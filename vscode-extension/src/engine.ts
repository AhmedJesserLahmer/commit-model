// Loads the GGUF model with node-llama-cpp and generates commit messages from prompts.
import type { Llama, LlamaCompletion, LlamaContext, LlamaModel } from "node-llama-cpp" with { "resolution-mode": "import" };

import { MAX_NEW_TOKENS, fitPrompt } from "./prompt";

export interface EngineOptions {
    /** Local .gguf path; used instead of modelUri when set. */
    modelPath: string;
    /** Hugging Face URI or URL to download the model from. */
    modelUri: string;
    /** Folder the downloaded model is stored in. */
    downloadDir: string;
    gpu: "auto" | "cpu";
}

export type StartPhase = { phase: "downloading"; percent: number } | { phase: "loading" };

export class ModelEngine {
    private llama?: Llama;
    private model?: LlamaModel;
    private context?: LlamaContext;
    private completion?: LlamaCompletion;
    private starting?: Promise<void>;

    get isRunning(): boolean {
        return this.completion !== undefined;
    }

    /** Loads the model, downloading it first if needed. Concurrent calls share one start. */
    start(options: EngineOptions, onPhase: (phase: StartPhase) => void): Promise<void> {
        if (this.isRunning) {
            return Promise.resolve();
        }
        this.starting ??= this.load(options, onPhase).finally(() => {
            this.starting = undefined;
        });
        return this.starting;
    }

    private async load(options: EngineOptions, onPhase: (phase: StartPhase) => void): Promise<void> {
        // node-llama-cpp is ESM-only; a dynamic import works from this CommonJS extension.
        const { getLlama, resolveModelFile, LlamaCompletion } = await import("node-llama-cpp");

        let modelPath = options.modelPath;
        if (!modelPath) {
            modelPath = await resolveModelFile(options.modelUri, {
                directory: options.downloadDir,
                cli: false,
                onProgress: ({ totalSize, downloadedSize }) => {
                    onPhase({ phase: "downloading", percent: totalSize ? (100 * downloadedSize) / totalSize : 0 });
                },
            });
        }

        onPhase({ phase: "loading" });
        try {
            this.llama = await getLlama({ gpu: options.gpu === "cpu" ? false : "auto" });
            this.model = await this.llama.loadModel({ modelPath });
            // 1024 leaves headroom above the 768-token prompts the model was trained on.
            this.context = await this.model.createContext({ contextSize: 1024 });
            this.completion = new LlamaCompletion({ contextSequence: this.context.getSequence() });
        } catch (error) {
            await this.unload();
            throw error;
        }
    }

    /** One-line commit message for an already-filtered diff. */
    async generate(diff: string): Promise<string> {
        if (!this.completion || !this.model) {
            throw new Error("Model isn't running");
        }
        const text = await this.completion.generateCompletion(fitPrompt(this.model, diff), {
            maxTokens: MAX_NEW_TOKENS,
            temperature: 0, // greedy, as in training evaluation
            // node-llama-cpp enables a repeat penalty by default. It pushes the model away from words in
            // the diff (e.g. dropping a "(cache)" scope), which training and evaluation never used.
            repeatPenalty: false,
            customStopTriggers: ["\n"], // only the first line is kept anyway
        });
        return (text.trim().split(/\r?\n/)[0] ?? "").trim();
    }

    /** Unloads the model and frees its memory. If it's still loading, waits for that first. */
    async stop(): Promise<void> {
        await this.starting?.catch(() => undefined);
        await this.unload();
    }

    private async unload(): Promise<void> {
        const { context, model, llama } = this;
        this.completion = this.context = this.model = this.llama = undefined;
        await context?.dispose();
        await model?.dispose();
        await llama?.dispose();
    }
}
