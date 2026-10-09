// Diff filtering and prompt building: a port of src/commit_model/diff_utils.py.
//
// Keep the two in sync. The model was trained on diffs shaped by this policy, so the extension
// must shape live diffs the same way or the prompts drift from what the model saw in training.
// Python slices strings by code point, so the slicing here does too (not by UTF-16 unit).

export const PROMPT_TEMPLATE = "Write a Conventional Commits message for this diff.\n\n{diff}\n\nCommit message:";

// Must match SEQ_LEN in fine-tuning_Kaggle.ipynb: the model never saw longer prompts.
export const SEQ_LEN = 768;
export const MAX_NEW_TOKENS = 40;

const MAX_DIFF_CHARS = 4000;
const MAX_FILES_PER_DIFF = 6;

const GENERATED_FILE_PATTERNS = [
    /package-lock\.json$/, /yarn\.lock$/, /pnpm-lock\.yaml$/,
    /Cargo\.lock$/, /Gemfile\.lock$/, /poetry\.lock$/, /uv\.lock$/,
    /\.min\.(js|css)$/, /\.map$/, /\/dist\//, /\/build\//, /\/vendor\//,
    /\.svg$/, /\.snap$/,
];

/** The model's own tokenizer (served by llama-server's /tokenize and /detokenize). */
export interface Tokenizer {
    tokenize(text: string): Promise<number[]>;
    detokenize(tokens: number[]): Promise<string>;
}

function sliceCodePoints(text: string, end: number): string {
    return Array.from(text).slice(0, end).join("");
}

export function isGeneratedPath(path: string): boolean {
    return GENERATED_FILE_PATTERNS.some((pattern) => pattern.test(path));
}

/** Split a unified diff into [path, hunkText] chunks. */
export function splitDiffByFile(diff: string): [string, string][] {
    const files: [string, string][] = [];
    for (const chunk of diff.split(/(?=^diff --git )/m)) {
        if (!chunk.trim()) {
            continue;
        }
        const match = /^diff --git a\/(\S+) b\/(\S+)/.exec(chunk);
        files.push([match ? match[2] : "unknown", chunk]);
    }
    return files;
}

/** Drop generated/lockfile paths, cap file count, and cap total length. */
export function truncateDiff(diff: string): string | null {
    let kept = splitDiffByFile(diff).filter(([path]) => !isGeneratedPath(path));
    if (kept.length === 0) {
        return null;
    }
    kept = kept.slice(0, MAX_FILES_PER_DIFF);

    const share = Math.max(Math.floor(MAX_DIFF_CHARS / kept.length), 200);
    const joined = kept.map(([, chunk]) => sliceCodePoints(chunk, share)).join("");
    return sliceCodePoints(joined, MAX_DIFF_CHARS);
}

/** The filtered diff, or null when nothing useful is left (e.g. only lockfiles changed). */
export function buildDiff(diff: string): string | null {
    const truncated = truncateDiff(diff);
    if (truncated === null || truncated.trim().length < 20) {
        return null;
    }
    return truncated;
}

/**
 * Format the prompt, truncating the diff (not the prompt's tail) to fit SEQ_LEN.
 *
 * Mirrors the training-time truncation: `reserveTokens` stands in for the commit message, so the
 * instruction and trailing "Commit message:" always survive.
 */
export async function fitPrompt(tokenizer: Tokenizer, diff: string, reserveTokens = MAX_NEW_TOKENS): Promise<string> {
    const templateTokens = (await tokenizer.tokenize(PROMPT_TEMPLATE.replace("{diff}", ""))).length;
    const budget = Math.max(SEQ_LEN - templateTokens - reserveTokens - 8, 0);
    const diffTokens = (await tokenizer.tokenize(diff)).slice(0, budget);
    const truncatedDiff = await tokenizer.detokenize(diffTokens);
    return PROMPT_TEMPLATE.replace("{diff}", () => truncatedDiff);
}
