#!/usr/bin/env bash
# Installs a prepare-commit-msg hook into the target git repo (defaults to CWD)
# that pre-fills the commit message using the commit-model CLI.
#
# Usage: scripts/install_hook.sh [path-to-repo] [path-to-model.gguf]
#
# Without a model path, the hook uses $COMMIT_MODEL_PATH / $COMMIT_MODEL_URI as set when git runs it.
set -euo pipefail

REPO_DIR="${1:-.}"
MODEL_PATH="${2:-}"
HOOK_PATH="$REPO_DIR/.git/hooks/prepare-commit-msg"

if [ ! -d "$REPO_DIR/.git" ]; then
    echo "error: $REPO_DIR is not a git repository" >&2
    exit 1
fi

# Absolute path to the CLI: git hooks often run without the project's virtualenv on PATH.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$(command -v commit-model || true)"
if [ -z "$CLI" ] && [ -x "$SCRIPT_DIR/../.venv/bin/commit-model" ]; then
    CLI="$(cd "$SCRIPT_DIR/../.venv/bin" && pwd)/commit-model"
fi
if [ -z "$CLI" ]; then
    echo "error: commit-model not found. Run 'uv pip install -e .' in the project first." >&2
    exit 1
fi

MODEL_ARGS=""
if [ -n "$MODEL_PATH" ]; then
    MODEL_PATH="$(cd "$(dirname "$MODEL_PATH")" && pwd)/$(basename "$MODEL_PATH")"
    MODEL_ARGS="--model-path $(printf '%q' "$MODEL_PATH")"
fi

cat > "$HOOK_PATH" <<EOF
#!/usr/bin/env bash
# Installed by CLI-Commit-Model/scripts/install_hook.sh
MSG_FILE="\$1"
COMMIT_SOURCE="\${2:-}"

# Only auto-fill on a plain \`git commit\` with no message/template/merge already provided.
if [ -z "\$COMMIT_SOURCE" ]; then
    $(printf '%q' "$CLI") $MODEL_ARGS --hook-file "\$MSG_FILE" || true
fi
EOF

chmod +x "$HOOK_PATH"
echo "Installed prepare-commit-msg hook at $HOOK_PATH"
