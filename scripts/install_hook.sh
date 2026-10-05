#!/usr/bin/env bash
# Installs a prepare-commit-msg hook into the target git repo (defaults to CWD)
# that pre-fills the commit message using the commit-model CLI.
#
# Usage: scripts/install_hook.sh [path-to-repo]
set -euo pipefail

REPO_DIR="${1:-.}"
HOOK_PATH="$REPO_DIR/.git/hooks/prepare-commit-msg"

if [ ! -d "$REPO_DIR/.git" ]; then
    echo "error: $REPO_DIR is not a git repository" >&2
    exit 1
fi

cat > "$HOOK_PATH" <<'EOF'
#!/usr/bin/env bash
# Installed by CLI-Commit-Model/scripts/install_hook.sh
MSG_FILE="$1"
COMMIT_SOURCE="${2:-}"

# Only auto-fill on a plain `git commit` with no message/template/merge already provided.
if [ -z "$COMMIT_SOURCE" ]; then
    commit-model --hook-file "$MSG_FILE" || true
fi
EOF

chmod +x "$HOOK_PATH"
echo "Installed prepare-commit-msg hook at $HOOK_PATH"
