import * as vscode from "vscode";

import { EngineOptions, ModelEngine } from "./engine";
import { pickRepository, setCommitMessage, stagedDiff } from "./git";
import { buildDiff } from "./prompt";

const engine = new ModelEngine((reason) => {
    setStatus("off");
    vscode.window.showWarningMessage(`Commit Model: ${reason}`);
});
let statusBar: vscode.StatusBarItem;
let generating = false;

export function activate(context: vscode.ExtensionContext): void {
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    setStatus("off");
    statusBar.show();

    context.subscriptions.push(
        statusBar,
        vscode.commands.registerCommand("commitModel.start", () => startWithProgress(context)),
        vscode.commands.registerCommand("commitModel.stop", stop),
        vscode.commands.registerCommand("commitModel.generate", (sourceControl?: { rootUri?: vscode.Uri }) =>
            generate(context, sourceControl)),
    );
}

export function deactivate(): Promise<void> {
    return engine.stop();
}

type Status = "off" | "downloading" | "loading" | "ready" | "generating";

function setStatus(status: Status, detail = ""): void {
    const view: Record<Status, [string, string, string | undefined]> = {
        off: ["$(circle-slash) Commit Model", "Model not loaded. Click to start.", "commitModel.start"],
        downloading: [`$(cloud-download) Commit Model ${detail}`, "Downloading (first start only)", undefined],
        loading: ["$(loading~spin) Commit Model", "Loading the model", undefined],
        ready: ["$(sparkle) Commit Model", "Model ready. Click to stop and free memory.", "commitModel.stop"],
        generating: ["$(loading~spin) Commit Model", "Writing a commit message", undefined],
    };
    [statusBar.text, statusBar.tooltip, statusBar.command] = view[status];
}

function engineOptions(context: vscode.ExtensionContext): EngineOptions {
    const config = vscode.workspace.getConfiguration("commitModel");
    const modelPath = config.get<string>("modelPath", "").trim();
    const modelUri = config.get<string>("modelUri", "").trim();
    if (!modelPath && (!modelUri || modelUri.includes("<username>"))) {
        throw new Error("No model configured. Set commitModel.modelPath (local .gguf) or commitModel.modelUri in Settings.");
    }
    return {
        modelPath,
        modelUri,
        storageDir: context.globalStorageUri.fsPath,
        gpu: config.get<"auto" | "cpu">("gpu", "auto"),
    };
}

/** Starts the model with a progress notification. Returns false if it failed (error already shown). */
async function startWithProgress(context: vscode.ExtensionContext): Promise<boolean> {
    if (engine.isRunning) {
        setStatus("ready");
        return true;
    }
    try {
        const options = engineOptions(context);
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: "Commit Model" },
            (progress) => engine.start(options, (phase) => {
                if (phase.phase === "downloading") {
                    const what = phase.what === "engine" ? "the engine (~30MB)" : "the model (~1GB)";
                    setStatus("downloading", `${phase.percent}%`);
                    progress.report({ message: `Downloading ${what}, first start only… ${phase.percent}%` });
                } else {
                    setStatus("loading");
                    progress.report({ message: "Loading the model…" });
                }
            }),
        );
        setStatus("ready");
        return true;
    } catch (error) {
        setStatus("off");
        vscode.window.showErrorMessage(`Commit Model couldn't start: ${errorMessage(error)}`);
        return false;
    }
}

async function stop(): Promise<void> {
    await engine.stop();
    setStatus("off");
}

async function generate(context: vscode.ExtensionContext, sourceControl?: { rootUri?: vscode.Uri }): Promise<void> {
    if (generating) {
        return;
    }
    generating = true;
    try {
        const repository = pickRepository(sourceControl);
        if (!repository) {
            vscode.window.showWarningMessage("Commit Model: no Git repository is open.");
            return;
        }
        const diff = await stagedDiff(repository);
        if (!diff.trim()) {
            vscode.window.showInformationMessage("Commit Model: nothing is staged. Stage your changes first.");
            return;
        }
        const filtered = buildDiff(diff);
        if (filtered === null) {
            vscode.window.showInformationMessage(
                "Commit Model: only lockfiles or generated files are staged, so there's nothing to describe.");
            return;
        }
        if (!(await startWithProgress(context))) {
            return;
        }

        setStatus("generating");
        const message = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.SourceControl },
            () => engine.generate(filtered),
        );
        setCommitMessage(repository, message);
    } catch (error) {
        vscode.window.showErrorMessage(`Commit Model: ${errorMessage(error)}`);
    } finally {
        generating = false;
        setStatus(engine.isRunning ? "ready" : "off");
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
