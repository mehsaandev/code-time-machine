import * as vscode from 'vscode';
import { HistoryManager } from './historyManager';
import { TimelineProvider } from './timelineProvider';

let historyManager: HistoryManager;
let timelineProvider: TimelineProvider;
let changeTimeout: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Code Time Machine is now active');

    // Initialize the history manager
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Code Time Machine requires an open workspace');
        return;
    }

    historyManager = new HistoryManager(workspaceFolder.uri.fsPath);
    
    // Initialize the timeline sidebar
    timelineProvider = new TimelineProvider(context.extensionUri, historyManager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('timeMachine.timeline', timelineProvider)
    );

    // Listen to document changes (with throttling)
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.scheme !== 'file') return;
            
            // Clear existing timeout
            if (changeTimeout) {
                clearTimeout(changeTimeout);
            }
            
            // Set new timeout - save after 3 seconds of inactivity
            changeTimeout = setTimeout(async () => {
                const created = await historyManager.captureSnapshot('Document changed', [e.document.uri.fsPath]);
                if (created) {
                    timelineProvider.refresh();
                }
            }, 3000);
        })
    );

    // Listen to document saves (immediate capture)
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (document.uri.scheme !== 'file') return;
            
            // Clear throttle timeout if exists
            if (changeTimeout) {
                clearTimeout(changeTimeout);
                changeTimeout = undefined;
            }
            
            const created = await historyManager.captureSnapshot('File saved', [document.uri.fsPath]);
            if (created) {
                timelineProvider.refresh();
            }
        })
    );

    // Listen to file creation
    context.subscriptions.push(
        vscode.workspace.onDidCreateFiles(async (e) => {
            const paths = e.files.map(f => f.fsPath);
            const created = await historyManager.captureSnapshot('Files created', paths);
            if (created) {
                timelineProvider.refresh();
            }
        })
    );

    // Listen to file deletion
    context.subscriptions.push(
        vscode.workspace.onDidDeleteFiles(async (e) => {
            const paths = e.files.map(f => f.fsPath);
            const created = await historyManager.captureSnapshot('Files deleted', paths);
            if (created) {
                timelineProvider.refresh();
            }
        })
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('timeMachine.revertToSnapshot', async (snapshotId: string) => {
            try {
                await historyManager.revertToSnapshot(snapshotId);
                vscode.window.showInformationMessage('✅ Successfully jumped to snapshot!');
                timelineProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`❌ Failed to jump: ${error}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('timeMachine.clearHistory', async () => {
            const answer = await vscode.window.showWarningMessage(
                '⚠️ Clear all history? This cannot be undone!',
                { modal: true },
                'Clear All',
                'Cancel'
            );
            if (answer === 'Clear All') {
                await historyManager.clearHistory();
                timelineProvider.refresh();
                vscode.window.showInformationMessage('🗑️ History cleared');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('timeMachine.exportSnapshot', async (snapshotId: string) => {
            const folder = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Export Snapshot Here',
                title: 'Choose Export Location'
            });

            if (folder && folder[0]) {
                try {
                    await historyManager.exportSnapshot(snapshotId, folder[0].fsPath);
                    vscode.window.showInformationMessage('📦 Snapshot exported successfully!');
                } catch (error) {
                    vscode.window.showErrorMessage(`❌ Export failed: ${error}`);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('timeMachine.viewSnapshotFiles', async (snapshotId: string) => {
            try {
                const files = await historyManager.getSnapshotFileList(snapshotId);
                const snapshot = historyManager.getSnapshotById(snapshotId);
                
                if (snapshot && files.length > 0) {
                    const message = `Snapshot contains ${files.length} file(s):\n${files.slice(0, 10).join('\n')}${files.length > 10 ? '\n...' : ''}`;
                    vscode.window.showInformationMessage(message);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to view files: ${error}`);
            }
        })
    );
}

export function deactivate() {
    if (changeTimeout) {
        clearTimeout(changeTimeout);
    }
}