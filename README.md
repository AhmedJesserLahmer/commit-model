<p align="center">
  <img src="Icon+banner/offhand-banner.png" alt="Offhand: free, lightweight commit model; your data stays local and private" width="100%">
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=JesserLahmer.offhand"><img alt="VS Code Marketplace" src="https://img.shields.io/badge/VS%20Code-Marketplace-B8323F"></a>
  <a href="https://huggingface.co/Jess2005/commit-model-CLI"><img alt="Model on Hugging Face" src="https://img.shields.io/badge/model-Hugging%20Face-3A0F14"></a>
  <img alt="Runs offline" src="https://img.shields.io/badge/runs-100%25%20local-F4F1EA?labelColor=3A0F14">
</p>

# Offhand

**AI commit messages that never leave your machine.** Stage your changes and a small fine-tuned model
suggests a [Conventional Commits](https://www.conventionalcommits.org) message right in VS Code's
terminal. Type **Y** and it's committed.

```
$ git add .
Offhand suggests:  feat: add subtract function
Commit with this message? [Y/N] y
✓ Committed 3f2a1bc  feat: add subtract function
```

Free, no account, no API key, no cloud: the model runs on your own GPU or CPU.

This repository holds everything behind it, from the training data to the published extension:

| | What | Where |
|---|---|---|
| <img src="Icon+banner/offhand-128.png" width="20"> **Offhand** | VS Code extension: suggestion after `git add`, Y/N, commit | [Marketplace](https://marketplace.visualstudio.com/items?itemName=JesserLahmer.offhand) · [`vscode-extension/`](vscode-extension/) |
| **Beemo** | the same model as a command-line tool, for any terminal | [`src/commit_model/`](src/commit_model/) |
| **The model** | Qwen2.5-Coder-1.5B fine-tuned with LoRA, 4-bit GGUF (986 MB) | [Hugging Face](https://huggingface.co/Jess2005/commit-model-CLI) |

## Get started

### Offhand (VS Code)

1. Install **Offhand** from the Extensions view (search "Offhand") or the
   [Marketplace](https://marketplace.visualstudio.com/items?itemName=JesserLahmer.offhand).
2. Click **Offhand: Off** in the status bar to turn it on. The first time, it downloads the engine
   and the model (about 1 GB, once).
3. Open a **new** terminal in VS Code, save your changes and run `git add .`.

Works in bash, zsh, Git Bash, PowerShell and Command Prompt. Uses the GPU when available (NVIDIA, AMD,
Intel, Apple Silicon), the CPU otherwise. Details in the [extension's README](vscode-extension/README.md).

### Beemo (command line)

```bash
uv venv --python 3.12 .venv && source .venv/bin/activate
uv pip install -e .

git add .
beemo                                   # prints a suggested message
scripts/install_hook.sh . <model.gguf>  # or pre-fill `git commit` through a git hook
```

Beemo downloads the same engine and model on first use (into `~/.cache/beemo`); `--model-path` or
`BEEMO_MODEL_PATH` uses a local `.gguf` instead.

## How it works

```
CommitBench (real GitHub commits)
  → filter: Conventional Commits messages only, no lockfiles or generated files   45,619 examples
  → fine-tune Qwen2.5-Coder-1.5B-Instruct with LoRA (Kaggle, 2× T4)
  → evaluate on 9,704 held-out commits against the base model and a majority baseline
  → merge the adapter, quantize to 4-bit GGUF with llama.cpp (no measurable quality loss)
  → publish on Hugging Face
  → Offhand / Beemo: llama.cpp's llama-server runs it locally
```

The extension is 40 KB: on first start it downloads the llama.cpp build that fits the user's system
(CUDA/Vulkan/Metal/CPU) and the model, then runs the server in the background, stopping it with
VS Code (even after a crash). A small `git` wrapper in VS Code's terminals asks the model after each
successful `git add`; nothing else changes.

## Results

On 9,704 held-out commits:

| | Base Qwen | **Fine-tuned** | Always `fix:` |
|---|---|---|---|
| Valid Conventional Commits format | 1.9% | **99.9%** | |
| Right commit type | 0.9% | **67.3%** | 53.3% |
| BLEU | 0.5 | **19.4** | |
| ROUGE-L | 0.022 | **0.328** | |

Strong on `fix`, `docs` and `test`. It leans toward `fix` (over half of the training data) and rarely
picks `build`, `ci`, `perf` or `style`. Full results, per-type accuracy and the 4-bit check:
[`results.md`](results.md).

## Repository

| Path | |
|---|---|
| [`notebooks/`](notebooks/) | the pipeline, in order: `CommitBench_filter` → `fine-tuning_Kaggle` → `evaluate_Kaggle` → `merge_adapter_Kaggle` → `quantize_gguf_Kaggle` → `evaluate_quantized_Kaggle` |
| [`vscode-extension/`](vscode-extension/) | Offhand (TypeScript) and its unit and integration tests |
| [`src/commit_model/`](src/commit_model/) | Beemo: CLI, engine, prompt building and cleanup (Python) |
| [`scripts/`](scripts/) | git hook installer, evaluation scripts |
| [`hf_model_card/`](hf_model_card/) | the model card for Hugging Face |
| [`Icon+banner/`](Icon+banner/) | logo and banner |
| [`results.md`](results.md), [`MVP.md`](MVP.md), [`plan.md`](plan.md) | results, extension design and tests, roadmap |

The prompt rules (diff filtering, truncation to 768 tokens, cleanup) exist in TypeScript
(`vscode-extension/src/prompt.ts`), Python (`src/commit_model/diff_utils.py`) and the filter notebook,
and must stay identical: the model expects prompts shaped exactly like its training data.

## Development

```bash
# Extension
cd vscode-extension && npm install && npm run compile
npm run test:unit                  # suggestion cleanup
npm run test:integration           # the whole workflow inside a real VS Code
# F5 in vscode-extension/ runs it in a development window

# Python
python -m unittest tests.test_postprocess
```

## Licenses and credits

- Extension code: MIT ([`vscode-extension/LICENSE`](vscode-extension/LICENSE)).
- The model: **CC BY-NC 4.0** (non-commercial), following its training data, **CommitBench**
  (Maximilian Schall et al., CC BY-NC 4.0). Base model **Qwen2.5-Coder-1.5B-Instruct** (Alibaba Cloud,
  Apache 2.0).
- Engine: **llama.cpp** (MIT).

See [`vscode-extension/NOTICE.md`](vscode-extension/NOTICE.md).
