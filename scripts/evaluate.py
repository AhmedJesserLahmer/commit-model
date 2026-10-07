"""Evaluate a fine-tuned adapter on the held-out CommitBench test split.

Reports: type-prefix accuracy (did we predict the right feat/fix/refactor/... type),
BLEU, and ROUGE-L. Prefix accuracy is the metric to trust most here; BLEU/ROUGE are
tracked mainly as a between-checkpoint regression signal, not as ground truth for quality.
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import evaluate

from commit_model.cli import DEFAULT_ADAPTER_PATH, DEFAULT_BASE_MODEL, generate_message, load_model
from commit_model.diff_utils import fit_prompt

TYPE_RE = re.compile(r"^(\w+)(\(.+?\))?!?:")


def extract_type(message: str) -> str | None:
    match = TYPE_RE.match(message.strip())
    return match.group(1) if match else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-model", default=DEFAULT_BASE_MODEL)
    parser.add_argument("--adapter-path", default=DEFAULT_ADAPTER_PATH)
    parser.add_argument("--no-adapter", action="store_true", help="evaluate the base model alone, as a baseline")
    parser.add_argument("--test-file", default="data/processed/test.jsonl")
    parser.add_argument("--limit", type=int, default=200)
    args = parser.parse_args()

    examples = [json.loads(l) for l in Path(args.test_file).read_text().splitlines()][: args.limit]

    model, tokenizer = load_model(args.base_model, None if args.no_adapter else args.adapter_path)

    predictions, references = [], []
    type_correct = 0

    for ex in examples:
        pred = generate_message(model, tokenizer, fit_prompt(tokenizer, ex["diff"]))

        predictions.append(pred)
        references.append(ex["message"])
        if extract_type(pred) == extract_type(ex["message"]):
            type_correct += 1

    bleu = evaluate.load("sacrebleu")
    rouge = evaluate.load("rouge")
    bleu_score = bleu.compute(predictions=predictions, references=[[r] for r in references])
    rouge_score = rouge.compute(predictions=predictions, references=references)

    print(f"Model: {args.base_model}" + ("" if args.no_adapter else f" + {args.adapter_path}"))
    print(f"Examples evaluated: {len(examples)}")
    print(f"Type-prefix accuracy: {type_correct / len(examples):.1%}")
    print(f"BLEU: {bleu_score['score']:.2f}")
    print(f"ROUGE-L: {rouge_score['rougeL']:.3f}")

    print("\nSample predictions:")
    for pred, ref in list(zip(predictions, references))[:10]:
        print(f"  pred: {pred}\n  ref:  {ref}\n")


if __name__ == "__main__":
    main()
