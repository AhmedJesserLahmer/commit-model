// Smoke test: runs test examples through the extension's own prompt building and engine, outside VS Code.
//
// Usage (after `npm run compile`):
//   node test/smoke.mjs <model.gguf> [test.jsonl] [count] [expected.jsonl]
//
// expected.jsonl: optional {"pred": ...} lines from another run of the same model (e.g. llama.cpp's
// llama-server) to compare against, line by line.
import { readFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { ModelEngine } = require("../dist/engine.js");
const { buildDiff } = require("../dist/prompt.js");

const [modelPath, testFile = "../data/processed/test.jsonl", count = "5", expectedFile] = process.argv.slice(2);
if (!modelPath) {
    console.error("usage: node test/smoke.mjs <model.gguf> [test.jsonl] [count] [expected.jsonl]");
    process.exit(2);
}

const readJsonl = (file) => readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const examples = readJsonl(testFile).slice(0, Number(count));
const expected = expectedFile ? readJsonl(expectedFile) : [];

const engine = new ModelEngine();
const started = Date.now();
await engine.start({ modelPath, modelUri: "", downloadDir: "", gpu: "auto" }, () => {});
console.log(`Model loaded in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

let matches = 0;
let failures = 0;
for (const [i, example] of examples.entries()) {
    const diff = buildDiff(example.diff);
    if (diff === null) {
        console.log(`#${i}: filtered out (no usable diff)\n`);
        continue;
    }
    const t = Date.now();
    const pred = await engine.generate(diff);
    const ok = /^(feat|fix|refactor|chore|docs|test|perf|style|build|ci)(\([\w./-]+\))?!?:\s+\S/.test(pred);
    failures += ok ? 0 : 1;
    console.log(`#${i} (${Date.now() - t}ms)${ok ? "" : "  INVALID FORMAT"}`);
    console.log(`  ref:      ${example.message}`);
    console.log(`  pred:     ${pred}`);
    if (expected[i]) {
        const same = expected[i].pred === pred;
        matches += same ? 1 : 0;
        console.log(`  expected: ${expected[i].pred}${same ? "  (same)" : "  (DIFFERENT)"}`);
    }
    console.log();
}

await engine.stop();
if (expected.length) {
    console.log(`Same as expected: ${matches}/${examples.length}`);
}
console.log(failures ? `${failures} invalid message(s)` : "All messages valid");
process.exit(failures ? 1 : 0);
