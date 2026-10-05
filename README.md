# CLI Commit Model

A small fine-tuned model (Qwen2.5-Coder-1.5B-Instruct + LoRA) that writes
Conventional Commits messages from a staged git diff. Trained on Kaggle
(2x T4), runs locally for inference on a 4GB GPU.

## Local setup (dataset prep + CLI inference)

```bash
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install torch --index-url https://download.pytorch.org/whl/cu124
uv pip install -e .
```

## Workflow

1. **Prepare data** — run `notebooks/CommitBench_filter.ipynb` (CPU-only, no GPU
   needed; runs locally or on Kaggle/Colab — it's self-contained, no dependency on
   the local `commit_model` package). Produces `data/processed/{train,validation,test}.jsonl`.
   Upload those files to your Kaggle notebook as a dataset input.

2. **Train on Kaggle** — run `notebooks/fine-tuning_Kaggle.ipynb` on a GPU notebook
   (Settings -> Accelerator -> GPU T4 x2). Update `DATA_DIR` in the notebook to point
   at your uploaded dataset, run the smoke-test cell first, then the full training
   cell. The last cell zips the adapter to `/kaggle/working/commit-model-lora.zip`
   for download — it's just the small LoRA adapter (a few MB-tens of MB), not the
   base model.

3. **Drop the adapter into the local repo**:
   ```bash
   mkdir -p checkpoints
   unzip commit-model-lora.zip -d checkpoints/commit-model-lora
   ```

4. **Evaluate** (type-prefix accuracy, BLEU, ROUGE-L, sample predictions —
   runs locally in 4-bit, same config the CLI uses):
   ```bash
   python scripts/evaluate.py
   ```

5. **Use it**:
   ```bash
   git add -A
   commit-model                     # prints a suggested commit message
   scripts/install_hook.sh          # or: auto-fill via prepare-commit-msg
   ```

## Notes

- Diff filtering/truncation policy is implemented in two places: `src/commit_model/diff_utils.py`
  (used by the CLI) and inlined in `notebooks/CommitBench_filter.ipynb` (kept
  self-contained so it's portable to Kaggle/Colab). **Keep these two in sync** —
  if you change the truncation policy, update both, or the model ends up trained
  on diffs shaped differently than what the CLI feeds it at inference time.
- Training uses plain bf16 LoRA on Kaggle (no 4-bit needed — a T4 has plenty of
  headroom for a 1.5B model). Local inference re-quantizes the base model to 4-bit
  to fit the 4GB card; the LoRA adapter loads on top of that as usual.
- Model size is capped at 1.5B (not scaled up despite Kaggle's extra VRAM) because
  the CLI must still run inference locally on the 4GB card.
- Fallback if quality is unsatisfying: `Qwen/Qwen2.5-Coder-3B-Instruct` — still
  trains comfortably on 2x T4, and 4-bit inference at 3B still fits in 4GB locally.
