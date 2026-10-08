# VS Code extension MVP (node-llama-cpp engine)

## Context

The fine-tuned model is done, evaluated (`results.md`), merged and quantized to a 986MB GGUF
(`merged_weights_quantized_model/quantized-model/commit-model-Q4_K_M.gguf`) with no measurable quality
loss. The goal now is the easiest possible experience for users: install one VS Code extension and
it handles everything: engine, model download, running. No Ollama, no Python, no manual Hugging Face steps.

Decisions made: **node-llama-cpp** as the engine (bundles llama.cpp for Win/macOS/Linux with CUDA, Vulkan,
Metal or CPU); the **user uploads the GGUF to Hugging Face**; the extension gets **manual Start / Stop /
Generate commands**. No more performance testing now. After the MVP works: CI tests, then model accuracy.

Checked: Node 24, npm 11, VS Code 1.140 installed. node-llama-cpp 3.22.1 (MIT) provides everything
needed: `getLlama({gpu: "auto"})`, `resolveModelFile(uri, {directory, onProgress})` (downloads `hf:` URIs
with progress), `LlamaCompletion.generateCompletion(prompt, {maxTokens, temperature, customStopTriggers})`
for plain-text completion (no chat template, as trained), and `model.tokenize/detokenize` for exact
token-based truncation. It is **ESM-only**, so the extension loads it with dynamic `import()`.

## Your part: upload the model to Hugging Face

1. Create a public model repo on huggingface.co (e.g. `<username>/commit-model`)
2. Upload `commit-model-Q4_K_M.gguf` (optionally `Modelfile` and a model card)
3. Give me `<username>/<repo>`; the extension's default model URI becomes
   `hf:<username>/<repo>/commit-model-Q4_K_M.gguf`

Not blocking: until then the extension is tested with a local model path setting.

## Implementation: new `vscode-extension/` folder in this repo

- **`package.json`** (extension manifest)
  - Commands: `commitModel.start`, `commitModel.stop`, `commitModel.generate` ("Commit Model: Start / Stop / Generate Commit Message")
  - `scm/title` menu: sparkle button for Generate when `scmProvider == git`
  - Settings: `commitModel.modelUri` (HF URI), `commitModel.modelPath` (local GGUF, overrides the URI; for dev),
    `commitModel.gpu` (`auto` default, or `false` for CPU)
  - `extensionDependencies: ["vscode.git"]`; deps: `node-llama-cpp`; dev: `typescript`, `@types/vscode`, `@types/node`, `@vscode/vsce`
- **`tsconfig.json`**: `module: node16` so `import("node-llama-cpp")` stays a real dynamic import (CommonJS output would break the ESM package)
- **`src/engine.ts`**: `ModelEngine`, single loaded instance
  - `start(onProgress)`: `getLlama({gpu})`, resolve the model (local path, or `resolveModelFile` into the extension's global storage, reporting download %), `loadModel`, `createContext({contextSize: 1024})`, `LlamaCompletion`. Concurrent calls share one in-flight start.
  - `generate(prompt)`: `generateCompletion(prompt, {maxTokens: 40, temperature: 0, customStopTriggers: ["\n"]})`, first line, trimmed (same decoding as the evals)
  - `stop()`: dispose context, model and llama to free VRAM/RAM
- **`src/prompt.ts`**: TypeScript port of `src/commit_model/diff_utils.py`, kept identical (comment says to keep in sync)
  - Generated/lockfile patterns, `MAX_DIFF_CHARS = 4000`, `MAX_FILES_PER_DIFF = 6`, `splitDiffByFile`, `truncateDiff`, `buildDiff`
  - `fitPrompt(model, diff)`: same as Python `fit_prompt`: `SEQ_LEN = 768`, 40 reserved, minus 8; truncates the diff's tokens, never the prompt's tail, using the model's own tokenizer
  - Same `PROMPT_TEMPLATE` string
- **`src/git.ts`**: built-in Git API (`vscode.git`, `getAPI(1)`): pick the repository for the active file (else the first), `repository.diff(true)` for the staged diff, write the result to `repository.inputBox.value`
- **`src/extension.ts`**: registers the three commands and a status-bar item (Off / Downloading x% / Loading / Ready / Generating)
  - **Start**: notification progress (download % on first run, then "Loading model")
  - **Stop**: unloads the model
  - **Generate**: starts the model first if it's off; clear messages for "nothing staged" and "only lockfiles/generated files staged"; progress shown in the Source Control view
- **`.vscode/launch.json`** + `README.md` in `vscode-extension/`: F5 runs the extension in a development window; setup steps

Then update the repo's `plan.md` to the new order: extension MVP → CI tests → model accuracy.

## Verification

1. `npm install && npm run compile` in `vscode-extension/`: no type errors
2. F5 → in the dev window open any git repo, set `commitModel.modelPath` to the local GGUF, run **Start**: status bar shows Ready; `nvidia-smi` shows ~1GB used (GPU engaged)
3. Stage a change, click the sparkle button: a Conventional Commits message appears in the commit box
4. Edge cases: nothing staged, only `package-lock.json` staged, Stop then Generate (auto-starts), Generate twice quickly
5. Correctness check that the port matches: run the first 5 test examples through `prompt.ts` + engine and compare with the
   earlier llama.cpp outputs for the same examples. They should match, apart from rare tiny differences. This is a wiring check, not
   performance testing, and it becomes the seed of the CI tests.
6. After the HF upload: clear `modelPath`, set `modelUri`, run Start: downloads with progress into global storage, then works; restart VS Code: no re-download

## Not in this MVP (next phases)

- Packaging per-platform `.vsix` and publishing to the Marketplace (node-llama-cpp's native binaries differ per OS/GPU)
- CI tests (Python/TS truncation parity, engine smoke test)
- Auto-unload after idle, optional Ollama backend, terminal CLI changes
- Model accuracy work (rebalancing `fix`)
