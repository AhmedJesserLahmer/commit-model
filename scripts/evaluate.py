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
import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

from commit_model.diff_utils import fit_prompt

DEFAULT_BASE_MODEL = "Qwen/Qwen2.5-Coder-1.5B-Instruct"
DEFAULT_ADAPTER_PATH = "checkpoints/commit-model-lora"

TYPE_RE = re.compile(r"^(\w+)(\(.+?\))?!?:")


def load_model(base_model: str, adapter_path: str | None):
    """Base model in 4-bit, plus the LoRA adapter unless adapter_path is None."""
    tokenizer = AutoTokenizer.from_pretrained(base_model)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    )
    model = AutoModelForCausalLM.from_pretrained(
        base_model, quantization_config=bnb_config, device_map="auto"
    )
    if adapter_path:
        model = PeftModel.from_pretrained(model, adapter_path)
    model.eval()
    return model, tokenizer


def generate_message(model, tokenizer, prompt: str, max_new_tokens: int = 40) -> str:
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    with torch.no_grad():
        output = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            temperature=None,
            top_p=None,
            pad_token_id=tokenizer.pad_token_id,
        )
    text = tokenizer.decode(output[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
    return (text.strip().splitlines() or [""])[0].strip()


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
