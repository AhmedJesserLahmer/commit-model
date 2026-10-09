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
reopening terminals. Terminals opened before the extension started need reopening once. Linux and macOS
for now (the wrapper is a shell script); Windows gets the ✨ button until then.

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
memory in the background.

Generation settings match training and evaluation: plain prompt (no chat template), greedy decoding,
no repeat penalty, first line only, diff truncated to fit 768 tokens.

Why not node-llama-cpp (the first choice): it loads llama.cpp inside VS Code's process, which fails in
Snap VS Code, Ubuntu's default install (`GLIBC_2.32 not found`), and it needed ~900MB of binaries.
A separate process uses the system's own libraries and can't take VS Code down if it crashes.

The model downloads from Hugging Face on first start (`commitModel.modelUri`), or comes from a local file
(`commitModel.modelPath`).

## Code

`vscode-extension/`:

| File | Role |
|---|---|
| `src/extension.ts` | toggle, status bar, ✨ button, activity log |
| `src/terminalSetup.ts` | the `git` wrapper on terminals' PATH, on/off state |
| `src/terminal.ts` | the terminal prompt: suggestion, Y/N, commit |
| `src/engine.ts` | downloads and runs llama-server (watchdog), GPU/CPU fallback |
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
| `npm run test:integration` | the whole workflow in a real VS Code, throwaway repo: real model, llama-server, `git` wrapper, Git, commits; answers typed into the prompt | **15/15** |
| `npm run test:unit` | cleanup rules (no model) | **18/18** |
| `python -m unittest tests.test_postprocess` | the Python cleanup, same 18 cases | **passes** |
| `npm run test:smoke` | the engine alone, outside VS Code | valid messages |

Integration tests:
1. the commands are registered
2. the git wrapper is installed for terminals
3. terminals keep working after a window reload (stable on/off file)
4. while off, git add is plain git add
5. turning on starts the model
6. git add → suggestion → Y commits it
7. anything but Y or N is asked again
8. N lets the user type their own message
9. N then an empty message commits nothing
10. other git commands don't prompt
11. git add with nothing to stage says so
12. no prompt outside an interactive terminal (scripts, tools)
13. in a real VS Code terminal: git add, then typing y commits
14. the ✨ button puts a suggestion in the commit box
15. turning off stops the model, and git add is plain again

Also verified: the engine inside Snap VS Code's runtime, GPU (NVIDIA, ~0.15-0.25s per message) and
CPU-only (~1.3s), GPU-to-CPU fallback, the engine stopping within 1s when its parent is killed, Hugging
Face downloads, quality on 200 test examples (same as fp32).

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
| another installed extension blocked ours from starting (unidentified) | F5 test window runs with other extensions disabled; to investigate before publishing |
| the first design asked Y/N in a box in the editor | moved to the terminal, only after `git add` (requested) |
| answers typed quickly or pasted together were lost (`readline/promises`) | answers are queued line by line |
| the engine kept running after VS Code was killed, holding GPU memory | watchdog around the server |
| a terminal from before a window reload kept an outdated on/off file (per process ID) | on/off file per workspace |
| ✨ during a commit silently did nothing | it now says a suggestion is in progress |
| the green ✅ emoji looked out of place | plain `✓` colored by the terminal, plus the commit hash |
| suggestions contained `(#<I>)` and inconsistent capitals | suggestion cleanup |
| launching VS Code for tests failed: inherited `VSCODE_*`/`ELECTRON_*` variables, Snap environment, Wayland crash | handled in `test/integration/runTest.js` |

## Left for the MVP

- Upload `commit-model-Q4_K_M.gguf` to Hugging Face and set the default `modelUri`
  (`hf:<username>/<repo>/commit-model-Q4_K_M.gguf`); test the first-start model download.
- Try it by hand on real work (scenarios 2-10 in the VS Code terminal).
- Find which installed extension blocked the extension from starting in a normal VS Code profile.

## Next phases

- CI: run the integration, unit and smoke tests on every push; Python/TypeScript prompt parity test
- Package and publish (Marketplace), test on Windows and macOS; Windows terminal support
- Retrain (`plan.md`, step 5): rebalance types so `build`, `ci`, `perf`, `style` get predicted, and clean
  the placeholders out of the training messages
