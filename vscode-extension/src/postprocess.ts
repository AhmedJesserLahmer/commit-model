// Cleans up a generated commit message before it's shown. Mirrors src/commit_model/postprocess.py;
// both are checked against test/clean-cases.json.
//
// The training data (CommitBench) replaced every number with <I> (and URLs, emails with <URL>,
// <EMAIL>), so the model learned to write e.g. "(#<I>)" for a pull-request number. Only those exact
// placeholder tokens are removed: real uses of #, < and > ("fixes #8", "a -> b", "<code>") stay.

const PLACEHOLDER = "<(?:I|URL|EMAIL|HASH)>";
const CONVENTIONAL_PREFIX = /^(\w+(?:\([^)]*\))?!?:\s*)(.*)$/;

export function cleanMessage(message: string): string {
    const match = CONVENTIONAL_PREFIX.exec(message.trim());
    const [prefix, description] = match ? [match[1], match[2]] : ["", message.trim()];

    let cleaned = description
        // "(#<I>)", "(<I>)", "[#<I>]": a pull-request or issue number
        .replace(new RegExp(`\\s*[([]\\s*(?:#|GH-)?${PLACEHOLDER}\\s*[)\\]]`, "gi"), "")
        // "Addresses org/repo#<I>", "closes #<I>": a reference, with the word introducing it
        .replace(new RegExp(`[,;]?\\s*(?:(?:addresses|closes|close|fixes|fix|resolves|refs?|see)\\s+)?\\S*#${PLACEHOLDER}`, "gi"), "")
        // any other placeholder, e.g. a version number
        .replace(new RegExp(PLACEHOLDER, "g"), "")
        .replace(/\(\s*\)|\[\s*\]/g, "")
        .replace(/\s{2,}/g, " ")
        .replace(/\s+([,.;:])/g, "$1")
        .trim()
        .replace(/[,;:]$/, "")
        .trim();

    if (!cleaned) {
        return message.trim(); // nothing meaningful left: better the original than an empty message
    }
    // Consistent lowercase start ("Add" -> "add"), but not for acronyms or names ("README", "PropTable").
    const [first, ...rest] = cleaned.split(" ");
    if (/^[A-Z][a-z]+$/.test(first)) {
        cleaned = [first.toLowerCase(), ...rest].join(" ");
    }
    return `${prefix}${cleaned}`;
}
