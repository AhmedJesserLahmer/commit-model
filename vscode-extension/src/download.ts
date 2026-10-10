// Downloads with progress, for the engine and the model.
import * as fs from "fs/promises";

/** Turns `hf:<user>/<repo>/<file>` into a direct Hugging Face download URL; other URLs pass through. */
export function resolveModelUrl(uri: string): string {
    if (!uri.startsWith("hf:")) {
        return uri;
    }
    const [user, repo, ...file] = uri.slice(3).split("/");
    if (!user || !repo || file.length === 0) {
        throw new Error(`Invalid Hugging Face model URI "${uri}". Expected hf:<user>/<repo>/<file>.gguf`);
    }
    return `https://huggingface.co/${user}/${repo}/resolve/main/${file.join("/")}`;
}

/**
 * Downloads `url` to `dest`. Writes to `dest.part` first and renames at the end, so an interrupted
 * download never leaves a file that looks complete.
 */
export async function downloadFile(url: string, dest: string, onPercent: (percent: number) => void): Promise<void> {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body) {
        throw new Error(`Download failed (HTTP ${response.status}): ${url}`);
    }
    const total = Number(response.headers.get("content-length")) || 0;
    const partPath = `${dest}.part`;
    const file = await fs.open(partPath, "w");
    try {
        const reader = response.body.getReader();
        let received = 0;
        let lastReported = -1;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            await file.write(value);
            received += value.length;
            const percent = total ? Math.floor((100 * received) / total) : 0;
            if (percent !== lastReported) {
                lastReported = percent;
                onPercent(percent);
            }
        }
        if (total && received !== total) {
            throw new Error(`Download incomplete (${received} of ${total} bytes), connection interrupted? Try again.`);
        }
    } catch (error) {
        await file.close();
        await fs.rm(partPath, { force: true });
        throw error;
    }
    await file.close();
    await fs.rename(partPath, dest);
}
