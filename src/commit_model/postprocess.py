"""Cleans up a generated commit message before it's shown.

Mirrors vscode-extension/src/postprocess.ts; both are checked against
vscode-extension/test/clean-cases.json.

The training data (CommitBench) replaced every number with <I> (and URLs, emails with <URL>,
<EMAIL>), so the model learned to write e.g. "(#<I>)" for a pull-request number. Only those exact
placeholder tokens are removed: real uses of #, < and > ("fixes #8", "a -> b", "<code>") stay.
"""
import re

PLACEHOLDER = r"<(?:I|URL|EMAIL|HASH)>"
CONVENTIONAL_PREFIX = re.compile(r"^(\w+(?:\([^)]*\))?!?:\s*)(.*)$")


def clean_message(message: str) -> str:
    match = CONVENTIONAL_PREFIX.match(message.strip())
    prefix, description = (match.group(1), match.group(2)) if match else ("", message.strip())

    # "(#<I>)", "(<I>)", "[#<I>]": a pull-request or issue number
    cleaned = re.sub(rf"\s*[(\[]\s*(?:#|GH-)?{PLACEHOLDER}\s*[)\]]", "", description, flags=re.IGNORECASE)
    # "Addresses org/repo#<I>", "closes #<I>": a reference, with the word introducing it
    cleaned = re.sub(rf"[,;]?\s*(?:(?:addresses|closes|close|fixes|fix|resolves|refs?|see)\s+)?\S*#{PLACEHOLDER}",
                     "", cleaned, flags=re.IGNORECASE)
    # any other placeholder, e.g. a version number
    cleaned = re.sub(PLACEHOLDER, "", cleaned)
    cleaned = re.sub(r"\(\s*\)|\[\s*\]", "", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    cleaned = re.sub(r"\s+([,.;:])", r"\1", cleaned).strip()
    cleaned = re.sub(r"[,;:]$", "", cleaned).strip()

    if not cleaned:
        return message.strip()  # nothing meaningful left: better the original than an empty message
    # Consistent lowercase start ("Add" -> "add"), but not for acronyms or names ("README", "PropTable").
    first, _, rest = cleaned.partition(" ")
    if re.fullmatch(r"[A-Z][a-z]+", first):
        cleaned = first.lower() + (" " + rest if rest else "")
    return prefix + cleaned
