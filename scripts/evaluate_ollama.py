"""Evaluate a model served by Ollama on the held-out CommitBench test split.

Same prompt, truncation, decoding and metrics as evaluate_Kaggle.ipynb, so scores are comparable
with results.md. Pass --fp32-preds (preds_finetuned.jsonl from the evaluate_Kaggle.ipynb run) to
compare example by example against the full-precision model.

Usage:
    python scripts/evaluate_ollama.py --limit 200
    python scripts/evaluate_ollama.py --fp32-preds preds_finetuned.jsonl
"""
import argparse
import json
import math
import re
import sys
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import evaluate
from transformers import AutoTokenizer

from commit_model.diff_utils import fit_prompt

TYPE_RE = re.compile(r"^(\w+)(\(.+?\))?!?:")
VALID_RE = re.compile(r"^(feat|fix|refactor|chore|docs|test|perf|style|build|ci)(\([\w./-]+\))?!?:\s+\S")
MAX_NEW_TOKENS = 40


def extract_type(message: str) -> str | None:
    match = TYPE_RE.match(message.strip())
    return match.group(1) if match else None


def mcnemar_p(only_a: int, only_b: int) -> float:
    """Exact two-sided McNemar test: binomial test of the discordant pairs at p = 0.5."""
    n = only_a + only_b
    if n == 0:
        return 1.0
    probs = [math.comb(n, i) * 0.5**n for i in range(n + 1)]
    return min(1.0, sum(p for p in probs if p <= probs[only_a] + 1e-12))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="commit-model", help="Ollama model name")
    parser.add_argument("--url", default="http://localhost:11434")
    parser.add_argument("--tokenizer", default="Qwen/Qwen2.5-Coder-1.5B-Instruct")
    parser.add_argument("--test-file", default="data/processed/test.jsonl")
    parser.add_argument("--limit", type=int, default=None, help="first N examples; default: all")
    parser.add_argument("--workers", type=int, default=4, help="parallel requests to Ollama")
    parser.add_argument("--fp32-preds", help="preds_finetuned.jsonl from evaluate_Kaggle.ipynb")
    parser.add_argument("--out", default="preds_ollama.jsonl")
    args = parser.parse_args()

    tokenizer = AutoTokenizer.from_pretrained(args.tokenizer)
    examples = [json.loads(l) for l in Path(args.test_file).read_text().splitlines()][: args.limit]
    refs = [ex["message"] for ex in examples]

    def generate(ex):
        request = urllib.request.Request(
            f"{args.url}/api/generate",
            headers={"Content-Type": "application/json"},
            data=json.dumps({
                "model": args.model,
                "prompt": fit_prompt(tokenizer, ex["diff"]),
                "raw": True,  # send the prompt as-is: the model was trained without a chat template
                "stream": False,
                "options": {"temperature": 0, "top_k": 1, "num_predict": MAX_NEW_TOKENS},
            }).encode(),
        )
        text = json.load(urllib.request.urlopen(request, timeout=300))["response"]
        return (text.strip().splitlines() or [""])[0].strip()

    started = time.time()
    preds = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for pred in pool.map(generate, examples):
            preds.append(pred)
            if len(preds) % 100 == 0 or len(preds) == len(examples):
                elapsed = time.time() - started
                print(f"[{elapsed / 60:5.1f} min] {len(preds)}/{len(examples)} "
                      f"({elapsed / len(preds):.2f}s each)", flush=True)

    with open(args.out, "w") as f:
        for pred, ref in zip(preds, refs):
            f.write(json.dumps({"pred": pred, "ref": ref}) + "\n")

    bleu = evaluate.load("sacrebleu")
    rouge = evaluate.load("rouge")
    ref_types = [extract_type(r) for r in refs]

    def score(p):
        return {
            "valid_format": sum(bool(VALID_RE.match(x)) for x in p) / len(p),
            "type_acc": sum(extract_type(x) == t for x, t in zip(p, ref_types)) / len(p),
            "BLEU": bleu.compute(predictions=p, references=[[r] for r in refs])["score"],
            "ROUGE-L": rouge.compute(predictions=p, references=refs)["rougeL"],
        }

    rows = {f"ollama ({args.model})": score(preds)}
    fp32_preds = None
    if args.fp32_preds:
        records = [json.loads(l) for l in Path(args.fp32_preds).read_text().splitlines()][: len(examples)]
        if [r["ref"] for r in records] != refs:
            sys.exit("--fp32-preds doesn't line up with the test file (different order or examples)")
        fp32_preds = [r["pred"] for r in records]
        rows = {"fp32": score(fp32_preds), **rows}

    print(f"\nExamples: {len(examples)}\n")
    print(f"  {'':<28}{'valid format':>14}{'type acc':>10}{'BLEU':>8}{'ROUGE-L':>9}")
    for name, s in rows.items():
        print(f"  {name:<28}{s['valid_format']:>14.1%}{s['type_acc']:>10.1%}{s['BLEU']:>8.2f}{s['ROUGE-L']:>9.3f}")

    print("\nType accuracy by type:")
    for t, n in Counter(ref_types).most_common():
        hits = sum(extract_type(x) == t for x, rt in zip(preds, ref_types) if rt == t)
        line = f"  {t:<10}{n:>6}  ollama {hits / n:6.1%}"
        if fp32_preds:
            fp32_hits = sum(extract_type(x) == t for x, rt in zip(fp32_preds, ref_types) if rt == t)
            line += f"   fp32 {fp32_hits / n:6.1%}"
        print(line)

    if fp32_preds:
        fp32_ok = [extract_type(x) == t for x, t in zip(fp32_preds, ref_types)]
        ollama_ok = [extract_type(x) == t for x, t in zip(preds, ref_types)]
        only_fp32 = sum(a and not b for a, b in zip(fp32_ok, ollama_ok))
        only_ollama = sum(b and not a for a, b in zip(fp32_ok, ollama_ok))
        p_value = mcnemar_p(only_fp32, only_ollama)
        print(f"\nIdentical messages, fp32 vs ollama: {sum(a == b for a, b in zip(fp32_preds, preds)) / len(preds):.1%}")
        print(f"Type right only in fp32: {only_fp32}, only in ollama: {only_ollama} (McNemar p = {p_value:.3f})")
        print("Verdict:", "significant change" if p_value < 0.05 else "no significant change", "in type accuracy")

    print("\nSample predictions:")
    for pred, ref in list(zip(preds, refs))[:5]:
        print(f"  ref:  {ref}\n  pred: {pred}\n")
    print(f"Predictions saved to {args.out}")


if __name__ == "__main__":
    main()
