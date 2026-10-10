// The terminal prompt. VS Code's integrated terminals get a `git` wrapper (see terminalSetup.ts) that
// runs this after a successful `git add` while Commit Model is on: it prints a suggested message,
// asks Y/N, and commits. On Windows it only writes the suggestion (`--suggest`), see main().
//
// Runs as a separate Node process (VS Code's own runtime), configured through environment variables:
//   COMMIT_MODEL_STATE     file the extension writes while on: {"url": "<llama-server address>"}
//   COMMIT_MODEL_REAL_GIT  the real git executable
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as readline from "readline";

import { ServerClient, isHealthy } from "./client";
import { buildDiff } from "./prompt";

const realGit = process.env.COMMIT_MODEL_REAL_GIT || "git";
const color = (code: number, text: string) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const dim = (text: string) => color(2, text);
const bold = (text: string) => color(1, text);
const green = (text: string) => color(32, text);

function git(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(realGit, args, { encoding: "utf8" });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function serverUrl(): string | undefined {
    try {
        return JSON.parse(fs.readFileSync(process.env.COMMIT_MODEL_STATE ?? "", "utf8")).url;
    } catch {
        return undefined; // turned off
    }
}

/**
 * Reads answers line by line. Lines are queued as they arrive, so answers typed ahead or pasted
 * together aren't lost (readline/promises drops lines that arrive while no question is waiting).
 */
class Answers {
    private readonly lines: string[] = [];
    private waiting?: (line: string | undefined) => void;
    private closed = false;
    private readonly rl = readline.createInterface({ input: process.stdin, terminal: false });

    constructor() {
        this.rl.on("line", (line) => {
            if (this.waiting) {
                const resolve = this.waiting;
                this.waiting = undefined;
                if (!process.stdin.isTTY) {
                    process.stdout.write(`${line}\n`);
                }
                resolve(line);
            } else {
                this.lines.push(line);
            }
        });
        this.rl.on("close", () => {
            this.closed = true;
            this.waiting?.(undefined);
        });
    }

    /** Prints the question and returns the next line; undefined if the input ended (Ctrl+D). */
    ask(question: string): Promise<string | undefined> {
        process.stdout.write(question);
        const line = this.lines.shift();
        if (line !== undefined || this.closed) {
            if (!process.stdin.isTTY) {
                process.stdout.write(`${line ?? ""}\n`); // echo piped answers, as a terminal would show them
            }
            return Promise.resolve(line);
        }
        return new Promise((resolve) => (this.waiting = resolve));
    }

    close(): void {
        this.rl.close();
    }
}

/** Asks until the answer is Y or N; undefined if the input ends (Ctrl+D). */
async function askYesNo(answers: Answers): Promise<"y" | "n" | undefined> {
    for (;;) {
        const answer = await answers.ask(`Commit with this message? ${bold("[Y/N]")} `);
        if (answer === undefined) {
            return undefined;
        }
        const normalized = answer.trim().toLowerCase();
        if (["y", "yes"].includes(normalized)) {
            return "y";
        }
        if (["n", "no"].includes(normalized)) {
            return "n";
        }
        console.log(dim("Please type Y or N."));
    }
}

function commit(message: string): void {
    const result = git(["commit", "-q", "-m", message]);
    if (result.status === 0) {
        const hash = git(["rev-parse", "--short", "HEAD"]).stdout.trim();
        console.log(`${green("✓ Committed")} ${dim(hash)}  ${message}`);
    } else {
        console.log(`Commit failed:\n${(result.stderr || result.stdout).trim()}`);
    }
}

/** What to tell the user after `git add`: nothing (off), a note, or a suggested message. */
type Suggestion = { status: "off" } | { status: "info"; text: string } | { status: "message"; message: string };

async function suggest(onGenerating: () => void): Promise<Suggestion> {
    const url = serverUrl();
    if (!url) {
        return { status: "off" };
    }
    const diff = git(["diff", "--cached"]).stdout;
    if (!diff.trim()) {
        return { status: "info", text: "Commit Model: nothing is staged, so there's no message to suggest. " +
            "(Changes still open in the editor? Save them first.)" };
    }
    const filtered = buildDiff(diff);
    if (filtered === null) {
        return { status: "info", text: "Commit Model: only lockfiles or generated files are staged, so there's nothing to describe." };
    }
    if (!(await isHealthy(url))) {
        return { status: "info", text: "Commit Model: the model isn't responding. Turn it off and on again in VS Code's status bar." };
    }
    onGenerating();
    const message = await new ServerClient(url).generate(filtered);
    return message
        ? { status: "message", message }
        : { status: "info", text: "Commit Model couldn't come up with a message for these changes." };
}

/** The conversation in the terminal (Linux, macOS): suggestion, Y/N, commit. */
async function interactive(): Promise<void> {
    // Only in an interactive terminal: scripts and tools running `git add` get plain git. (The bash
    // wrapper checks this too, before starting Node.)
    if (!process.stdin.isTTY && !process.env.COMMIT_MODEL_FORCE_PROMPT) {
        return;
    }
    let writing = false;
    const result = await suggest(() => {
        writing = true;
        process.stdout.write(dim("Commit Model is writing a message…"));
    });
    if (writing) {
        process.stdout.write(process.stdout.isTTY ? "\r\x1b[2K" : "\n");
    }
    if (result.status === "info") {
        console.log(dim(result.text));
    }
    if (result.status !== "message") {
        return;
    }
    const message = result.message;
    console.log(`Commit Model suggests:  ${bold(message)}`);

    const answers = new Answers();
    try {
        const answer = await askYesNo(answers);
        if (answer === "y") {
            commit(message);
            return;
        }
        if (answer === "n") {
            const own = ((await answers.ask("Your commit message (empty to cancel): ")) ?? "").trim();
            if (own) {
                commit(own);
                return;
            }
        }
        console.log("Nothing committed. Your changes stay staged.");
    } finally {
        answers.close();
    }
}

async function main(): Promise<void> {
    // `--suggest <file>`: Windows. VS Code's runtime (Code.exe) is a windowed program there and can't read
    // the keyboard, so it only writes the suggestion to <file>; a console PowerShell script
    // (commit-model-prompt.ps1, see terminalSetup.ts) does the conversation and the commit.
    if (process.argv[2] === "--suggest") {
        fs.writeFileSync(process.argv[3], JSON.stringify(await suggest(() => undefined)));
        return;
    }
    await interactive();
}

main().catch((error) => {
    const text = `Commit Model: ${error instanceof Error ? error.message : String(error)}`;
    if (process.argv[2] === "--suggest") {
        fs.writeFileSync(process.argv[3], JSON.stringify({ status: "info", text }));
    } else {
        console.log(text);
    }
});
