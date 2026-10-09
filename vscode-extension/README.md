# Commit Model for VS Code

Writes a Conventional Commits message (`feat: ...`, `fix(scope): ...`) from your staged changes with
a small fine-tuned model (Qwen2.5-Coder-1.5B + LoRA, 4-bit GGUF, ~1GB). Runs fully offline on your
machine, on the GPU when available (NVIDIA, AMD, Intel via Vulkan; Apple Silicon via Metal) or on the CPU.

On first start the extension downloads llama.cpp's `llama-server` build for your system (~12-33MB)
and the model (~1GB), then runs the server as a background process while the model is started.

## Use

- Click the ✨ button in the Source Control panel: the message appears in the commit box. The model
  starts automatically the first time.
- Command Palette (Ctrl+Shift+P):
  - **Commit Model: Start**: load the model (downloads the engine and model on the very first start)
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

F5 starts the window with your other extensions disabled, so they can't interfere with the test.

Smoke test outside VS Code (downloads the engine on first run):

```bash
node test/smoke.mjs ../merged_weights_quantized_model/quantized-model/commit-model-Q4_K_M.gguf
```

Diff filtering and prompt building in `src/prompt.ts` mirror `src/commit_model/diff_utils.py`.
Keep the two in sync: the model expects prompts shaped exactly like its training data.

Why `llama-server` and not a native module: Snap VS Code (Ubuntu's default install) runs on Ubuntu
20.04's glibc, too old for current llama.cpp builds loaded inside VS Code (`GLIBC_2.32 not found`).
A separate process uses the system's libraries instead, and an engine crash can't take VS Code down.
