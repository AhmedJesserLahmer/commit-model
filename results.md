# Evaluation results

Base `Qwen2.5-Coder-1.5B-Instruct` vs. base + LoRA adapter (`commit-model-lora`), on the full
held-out CommitBench test split. Run on 2026-10-07 with
[notebooks/evaluate_Kaggle.ipynb](notebooks/evaluate_Kaggle.ipynb).

## Setup

- **Test set:** `test.jsonl` from `CommitBench_filter.ipynb`, 9,704 examples, never used in training
  (12 diffs, ~0.1%, also appear in `train.jsonl`)
- **Hardware:** Kaggle T4 x2, one model per GPU
- **Precision:** fp32 for both models. The CLI loads the base model in 4-bit, so its output may differ slightly.
- **Prompt:** same template as training and the CLI, diff truncated so the prompt fits 768 tokens
- **Decoding:** greedy, max 40 new tokens, first line kept

## Overall

| Model | Valid format | Type accuracy | BLEU | ROUGE-L |
|---|---|---|---|---|
| Always `fix:` (majority baseline) | – | 53.3% | – | – |
| Base | 1.9% | 0.9% | 0.5 | 0.022 |
| **Fine-tuned** | **99.9%** | **67.3%** | **19.4** | **0.328** |

- **Valid format:** prediction starts with a Conventional Commits prefix (`feat:`, `fix(scope):`, ...)
- **Type accuracy:** predicted type matches the reference commit's type
- **BLEU / ROUGE-L:** wording overlap with the human-written message

The base model scores near zero because, given this plain prompt without a chat template, it almost
never answers in Conventional Commits form. The comparison reflects the CLI's prompt, not the base
model's best possible output.

## Type accuracy by type (fine-tuned)

| Type | Accuracy | Test examples |
|---|---|---|
| fix | 86.2% | 5,170 |
| chore | 37.7% | 1,043 |
| feat | 36.4% | 1,011 |
| test | 72.7% | 973 |
| refactor | 34.5% | 859 |
| docs | 74.6% | 358 |
| build | 23.5% | 102 |
| style | 6.9% | 101 |
| perf | 5.9% | 51 |
| ci | 11.1% | 36 |

Averaged equally across the 10 types, accuracy is about 39%.

## 4-bit model (Q4_K_M GGUF)

Merged (bf16) and quantized locally with llama.cpp b11476, run in `llama-server` on an RTX 3050 4GB.
Scored on the first 200 test examples, against the fp32 fine-tuned model on the same examples:

| Model | Valid format | Type accuracy | BLEU |
|---|---|---|---|
| Fine-tuned, fp32 | 99.5% | 67.5% | 16.67 |
| **Fine-tuned, Q4_K_M (986MB)** | **99.5%** | **71.0%** | **16.45** |

No measurable loss from quantizing: the type-accuracy gap is within the ±6.5-point noise at 200 examples.
Speed: 0.28s per message on the GPU.

## Takeaways

- Fine-tuning taught the format almost perfectly and beats the majority baseline by 14 points on
  type accuracy (±~1 point at this sample size).
- The model is biased toward `fix`, which is over half of the data. `feat`, `chore` and `refactor`
  are right only about a third of the time, and the rare types (build, ci, style, perf) almost never.
- Some of that error comes from inconsistent human labels (`chore` vs `build` vs `refactor`), so 100%
  type accuracy isn't a realistic target.
- Next step: rebalance the training data (cap `fix`) and fine-tune again, then compare against this table.
