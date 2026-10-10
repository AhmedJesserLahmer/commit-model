// Puts a small `git` wrapper first on the PATH of VS Code's integrated terminals, on every platform.
// It runs the real git; after a successful `git add` in an interactive terminal while Commit Model is
// on, it runs the terminal prompt (dist/terminal.js) with VS Code's own Node runtime.
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

// Windows (PowerShell, Command Prompt): the same, as a batch file. PATHEXT makes `git` resolve to this
// git.cmd before the real git.exe further down the PATH. It hands over to WINDOWS_PROMPT below.
const WINDOWS_WRAPPER = [
    "@echo off",
    "rem Installed by the Commit Model VS Code extension. Runs the real git; after a successful",
    "rem `git add` while Commit Model is on, suggests a commit message.",
    "setlocal",
    'set "real_git=%COMMIT_MODEL_REAL_GIT%"',
    'if not defined real_git for /f "delims=" %%G in (\'where git.exe\') do if not defined real_git set "real_git=%%G"',
    'call "%real_git%" %*',
    "set status=%ERRORLEVEL%",
    'if not "%status%"=="0" exit /b %status%',
    'if /i not "%~1"=="add" exit /b 0',
    'if not exist "%COMMIT_MODEL_STATE%" exit /b 0',
    'set "COMMIT_MODEL_REAL_GIT=%real_git%"',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0commit-model-prompt.ps1"',
    "exit /b 0",
    "",
].join("\r\n");

// Windows prompt: VS Code's runtime (Code.exe) is a windowed program there and can't read the keyboard,
// so it only produces the suggestion (`terminal.js --suggest`); this console PowerShell script has the
// conversation and commits. Same texts as terminal.ts. Characters like the check mark are built from
// their codes: Windows PowerShell 5.1 would misread them in a file without a byte-order mark.
const WINDOWS_PROMPT = [
    "# Installed by the Commit Model VS Code extension, run by git.cmd after a successful `git add`.",
    "$ErrorActionPreference = 'Stop'",
    "if ([Console]::IsInputRedirected -and -not $env:COMMIT_MODEL_FORCE_PROMPT) { exit 0 }  # scripts, tools",
    "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false",
    "$esc = [char]27; $color = -not [Console]::IsOutputRedirected",
    "function Dim($t) { if ($color) { \"$esc[2m$t$esc[0m\" } else { $t } }",
    "function Bold($t) { if ($color) { \"$esc[1m$t$esc[0m\" } else { $t } }",
    "function Green($t) { if ($color) { \"$esc[32m$t$esc[0m\" } else { $t } }",
    "function Ask($question) {",
    "    [Console]::Out.Write($question)",
    "    $line = [Console]::In.ReadLine()",
    "    if ([Console]::IsInputRedirected -and $null -ne $line) { [Console]::Out.WriteLine($line) }  # as a terminal would show it",
    "    return $line",
    "}",
    "function Commit($message) {",
    "    $file = [IO.Path]::GetTempFileName()",
    "    [IO.File]::WriteAllText($file, $message, (New-Object System.Text.UTF8Encoding $false))",
    "    $output = & $env:COMMIT_MODEL_REAL_GIT commit -q -F $file 2>&1",
    "    $ok = $LASTEXITCODE -eq 0",
    "    Remove-Item $file",
    "    if ($ok) {",
    "        $hash = & $env:COMMIT_MODEL_REAL_GIT rev-parse --short HEAD",
    "        [Console]::Out.WriteLine((Green \"$([char]0x2713) Committed\") + ' ' + (Dim $hash) + '  ' + $message)",
    "    } else {",
    "        [Console]::Out.WriteLine(\"Commit failed:`n$($output -join \"`n\")\")",
    "    }",
    "}",
    "",
    "$result = Join-Path $env:TEMP ('commit-model-' + [guid]::NewGuid() + '.json')",
    "[Console]::Out.Write((Dim \"Commit Model is writing a message$([char]0x2026)\"))",
    "$env:ELECTRON_RUN_AS_NODE = '1'",
    "& $env:COMMIT_MODEL_NODE $env:COMMIT_MODEL_CLIENT --suggest $result | Out-Null  # Out-Null waits for it",
    "Remove-Item env:ELECTRON_RUN_AS_NODE",
    "if ($color) { [Console]::Out.Write(\"$([char]13)$esc[2K\") } else { [Console]::Out.WriteLine() }",
    "if (-not (Test-Path $result)) { [Console]::Out.WriteLine('Commit Model: no suggestion was produced.'); exit 0 }",
    "$suggestion = [IO.File]::ReadAllText($result) | ConvertFrom-Json",
    "Remove-Item $result",
    "if ($suggestion.status -eq 'info') { [Console]::Out.WriteLine((Dim $suggestion.text)) }",
    "if ($suggestion.status -ne 'message') { exit 0 }",
    "$message = $suggestion.message",
    "[Console]::Out.WriteLine('Commit Model suggests:  ' + (Bold $message))",
    "while ($true) {",
    "    $answer = Ask ('Commit with this message? ' + (Bold '[Y/N]') + ' ')",
    "    if ($null -eq $answer) { break }",
    "    $answer = $answer.Trim().ToLower()",
    "    if ($answer -in 'y', 'yes') { Commit $message; exit 0 }",
    "    if ($answer -in 'n', 'no') {",
    "        $own = Ask 'Your commit message (empty to cancel): '",
    "        if ($own -and $own.Trim()) { Commit $own.Trim(); exit 0 }",
    "        break",
    "    }",
    "    [Console]::Out.WriteLine((Dim 'Please type Y or N.'))",
    "}",
    "[Console]::Out.WriteLine('Nothing committed. Your changes stay staged.')",
    "",
].join("\r\n");

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

export function setUpTerminals(context: vscode.ExtensionContext, realGit: string | undefined): TerminalSetup {
    const binDir = path.join(context.globalStorageUri.fsPath, "bin");
    // One per workspace, so windows on different folders don't turn each other off. It must stay the
    // same across window reloads: terminals survive a reload and keep the path they were started with.
    const stateDir = (context.storageUri ?? context.globalStorageUri).fsPath;
    const stateFile = path.join(stateDir, "terminal-state.json");
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    // `git` for bash and zsh (Linux, macOS, and Git Bash on Windows); `git.cmd` for PowerShell and
    // Command Prompt on Windows.
    fs.writeFileSync(path.join(binDir, "git"), WRAPPER, { mode: 0o755 });
    fs.chmodSync(path.join(binDir, "git"), 0o755);
    if (process.platform === "win32") {
        fs.writeFileSync(path.join(binDir, "git.cmd"), WINDOWS_WRAPPER);
        fs.writeFileSync(path.join(binDir, "commit-model-prompt.ps1"), WINDOWS_PROMPT);
    }
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
