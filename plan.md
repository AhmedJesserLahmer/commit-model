# Plan

Goal: ship the fine-tuned model as a local commit-message tool that runs on any VS Code user's machine,
installed as one extension that handles the engine, model download and running.

**Done:**
- Data filtering, LoRA fine-tuning, evaluation (`results.md`)
- Merge + 4-bit quantization, run locally (`merged_weights_quantized_model/`); no measurable quality loss
- VS Code extension MVP code (`vscode-extension/`, details in `MVP.md`): node-llama-cpp engine, Start / Stop /
  Generate commands. Engine verified outside VS Code on 200 test examples (same quality as fp32).

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
- **Task:** per-platform `.vsix` builds (node-llama-cpp's engine binaries differ per OS/GPU; `node_modules`
  is ~900MB with every CUDA variant), test on a machine without an NVIDIA GPU, publish to the Marketplace.
- **Why:** users install from the Marketplace; one package with every platform's binaries would be far too big.

## 5. Improve the model
- **Task:** cap `fix` examples in the training data, fine-tune again, compare with `results.md`, then
  re-merge, re-quantize and upload.
- **Why:** the model labels too much as `fix` (feat/chore/refactor are right only ~35% of the time).

## 6. Update the README
- **Task:** document the full workflow: data, training, evaluation, merge, quantize, extension.
- **Why:** it describes settings and steps that no longer exist.

## Later (optional)
- Auto-unload the model after idle time; use Ollama when it's already installed; message bodies for large diffs.
