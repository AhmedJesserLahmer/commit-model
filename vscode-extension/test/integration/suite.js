// Integration tests, run inside VS Code by runTest.js. Everything is real: model, llama-server, the
// `git` wrapper in the terminals, Git and commits. Answers are typed into the prompt's input.
const assert = require("assert");
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

const repo = fs.realpathSync(process.env.COMMIT_MODEL_TEST_REPO);
const realGit = (...args) => execFileSync("git", args, { cwd: repo }).toString().trim();
const lastCommitSubject = () => realGit("log", "-1", "--format=%s");
const stagedFiles = () => realGit("diff", "--cached", "--name-only");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isWindows = process.platform === "win32";
// Windows paths are case-insensitive, and VS Code writes the drive letter in lowercase ("c:\\...").
const samePath = (a, b) => (isWindows ? a.toLowerCase() === b.toLowerCase() : a === b);
const VALID_MESSAGE = /^(feat|fix|refactor|chore|docs|test|perf|style|build|ci)(\([\w./-]+\))?!?:\s+\S/;

async function waitFor(what, condition, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await condition();
        if (value) {
            return value;
        }
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${what}`);
        }
        await sleep(200);
    }
}

let terminals;
let ui;
const shown = [];
const runtimeMissing = isWindows &&
    !fs.existsSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "vcruntime140.dll"));

/**
 * Runs a git command the way an integrated terminal does (wrapper first on PATH, the extension's
 * environment), typing `input` as the user's answers. COMMIT_MODEL_FORCE_PROMPT stands in for the
 * terminal: without a real terminal (TTY) the wrapper never prompts.
 */
function gitInTerminal(args, input = "", { interactive = true } = {}) {
    const env = { ...process.env, ...terminals.env, PATH: `${terminals.binDir}${path.delimiter}${process.env.PATH}` };
    if (interactive) {
        env.COMMIT_MODEL_FORCE_PROMPT = "1";
    }
    // On Windows, through the Command Prompt like a user's terminal: Node itself can't run git.cmd.
    const result = isWindows
        ? spawnSync(["git", ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" "),
            { cwd: repo, env, input, encoding: "utf8", timeout: 120_000, shell: true })
        : spawnSync("git", args, { cwd: repo, env, input, encoding: "utf8", timeout: 120_000 });
    assert.strictEqual(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
    return result.stdout;
}

function write(file, content) {
    fs.writeFileSync(path.join(repo, file), content);
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const suggestionIn = (output) => (output.match(/Commit Model suggests:\s+(.+)/) ?? [])[1]?.trim();

function serverRunning() {
    const processes = isWindows
        ? execFileSync("powershell", ["-NoProfile", "-Command",
            "Get-CimInstance Win32_Process -Filter \"Name='llama-server.exe'\" | ForEach-Object CommandLine"]).toString()
        : execFileSync("ps", ["-eo", "args"]).toString();
    return processes.split(/\r?\n/).some((p) => p.includes("llama-server") && p.includes(".vscode-test"));
}

const tests = [
    ["the commands are registered", async () => {
        const commands = await vscode.commands.getCommands(true);
        for (const id of ["commitModel.toggle", "commitModel.start", "commitModel.stop", "commitModel.generate"]) {
            assert.ok(commands.includes(id), `missing command ${id}`);
        }
    }],

    ["the git wrapper is installed for terminals", async () => {
        const wrapper = path.join(terminals.binDir, isWindows ? "git.cmd" : "git");
        fs.accessSync(wrapper, isWindows ? fs.constants.R_OK : fs.constants.X_OK);
        assert.ok(terminals.env.COMMIT_MODEL_REAL_GIT, "the real git wasn't found");
    }],

    ["terminals keep working after a window reload (stable on/off file)", async () => {
        // Terminals survive a window reload and keep the environment they started with, so the
        // on/off file must not depend on anything that changes on reload, like the process ID.
        const stateFile = terminals.env.COMMIT_MODEL_STATE;
        assert.ok(!stateFile.includes(String(process.pid)), `per-process path: ${stateFile}`);
        assert.strictEqual(path.basename(stateFile), "terminal-state.json");
    }],

    ["while off, git add is plain git add", async () => {
        write("draft.txt", "draft\n");
        const output = gitInTerminal(["add", "draft.txt"]);
        assert.doesNotMatch(output, /Commit Model/);
        assert.strictEqual(stagedFiles(), "draft.txt");
        realGit("reset", "-q");
        fs.rmSync(path.join(repo, "draft.txt"));
    }],

    ["Windows without the Visual C++ runtime: offers to install it, then starts", async () => {
        if (!runtimeMissing) {
            console.log("      (skipped: not Windows, or the runtime is already installed)");
            return;
        }
        const offers = [];
        ui.offerInstall = async (message) => {
            offers.push(message);
            return true; // the user clicks "Install it"
        };
        await vscode.commands.executeCommand("commitModel.toggle");
        await waitFor("the install offer", () => offers.length > 0, 30_000);
        assert.match(offers[0], /Microsoft Visual C\+\+ runtime/);
        // Real download and install from Microsoft, then Commit Model turns on by itself.
        // On = the on/off file exists (written once the model has loaded, unlike the server process).
        await waitFor("the runtime install and Commit Model turning on",
            () => fs.existsSync(terminals.env.COMMIT_MODEL_STATE), 600_000);
        assert.ok(serverRunning(), "llama-server isn't running");
        assert.ok(fs.existsSync(path.join(process.env.SystemRoot, "System32", "vcruntime140.dll")));
        await vscode.commands.executeCommand("commitModel.toggle"); // back off, for the next test
        await waitFor("llama-server to stop", () => !serverRunning(), 30_000);
    }],

    ["turning on starts the model (download mode: downloads it from Hugging Face first)", async () => {
        const models = path.join(path.dirname(terminals.binDir), "models");
        const downloaded = path.join(models, "commit-model-Q4_K_M.gguf");
        const downloadMode = Boolean(process.env.COMMIT_MODEL_TEST_DOWNLOAD);
        if (downloadMode) {
            assert.ok(!fs.existsSync(downloaded), "the model was already downloaded: not a first start");
        }
        const started = Date.now();
        await vscode.commands.executeCommand("commitModel.toggle");
        if (downloadMode) {
            const size = fs.statSync(downloaded).size;
            console.log(`      downloaded ${(size / 1e6).toFixed(0)} MB from Hugging Face and started in ${((Date.now() - started) / 1000).toFixed(0)}s`);
            assert.ok(size > 900e6, `downloaded model too small: ${size} bytes`);
            assert.deepStrictEqual(fs.readdirSync(models).filter((f) => f.endsWith(".part")), [], "a partial download was left behind");
        }
        assert.deepStrictEqual(shown.filter((m) => m.kind === "error"), []);
        assert.ok(serverRunning(), "llama-server isn't running");
        assert.ok(fs.existsSync(terminals.env.COMMIT_MODEL_STATE), "the terminals weren't told it's on");
    }],

    ["git add → suggestion → Y commits it", async () => {
        write("math_utils.py", "def add(a, b):\n    return a + b\n\n\ndef multiply(a, b):\n    return a * b\n");
        const output = gitInTerminal(["add", "."], "y\n");
        const suggestion = suggestionIn(output);
        assert.match(suggestion ?? "", VALID_MESSAGE, `no valid suggestion in:\n${output}`);
        assert.match(output, /Commit with this message\? \[Y\/N\]/);
        assert.match(output, new RegExp(`✓ Committed [0-9a-f]{7,}  ${escape(suggestion)}`), output);
        assert.strictEqual(lastCommitSubject(), suggestion);
        assert.strictEqual(stagedFiles(), "");
        console.log(`      suggested and committed: ${suggestion}`);
    }],

    ["anything but Y or N is asked again", async () => {
        write("math_utils.py", "def add(a, b):\n    return a + b\n\n\ndef multiply(a, b):\n    return a * b\n\n\ndef subtract(a, b):\n    return a - b\n");
        const output = gitInTerminal(["add", "."], "maybe\nyes\n");
        assert.match(output, /Please type Y or N\./);
        assert.strictEqual(lastCommitSubject(), suggestionIn(output));
    }],

    ["N lets the user type their own message", async () => {
        write("README.md", "# Math utils\n\nSmall helpers.\n");
        const output = gitInTerminal(["add", "README.md"], "n\ndocs: add usage notes\n");
        assert.match(output, /Your commit message/);
        assert.match(output, /✓ Committed [0-9a-f]{7,}  docs: add usage notes/, output);
        assert.strictEqual(lastCommitSubject(), "docs: add usage notes");
    }],

    ["N then an empty message commits nothing", async () => {
        const commitBefore = lastCommitSubject();
        write("test_math.py", "from math_utils import add\n\n\ndef test_add():\n    assert add(1, 2) == 3\n");
        const output = gitInTerminal(["add", "test_math.py"], "n\n\n");
        assert.match(output, /Nothing committed\. Your changes stay staged\./);
        assert.strictEqual(lastCommitSubject(), commitBefore);
        assert.strictEqual(stagedFiles(), "test_math.py");
    }],

    ["other git commands don't prompt", async () => {
        const status = gitInTerminal(["status", "--short"]);
        assert.doesNotMatch(status, /Commit Model/);
        const commit = gitInTerminal(["commit", "-q", "-m", "test: add a test for add"]);
        assert.doesNotMatch(commit, /Commit Model/);
        assert.strictEqual(lastCommitSubject(), "test: add a test for add");
    }],

    ["git add with nothing to stage says so", async () => {
        const output = gitInTerminal(["add", "."]);
        assert.match(output, /nothing is staged/);
        assert.match(output, /Save them first/);
    }],

    ["no prompt outside an interactive terminal (scripts, tools)", async () => {
        write("script_output.txt", "generated\n");
        const output = gitInTerminal(["add", "script_output.txt"], "", { interactive: false });
        assert.doesNotMatch(output, /Commit Model/);
        realGit("reset", "-q");
        fs.rmSync(path.join(repo, "script_output.txt"));
    }],

    ["in a real VS Code terminal: git add, then typing y commits", async () => {
        const terminal = vscode.window.createTerminal({ name: "commit-model-test", cwd: repo });
        try {
            write("strings.py", "def shout(text):\n    return text.upper()\n");
            const integration = await waitFor("shell integration", () => terminal.shellIntegration, 30_000).catch(() => undefined);
            if (integration) {
                // Read the terminal's output: the suggestion and the question must appear in it.
                const execution = integration.executeCommand("git add strings.py");
                let output = "";
                let answered = false;
                for await (const chunk of execution.read()) {
                    output += chunk;
                    if (!answered && /\[Y\/N\]/.test(output)) {
                        answered = true;
                        terminal.sendText("y", true);
                    }
                }
                const clean = output.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, "");
                const suggestion = suggestionIn(clean);
                assert.match(suggestion ?? "", VALID_MESSAGE, `no suggestion in the terminal output:\n${clean}`);
                assert.match(clean, /✓ Committed [0-9a-f]{7,}/, clean);
                assert.strictEqual(lastCommitSubject(), suggestion);
            } else {
                // Without shell integration the test can't see when the question appears, and an answer
                // typed ahead may be taken by the shell's line editor (PSReadLine) instead of the prompt.
                throw new Error("no shell integration in this terminal, so the prompt can't be read (see runTest.js)");
            }
            console.log(`      committed from the terminal: ${lastCommitSubject()}`);
        } finally {
            terminal.dispose();
        }
    }],

    ["the ✨ button puts a suggestion in the commit box", async () => {
        write("strings.py", "def shout(text):\n    return text.upper()\n\n\ndef whisper(text):\n    return text.lower()\n");
        realGit("add", "strings.py");
        await vscode.commands.executeCommand("commitModel.generate");
        const gitApi = vscode.extensions.getExtension("vscode.git").exports.getAPI(1);
        const repository = gitApi.repositories.find((r) => samePath(r.rootUri.fsPath, repo));
        assert.match(repository.inputBox.value, VALID_MESSAGE);
        realGit("reset", "-q");
    }],

    ["download mode: a second start reuses the downloaded model", async () => {
        if (!process.env.COMMIT_MODEL_TEST_DOWNLOAD) {
            console.log("      (skipped: not in download mode)");
            return;
        }
        const downloaded = path.join(path.dirname(terminals.binDir), "models", "commit-model-Q4_K_M.gguf");
        const before = fs.statSync(downloaded).mtimeMs;
        await vscode.commands.executeCommand("commitModel.toggle"); // off
        await waitFor("llama-server to stop", () => !serverRunning(), 30_000);
        const started = Date.now();
        await vscode.commands.executeCommand("commitModel.toggle"); // on again
        assert.ok(serverRunning(), "llama-server isn't running");
        assert.strictEqual(fs.statSync(downloaded).mtimeMs, before, "the model was downloaded again");
        console.log(`      second start without downloading: ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }],

    ["turning off stops the model, and git add is plain again", async () => {
        await vscode.commands.executeCommand("commitModel.toggle");
        await waitFor("llama-server to stop", () => !serverRunning(), 30_000);
        assert.ok(!fs.existsSync(terminals.env.COMMIT_MODEL_STATE));
        write("after_off.txt", "x\n");
        const output = gitInTerminal(["add", "after_off.txt"], "y\n");
        assert.doesNotMatch(output, /Commit Model/);
    }],
];

exports.run = async function run() {
    const api = await vscode.extensions.getExtension("commit-model.commit-model").activate();
    terminals = api.terminals;
    ui = api.ui;
    for (const kind of ["info", "warn", "error"]) {
        api.ui[kind] = (message) => shown.push({ kind, message });
    }
    const gitApi = vscode.extensions.getExtension("vscode.git").exports.getAPI(1);
    await waitFor("Git to open the test repository", () => gitApi.repositories.some((r) => samePath(r.rootUri.fsPath, repo)), 30_000);

    const failures = [];
    for (const [name, test] of tests) {
        try {
            await test();
            console.log(`  ✓ ${name}`);
        } catch (error) {
            failures.push(name);
            console.log(`  ✗ ${name}\n      ${error.message.split("\n").join("\n      ")}`);
        }
    }
    console.log(`\n${tests.length - failures.length}/${tests.length} passed`);
    if (failures.length) {
        throw new Error(`${failures.length} test(s) failed: ${failures.join(", ")}`);
    }
};
