# Commit Model for VS Code

Writes a Conventional Commits message (`feat: ...`, `fix(scope): ...`) from your staged changes with
a small fine-tuned model (Qwen2.5-Coder-1.5B + LoRA, 4-bit GGUF, ~1GB). Runs fully offline on your
machine, on the GPU when available (NVIDIA, AMD, Intel via Vulkan; Apple Silicon via Metal) or on the CPU.

On first start the extension downloads llama.cpp's `llama-server` build for your system (~12-33MB)
and the model (~1GB), then runs the server as a background process while the model is started.

## Use

1. Click **Commit Model: Off** in the bottom-left status bar to turn it **On**. The first time, it
   downloads the engine and the model (progress shows in the status bar).
2. In VS Code's terminal, stage your changes:
   ```
   $ git add .
   Commit Model suggests:  feat: add subtract function
   Commit with this message? [Y/N] y
   ✓ Committed 3f2a1bc  feat: add subtract function
   ```
   **Y** commits with the suggestion; **N** lets you type your own message (empty cancels).
3. Click **Commit Model: On** to turn it off and free the memory.

Only `git add` in VS Code's terminal triggers it: bash, zsh, Git Bash, PowerShell or Command Prompt.
On Windows, the first start may ask to install the Microsoft Visual C++ runtime (a free Microsoft
component the engine needs; many PCs already have it): click "Install it".
Save your files first: Git only sees saved changes. The ✨ button in the Source Control panel puts a suggestion in the commit box
instead. Terminals opened before the extension started need to be reopened once.

Only the first line (subject) is generated. Read it before typing Y: the model tends to label too many
changes as `fix`.

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

Tests (both use the locally quantized model and download the engine on first run):

```bash
npm run test:integration   # the whole workflow inside a real VS Code (~30s)
npm run test:smoke         # the engine alone, outside VS Code
```

Diff filtering and prompt building in `src/prompt.ts` mirror `src/commit_model/diff_utils.py`.
Keep the two in sync: the model expects prompts shaped exactly like its training data.

Why `llama-server` and not a native module: Snap VS Code (Ubuntu's default install) runs on Ubuntu
20.04's glibc, too old for current llama.cpp builds loaded inside VS Code (`GLIBC_2.32 not found`).
A separate process uses the system's libraries instead, and an engine crash can't take VS Code down.
