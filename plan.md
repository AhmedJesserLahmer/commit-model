# Plan

Goal: ship the fine-tuned model as a local commit-message tool that runs on any VS Code user's machine,
installed as one extension that handles the engine, model download and running.

**Done:**
- Data filtering, LoRA fine-tuning, evaluation (`results.md`)
- Merge + 4-bit quantization, run locally (`merged_weights_quantized_model/`); no measurable quality loss
- VS Code extension MVP code (`vscode-extension/`, details in `MVP.md`): llama.cpp's `llama-server` as the
  engine (downloaded per platform on first start), Start / Stop / Generate commands. Engine verified outside
  VS Code, including inside Snap VS Code's runtime.

## 1. Finish the MVP
- **Task:** upload `commit-model-Q4_K_M.gguf` to Hugging Face and set the extension's default `modelUri`;
  try the extension in VS Code (F5) on real commits.
- **Why:** the download-on-first-start flow and the Source Control button can only be checked inside VS Code.

## 2. Commit current work
- **Task:** commit the extension, notebooks, scripts, `results.md`, `plan.md`, `MVP.md`.
- **Why:** none of this session's work is in git yet.

## 3. CI tests
- **Task:** GitHub Actions running on every push:
  - Python/TypeScript prompt parity: `diff_utils.py` and `prompt.ts` must build identical prompts
  - extension compiles; engine smoke test (`vscode-extension/test/smoke.mjs`) with the model cached
- **Why:** the prompt logic exists in two languages and the model depends on it exactly; CI catches drift
  and keeps the working engine from breaking.

## 4. Package and publish the extension
- **Task:** package the `.vsix` (no native code inside: the engine downloads per platform), test on Windows,
  macOS and a machine without a GPU, publish to the Marketplace.
- **Why:** users install from the Marketplace; the engine download has only been tested on Linux so far.

## 5. Improve the model
- **Task:** in `CommitBench_filter.ipynb`, cap `fix` examples and remove CommitBench's placeholders from
  the messages (`<I>` for numbers, `<URL>`, `<EMAIL>`: same rule as `clean_message` in
  `src/commit_model/postprocess.py`); fine-tune again, compare with `results.md`, then re-merge,
  re-quantize and upload.
- **Why:** the model labels too much as `fix` and never picks the rare types (`build`, `ci`, `perf`,
  `style` all got a common type in the 10 test scenarios). 24% of training messages contain a
  placeholder, so the model writes things like `(#<I>)`; the extension and CLI strip them for now.

## 6. Update the README
- **Task:** document the full workflow: data, training, evaluation, merge, quantize, extension.
- **Why:** it describes settings and steps that no longer exist.

## Later (optional)
- Auto-unload the model after idle time; use Ollama when it's already installed; message bodies for large diffs.
