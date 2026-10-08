# Commit Model for VS Code

Writes a Conventional Commits message (`feat: ...`, `fix(scope): ...`) from your staged changes with
a small fine-tuned model (Qwen2.5-Coder-1.5B + LoRA, 4-bit GGUF, ~1GB). Runs fully offline on your
machine, on the GPU when available (NVIDIA, AMD, Intel, Apple Silicon) or on the CPU.

## Use

- Click the ✨ button in the Source Control panel: the message appears in the commit box. The model
  starts automatically the first time.
- Command Palette (Ctrl+Shift+P):
  - **Commit Model: Start**: load the model (downloads it on the very first start)
  - **Commit Model: Stop**: unload it and free memory
  - **Commit Model: Generate Commit Message**
- The status bar shows the model's state. Click it to start or stop.

Only the first line (subject) is generated. Review it before committing: the model tends to label
too many changes as `fix`.

## Settings

| Setting | Default | |
|---|---|---|
| `commitModel.modelUri` | Hugging Face URI | Where the model is downloaded from on first start |
| `commitModel.modelPath` | empty | Local `.gguf` file; used instead of downloading when set |
| `commitModel.gpu` | `auto` | `cpu` forces CPU-only |

## Develop

```bash
cd vscode-extension
npm install
npm run compile
```

Open the `vscode-extension` folder in VS Code and press F5: a development window opens with the
extension loaded. In it, set `commitModel.modelPath` to a local model, for example
`merged_weights_quantized_model/quantized-model/commit-model-Q4_K_M.gguf` (absolute path), open a
Git repository, stage a change and click ✨.

Diff filtering and prompt building in `src/prompt.ts` mirror `src/commit_model/diff_utils.py`.
Keep the two in sync: the model expects prompts shaped exactly like its training data.
