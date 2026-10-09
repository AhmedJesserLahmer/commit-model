// Runs the model in llama.cpp's llama-server, as a separate process.
//
// A separate process (rather than a native module inside VS Code) uses the system's own libraries.
// That matters on Linux: Snap VS Code runs on Ubuntu 20.04's glibc, too old for current llama.cpp
// builds, but a process it launches still gets the system's glibc. It also keeps an engine crash
// from taking VS Code down.
import { ChildProcess, execFile, spawn } from "child_process";
import * as fs from "fs/promises";
import * as net from "net";
import * as path from "path";

import { downloadFile, resolveModelUrl } from "./download";
import { MAX_NEW_TOKENS, Tokenizer, fitPrompt } from "./prompt";

// The llama.cpp release the model was quantized and verified with.
const LLAMA_TAG = "b11476";
// 1024 leaves headroom above the 768-token prompts the model was trained on.
const CONTEXT_SIZE = 1024;

export interface EngineOptions {
    /** Local .gguf path; used instead of modelUri when set. */
    modelPath: string;
    /** Hugging Face URI (hf:<user>/<repo>/<file>) or URL to download the model from. */
    modelUri: string;
    /** Folder where the engine and the model are downloaded. */
    storageDir: string;
    gpu: "auto" | "cpu";
}

export type StartPhase =
    | { phase: "downloading"; what: "engine" | "model"; percent: number }
    | { phase: "loading" };

interface Build {
    /** Release asset name without the extension, e.g. ubuntu-vulkan-x64. */
    variant: string;
    /** Whether this build can use the GPU (Vulkan, or Metal on macOS). */
    gpu: boolean;
}

/** Builds to try, best first: a GPU build when wanted, then a CPU-only one as the fallback. */
function candidateBuilds(useGpu: boolean): Build[] {
    const { platform, arch } = process;
    const a = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : undefined;
    if (!a) {
        throw new Error(`Unsupported processor architecture: ${arch}`);
    }
    if (platform === "darwin") {
        // macOS builds include Metal; CPU-only mode is chosen at launch with -ngl 0.
        return [{ variant: `macos-${a}`, gpu: useGpu }];
    }
    const [gpuBuild, cpuBuild] =
        platform === "linux" ? [`ubuntu-vulkan-${a}`, `ubuntu-${a}`]
        : platform === "win32" ? [`win-vulkan-${a}`, `win-cpu-${a}`]
        : [undefined, undefined];
    if (!cpuBuild) {
        throw new Error(`Unsupported operating system: ${platform}`);
    }
    const cpu = { variant: cpuBuild, gpu: false };
    return useGpu && gpuBuild ? [{ variant: gpuBuild, gpu: true }, cpu] : [cpu];
}

async function exists(file: string): Promise<boolean> {
    return fs.access(file).then(() => true, () => false);
}

async function findFile(dir: string, name: string): Promise<string | undefined> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === name) {
            return full;
        }
        if (entry.isDirectory()) {
            const found = await findFile(full, name);
            if (found) {
                return found;
            }
        }
    }
    return undefined;
}

function run(file: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(file, args, { ...options, timeout: 60_000 }, (error, stdout, stderr) => {
            error ? reject(new Error(`${path.basename(file)} failed: ${stderr || error.message}`)) : resolve(stdout + stderr);
        });
    });
}

/** Library search path so the server finds the shared libraries shipped next to it. */
function serverEnv(binDir: string): NodeJS.ProcessEnv {
    const join = (current?: string) => (current ? `${binDir}${path.delimiter}${current}` : binDir);
    return {
        ...process.env,
        LD_LIBRARY_PATH: join(process.env.LD_LIBRARY_PATH),
        DYLD_LIBRARY_PATH: join(process.env.DYLD_LIBRARY_PATH),
    };
}

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address() as net.AddressInfo;
            server.close(() => resolve(port));
        });
    });
}

/**
 * Picks the GPU to use. With several (e.g. an integrated Intel GPU next to an NVIDIA one), prefers
 * a dedicated GPU: llama.cpp would otherwise split the model across both.
 */
async function pickDevice(serverPath: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
    const output = await run(serverPath, ["--list-devices"], { cwd: path.dirname(serverPath), env }).catch(() => "");
    const devices = [...output.matchAll(/^\s*(\S+): (.+?) \(\d+ MiB/gm)].map((m) => ({ id: m[1], name: m[2] }));
    if (devices.length < 2) {
        return undefined;
    }
    const integrated = /intel|llvmpipe|swiftshader|microsoft basic/i;
    return (devices.find((d) => !integrated.test(d.name)) ?? devices[0]).id;
}

export class ModelEngine {
    private server?: ChildProcess;
    private baseUrl?: string;
    private starting?: Promise<void>;
    private stopping = false;

    /** @param onUnexpectedExit called if the server process dies on its own. */
    constructor(private readonly onUnexpectedExit: (reason: string) => void = () => undefined) {}

    get isRunning(): boolean {
        return this.server !== undefined && this.baseUrl !== undefined;
    }

    /** Downloads the engine and model if needed, then starts the server. Concurrent calls share one start. */
    start(options: EngineOptions, onPhase: (phase: StartPhase) => void): Promise<void> {
        if (this.isRunning) {
            return Promise.resolve();
        }
        this.starting ??= this.launch(options, onPhase).finally(() => {
            this.starting = undefined;
        });
        return this.starting;
    }

    private async launch(options: EngineOptions, onPhase: (phase: StartPhase) => void): Promise<void> {
        // Absolute, because the server runs from its own folder.
        const modelPath = path.resolve(options.modelPath || (await this.ensureModel(options, onPhase)));
        if (!(await exists(modelPath))) {
            throw new Error(`Model file not found: ${modelPath}`);
        }
        let lastError: unknown;
        for (const build of candidateBuilds(options.gpu !== "cpu")) {
            try {
                const serverPath = await this.ensureEngine(build, options.storageDir, onPhase);
                onPhase({ phase: "loading" });
                await this.startServer(serverPath, modelPath, build.gpu);
                return;
            } catch (error) {
                // A GPU build can fail on machines without working GPU drivers; the CPU build comes next.
                lastError = error;
            }
        }
        throw lastError;
    }

    private async ensureModel(options: EngineOptions, onPhase: (phase: StartPhase) => void): Promise<string> {
        const url = resolveModelUrl(options.modelUri);
        const dir = path.join(options.storageDir, "models");
        const modelPath = path.join(dir, path.basename(new URL(url).pathname));
        if (!(await exists(modelPath))) {
            await fs.mkdir(dir, { recursive: true });
            await downloadFile(url, modelPath, (percent) => onPhase({ phase: "downloading", what: "model", percent }));
        }
        return modelPath;
    }

    /** Returns the path to llama-server for this build, downloading and unpacking it the first time. */
    private async ensureEngine(build: Build, storageDir: string, onPhase: (phase: StartPhase) => void): Promise<string> {
        const dir = path.join(storageDir, "engine", LLAMA_TAG, build.variant);
        const serverName = process.platform === "win32" ? "llama-server.exe" : "llama-server";
        const doneMarker = path.join(dir, ".complete");
        if (!(await exists(doneMarker))) {
            await fs.rm(dir, { recursive: true, force: true });
            await fs.mkdir(dir, { recursive: true });
            const archiveName = `llama-${LLAMA_TAG}-bin-${build.variant}.${process.platform === "win32" ? "zip" : "tar.gz"}`;
            const archive = path.join(dir, archiveName);
            await downloadFile(
                `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/${archiveName}`,
                archive,
                (percent) => onPhase({ phase: "downloading", what: "engine", percent }),
            );
            // tar ships with Linux, macOS and Windows 10+, and Windows' tar also unpacks .zip.
            await run("tar", ["-xf", archive, "-C", dir], {});
            await fs.rm(archive);
            await fs.writeFile(doneMarker, "");
        }
        const serverPath = await findFile(dir, serverName);
        if (!serverPath) {
            throw new Error(`${serverName} not found in the downloaded engine (${dir})`);
        }
        return serverPath;
    }

    private async startServer(serverPath: string, modelPath: string, useGpu: boolean): Promise<void> {
        const binDir = path.dirname(serverPath);
        const env = serverEnv(binDir);
        const port = await freePort();
        const args = [
            "-m", modelPath,
            "-c", String(CONTEXT_SIZE),
            "-np", "1",
            "--host", "127.0.0.1",
            "--port", String(port),
            "-ngl", useGpu ? "99" : "0",
        ];
        const device = useGpu ? await pickDevice(serverPath, env) : undefined;
        if (device) {
            args.push("--device", device);
        }

        const server = spawn(serverPath, args, { cwd: binDir, env, stdio: ["ignore", "pipe", "pipe"] });
        let output = "";
        const keepTail = (chunk: Buffer) => {
            output = (output + chunk.toString()).slice(-4000);
        };
        server.stdout?.on("data", keepTail);
        server.stderr?.on("data", keepTail);
        let exited = false;
        server.on("exit", () => {
            exited = true;
        });

        const baseUrl = `http://127.0.0.1:${port}`;
        const deadline = Date.now() + 180_000;
        while (!(await this.isHealthy(baseUrl))) {
            if (exited) {
                throw new Error(`llama-server exited while loading the model:\n${output.trim().split("\n").slice(-8).join("\n")}`);
            }
            if (Date.now() > deadline) {
                server.kill();
                throw new Error("llama-server didn't become ready within 3 minutes");
            }
            await new Promise((resolve) => setTimeout(resolve, 300));
        }

        this.server = server;
        this.baseUrl = baseUrl;
        server.on("exit", (code) => {
            if (this.server !== server) {
                return;
            }
            this.server = this.baseUrl = undefined;
            if (!this.stopping) {
                this.onUnexpectedExit(`llama-server stopped unexpectedly (exit code ${code})`);
            }
        });
    }

    private async isHealthy(baseUrl: string): Promise<boolean> {
        try {
            const response = await fetch(`${baseUrl}/health`);
            return response.ok && ((await response.json()) as { status?: string }).status === "ok";
        } catch {
            return false;
        }
    }

    private async post<T>(endpoint: string, body: unknown): Promise<T> {
        if (!this.baseUrl) {
            throw new Error("Model isn't running");
        }
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`llama-server ${endpoint} failed (HTTP ${response.status}): ${await response.text()}`);
        }
        return (await response.json()) as T;
    }

    private readonly tokenizer: Tokenizer = {
        tokenize: async (text) =>
            (await this.post<{ tokens: number[] }>("/tokenize", { content: text, add_special: false })).tokens,
        detokenize: async (tokens) => (await this.post<{ content: string }>("/detokenize", { tokens })).content,
    };

    /** One-line commit message for an already-filtered diff. */
    async generate(diff: string): Promise<string> {
        const { content } = await this.post<{ content: string }>("/completion", {
            prompt: await fitPrompt(this.tokenizer, diff),
            n_predict: MAX_NEW_TOKENS,
            temperature: 0, // greedy, as in training evaluation
            top_k: 1,
            repeat_penalty: 1.0, // no repeat penalty: training and evaluation never used one
            stop: ["\n"], // only the first line is kept anyway
        });
        return (content.trim().split(/\r?\n/)[0] ?? "").trim();
    }

    /** Stops the server and frees its memory. If it's still starting, waits for that first. */
    async stop(): Promise<void> {
        await this.starting?.catch(() => undefined);
        const server = this.server;
        if (!server || server.exitCode !== null || server.signalCode !== null) {
            this.server = this.baseUrl = undefined;
            return;
        }
        this.stopping = true;
        try {
            const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
            server.kill();
            const timeout = setTimeout(() => server.kill("SIGKILL"), 5000);
            await exited;
            clearTimeout(timeout);
        } finally {
            this.stopping = false;
            this.server = this.baseUrl = undefined;
        }
    }
}
