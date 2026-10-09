// Talks to a running llama-server: tokenizing, and generating a commit message for a diff.
// Shared by the extension and the terminal prompt (terminal.ts).
import { MAX_NEW_TOKENS, Tokenizer, fitPrompt } from "./prompt";

export async function isHealthy(baseUrl: string): Promise<boolean> {
    try {
        const response = await fetch(`${baseUrl}/health`);
        return response.ok && ((await response.json()) as { status?: string }).status === "ok";
    } catch {
        return false;
    }
}

export class ServerClient {
    constructor(readonly baseUrl: string) {}

    private async post<T>(endpoint: string, body: unknown): Promise<T> {
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
}
