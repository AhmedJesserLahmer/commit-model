// Integration test launcher: runs the extension inside a real VS Code, in a throwaway Git repository.
//
// Usage (after `npm run compile`):
//   node test/integration/runTest.js [model.gguf]
//
// Model: argument, else $COMMIT_MODEL_PATH, else the locally quantized model in this project.
// VS Code: $VSCODE_PATH if set, else the installed `code`, else @vscode/test-electron downloads one.
// Uses a separate test profile in .vscode-test/ with other extensions disabled.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runTests } = require("@vscode/test-electron");

const extensionRoot = path.resolve(__dirname, "..", "..");
const modelPath = path.resolve(
    process.argv[2] || process.env.COMMIT_MODEL_PATH ||
    path.join(extensionRoot, "..", "merged_weights_quantized_model", "quantized-model", "commit-model-Q4_K_M.gguf"),
);

function installedVSCode() {
    if (process.env.VSCODE_PATH) {
        return process.env.VSCODE_PATH;
    }
    if (process.platform !== "linux") {
        return undefined; // @vscode/test-electron downloads a VS Code build
    }
    // The real Electron binary, not the `code` launcher script (which returns before tests finish).
    const snapBinary = "/snap/code/current/usr/share/code/code";
    if (fs.existsSync(snapBinary)) {
        // Snap VS Code must run inside the Snap environment (its graphics libraries and paths),
        // so wrap the binary in `snap run --shell code`.
        const wrapper = path.join(os.tmpdir(), "commit-model-snap-code.sh");
        fs.writeFileSync(wrapper,
            "#!/usr/bin/env bash\n" +
            `exec snap run --shell code -c "exec $(printf '%q ' ${snapBinary} \"$@\")"\n`);
        fs.chmodSync(wrapper, 0o755);
        return wrapper;
    }
    try {
        const launcher = fs.realpathSync(execFileSync("which", ["code"]).toString().trim());
        const binary = path.join(path.dirname(launcher), "..", "code"); // .deb: /usr/share/code/bin/code -> ../code
        return fs.existsSync(binary) ? binary : undefined;
    } catch {
        return undefined;
    }
}

async function main() {
    // When run from VS Code's own terminal, these make the launched VS Code start as plain Node.js
    // (ELECTRON_RUN_AS_NODE) or hand off to the already-open window (VSCODE_*).
    for (const name of Object.keys(process.env)) {
        if (name.startsWith("VSCODE_") || name.startsWith("ELECTRON_")) {
            delete process.env[name];
        }
    }
    if (process.platform === "win32") {
        // Lets VS Code load its shell integration in Windows PowerShell (blocked by the default
        // "Restricted" script policy), so the terminal test can read the prompt. Only affects the
        // processes started by this test run.
        process.env.PSExecutionPolicyPreference = "RemoteSigned";
    }
    if (!fs.existsSync(modelPath)) {
        throw new Error(`Model not found: ${modelPath}. Pass a .gguf path as argument.`);
    }

    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "commit-model-it-"));
    const git = (...args) => execFileSync("git", args, { cwd: repo });
    git("init", "-q");
    git("config", "user.name", "Integration Test");
    git("config", "user.email", "test@example.com");
    fs.mkdirSync(path.join(repo, ".vscode"));
    fs.writeFileSync(path.join(repo, ".vscode", "settings.json"),
        JSON.stringify({ "commitModel.modelPath": modelPath, "git.autoRepositoryDetection": true }, null, 2));
    fs.appendFileSync(path.join(repo, ".git", "info", "exclude"), ".vscode/\n");
    fs.writeFileSync(path.join(repo, "math_utils.py"), "def add(a, b):\n    return a + b\n");
    git("add", "math_utils.py");
    git("commit", "-q", "-m", "chore: initial commit");

    const testRoot = path.join(extensionRoot, ".vscode-test");
    try {
        await runTests({
            vscodeExecutablePath: installedVSCode(),
            extensionDevelopmentPath: extensionRoot,
            extensionTestsPath: path.join(__dirname, "suite.js"),
            extensionTestsEnv: { COMMIT_MODEL_TEST_REPO: repo },
            launchArgs: [
                repo,
                "--disable-extensions",
                "--disable-workspace-trust",
                // As the regular `code` launcher does on Linux: Electron's Wayland backend can crash at startup.
                ...(process.platform === "linux" ? ["--ozone-platform=x11"] : []),
                "--user-data-dir", path.join(testRoot, "user-data"),
                "--extensions-dir", path.join(testRoot, "extensions"),
            ],
        });
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error("Integration tests failed:", error.message ?? error);
    process.exit(1);
});
