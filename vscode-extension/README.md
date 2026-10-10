# Commit Model

Stage your changes in VS Code's terminal and get a commit message suggested right there:

```
$ git add .
Commit Model suggests:  feat: add subtract function
Commit with this message? [Y/N] y
✓ Committed 3f2a1bc  feat: add subtract function
```

**Y** commits with the suggestion. **N** lets you type your own message (empty cancels). The messages
follow [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix(scope):`, `docs:` ...).

It runs a small fine-tuned model **on your machine**: no account, no API key, and your code never leaves
your computer.

## Getting started

1. Click **Commit Model: Off** in the bottom-left status bar to turn it **On**. The first time, it
   downloads the engine and the model (about 1 GB, once); progress shows in the status bar.
2. Open a terminal in VS Code, save your files, and run `git add .`.
3. Answer **Y** or **N**.

Click **Commit Model: On** to turn it off and free the memory it uses (about 1 GB).

Only `git add` in VS Code's terminal triggers it: other git commands, the + buttons in Source Control,
scripts, and everything while it's off work exactly as before. Terminals that were open before you
installed the extension need to be reopened once.

The ✨ button in the Source Control panel puts a suggestion in the commit box instead.

## Requirements

- Git, and a VS Code terminal: bash, zsh, Git Bash, PowerShell or Command Prompt.
- About 1.1 GB of disk space for the model and engine, and about 1 GB of memory while it's on.
- A GPU is used when available (NVIDIA, AMD and Intel on Windows and Linux, Apple Silicon on macOS);
  otherwise it runs on the CPU (a second or two per message).
- **Windows:** the engine needs the Microsoft Visual C++ runtime. Many PCs already have it; if yours
  doesn't, the extension offers to install it from Microsoft (click **Install it**; Windows asks for
  permission).

## Privacy

Everything runs locally. The only network access is the one-time download of the engine (from
llama.cpp's GitHub releases) and the model (from Hugging Face), and on Windows, if you accept, the
Microsoft runtime installer.

## Good to know

- Only the first line (subject) is written. Read it before typing **Y**.
- The model tends to label too many changes as `fix`, and rarely picks `build`, `ci`, `perf` or `style`.
  Its descriptions are usually accurate even when the type is off.
- This is a preview release. It has been tested on Linux and Windows 11; macOS should work but hasn't
  been tested yet.

## Commands

**Commit Model: Turn On / Off**, **Turn On**, **Turn Off**, **Suggest Commit Message in the Commit Box**
(Command Palette, Ctrl+Shift+P). Activity log: Output panel → **Commit Model**.

## Settings

| Setting | Default | |
|---|---|---|
| `commitModel.gpu` | `auto` | `cpu` to always run on the CPU |
| `commitModel.modelUri` | `hf:Jess2005/commit-model-CLI/commit-model-Q4_K_M.gguf` | Where the model is downloaded from |
| `commitModel.modelPath` | empty | A local `.gguf` model to use instead of downloading |

## The model

[`Jess2005/commit-model-CLI`](https://huggingface.co/Jess2005/commit-model-CLI): Qwen2.5-Coder-1.5B-Instruct
fine-tuned with LoRA on CommitBench, quantized to 4 bits (986 MB). On 9,704 held-out real commits it
writes a valid Conventional Commits message 99.9% of the time, with the right type 67% of the time.
Because of CommitBench's license, the model is for **non-commercial use**. See `NOTICE.md`.

## License

The extension's code is MIT licensed. The model and the engine are downloaded on first start and keep
their own licenses, listed in `NOTICE.md`.

## Development

Source and the training pipeline: https://github.com/AhmedJesserLahmer/commit-model

```bash
cd vscode-extension
npm install && npm run compile
npm run test:unit             # suggestion cleanup
npm run test:integration      # the whole workflow inside a real VS Code
```

Press F5 in the `vscode-extension` folder to run it in a development window. Diff filtering and prompt
building in `src/prompt.ts` mirror `src/commit_model/diff_utils.py`: keep the two in sync.
