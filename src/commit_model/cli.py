"""CLI: reads `git diff --staged`, generates a Conventional Commits message.

Usage:
    commit-model                      # print a suggestion for the staged diff
    commit-model --hook-file MSGFILE  # write suggestion into a prepare-commit-msg file
"""
import argparse
import subprocess
import sys

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

from commit_model.diff_utils import build_prompt

DEFAULT_BASE_MODEL = "Qwen/Qwen2.5-Coder-1.5B-Instruct"
DEFAULT_ADAPTER_PATH = "checkpoints/commit-model-lora"


def get_staged_diff() -> str:
    result = subprocess.run(
        ["git", "diff", "--staged"], capture_output=True, text=True, check=True
    )
    return result.stdout


def load_model(base_model: str, adapter_path: str | None):
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
    return text.strip().splitlines()[0].strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-model", default=DEFAULT_BASE_MODEL)
    parser.add_argument("--adapter-path", default=DEFAULT_ADAPTER_PATH)
    parser.add_argument("--no-adapter", action="store_true", help="run the base model without a LoRA adapter")
    parser.add_argument("--hook-file", help="prepare-commit-msg target file: write suggestion here instead of stdout")
    args = parser.parse_args()

    diff = get_staged_diff()
    if not diff.strip():
        print("No staged changes (git diff --staged is empty).", file=sys.stderr)
        sys.exit(1)

    prompt = build_prompt(diff)
    if prompt is None:
        print("Staged diff was empty after filtering (only lockfiles/generated files?).", file=sys.stderr)
        sys.exit(1)

    adapter_path = None if args.no_adapter else args.adapter_path
    model, tokenizer = load_model(args.base_model, adapter_path)
    message = generate_message(model, tokenizer, prompt)

    if args.hook_file:
        with open(args.hook_file, "r") as f:
            existing = f.read()
        # Only overwrite if the user hasn't already typed a message (e.g. `git commit -m`).
        if existing.strip().startswith("#") or not existing.strip():
            with open(args.hook_file, "w") as f:
                f.write(message + "\n" + existing)
    else:
        print(message)


if __name__ == "__main__":
    main()
