---
license: cc-by-nc-4.0
base_model: Qwen/Qwen2.5-Coder-1.5B-Instruct
datasets:
  - Maxscha/commitbench
language:
  - en
pipeline_tag: text-generation
library_name: gguf
tags:
  - gguf
  - llama.cpp
  - commit-messages
  - conventional-commits
  - git
  - lora
---

# Commit Model (4-bit GGUF)

Writes a [Conventional Commits](https://www.conventionalcommits.org) subject line (`feat:`,
`fix(scope):`, `docs:` ...) from a staged `git diff`. Small enough to run locally: 986 MB, about 1 GB of
memory, on a GPU or CPU.

Used by the **Offhand** VS Code extension, which suggests a message after `git add` in the terminal
and commits it on **Y**. Source and training pipeline: https://github.com/AhmedJesserLahmer/commit-model

## Files

| File | |
|---|---|
| `commit-model-Q4_K_M.gguf` | the model, 4-bit (Q4_K_M), for llama.cpp, Ollama, LM Studio ... |
| `Modelfile` | for `ollama create commit-model -f Modelfile` |

## How it was made

- **Base model:** Qwen2.5-Coder-1.5B-Instruct
- **Data:** CommitBench, filtered to messages in Conventional Commits form, without lockfiles or
  generated files: 45,619 training examples
- **Fine-tuning:** LoRA (rank 16) on the commit message only, 2 epochs, prompts up to 768 tokens
- **Merged** into the base model, then **quantized** to Q4_K_M with llama.cpp

## Prompt format

Plain text, no chat template. Generate greedily and keep the first line:

```
Write a Conventional Commits message for this diff.

<the staged diff, truncated so the whole prompt fits in 768 tokens>

Commit message:
```

Truncate the **diff**, never the end of the prompt: the model needs the final `Commit message:`.

## Results

On 9,704 held-out CommitBench commits (full-precision model):

| | Base Qwen | Fine-tuned | Always `fix:` |
|---|---|---|---|
| Valid format | 1.9% | **99.9%** | |
| Type accuracy | 0.9% | **67.3%** | 53.3% |
| BLEU | 0.5 | **19.4** | |
| ROUGE-L | 0.022 | **0.328** | |

The 4-bit version scores the same within noise (200-example check). Type accuracy by type: `fix` 86%,
`docs` 75%, `test` 73%, `chore` 38%, `feat` 36%, `refactor` 35%; `build`, `ci`, `perf`, `style` are rare
in the data and rarely predicted.

## Limitations

- Biased toward `fix`, which is over half of the training data.
- Subject line only, no message body.
- CommitBench replaced numbers with `<I>`, so the model sometimes writes `(#<I>)`; strip it in
  post-processing (the extension does).

## License

**CC BY-NC 4.0** (non-commercial), following the training data, CommitBench (CC BY-NC 4.0). The base
model, Qwen2.5-Coder-1.5B-Instruct, is Apache 2.0.
