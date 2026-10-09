// Puts a small `git` wrapper first on the PATH of VS Code's integrated terminals. It runs the real
// git; after a successful `git add` in an interactive terminal while Commit Model is on, it runs the
// terminal prompt (dist/terminal.js) with VS Code's own Node runtime.
//
// The wrapper is set up once, at activation, so turning Commit Model on or off never requires
// reopening terminals: on/off is a state file that the wrapper checks.
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const WRAPPER = `#!/usr/bin/env bash
# Installed by the Commit Model VS Code extension. Runs the real git; after a successful
# \`git add\` in an interactive terminal while Commit Model is on, suggests a commit message.
real_git="\${COMMIT_MODEL_REAL_GIT:-}"
if [ -z "$real_git" ] || [ ! -x "$real_git" ]; then
    # Find git on the PATH without this wrapper's own folder.
    own_dir="$(cd "$(dirname "$0")" && pwd)"
    real_git="$(PATH="$(printf '%s' "$PATH" | tr ':' '\\n' | grep -vxF "$own_dir" | paste -sd ':')" command -v git)"
fi
"$real_git" "$@"
status=$?
if [ "$status" -eq 0 ] && [ "\${1:-}" = "add" ] && [ -f "\${COMMIT_MODEL_STATE:-}" ] \\
    && { [ -t 0 ] || [ -n "\${COMMIT_MODEL_FORCE_PROMPT:-}" ]; }; then
    COMMIT_MODEL_REAL_GIT="$real_git" ELECTRON_RUN_AS_NODE=1 "$COMMIT_MODEL_NODE" "$COMMIT_MODEL_CLIENT" || true
fi
exit "$status"
`;

export interface TerminalSetup {
    /** Environment variables given to integrated terminals (also used by tests). */
    env: Record<string, string>;
    /** Folder with the `git` wrapper, prepended to PATH. */
    binDir: string;
    /** Tells the wrapper the model is on, at this llama-server address. */
    turnOn(url: string): void;
    /** Tells the wrapper the model is off: `git add` behaves normally again. */
    turnOff(): void;
}

export function setUpTerminals(context: vscode.ExtensionContext, realGit: string | undefined): TerminalSetup | undefined {
    if (process.platform === "win32") {
        return undefined; // the wrapper is a bash script; Windows support comes later
    }
    const binDir = path.join(context.globalStorageUri.fsPath, "bin");
    // One per workspace, so windows on different folders don't turn each other off. It must stay the
    // same across window reloads: terminals survive a reload and keep the path they were started with.
    const stateDir = (context.storageUri ?? context.globalStorageUri).fsPath;
    const stateFile = path.join(stateDir, "terminal-state.json");
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, "git"), WRAPPER, { mode: 0o755 });
    fs.chmodSync(path.join(binDir, "git"), 0o755);
    fs.rmSync(stateFile, { force: true }); // starts off

    const env: Record<string, string> = {
        COMMIT_MODEL_STATE: stateFile,
        COMMIT_MODEL_NODE: process.execPath,
        COMMIT_MODEL_CLIENT: path.join(context.extensionPath, "dist", "terminal.js"),
        ...(realGit ? { COMMIT_MODEL_REAL_GIT: realGit } : {}),
    };
    const collection = context.environmentVariableCollection;
    collection.persistent = false;
    collection.description = "Commit Model: suggests a commit message after `git add` while it's on";
    collection.prepend("PATH", binDir + path.delimiter);
    for (const [name, value] of Object.entries(env)) {
        collection.replace(name, value);
    }

    return {
        env,
        binDir,
        turnOn: (url) => fs.writeFileSync(stateFile, JSON.stringify({ url })),
        turnOff: () => fs.rmSync(stateFile, { force: true }),
    };
}
