// Status bar toggle: "Offhand: On" loads the model; then, in VS Code's terminals, every successful
// `git add` is followed by a suggested commit message and a Y/N question (see terminal.ts).
import * as vscode from "vscode";

import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";

import { downloadFile } from "./download";
import { EngineOptions, MissingRuntimeError, ModelEngine } from "./engine";
import { gitPath, pickRepository, setCommitMessage, stagedDiff } from "./git";
import { buildDiff } from "./prompt";
import { TerminalSetup, setUpTerminals } from "./terminalSetup";

const engine = new ModelEngine((reason) => {
    void turnOff();
    log(`engine stopped unexpectedly: ${reason}`);
    ui.warn(`Offhand turned off: ${reason}`);
});
let statusBar: vscode.StatusBarItem;
let extensionContext: vscode.ExtensionContext;
let terminals: TerminalSetup | undefined;
let output: vscode.OutputChannel | undefined;
let enabled = false;
let starting = false;
let generating = false;

/** User-facing messages, in one swappable place: integration tests replace it to record them. */
export const ui = {
    info: (message: string) => void vscode.window.showInformationMessage(message),
    warn: (message: string) => void vscode.window.showWarningMessage(message),
    error: (message: string) => void vscode.window.showErrorMessage(message),
    /** Asks whether to install a missing Windows component; true if the user agreed. */
    offerInstall: async (message: string, action: string) =>
        (await vscode.window.showErrorMessage(message, action)) === action,
};

/** Activity log in the Output panel ("Offhand"). */
function log(line: string): void {
    output?.appendLine(`[${new Date().toLocaleTimeString()}] ${line}`);
}

export function activate(context: vscode.ExtensionContext): { ui: typeof ui; terminals: TerminalSetup | undefined } {
    extensionContext = context;
    // Commands first: if anything later in activation failed, they'd otherwise never be registered and
    // users would only see "command not found".
    context.subscriptions.push(
        vscode.commands.registerCommand("offhand.toggle", () => (enabled ? turnOff() : turnOn())),
        vscode.commands.registerCommand("offhand.start", turnOn),
        vscode.commands.registerCommand("offhand.stop", turnOff),
        vscode.commands.registerCommand("offhand.generate", (sourceControl?: { rootUri?: vscode.Uri }) =>
            fillCommitBox(sourceControl)),
    );
    output = vscode.window.createOutputChannel("Offhand");
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    context.subscriptions.push(output, statusBar);
    refreshStatus();
    statusBar.show();

    try {
        terminals = setUpTerminals(context, gitPath());
    } catch (error) {
        // The ✨ button still works without the terminal prompt.
        log(`terminal setup failed: ${errorMessage(error)}`);
        ui.warn(`Offhand: the terminal prompt after \`git add\` couldn't be set up: ${errorMessage(error)}`);
    }
    return { ui, terminals };
}

export async function deactivate(): Promise<void> {
    terminals?.turnOff();
    await engine.stop();
}

// --- Status bar -------------------------------------------------------------------------------------

function setStatus(text: string, tooltip: string, command?: string): void {
    statusBar.text = text;
    statusBar.tooltip = tooltip;
    statusBar.command = command;
}

function refreshStatus(): void {
    if (enabled) {
        setStatus("$(sparkle) Offhand: On",
            "After each `git add` in the terminal, suggests a commit message. Click to turn off and free memory.",
            "offhand.toggle");
    } else {
        setStatus("$(circle-large-outline) Offhand: Off",
            "Click to turn on: after each `git add` in the terminal, suggests a commit message.",
            "offhand.toggle");
    }
}

// --- Turning on and off -------------------------------------------------------------------------------

function engineOptions(): EngineOptions {
    const config = vscode.workspace.getConfiguration("offhand");
    const modelPath = config.get<string>("modelPath", "").trim();
    const modelUri = config.get<string>("modelUri", "").trim();
    if (!modelPath && (!modelUri || modelUri.includes("<username>"))) {
        throw new Error("No model configured. Set offhand.modelPath (local .gguf) or offhand.modelUri in Settings.");
    }
    return {
        modelPath,
        modelUri,
        storageDir: extensionContext.globalStorageUri.fsPath,
        gpu: config.get<"auto" | "cpu">("gpu", "auto"),
    };
}

/** Starts the model; progress shows in the status bar. Returns false if it failed (error already shown). */
async function startEngine(): Promise<boolean> {
    if (engine.isRunning) {
        return true;
    }
    try {
        const options = engineOptions();
        await engine.start(options, (phase) => {
            if (phase.phase === "downloading") {
                const what = phase.what === "engine" ? "the engine (~30MB)" : "the model (~1GB)";
                setStatus(`$(cloud-download) Offhand ${phase.percent}%`, `Downloading ${what}, first start only`);
            } else {
                setStatus("$(loading~spin) Offhand: Starting", "Loading the model");
            }
        });
        return true;
    } catch (error) {
        log(`couldn't start: ${errorMessage(error)}`);
        if (error instanceof MissingRuntimeError) {
            void offerRuntimeInstall();
        } else {
            ui.error(`Offhand couldn't start: ${errorMessage(error)}`);
        }
        return false;
    } finally {
        refreshStatus();
    }
}

/**
 * Windows without the Microsoft Visual C++ runtime: offers to download Microsoft's installer and run it
 * (Windows asks for permission), then turns Offhand on.
 */
async function offerRuntimeInstall(): Promise<void> {
    const install = await ui.offerInstall(
        "Offhand needs the Microsoft Visual C++ runtime, which isn't installed on this PC. " +
        "It's a free Microsoft component that many apps use.",
        "Install it",
    );
    if (!install) {
        return;
    }
    try {
        const installer = path.join(extensionContext.globalStorageUri.fsPath, "vc_redist.x64.exe");
        await fs.mkdir(path.dirname(installer), { recursive: true });
        await downloadFile(MissingRuntimeError.INSTALLER_URL, installer, (percent) =>
            setStatus(`$(cloud-download) Offhand ${percent}%`, "Downloading the Microsoft Visual C++ runtime"));
        setStatus("$(loading~spin) Offhand: Installing", "Installing the Microsoft Visual C++ runtime");
        log("installing the Microsoft Visual C++ runtime");
        const code = await new Promise<number | null>((resolve, reject) => {
            const child = spawn(installer, ["/install", "/passive", "/norestart"]);
            child.on("error", reject);
            child.on("exit", resolve);
        });
        // 0: installed; 1638: a newer version is already there; 3010: installed, restart recommended
        if (code !== 0 && code !== 1638 && code !== 3010) {
            throw new Error(`the installer ended with code ${code} (cancelled?)`);
        }
        log("Microsoft Visual C++ runtime installed");
        await turnOn();
    } catch (error) {
        log(`runtime install failed: ${errorMessage(error)}`);
        ui.error(`Offhand couldn't install the Microsoft Visual C++ runtime: ${errorMessage(error)}. ` +
            `You can install it yourself from ${MissingRuntimeError.INSTALLER_URL}`);
    } finally {
        refreshStatus();
    }
}

async function turnOn(): Promise<void> {
    if (enabled || starting) {
        return;
    }
    starting = true;
    try {
        if (!(await startEngine()) || !engine.url) {
            return;
        }
        terminals?.turnOn(engine.url);
        enabled = true;
        log("turned on");
    } finally {
        starting = false;
        refreshStatus();
    }
}

async function turnOff(): Promise<void> {
    if (enabled) {
        log("turned off");
    }
    enabled = false;
    terminals?.turnOff();
    refreshStatus();
    await engine.stop();
}

// --- ✨ button ----------------------------------------------------------------------------------------

/** The ✨ button in Source Control: puts a suggestion for the staged changes in the commit box. */
async function fillCommitBox(sourceControl?: { rootUri?: vscode.Uri }): Promise<void> {
    if (generating) {
        return;
    }
    generating = true;
    try {
        const repository = pickRepository(sourceControl);
        if (!repository) {
            ui.warn("Offhand: no Git repository is open.");
            return;
        }
        const diff = await stagedDiff(repository);
        if (!diff.trim()) {
            ui.info("Offhand: nothing is staged. Stage your changes first (e.g. git add .).");
            return;
        }
        const filtered = buildDiff(diff);
        if (filtered === null) {
            ui.info("Offhand: only lockfiles or generated files are staged, so there's nothing to describe.");
            return;
        }
        await turnOn();
        if (!enabled) {
            return;
        }
        setStatus("$(loading~spin) Offhand: Writing…", "Writing a commit message");
        const message = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.SourceControl },
            () => engine.generate(filtered),
        );
        log(`suggested in the commit box: ${message}`);
        setCommitMessage(repository, message);
    } catch (error) {
        log(`error: ${errorMessage(error)}`);
        ui.error(`Offhand: ${errorMessage(error)}`);
    } finally {
        generating = false;
        refreshStatus();
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
