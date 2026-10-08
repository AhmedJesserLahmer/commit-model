// Access to staged changes and the commit message box, via VS Code's built-in Git extension.
import * as vscode from "vscode";

// The subset of the Git extension API used here (full typings: vscode's extensions/git/src/api/git.d.ts).
interface Repository {
    readonly rootUri: vscode.Uri;
    readonly inputBox: { value: string };
    diff(cached?: boolean): Promise<string>;
}

interface GitAPI {
    readonly repositories: Repository[];
    getRepository(uri: vscode.Uri): Repository | null;
}

function getGitApi(): GitAPI {
    const gitExtension = vscode.extensions.getExtension("vscode.git");
    if (!gitExtension?.isActive) {
        throw new Error("VS Code's Git extension isn't active");
    }
    return gitExtension.exports.getAPI(1);
}

/**
 * The repository to work on: the one whose Source Control title button was clicked, else the one
 * containing the active file, else the first open repository.
 */
export function pickRepository(sourceControl?: { rootUri?: vscode.Uri }): Repository | undefined {
    const git = getGitApi();
    if (sourceControl?.rootUri) {
        const clicked = git.getRepository(sourceControl.rootUri);
        if (clicked) {
            return clicked;
        }
    }
    const activeFile = vscode.window.activeTextEditor?.document.uri;
    return (activeFile && git.getRepository(activeFile)) || git.repositories[0];
}

export function stagedDiff(repository: Repository): Promise<string> {
    return repository.diff(true);
}

export function setCommitMessage(repository: Repository, message: string): void {
    repository.inputBox.value = message;
}
