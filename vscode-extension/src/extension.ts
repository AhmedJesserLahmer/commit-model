// Status bar toggle: "Commit Model: On" loads the model; then, in VS Code's terminals, every successful
// `git add` is followed by a suggested commit message and a Y/N question (see terminal.ts).
import * as vscode from "vscode";

import { EngineOptions, ModelEngine } from "./engine";
import { gitPath, pickRepository, setCommitMessage, stagedDiff } from "./git";
import { buildDiff } from "./prompt";
import { TerminalSetup, setUpTerminals } from "./terminalSetup";

const engine = new ModelEngine((reason) => {
    void turnOff();
    log(`engine stopped unexpectedly: ${reason}`);
    ui.warn(`Commit Model turned off: ${reason}`);
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
};

/** Activity log in the Output panel ("Commit Model"). */
function log(line: string): void {
    output?.appendLine(`[${new Date().toLocaleTimeString()}] ${line}`);
}

export function activate(context: vscode.ExtensionContext): { ui: typeof ui; terminals: TerminalSetup | undefined } {
    extensionContext = context;
    output = vscode.window.createOutputChannel("Commit Model");
    terminals = setUpTerminals(context, gitPath());
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    refreshStatus();
    statusBar.show();

    context.subscriptions.push(
        statusBar,
        output,
        vscode.commands.registerCommand("commitModel.toggle", () => (enabled ? turnOff() : turnOn())),
        vscode.commands.registerCommand("commitModel.start", turnOn),
        vscode.commands.registerCommand("commitModel.stop", turnOff),
        vscode.commands.registerCommand("commitModel.generate", (sourceControl?: { rootUri?: vscode.Uri }) =>
            fillCommitBox(sourceControl)),
    );
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
        setStatus("$(sparkle) Commit Model: On",
            "After each `git add` in the terminal, suggests a commit message. Click to turn off and free memory.",
            "commitModel.toggle");
    } else {
        setStatus("$(circle-large-outline) Commit Model: Off",
            "Click to turn on: after each `git add` in the terminal, suggests a commit message.",
            "commitModel.toggle");
    }
}

// --- Turning on and off -------------------------------------------------------------------------------

function engineOptions(): EngineOptions {
    const config = vscode.workspace.getConfiguration("commitModel");
    const modelPath = config.get<string>("modelPath", "").trim();
    const modelUri = config.get<string>("modelUri", "").trim();
    if (!modelPath && (!modelUri || modelUri.includes("<username>"))) {
        throw new Error("No model configured. Set commitModel.modelPath (local .gguf) or commitModel.modelUri in Settings.");
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
                setStatus(`$(cloud-download) Commit Model ${phase.percent}%`, `Downloading ${what}, first start only`);
            } else {
                setStatus("$(loading~spin) Commit Model: Starting", "Loading the model");
            }
        });
        return true;
    } catch (error) {
        log(`couldn't start: ${errorMessage(error)}`);
        ui.error(`Commit Model couldn't start: ${errorMessage(error)}`);
        return false;
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
        if (!terminals) {
            ui.warn("Commit Model: the terminal prompt after `git add` isn't available on Windows yet; use the ✨ button in Source Control.");
        }
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
            ui.warn("Commit Model: no Git repository is open.");
            return;
        }
        const diff = await stagedDiff(repository);
        if (!diff.trim()) {
            ui.info("Commit Model: nothing is staged. Stage your changes first (e.g. git add .).");
            return;
        }
        const filtered = buildDiff(diff);
        if (filtered === null) {
            ui.info("Commit Model: only lockfiles or generated files are staged, so there's nothing to describe.");
            return;
        }
        await turnOn();
        if (!enabled) {
            return;
        }
        setStatus("$(loading~spin) Commit Model: Writing…", "Writing a commit message");
        const message = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.SourceControl },
            () => engine.generate(filtered),
        );
        log(`suggested in the commit box: ${message}`);
        setCommitMessage(repository, message);
    } catch (error) {
        log(`error: ${errorMessage(error)}`);
        ui.error(`Commit Model: ${errorMessage(error)}`);
    } finally {
        generating = false;
        refreshStatus();
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
