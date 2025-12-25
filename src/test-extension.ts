import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('Simple test extension activating...');
    
    // Create output channel for debugging
    const output = vscode.window.createOutputChannel('Test Extension');
    output.show();
    output.appendLine('Extension activated!');
    
    // Register a simple command
    const disposable = vscode.commands.registerCommand('test.hello', () => {
        vscode.window.showInformationMessage('Hello from test extension!');
        output.appendLine('Test command executed!');
    });
    
    context.subscriptions.push(disposable);
    
    console.log('Test extension registered command test.hello');
    output.appendLine('Command registered: test.hello');
}

export function deactivate() {
    console.log('Test extension deactivating...');
}