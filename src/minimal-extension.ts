/**
 * Incremental Extension Build - Adding Back Functionality
 */
import * as vscode from 'vscode';

// Simple in-memory storage for now (no sql.js dependency)
let currentSession: any = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('[CodeTimeMachine] Extension activating...');
    
    const outputChannel = vscode.window.createOutputChannel('Code Time Machine');
    outputChannel.show();
    outputChannel.appendLine('[CodeTimeMachine] Extension activating...');

    try {
        // Register commands
        outputChannel.appendLine('[CodeTimeMachine] Registering commands...');
        
        // Command: Start Session
        const startSessionCmd = vscode.commands.registerCommand(
            'visualCodeTimeMachine.startSession',
            async () => {
                console.log('[CodeTimeMachine] Start session command executed!');
                outputChannel.appendLine('Start session command executed!');
                
                // Check if recording is enabled
                const config = vscode.workspace.getConfiguration('visualCodeTimeMachine');
                const isEnabled = config.get<boolean>('enabled', false);

                if (!isEnabled) {
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

                // Start a simple session
                if (!currentSession) {
                    currentSession = {
                        sessionId: Date.now().toString(),
                        startTime: new Date(),
                        fileChanges: []
                    };
                    outputChannel.appendLine(`Session started: ${currentSession.sessionId}`);
                    vscode.window.showInformationMessage(`Code Time Machine: Session started`);
                } else {
                    vscode.window.showInformationMessage('Session already active');
                }
            }
        );

        // Command: Stop Session
        const stopSessionCmd = vscode.commands.registerCommand(
            'visualCodeTimeMachine.stopSession',
            () => {
                console.log('[CodeTimeMachine] Stop session command executed!');
                outputChannel.appendLine('Stop session command executed!');
                
                if (currentSession) {
                    outputChannel.appendLine(`Session ended: ${currentSession.sessionId}`);
                    vscode.window.showInformationMessage('Code Time Machine: Session ended');
                    currentSession = null;
                } else {
                    vscode.window.showInformationMessage('No active session to stop');
                }
            }
        );

        // Register other commands (simplified for now)
        const rebuildFileCmd = vscode.commands.registerCommand(
            'visualCodeTimeMachine.rebuildFileAtTime',
            () => {
                vscode.window.showInformationMessage('File rebuild feature coming soon...');
            }
        );

        const pauseRecordingCmd = vscode.commands.registerCommand(
            'visualCodeTimeMachine.pauseRecording',
            () => {
                vscode.window.showInformationMessage('Recording paused (feature coming soon)');
            }
        );

        const resumeRecordingCmd = vscode.commands.registerCommand(
            'visualCodeTimeMachine.resumeRecording',
            () => {
                vscode.window.showInformationMessage('Recording resumed (feature coming soon)');
            }
        );

        context.subscriptions.push(
            startSessionCmd,
            stopSessionCmd,
            rebuildFileCmd,
            pauseRecordingCmd,
            resumeRecordingCmd
        );
        
        outputChannel.appendLine('[CodeTimeMachine] All commands registered successfully');
        console.log('[CodeTimeMachine] Extension activated successfully');

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[CodeTimeMachine] Activation failed:', errorMessage);
        outputChannel.appendLine(`Activation failed: ${errorMessage}`);
        vscode.window.showErrorMessage(`Code Time Machine failed to activate: ${errorMessage}`);
    }
}

export function deactivate(): void {
    console.log('[CodeTimeMachine] Extension deactivating...');
    currentSession = null;
}