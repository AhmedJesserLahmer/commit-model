"""CLI: reads `git diff --staged`, generates a Conventional Commits message.

Runs the 4-bit model in llama.cpp's llama-server (same engine as the VS Code extension). The engine
and, unless a local model is given, the model are downloaded once into ~/.cache/commit-model.

Usage:
    commit-model                                  # print a suggestion for the staged diff
    commit-model --model-path model.gguf          # use a local model file
    commit-model --hook-file MSGFILE              # write suggestion into a prepare-commit-msg file

The model can also be set with the COMMIT_MODEL_PATH (local file) or COMMIT_MODEL_URI environment variables.
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

from commit_model.diff_utils import build_diff
from commit_model.engine import DEFAULT_CACHE_DIR, Engine

# Placeholder until the model is published on Hugging Face.
DEFAULT_MODEL_URI = "hf:<username>/<repo>/commit-model-Q4_K_M.gguf"


def get_staged_diff() -> str:
    result = subprocess.run(
        ["git", "diff", "--staged"], capture_output=True, text=True, check=True
    )
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model-path", default=os.environ.get("COMMIT_MODEL_PATH"),
                        help="local .gguf model (default: $COMMIT_MODEL_PATH)")
    parser.add_argument("--model-uri", default=os.environ.get("COMMIT_MODEL_URI", DEFAULT_MODEL_URI),
                        help="hf:<user>/<repo>/<file> or URL to download the model from (default: $COMMIT_MODEL_URI)")
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR,
                        help=f"where the engine and model are downloaded (default: {DEFAULT_CACHE_DIR})")
    parser.add_argument("--cpu", action="store_true", help="run on the CPU even if a GPU is available")
    parser.add_argument("--hook-file", help="prepare-commit-msg target file: write suggestion here instead of stdout")
    args = parser.parse_args()

    if not args.model_path and "<username>" in args.model_uri:
        print("No model configured: pass --model-path, or set COMMIT_MODEL_PATH or COMMIT_MODEL_URI.", file=sys.stderr)
        sys.exit(1)

    diff = get_staged_diff()
    if not diff.strip():
        print("No staged changes (git diff --staged is empty).", file=sys.stderr)
        sys.exit(1)

    diff = build_diff(diff)
    if diff is None:
        print("Staged diff was empty after filtering (only lockfiles/generated files?).", file=sys.stderr)
        sys.exit(1)

    with Engine(args.model_path, args.model_uri, args.cache_dir, use_gpu=not args.cpu) as engine:
        message = engine.generate(diff)

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
