"""Diff filtering/truncation policy shared by dataset prep and inference.

Keeping this in one place matters: the model is trained on diffs shaped by this
policy, so inference must shape live diffs the same way or the prompt distribution
will drift from what the model saw during fine-tuning.
"""
import re

CONVENTIONAL_PREFIX = re.compile(
    r"^(feat|fix|refactor|chore|docs|test|perf|style|build|ci)(\([\w./-]+\))?!?:\s+\S"
)

LOW_CONTENT_STOPLIST = {
    "fix", "wip", "update", "updates", "minor", "minor changes", "misc",
    "cleanup", "small fix", "typo", "changes", "stuff", "test", "tmp",
    "asdf", "oops", "fixup",
}

GENERATED_FILE_PATTERNS = [
    re.compile(p) for p in [
        r"package-lock\.json$", r"yarn\.lock$", r"pnpm-lock\.yaml$",
        r"Cargo\.lock$", r"Gemfile\.lock$", r"poetry\.lock$", r"uv\.lock$",
        r"\.min\.(js|css)$", r"\.map$", r"/dist/", r"/build/", r"/vendor/",
        r"\.svg$", r"\.snap$",
    ]
]

MAX_DIFF_CHARS = 4000
MAX_FILES_PER_DIFF = 6

PROMPT_TEMPLATE = "Write a Conventional Commits message for this diff.\n\n{diff}\n\nCommit message:"

# Must match SEQ_LEN in fine-tuning_Kaggle.ipynb: the model never saw longer prompts.
SEQ_LEN = 768


def is_generated_path(path: str) -> bool:
    return any(p.search(path) for p in GENERATED_FILE_PATTERNS)


def message_is_low_content(message: str) -> bool:
    first_line = message.strip().splitlines()[0] if message.strip() else ""
    has_prefix = CONVENTIONAL_PREFIX.match(first_line)
    subject = first_line.split(":", 1)[-1].strip() if has_prefix else first_line
    normalized = subject.lower().strip(" .!")
    return len(normalized) < 8 or normalized in LOW_CONTENT_STOPLIST


def split_diff_by_file(diff: str):
    """Split a unified diff into (path, hunk_text) chunks."""
    chunks = re.split(r"(?=^diff --git )", diff, flags=re.MULTILINE)
    files = []
    for chunk in chunks:
        if not chunk.strip():
            continue
        match = re.search(r"^diff --git a/(\S+) b/(\S+)", chunk)
        path = match.group(2) if match else "unknown"
        files.append((path, chunk))
    return files


def truncate_diff(diff: str) -> str | None:
    """Drop generated/lockfile paths, cap file count, and cap total length."""
    files = split_diff_by_file(diff)
    kept = [(p, c) for p, c in files if not is_generated_path(p)]
    if not kept:
        return None
    kept = kept[:MAX_FILES_PER_DIFF]

    pieces = []
    for path, chunk in kept:
        share = max(MAX_DIFF_CHARS // max(len(kept), 1), 200)
        pieces.append(chunk[:share])
    return "".join(pieces)[:MAX_DIFF_CHARS]


def fit_prompt(tokenizer, diff: str, reserve_tokens: int = 40) -> str:
    """Format the prompt, truncating the diff (not the prompt's tail) to fit SEQ_LEN.

    Mirrors the training-time truncation: `reserve_tokens` stands in for the commit
    message, so the instruction and trailing "Commit message:" always survive.
    """
    template_tokens = len(tokenizer(PROMPT_TEMPLATE.format(diff=""), add_special_tokens=False).input_ids)
    budget = max(SEQ_LEN - template_tokens - reserve_tokens - 8, 0)
    diff_ids = tokenizer(diff, add_special_tokens=False).input_ids[:budget]
    return PROMPT_TEMPLATE.format(diff=tokenizer.decode(diff_ids))


def build_diff(diff: str) -> str | None:
    truncated = truncate_diff(diff)
    if truncated is None or len(truncated.strip()) < 20:
        return None
    return truncated
