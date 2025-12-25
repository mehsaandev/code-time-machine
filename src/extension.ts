/**
 * Code Time Machine - VS Code Extension
 * 
 * Main extension entry point - handles activation, wiring, and commands
 * 
 * This extension captures code changes as batched diffs and allows
 * reconstruction of files at any point in time.
 */

import * as vscode from 'vscode';
import { SessionManager, Session } from './sessionManager';
import { DiffEngine, DiffEvent } from './diffEngine';
import { Storage } from './storage';
import { FileRebuilder, RebuildResult } from './fileRebuilder';

// Global instances
let sessionManager: SessionManager | null = null;
let diffEngine: DiffEngine | null = null;
let storage: Storage | null = null;
let fileRebuilder: FileRebuilder | null = null;

// Disposables for cleanup
const disposables: vscode.Disposable[] = [];

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('[CodeTimeMachine] Extension activating...');

    try {
        // Initialize storage with extension's global storage path
        const storagePath = context.globalStorageUri.fsPath;
        storage = new Storage(storagePath);
        await storage.initialize();

        // Initialize components
        sessionManager = new SessionManager();
        diffEngine = new DiffEngine();
        fileRebuilder = new FileRebuilder(storage);

        // Wire up components
        wireComponents();

        // Register commands
        registerCommands(context);

        // Register document listeners
        registerDocumentListeners(context);

        // Check if extension is enabled and auto-start session if workspace is open
        const config = vscode.workspace.getConfiguration('codeTimeMachine');
        const isEnabled = config.get<boolean>('enabled', false);

        if (isEnabled && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            console.log('[CodeTimeMachine] Auto-starting session (extension enabled and workspace open)');
            await sessionManager.startSession();
        }

        console.log('[CodeTimeMachine] Extension activated successfully');
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[CodeTimeMachine] Activation failed:', errorMessage);
        vscode.window.showErrorMessage(`Code Time Machine failed to activate: ${errorMessage}`);
    }
}

/**
 * Wire up component callbacks
 */
function wireComponents(): void {
    if (!sessionManager || !diffEngine || !storage) {
        throw new Error('Components not initialized');
    }

    // When session starts, update diff engine and save session
    sessionManager.onSessionStart((session: Session) => {
        diffEngine!.setSessionId(session.sessionId);
        storage!.saveSession(session);
        
        // Initialize tracking for all open documents
        vscode.workspace.textDocuments.forEach(doc => {
            if (doc.uri.scheme === 'file') {
                diffEngine!.initializeDocument(doc);
            }
        });
        
        vscode.window.showInformationMessage(
            `Code Time Machine: Session started (${session.sessionId.substring(0, 8)}...)`
        );
    });

    // When session ends, clear diff engine session and update storage
    sessionManager.onSessionEnd((session: Session) => {
        diffEngine!.flushAllPendingChanges();
        diffEngine!.clearSessionId();
        storage!.endSession(session.sessionId);
        
        vscode.window.showInformationMessage(
            `Code Time Machine: Session ended (${session.sessionId.substring(0, 8)}...)`
        );
    });

    // When diff is captured, save to storage
    diffEngine.onDiffCaptured((diff: DiffEvent) => {
        storage!.saveDiffEvent(diff);
        
        // Also update session activity
        if (sessionManager!.isSessionActive()) {
            sessionManager!.recordActivity();
            const session = sessionManager!.getCurrentSession();
            if (session) {
                storage!.updateSessionActivity(session.sessionId, session.lastActivityTime);
            }
        }
    });
}

/**
 * Register VS Code commands
 */
function registerCommands(context: vscode.ExtensionContext): void {
    // Command: Start Session
    const startSessionCmd = vscode.commands.registerCommand(
        'codeTimeMachine.startSession',
        async () => {
            if (!sessionManager) {
                vscode.window.showErrorMessage('Code Time Machine not initialized');
                return;
            }

            // Check if recording is enabled
            const config = vscode.workspace.getConfiguration('codeTimeMachine');
            const isEnabled = config.get<boolean>('enabled', false);

            if (!isEnabled) {
                // Prompt user to enable
                const enable = await vscode.window.showInformationMessage(
                    'Code Time Machine recording is disabled. Enable it now?',
                    'Enable',
                    'Cancel'
                );

                if (enable === 'Enable') {
                    await config.update('enabled', true, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage('Code Time Machine recording enabled');
                } else {
                    return;
                }
            }

            await sessionManager.startSession();
        }
    );

    // Command: Stop Session
    const stopSessionCmd = vscode.commands.registerCommand(
        'codeTimeMachine.stopSession',
        () => {
            if (!sessionManager) {
                vscode.window.showErrorMessage('Code Time Machine not initialized');
                return;
            }

            const session = sessionManager.stopSession();
            if (!session) {
                vscode.window.showInformationMessage('No active session to stop');
            }
        }
    );

    // Command: Rebuild File At Time
    const rebuildFileCmd = vscode.commands.registerCommand(
        'codeTimeMachine.rebuildFileAtTime',
        async () => {
            if (!storage || !fileRebuilder) {
                vscode.window.showErrorMessage('Code Time Machine not initialized');
                return;
            }

            // Get list of tracked files
            const trackedFiles = storage.getTrackedFilePaths();

            if (trackedFiles.length === 0) {
                vscode.window.showInformationMessage('No tracked files found. Start a session and make some edits first.');
                return;
            }

            // Let user select a file
            const selectedFile = await vscode.window.showQuickPick(trackedFiles, {
                placeHolder: 'Select a file to rebuild',
                title: 'Code Time Machine: Rebuild File'
            });

            if (!selectedFile) {
                return;
            }

            // Get available timestamps for the file
            const timestamps = fileRebuilder.getAvailableTimestamps(selectedFile);

            if (timestamps.length === 0) {
                vscode.window.showInformationMessage(`No diff history found for "${selectedFile}"`);
                return;
            }

            // Let user select a timestamp
            const timestampOptions = timestamps.map(ts => ({
                label: new Date(ts).toLocaleString(),
                description: `Timestamp: ${ts}`,
                timestamp: ts
            }));

            const selectedTimestamp = await vscode.window.showQuickPick(timestampOptions, {
                placeHolder: 'Select a point in time',
                title: 'Code Time Machine: Select Timestamp'
            });

            if (!selectedTimestamp) {
                return;
            }

            // Rebuild the file
            const result = fileRebuilder.rebuild(selectedFile, selectedTimestamp.timestamp);

            if (result.success) {
                // Show the rebuilt content in a new editor
                const doc = await vscode.workspace.openTextDocument({
                    content: result.content,
                    language: getLanguageFromPath(selectedFile)
                });

                await vscode.window.showTextDocument(doc, {
                    preview: true,
                    viewColumn: vscode.ViewColumn.Beside
                });

                vscode.window.showInformationMessage(
                    `Rebuilt "${selectedFile}" at ${new Date(result.timestamp).toLocaleString()} ` +
                    `(${result.patchesApplied} patches applied)`
                );

                console.log(`[CodeTimeMachine] Rebuild successful:`);
                console.log(`  File: ${result.filePath}`);
                console.log(`  Timestamp: ${result.timestamp}`);
                console.log(`  Patches applied: ${result.patchesApplied}`);
                console.log(`  Content length: ${result.content.length}`);

            } else {
                vscode.window.showErrorMessage(
                    `Failed to rebuild file: ${result.errorMessage}`
                );
            }
        }
    );

    // Command: Pause Recording
    const pauseRecordingCmd = vscode.commands.registerCommand(
        'codeTimeMachine.pauseRecording',
        () => {
            if (!diffEngine) {
                vscode.window.showErrorMessage('Code Time Machine not initialized');
                return;
            }

            diffEngine.pause();
            vscode.window.showInformationMessage('Code Time Machine: Recording paused');
        }
    );

    // Command: Resume Recording
    const resumeRecordingCmd = vscode.commands.registerCommand(
        'codeTimeMachine.resumeRecording',
        () => {
            if (!diffEngine) {
                vscode.window.showErrorMessage('Code Time Machine not initialized');
                return;
            }

            diffEngine.resume();
            vscode.window.showInformationMessage('Code Time Machine: Recording resumed');
        }
    );

    // Register all commands
    context.subscriptions.push(
        startSessionCmd,
        stopSessionCmd,
        rebuildFileCmd,
        pauseRecordingCmd,
        resumeRecordingCmd
    );
}

/**
 * Register document change listeners
 */
function registerDocumentListeners(context: vscode.ExtensionContext): void {
    // Listen for document changes
    const changeListener = vscode.workspace.onDidChangeTextDocument(event => {
        if (!diffEngine || !sessionManager) {
            return;
        }

        // Only track file:// scheme documents
        if (event.document.uri.scheme !== 'file') {
            return;
        }

        // Check if recording is enabled
        const config = vscode.workspace.getConfiguration('codeTimeMachine');
        const isEnabled = config.get<boolean>('enabled', false);
        
        if (!isEnabled) {
            return;
        }

        // Auto-start session on first edit if not active
        if (!sessionManager.isSessionActive()) {
            sessionManager.startSession().then(() => {
                // Now handle the change
                diffEngine!.handleDocumentChange(event.document, event.contentChanges);
            });
        } else {
            diffEngine.handleDocumentChange(event.document, event.contentChanges);
        }
    });

    // Listen for document opens (to initialize tracking)
    const openListener = vscode.workspace.onDidOpenTextDocument(document => {
        if (!diffEngine || !sessionManager?.isSessionActive()) {
            return;
        }

        if (document.uri.scheme === 'file') {
            diffEngine.initializeDocument(document);
        }
    });

    // Listen for workspace folder changes
    const folderListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        console.log('[CodeTimeMachine] Workspace folders changed');
    });

    context.subscriptions.push(changeListener, openListener, folderListener);
}

/**
 * Get language ID from file path
 */
function getLanguageFromPath(filePath: string): string {
    const ext = filePath.toLowerCase().split('.').pop() || '';
    
    const languageMap: Record<string, string> = {
        'ts': 'typescript',
        'tsx': 'typescriptreact',
        'js': 'javascript',
        'jsx': 'javascriptreact',
        'json': 'json',
        'md': 'markdown',
        'py': 'python',
        'rb': 'ruby',
        'java': 'java',
        'c': 'c',
        'cpp': 'cpp',
        'h': 'c',
        'hpp': 'cpp',
        'cs': 'csharp',
        'go': 'go',
        'rs': 'rust',
        'php': 'php',
        'html': 'html',
        'css': 'css',
        'scss': 'scss',
        'less': 'less',
        'xml': 'xml',
        'yaml': 'yaml',
        'yml': 'yaml',
        'sql': 'sql',
        'sh': 'shellscript',
        'bash': 'shellscript',
        'ps1': 'powershell',
        'vue': 'vue',
        'svelte': 'svelte',
    };

    return languageMap[ext] || 'plaintext';
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
    console.log('[CodeTimeMachine] Extension deactivating...');

    // Stop session if active
    if (sessionManager?.isSessionActive()) {
        sessionManager.stopSession();
    }

    // Dispose components
    sessionManager?.dispose();
    diffEngine?.dispose();
    storage?.close();

    // Dispose all disposables
    disposables.forEach(d => d.dispose());

    console.log('[CodeTimeMachine] Extension deactivated');
}
