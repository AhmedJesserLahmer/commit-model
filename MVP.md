# VS Code extension MVP

Goal: the easiest possible experience. Install one VS Code extension; it downloads the engine and the
model itself, runs fully offline, and turns staged changes into commits with one keystroke.

## Workflow

Everything happens in VS Code's terminal, and only right after `git add`. Nothing pops up in the editor.

1. **Bottom-left toggle:** "Commit Model: Off" / "Commit Model: On". Clicking it turns it on (starts the
   model) or off (stops it and frees memory). Download and loading progress show in the toggle itself.
2. **In the terminal**, after a successful `git add` while it's on:
   ```
   $ git add .
   Commit Model suggests:  feat: add subtract function
   Commit with this message? [Y/N] y
   ✓ Committed 3f2a1bc  feat: add subtract function
   ```
   - **Y:** runs `git commit` with the suggestion.
   - **N:** asks `Your commit message (empty to cancel):` and commits that; empty cancels.
   - Anything else is asked again; Ctrl+C or Ctrl+D cancels. Cancelling leaves the changes staged.
3. **Nothing staged** after `git add` (e.g. changes not saved in the editor): it says so, and reminds you
   to save.

Only `git add` triggers it: other git commands, staging with the + buttons, scripts and tools (no
interactive terminal), and everything while it's Off behave exactly as before. The ✨ button in Source
Control still puts a suggestion in the commit box on demand.

How: the extension puts a small `git` wrapper first on the PATH of VS Code's terminals. It runs the real
git; after a successful `git add` in an interactive terminal while the toggle is On, it runs the prompt
(`dist/terminal.js`) with VS Code's own Node runtime, which asks the already-running model. On/off is a
state file per VS Code window, so toggling never requires reopening terminals. Linux and macOS for now
(the wrapper is a shell script); Windows gets the ✨ button until then.

Activity log: Output panel → "Commit Model".

## Engine

llama.cpp's `llama-server` (release `b11476`, the one the model was quantized and verified with), run as a
separate process. On first start the extension downloads the build for the user's system: Vulkan GPU
build for Linux/Windows (NVIDIA, AMD, Intel; 24-33MB) or macOS (Metal; 12MB), with a CPU-only build as
fallback. With two GPUs it picks the dedicated one over an integrated Intel GPU.

Why not node-llama-cpp (the first choice): it loads llama.cpp inside VS Code's process, which fails in
Snap VS Code, Ubuntu's default install (`GLIBC_2.32 not found`), and it needed ~900MB of binaries.
A separate process uses the system's own libraries and can't take VS Code down if it crashes.

The model downloads from Hugging Face on first start (`commitModel.modelUri`), or comes from a local file
(`commitModel.modelPath`).

## Code (`vscode-extension/`)

| File | Role |
|---|---|
| `src/extension.ts` | toggle, status bar, ✨ button, activity log |
| `src/terminalSetup.ts` | the `git` wrapper on terminals' PATH, on/off state |
| `src/terminal.ts` | the terminal prompt: suggestion, Y/N, commit |
| `src/engine.ts` | downloads and runs llama-server (stops with VS Code, even after a crash), GPU/CPU fallback |
| `src/client.ts` | talks to llama-server: tokenizing, generating |
| `src/download.ts` | downloads with progress, `hf:` URIs |
| `src/git.ts` | VS Code Git API: staged diff, commit box |
| `src/prompt.ts` | diff filtering and prompt building, a port of `src/commit_model/diff_utils.py` (keep in sync) |
| `test/integration/` | tests in a real VS Code |
| `test/smoke.mjs` | engine test outside VS Code |

The terminal CLI (`src/commit_model/cli.py`, `engine.py`) uses the same engine and generation settings.

## Testing

`npm run test:integration` runs VS Code with the extension in a throwaway Git repository: real model,
llama-server, `git` wrapper, Git and commits; answers are typed into the prompt.
Latest runs: **14/14 passed, twice in a row**.

1. the commands are registered
2. the git wrapper is installed for terminals
3. while off, git add is plain git add
4. turning on starts the model
5. git add → suggestion → Y commits it
6. anything but Y or N is asked again
7. N lets the user type their own message
8. N then an empty message commits nothing
9. other git commands don't prompt
10. git add with nothing to stage says so
11. no prompt outside an interactive terminal (scripts, tools)
12. in a real VS Code terminal: git add, then typing y commits
13. the ✨ button puts a suggestion in the commit box
14. turning off stops the model, and git add is plain again

Also verified: the engine inside Snap VS Code's runtime, GPU (NVIDIA, ~0.15-0.25s per message) and
CPU-only (~1.3s), GPU-to-CPU fallback, the engine stopping within 1s when VS Code is killed, Hugging Face
downloads, quality on 200 test examples (same as fp32).

## Left for the MVP

- Upload `commit-model-Q4_K_M.gguf` to Hugging Face and set the default `modelUri`
  (`hf:<username>/<repo>/commit-model-Q4_K_M.gguf`); test the first-start model download.
- Try it by hand (F5) on real work.

## Next phases

- CI: run the integration and smoke tests on every push; Python/TypeScript prompt parity test
- Package and publish (Marketplace), test on Windows and macOS
- Model accuracy (rebalancing `fix`)
