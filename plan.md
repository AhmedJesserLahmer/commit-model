# Plan

Goal: ship the fine-tuned model as a local commit-message tool that runs on any VS Code user's machine.

**Done:** data filtering, LoRA fine-tuning, evaluation (`results.md`). Merge and quantize notebooks written, not yet run.

## 1. Commit current work
- **Task:** commit the truncation fix, the eval baseline flag, the new notebooks, `results.md`, `plan.md`.
- **Why:** none of it is in git yet; one lost file or bad edit would undo a day of work.

## 2. Merge the adapter (`merge_adapter_Kaggle.ipynb`)
- **Task:** fold the LoRA adapter into the base model, producing one standalone model.
- **Why:** GGUF, Ollama and Hugging Face users need a single model, not base + adapter loaded through PEFT.

## 3. Quantize to 4-bit (`quantize_gguf_Kaggle.ipynb`)
- **Task:** convert the merged model to a ~1GB 4-bit GGUF and check its scores against fp32 on the same 200 examples.
- **Why:** full precision needs ~6GB and an NVIDIA GPU; 4-bit GGUF runs on any machine. The check confirms
  quantizing didn't hurt quality. If type accuracy drops by more than ~3 points, use `Q5_K_M` or `Q8_0` instead.

## 4. Run it locally with Ollama
- **Task:** `ollama create commit-model -f Modelfile`, try it on real diffs, then make `cli.py` call Ollama
  instead of loading the model with PyTorch.
- **Why:** proves the quantized model works outside Kaggle, makes the CLI light (no torch, PEFT or GPU
  requirement), and removes the adapter-path problem: the model is called by name.

## 5. Publish the model on Hugging Face
- **Task:** upload the merged model, the GGUF, the `Modelfile` and a model card (prompt format, results, known `fix` bias).
- **Why:** the VS Code extension and its users need a public place to download the model from.

## 6. Build the VS Code extension
- **Task:** a "Generate commit message" button in the Source Control panel: reads the staged diff, calls
  Ollama, fills the commit box. Clear error if Ollama or the model is missing.
- **Why:** the git hook likely doesn't fill the message when committing from VS Code's panel (VS Code
  passes its own message, so the hook skips). A button is how VS Code users expect this to work.
  Verify the hook behaviour first.

## 7. Update the README
- **Task:** document the full workflow: data, training, evaluation, merge, quantize, Ollama, extension.
- **Why:** it currently describes settings and steps that no longer exist.

## Later: improve the model (optional)
- **Task:** cap `fix` examples in the training data, fine-tune again, compare with `results.md`.
- **Why:** the model labels too much as `fix` (feat/chore/refactor are right only ~35% of the time).
  Only worth it if this bothers you in real use.
