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
   - **Y:** runs `git commit` with the suggestion. `✓ Committed` is green, the short commit hash dimmed.
   - **N:** asks `Your commit message (empty to cancel):` and commits that; empty cancels.
   - Anything else is asked again; Ctrl+C or Ctrl+D cancels. Cancelling leaves the changes staged.
3. **Nothing staged** after `git add`: it says so, and reminds you to save (Git only sees saved files;
   unsaved editor changes were the cause of a "nothing happens" report during testing).

Only `git add` triggers it: other git commands, staging with the + buttons, scripts and tools (no
interactive terminal), and everything while it's Off behave exactly as before. The ✨ button in Source
Control still puts a suggestion in the commit box on demand.

How: the extension puts a small `git` wrapper first on the PATH of VS Code's terminals. It runs the real
git; after a successful `git add` in an interactive terminal while the toggle is On, it runs the prompt
(`dist/terminal.js`) with VS Code's own Node runtime, which asks the already-running model. On/off is a
state file per workspace, stable across window reloads, so toggling or reloading never requires
reopening terminals. Terminals opened before the extension started need reopening once.

Every platform gets the terminal prompt: a shell wrapper `git` for bash and zsh (Linux, macOS, Git Bash
on Windows) and a batch wrapper `git.cmd` for PowerShell and Command Prompt on Windows (Windows finds
`git.cmd` first on the PATH, before the real `git.exe`).

On Windows the conversation runs in PowerShell: VS Code's runtime (`Code.exe`) is a windowed program
there, so it can write to a terminal but can't read the keyboard (verified in the VM: its input is
closed). `git.cmd` runs `commit-model-prompt.ps1`, which gets the suggestion from `terminal.js --suggest`
(the same TypeScript filtering, prompt, generation and cleanup), then asks Y/N and commits with the same
texts as on Linux and macOS.

Windows also needs the Microsoft Visual C++ runtime for llama.cpp, which a fresh Windows doesn't have
(many PCs do, from other apps). The extension checks for it before starting; if it's missing it explains
in plain words and offers "Install it": downloads Microsoft's official installer, runs it (Windows asks
for permission), then turns Commit Model on. The Python CLI says the same with the download link.

Activity log: Output panel → "Commit Model".

## Suggestion cleanup

The model's raw output is cleaned before it's shown (`cleanMessage` in `src/postprocess.ts`, mirrored by
`clean_message` in `src/commit_model/postprocess.py` for the Python CLI). The model itself is unchanged.

- **Placeholders removed.** CommitBench, the training data, replaced every number with `<I>` (and URLs,
  emails with `<URL>`, `<EMAIL>`); 24% of the training messages contain one, so the model writes things
  like `(#<I>)`. Regular expressions remove exactly those tokens: `(#<I>)`, `[#<I>]`, references such as
  `closes #<I>` or `org/repo#<I>`, then any leftover placeholder. Real uses of the characters stay
  (`fixes #8`, `swich -> switch`, `<code>`), which is why the characters `#<>` themselves aren't trimmed.
- **Consistent lowercase start:** `Add ...` becomes `add ...`; acronyms and names (`README`, `PropTable`)
  are kept.
- If nothing meaningful is left, the original message is kept.

Limitation: a placeholder in mid-sentence can leave odd wording (`link to <URL> in the README` becomes
`link to in the README`). The proper fix is cleaning the training messages when retraining (see
`plan.md`, step 5).

## Engine

llama.cpp's `llama-server` (release `b11476`, the one the model was quantized and verified with), run as a
separate process. On first start the extension downloads the build for the user's system: Vulkan GPU
build for Linux/Windows (NVIDIA, AMD, Intel; 24-33MB) or macOS (Metal; 12MB), with a CPU-only build as
fallback. With two GPUs it picks the dedicated one over an integrated Intel GPU. A small watchdog stops the
server as soon as VS Code's extension process ends, even after a crash, so it never keeps ~1GB of GPU
memory in the background: a shell watchdog on Linux and macOS, a Node watchdog (`dist/watchdog.js`,
connected over IPC) on Windows, where killing a process skips its cleanup.

Generation settings match training and evaluation: plain prompt (no chat template), greedy decoding,
no repeat penalty, first line only, diff truncated to fit 768 tokens.

Why not node-llama-cpp (the first choice): it loads llama.cpp inside VS Code's process, which fails in
Snap VS Code, Ubuntu's default install (`GLIBC_2.32 not found`), and it needed ~900MB of binaries.
A separate process uses the system's own libraries and can't take VS Code down if it crashes.

The model downloads on first start from Hugging Face,
[`Jess2005/commit-model-CLI`](https://huggingface.co/Jess2005/commit-model-CLI) (the default
`commitModel.modelUri`, `hf:Jess2005/commit-model-CLI/commit-model-Q4_K_M.gguf`; 986 MB, same SHA-256 as
the local model), into VS Code's storage for the extension, then is reused. A download whose size doesn't
match what the server announced is discarded with a clear error, so an interrupted download never leaves
a broken model. `commitModel.modelPath` (a local file) overrides it, for development. The Python CLI uses
the same default, into `~/.cache/commit-model`.

## Package and publishing

`npx vsce package` builds `commit-model.vsix`: 31 KB, 18 files (compiled code, `package.json`, README,
CHANGELOG, LICENSE, NOTICE, icon; `.vscodeignore` keeps sources, tests and build tools out). The engine
and model download on first start, so one package serves every OS. Tested: the unpacked final package
passes the integration suite (17/17).

Marketplace metadata in `package.json`: marked **preview** (macOS untested), icon (`icon.png`, a commit
graph with a sparkle), repository/issues links to GitHub, keywords. The README is the Marketplace page.

Licensing: the extension's code is MIT (`LICENSE`). `NOTICE.md` credits what it downloads: the model
(Qwen2.5-Coder-1.5B-Instruct, Apache 2.0, fine-tuned on CommitBench, CC BY-NC 4.0, so non-commercial),
llama.cpp (MIT), and on Windows Microsoft's Visual C++ runtime. `hf_model_card/README.md` is a model card
for the Hugging Face repo, licensed CC BY-NC 4.0 (the repo currently says MIT): to upload by the user.

To publish (the user does it):
1. Create a publisher at marketplace.visualstudio.com/manage; put its ID in `"publisher"` in
   `vscode-extension/package.json` (currently the placeholder `commit-model`).
2. Create an Azure DevOps personal access token (Organization: All accessible organizations; Scope:
   Marketplace → Manage).
3. In `vscode-extension/`: `npx vsce login <publisher>`, then `npx vsce publish`.

## Code

`vscode-extension/`:

| File | Role |
|---|---|
| `src/extension.ts` | toggle, status bar, ✨ button, activity log |
| `src/terminalSetup.ts` | the `git` wrapper on terminals' PATH, on/off state |
| `src/terminal.ts` | the terminal prompt: suggestion, Y/N, commit |
| `src/engine.ts` | downloads and runs llama-server, GPU/CPU fallback |
| `src/watchdog.ts` | Windows: stops llama-server when VS Code's extension process ends |
| `src/terminalSetup.ts` (`WINDOWS_PROMPT`) | Windows: the PowerShell conversation script |
| `src/client.ts` | talks to llama-server: tokenizing, generating |
| `src/postprocess.ts` | suggestion cleanup |
| `src/download.ts` | downloads with progress, `hf:` URIs |
| `src/git.ts` | VS Code Git API: staged diff, commit box |
| `src/prompt.ts` | diff filtering and prompt building, a port of `src/commit_model/diff_utils.py` (keep in sync) |
| `test/integration/` | tests in a real VS Code |
| `test/unit.test.mjs`, `test/clean-cases.json` | cleanup unit tests; the cases are shared with the Python CLI |
| `test/smoke.mjs` | engine test outside VS Code |

Python CLI (`src/commit_model/`): `cli.py` and `engine.py` use the same llama-server engine and
generation settings; `postprocess.py` mirrors the cleanup; `tests/test_postprocess.py` checks it against
the same cases. `scripts/install_hook.sh` installs a git hook that uses the CLI.

## Testing

| Command | What it runs | Latest |
|---|---|---|
| `npm run test:integration` (Linux) | the whole workflow in a real VS Code, throwaway repo: real model, llama-server, `git` wrapper, Git, commits; answers typed into the prompt | **16/16** (1 Windows-only skipped) |
| `COMMIT_MODEL_NODE_WATCHDOG=1 npm run test:integration` (Linux) | the same with the Windows (Node) watchdog | **16/16** |
| `node test/integration/runTest.js <model>` (Windows 11 VM) | the same on Windows, from a fresh PC without the Visual C++ runtime; PowerShell terminal | **16/16** |
| `COMMIT_MODEL_TEST_DOWNLOAD=1 npm run test:integration` | as a new user: no model setting, nothing downloaded; the model comes from Hugging Face | **17/17** (986 MB in ~280s, second start 2.4s) |
| the same with `COMMIT_MODEL_TEST_EXTENSION_PATH=<unpacked .vsix>` | the packaged extension itself, not the development folder | **17/17** |
| `npm run test:unit` | cleanup rules (no model) | **18/18** |
| `python -m unittest tests.test_postprocess` | the Python cleanup, same 18 cases | **passes** |
| `npm run test:smoke` | the engine alone, outside VS Code | valid messages |

Integration tests:
1. the commands are registered
2. the git wrapper is installed for terminals
3. terminals keep working after a window reload (stable on/off file)
4. while off, git add is plain git add
5. Windows without the Visual C++ runtime: offers to install it, then starts (real download and install)
6. turning on starts the model (download mode: downloads it from Hugging Face first, checks it's complete)
7. git add → suggestion → Y commits it
8. anything but Y or N is asked again
9. N lets the user type their own message
10. N then an empty message commits nothing
11. other git commands don't prompt
12. git add with nothing to stage says so
13. no prompt outside an interactive terminal (scripts, tools)
14. in a real VS Code terminal: git add, then typing y commits (bash on Linux, PowerShell on Windows)
15. the ✨ button puts a suggestion in the commit box
16. download mode: a second start reuses the downloaded model
17. turning off stops the model, and git add is plain again

Also verified: the engine inside Snap VS Code's runtime, GPU (NVIDIA, ~0.15-0.25s per message) and
CPU-only (~1.3s), GPU-to-CPU fallback, the engine stopping within 1s when its parent is killed (both
watchdogs), Hugging Face downloads, quality on 200 test examples (same as fp32).

### Windows

Tested in a Windows 11 Pro VM (French, unactivated) on this machine: `~/win11-vm/` (QEMU/KVM, virtual
TPM, unattended install from `~/Téléchargements/Win11_25H2_French_x64_v2.iso`, OpenSSH for remote
control). `~/win11-vm/start.sh` starts it in the background; `vm.sh '<PowerShell>'` runs a command in it,
`vmcp.sh` copies files in, `shot.sh out.png` takes a screenshot. Git for Windows and Node.js installed by
`provision.ps1`. The model ran on the VM's CPU (no GPU: the Vulkan build failed and the CPU build took
over, as designed). Before that, the `git.cmd` logic was checked under Wine.

### Realistic scenarios

Ten realistic changes to a small to-do app (`~/try-commit-scenarios/`, one per commit type, mostly
multi-file), run in `~/try-commit` through the extension's own generation code. Scenario 1 run by hand
in the VS Code terminal. Suggestions shown as generated, before the cleanup existed.

| # | Expected | Suggested | Type | Description |
|---|---|---|---|---|
| 1 | `fix(storage): don't crash when the data file doesn't exist yet` | `fix(storage): load_tasks should return an empty list if there is no data file` | ✅ | ✅ |
| 2 | `feat: add task priorities and due dates` | `feat: add due date and priority to tasks` | ✅ | ✅ |
| 3 | `refactor(cli): move command handlers into commands.py` | `refactor(todo): Extract command functions into separate module` | ✅ | ✅ |
| 4 | `docs: document installation and usage in the README` | `docs: Add more details to README` | ✅ | vague |
| 5 | `test: add tests for models and storage` | `test: add some tests for the models` | ✅ | partial |
| 6 | `build: add pyproject.toml with a todo console script` | `chore: add pyproject.toml and requirements-dev.txt` | ❌ | ✅ |
| 7 | `ci: run the tests on GitHub Actions` | `chore: add tests workflow (#<I>)` | ❌ | placeholder |
| 8 | `chore: add .gitignore and .editorconfig` | `chore: add editorconfig and gitignore` | ✅ | ✅ |
| 9 | `perf(storage): cache tasks instead of re-reading the file` | `feat(storage): cache file contents to avoid re-parsing on each call` | ❌ | ✅ |
| 10 | `style: format cli and commands modules` | `refactor: make code more readable` | ❌ | vague |

Right type 6/10: all common types correct; the rare ones (`build`, `ci`, `perf`, `style`, under 3% of
the training data) always got a common type, as the evaluation predicted. Descriptions are accurate even
when the type is wrong. With the cleanup, 3, 4 and 7 now read `refactor(todo): extract command functions
into separate module`, `docs: add more details to README`, `chore: add tests workflow`.

## Problems found and fixed

| Problem | Fix |
|---|---|
| node-llama-cpp can't load in Snap VS Code (`GLIBC_2.32 not found`) | engine switched to `llama-server` as a separate process |
| node-llama-cpp applies a repeat penalty by default, unlike training | engine sets `repeat_penalty: 1.0` |
| a relative model path resolved from the engine's folder | paths made absolute |
| ours wasn't started in one test window ("command not found") | not reproducible: with all 8 of the user's extensions, their settings, their saved VS Code state, and even the old node-llama-cpp build, it starts normally every time; probably a one-off in that launch |
| if anything failed during activation, commands were never registered ("command not found") | commands are registered first; a failed terminal setup only logs a warning |
| Windows only had the ✨ button | `git.cmd` wrapper for PowerShell/Command Prompt, Node watchdog |
| Windows: llama-server exited at once (`0xC0000135`, DLL not found): no Microsoft Visual C++ runtime on a fresh Windows | runtime check before starting, plain-language message, "Install it" button that installs Microsoft's runtime and turns on |
| Windows: no suggestion appeared in a real terminal: `Code.exe` is a windowed program and can't read the keyboard | the conversation moved to a PowerShell script; TypeScript only produces the suggestion (`--suggest`) |
| tests on Windows: VS Code writes `c:\` lowercase; Node can't run `git.cmd` directly; PowerShell's default "Restricted" policy blocks shell integration and `npm.ps1` | path comparison case-insensitive on Windows; tests run git through the Command Prompt; `PSExecutionPolicyPreference` for the test run only; `npm.cmd` in the VM |
| a test checked "off" while the extension was still starting | tests wait for the on/off file, which appears once the model has loaded |
| the first design asked Y/N in a box in the editor | moved to the terminal, only after `git add` (requested) |
| answers typed quickly or pasted together were lost (`readline/promises`) | answers are queued line by line |
| the engine kept running after VS Code was killed, holding GPU memory | watchdog around the server |
| a terminal from before a window reload kept an outdated on/off file (per process ID) | on/off file per workspace |
| ✨ during a commit silently did nothing | it now says a suggestion is in progress |
| the green ✅ emoji looked out of place | plain `✓` colored by the terminal, plus the commit hash |
| suggestions contained `(#<I>)` and inconsistent capitals | suggestion cleanup |
| launching VS Code for tests failed: inherited `VSCODE_*`/`ELECTRON_*` variables, Snap environment, Wayland crash | handled in `test/integration/runTest.js` |

## Left for the MVP

- Try it by hand on real work (scenarios 2-10 in the VS Code terminal).
- Windows: tested in PowerShell; Command Prompt and Git Bash terminals not tested yet.

## Next phases

- CI: run the integration, unit and smoke tests on every push; Python/TypeScript prompt parity test
- Package and publish (Marketplace), test on Windows and macOS
- Retrain (`plan.md`, step 5): rebalance types so `build`, `ci`, `perf`, `style` get predicted, and clean
  the placeholders out of the training messages
