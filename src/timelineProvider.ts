import * as vscode from 'vscode';
import * as path from 'path';
import { HistoryManager, Snapshot } from './historyManager';

export class TimelineProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly historyManager: HistoryManager
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'revert':
                    const confirmed = await vscode.window.showWarningMessage(
                        `Jump to this point in time? Your workspace will be restored to this exact state.`,
                        { modal: true },
                        'Jump Here',
                        'Cancel'
                    );
                    if (confirmed === 'Jump Here') {
                        try {
                            await vscode.commands.executeCommand('timeMachine.revertToSnapshot', data.snapshotId);
                            vscode.window.showInformationMessage('✅ Successfully jumped to snapshot');
                        } catch (error) {
                            vscode.window.showErrorMessage(`❌ Failed to jump: ${error}`);
                        }
                    }
                    break;
                case 'clearHistory':
                    const clearConfirmed = await vscode.window.showWarningMessage(
                        'Are you sure you want to clear all history? This cannot be undone!',
                        { modal: true },
                        'Clear All',
                        'Cancel'
                    );
                    if (clearConfirmed === 'Clear All') {
                        await vscode.commands.executeCommand('timeMachine.clearHistory');
                    }
                    break;
                case 'viewFiles':
                    await this.showSnapshotFiles(data.snapshotId);
                    break;
                case 'exportSnapshot':
                    await vscode.commands.executeCommand('timeMachine.exportSnapshot', data.snapshotId);
                    break;
                case 'refresh':
                    this.refresh();
                    break;
                case 'rename':
                    const newName = await vscode.window.showInputBox({
                        prompt: 'Enter new snapshot name',
                        value: data.currentName,
                        validateInput: (value) => {
                            if (!value || value.trim().length === 0) {
                                return 'Name cannot be empty';
                            }
                            return null;
                        }
                    });
                    if (newName && newName.trim()) {
                        const success = await this.historyManager.renameSnapshot(data.snapshotId, newName.trim());
                        if (success) {
                            vscode.window.showInformationMessage('✅ Snapshot renamed');
                            this.refresh();
                        } else {
                            vscode.window.showErrorMessage('❌ Failed to rename snapshot');
                        }
                    }
                    break;
            }
        });

        // Wait for initialization before first refresh
        this.historyManager.waitForInitialization().then(() => {
            this.refresh();
        });
    }

    private async showSnapshotFiles(snapshotId: string) {
        const files = await this.historyManager.getSnapshotFileList(snapshotId);
        const snapshot = this.historyManager.getSnapshotById(snapshotId);
        
        if (!snapshot) {
            vscode.window.showErrorMessage('Snapshot not found');
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'snapshotFiles',
            `📸 Snapshot Files - ${new Date(snapshot.timestamp).toLocaleString()}`,
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        const sortedFiles = files.sort();
        const filesByDir = this.groupFilesByDirectory(sortedFiles);

        // Handle messages from webview
        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'showDiff') {
                await this.showFileDiff(snapshotId, message.filePath);
            }
        });

        panel.webview.html = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body { 
                        font-family: var(--vscode-font-family); 
                        padding: 24px;
                        color: var(--vscode-foreground);
                        background: var(--vscode-editor-background);
                    }
                    .header {
                        margin-bottom: 24px;
                        padding-bottom: 20px;
                        border-bottom: 2px solid var(--vscode-panel-border);
                    }
                    h1 { 
                        font-size: 20px;
                        margin-bottom: 12px;
                        font-weight: 600;
                    }
                    .meta {
                        display: flex;
                        gap: 12px;
                        flex-wrap: wrap;
                    }
                    .meta-item {
                        font-size: 12px;
                        color: var(--vscode-descriptionForeground);
                        background: var(--vscode-badge-background);
                        padding: 6px 12px;
                        border-radius: 12px;
                    }
                    .hint {
                        margin-top: 12px;
                        padding: 10px 14px;
                        background: var(--vscode-textBlockQuote-background);
                        border-left: 3px solid var(--vscode-textLink-foreground);
                        border-radius: 0 6px 6px 0;
                        font-size: 12px;
                        color: var(--vscode-descriptionForeground);
                    }
                    .hint strong {
                        color: var(--vscode-foreground);
                    }
                    .search-container {
                        margin-bottom: 20px;
                    }
                    .search-box {
                        width: 100%;
                        padding: 10px 14px;
                        background: var(--vscode-input-background);
                        border: 1px solid var(--vscode-input-border);
                        color: var(--vscode-input-foreground);
                        border-radius: 6px;
                        font-size: 13px;
                    }
                    .search-box:focus {
                        outline: none;
                        border-color: var(--vscode-focusBorder);
                    }
                    .directory {
                        margin-bottom: 24px;
                    }
                    .directory-header {
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        padding: 10px 14px;
                        background: var(--vscode-sideBar-background);
                        border-radius: 6px;
                        cursor: pointer;
                        font-weight: 600;
                        font-size: 13px;
                        margin-bottom: 8px;
                        transition: background 0.15s;
                    }
                    .directory-header:hover {
                        background: var(--vscode-list-hoverBackground);
                    }
                    .folder-icon {
                        font-size: 16px;
                    }
                    .file-count {
                        margin-left: auto;
                        font-size: 11px;
                        color: var(--vscode-descriptionForeground);
                        background: var(--vscode-badge-background);
                        padding: 2px 8px;
                        border-radius: 10px;
                    }
                    .file-list { 
                        list-style: none;
                        padding-left: 24px;
                    }
                    .file-item { 
                        padding: 8px 12px;
                        margin: 2px 0;
                        border-radius: 4px;
                        font-family: 'Courier New', monospace;
                        font-size: 12px;
                        transition: all 0.15s;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        cursor: pointer;
                    }
                    .file-item:hover {
                        background: var(--vscode-list-hoverBackground);
                    }
                    .file-icon {
                        font-size: 14px;
                    }
                    .file-name {
                        flex: 1;
                    }
                    .diff-btn {
                        padding: 4px 10px;
                        background: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        border: none;
                        border-radius: 4px;
                        font-size: 11px;
                        cursor: pointer;
                        opacity: 0;
                        transition: all 0.15s;
                    }
                    .file-item:hover .diff-btn {
                        opacity: 1;
                    }
                    .diff-btn:hover {
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                    }
                    .hidden { display: none; }
                    .result-count {
                        font-size: 13px;
                        color: var(--vscode-descriptionForeground);
                        margin-bottom: 16px;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>📸 Snapshot Files</h1>
                    <div class="meta">
                        <span class="meta-item">🕐 ${new Date(snapshot.timestamp).toLocaleString()}</span>
                        <span class="meta-item">📁 ${files.length} files</span>
                        <span class="meta-item">📝 ${snapshot.description}</span>
                    </div>
                    <div class="hint">
                        <strong>💡 Tip:</strong> Click on any file to compare with the current version in your workspace
                    </div>
                </div>
                
                <div class="search-container">
                    <input 
                        type="text" 
                        class="search-box" 
                        placeholder="🔍 Search files..." 
                        id="searchInput"
                    />
                </div>

                <div class="result-count" id="resultCount">Showing all ${files.length} files</div>
                
                <div id="fileTree">
                    ${Object.entries(filesByDir).map(([dir, dirFiles]) => `
                        <div class="directory">
                            <div class="directory-header" onclick="toggleDir(this)">
                                <span class="folder-icon">📁</span>
                                <span>${dir === '.' ? 'Root' : dir}</span>
                                <span class="file-count">${dirFiles.length}</span>
                            </div>
                            <ul class="file-list">
                                ${dirFiles.map(f => `
                                    <li class="file-item" data-file="${f}" onclick="showDiff('${f.replace(/\\/g, '\\\\')}')">
                                        <span class="file-icon">📄</span>
                                        <span class="file-name">${f.split('/').pop()}</span>
                                        <button class="diff-btn" onclick="event.stopPropagation(); showDiff('${f.replace(/\\/g, '\\\\')}')">
                                            🔍 Compare
                                        </button>
                                    </li>
                                `).join('')}
                            </ul>
                        </div>
                    `).join('')}
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const searchInput = document.getElementById('searchInput');
                    const directories = document.querySelectorAll('.directory');
                    const resultCount = document.getElementById('resultCount');
                    
                    searchInput.addEventListener('input', (e) => {
                        const query = e.target.value.toLowerCase();
                        let visibleCount = 0;
                        
                        directories.forEach(dir => {
                            const filesInDir = dir.querySelectorAll('.file-item');
                            let hasVisibleFiles = false;
                            
                            filesInDir.forEach(item => {
                                const fileName = item.dataset.file.toLowerCase();
                                if (fileName.includes(query)) {
                                    item.classList.remove('hidden');
                                    hasVisibleFiles = true;
                                    visibleCount++;
                                } else {
                                    item.classList.add('hidden');
                                }
                            });
                            
                            dir.style.display = hasVisibleFiles ? 'block' : 'none';
                        });
                        
                        resultCount.textContent = query ? 
                            \`Showing \${visibleCount} of ${files.length} files\` : 
                            \`Showing all ${files.length} files\`;
                    });

                    function toggleDir(element) {
                        const fileList = element.nextElementSibling;
                        const isHidden = fileList.style.display === 'none';
                        fileList.style.display = isHidden ? 'block' : 'none';
                    }

                    function showDiff(filePath) {
                        vscode.postMessage({ type: 'showDiff', filePath: filePath });
                    }
                </script>
            </body>
            </html>
        `;
    }

    private async showFileDiff(snapshotId: string, relativePath: string) {
        const snapshotContent = await this.historyManager.getSnapshotFileContent(snapshotId, relativePath);
        const snapshot = this.historyManager.getSnapshotById(snapshotId);
        
        if (snapshotContent === null) {
            vscode.window.showErrorMessage('Could not retrieve file content from snapshot');
            return;
        }

        // Get workspace folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }

        const workspacePath = workspaceFolders[0].uri.fsPath;
        const currentFilePath = vscode.Uri.file(path.join(workspacePath, relativePath));
        
        // Create a virtual document for the snapshot version
        const snapshotUri = vscode.Uri.parse(`timemachine:${snapshotId}/${relativePath}`);
        
        // Register a content provider if not already registered
        const provider = new (class implements vscode.TextDocumentContentProvider {
            provideTextDocumentContent(uri: vscode.Uri): string {
                return snapshotContent;
            }
        })();

        const disposable = vscode.workspace.registerTextDocumentContentProvider('timemachine', provider);

        // Check if current file exists
        let currentExists = true;
        try {
            await vscode.workspace.fs.stat(currentFilePath);
        } catch {
            currentExists = false;
        }

        const snapshotDate = snapshot ? new Date(snapshot.timestamp).toLocaleString() : 'Unknown';
        const fileName = relativePath.split('/').pop() || relativePath;

        if (currentExists) {
            // Show diff between snapshot and current
            await vscode.commands.executeCommand(
                'vscode.diff',
                snapshotUri,
                currentFilePath,
                `${fileName} (Snapshot: ${snapshotDate}) ↔ ${fileName} (Current)`
            );
        } else {
            // File was deleted, just show the snapshot version
            const doc = await vscode.workspace.openTextDocument(snapshotUri);
            await vscode.window.showTextDocument(doc, { preview: true });
            vscode.window.showInformationMessage(`📁 This file no longer exists in the current workspace`);
        }

        // Clean up the provider after a delay
        setTimeout(() => disposable.dispose(), 5000);
    }

    private groupFilesByDirectory(files: string[]): { [dir: string]: string[] } {
        const grouped: { [dir: string]: string[] } = {};
        
        files.forEach(file => {
            const parts = file.split('/');
            const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
            
            if (!grouped[dir]) {
                grouped[dir] = [];
            }
            grouped[dir].push(file);
        });
        
        return grouped;
    }

    public async refresh() {
        if (this._view) {
            await this.historyManager.waitForInitialization();
            const snapshots = this.historyManager.getSnapshots();
            
            this._view.webview.postMessage({
                type: 'update',
                snapshots: snapshots.reverse()
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Code Time Machine</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            overflow-x: hidden;
        }

        .header {
            background: var(--vscode-sideBar-background);
            padding: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .title-bar {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
        }

        .icon {
            font-size: 24px;
        }

        .title-content h1 {
            font-size: 15px;
            font-weight: 600;
            margin-bottom: 2px;
        }

        .subtitle {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .stats-bar {
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
        }

        .stat {
            flex: 1;
            background: var(--vscode-editor-background);
            padding: 8px 12px;
            border-radius: 6px;
            border: 1px solid var(--vscode-panel-border);
        }

        .stat-value {
            font-size: 18px;
            font-weight: 700;
            color: var(--vscode-foreground);
        }

        .stat-label {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 2px;
        }

        .filters {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 12px;
        }

        .filter-group {
            margin-bottom: 12px;
        }

        .filter-group:last-child {
            margin-bottom: 0;
        }

        .filter-label {
            font-size: 10px;
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 6px;
            display: block;
        }

        .search-input {
            width: 100%;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 12px;
            transition: border-color 0.15s;
        }

        .search-input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .quick-filters {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 6px;
        }

        .quick-filter {
            padding: 8px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s;
            text-align: center;
        }

        .quick-filter:hover {
            background: var(--vscode-button-secondaryHoverBackground);
            border-color: var(--vscode-focusBorder);
        }

        .quick-filter.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
        }

        .actions {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
        }

        button {
            padding: 8px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s;
        }

        button:hover {
            background: var(--vscode-button-hoverBackground);
        }

        button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .timeline-container {
            padding: 16px;
        }

        .timeline {
            position: relative;
            padding-left: 28px;
        }

        .timeline::before {
            content: '';
            position: absolute;
            left: 8px;
            top: 0;
            bottom: 0;
            width: 2px;
            background: var(--vscode-panel-border);
        }

        .snapshot {
            position: relative;
            margin-bottom: 16px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            overflow: hidden;
            transition: all 0.2s;
        }

        .snapshot:hover {
            border-color: var(--vscode-focusBorder);
            transform: translateX(2px);
        }

        .snapshot.latest {
            border-color: var(--vscode-progressBar-background);
        }

        .snapshot::before {
            content: '';
            position: absolute;
            left: -24px;
            top: 16px;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--vscode-button-background);
            border: 2px solid var(--vscode-sideBar-background);
        }

        .snapshot.latest::before {
            background: var(--vscode-progressBar-background);
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .snapshot-header {
            padding: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .snapshot-time {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            font-weight: 600;
            margin-bottom: 4px;
        }

        .snapshot-date {
            font-size: 12px;
            font-family: 'Courier New', monospace;
        }

        .snapshot-body {
            padding: 12px;
        }

        .snapshot-desc {
            font-size: 12px;
            margin-bottom: 8px;
        }

        .snapshot-meta {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }

        .badge {
            font-size: 10px;
            padding: 3px 8px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 10px;
        }

        .badge.latest {
            background: var(--vscode-progressBar-background);
            color: var(--vscode-button-foreground);
        }

        .snapshot-actions {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 8px;
            padding: 8px 12px;
            background: var(--vscode-sideBar-background);
        }

        .snapshot-btn {
            padding: 6px 10px;
            font-size: 11px;
            border-radius: 4px;
        }

        .snapshot-btn.primary {
            grid-column: 1 / -1;
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.5;
        }

        .empty-title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        .empty-text {
            font-size: 12px;
            line-height: 1.5;
        }

        @media (max-width: 300px) {
            .stats-bar {
                flex-direction: column;
            }
            
            .quick-filters {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title-bar">
            <span class="icon">⏰</span>
            <div class="title-content">
                <h1>Time Machine</h1>
                <div class="subtitle">Navigate your code history</div>
            </div>
        </div>

        <div class="stats-bar">
            <div class="stat">
                <div class="stat-value" id="totalCount">0</div>
                <div class="stat-label">Total</div>
            </div>
            <div class="stat">
                <div class="stat-value" id="visibleCount">0</div>
                <div class="stat-label">Showing</div>
            </div>
        </div>

        <div class="filters">
            <div class="filter-group">
                <label class="filter-label">Search</label>
                <input 
                    type="text" 
                    class="search-input" 
                    id="searchInput"
                    placeholder="Filter by description..."
                />
            </div>

            <div class="filter-group">
                <label class="filter-label">Time Period</label>
                <div class="quick-filters">
                    <button class="quick-filter" data-period="today">Today</button>
                    <button class="quick-filter" data-period="yesterday">Yesterday</button>
                    <button class="quick-filter" data-period="week">This Week</button>
                    <button class="quick-filter" data-period="month">This Month</button>
                    <button class="quick-filter active" data-period="all">All Time</button>
                    <button class="quick-filter secondary" id="clearFilters">Clear</button>
                </div>
            </div>
        </div>

        <div class="actions">
            <button id="refreshBtn" class="secondary">↻ Refresh</button>
            <button id="clearBtn" class="secondary">🗑️ Clear</button>
        </div>
    </div>

    <div class="timeline-container">
        <div id="timeline" class="timeline"></div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let allSnapshots = [];
        let filters = { search: '', startTime: null, endTime: null };

        document.getElementById('refreshBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'refresh' });
        });

        document.getElementById('clearBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'clearHistory' });
        });

        document.getElementById('searchInput').addEventListener('input', (e) => {
            filters.search = e.target.value.toLowerCase();
            applyFilters();
        });

        document.querySelectorAll('.quick-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                const period = btn.dataset.period;
                if (!period) return;

                document.querySelectorAll('.quick-filter').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const now = new Date();
                switch(period) {
                    case 'today':
                        filters.startTime = new Date(now.setHours(0,0,0,0)).getTime();
                        filters.endTime = Date.now();
                        break;
                    case 'yesterday':
                        const yesterday = new Date(now.setDate(now.getDate()-1));
                        filters.startTime = new Date(yesterday.setHours(0,0,0,0)).getTime();
                        filters.endTime = new Date(yesterday.setHours(23,59,59,999)).getTime();
                        break;
                    case 'week':
                        const weekStart = new Date(now.setDate(now.getDate()-now.getDay()));
                        filters.startTime = new Date(weekStart.setHours(0,0,0,0)).getTime();
                        filters.endTime = Date.now();
                        break;
                    case 'month':
                        filters.startTime = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
                        filters.endTime = Date.now();
                        break;
                    case 'all':
                        filters.startTime = null;
                        filters.endTime = null;
                        break;
                }
                applyFilters();
            });
        });

        document.getElementById('clearFilters').addEventListener('click', () => {
            document.getElementById('searchInput').value = '';
            filters = { search: '', startTime: null, endTime: null };
            document.querySelectorAll('.quick-filter').forEach(b => b.classList.remove('active'));
            document.querySelector('[data-period="all"]').classList.add('active');
            applyFilters();
        });

        function applyFilters() {
            const filtered = allSnapshots.filter(s => {
                if (filters.search && !s.description.toLowerCase().includes(filters.search)) {
                    return false;
                }
                if (filters.startTime && s.timestamp < filters.startTime) return false;
                if (filters.endTime && s.timestamp > filters.endTime) return false;
                return true;
            });

            document.getElementById('totalCount').textContent = allSnapshots.length;
            document.getElementById('visibleCount').textContent = filtered.length;
            renderTimeline(filtered);
        }

        function formatRelativeTime(ts) {
            const diff = Date.now() - ts;
            const mins = Math.floor(diff / 60000);
            const hours = Math.floor(diff / 3600000);
            const days = Math.floor(diff / 86400000);

            if (mins < 1) return 'Just now';
            if (mins < 60) return \`\${mins}m ago\`;
            if (hours < 24) return \`\${hours}h ago\`;
            if (days < 7) return \`\${days}d ago\`;
            return \`\${Math.floor(days/7)}w ago\`;
        }

        function formatDateTime(ts) {
            return new Date(ts).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        function renderTimeline(snapshots) {
            const timeline = document.getElementById('timeline');

            if (snapshots.length === 0) {
                const hasFilters = filters.search || filters.startTime;
                timeline.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-icon">\${hasFilters ? '🔍' : '⏱️'}</div>
                        <div class="empty-title">\${hasFilters ? 'No Results' : 'No History'}</div>
                        <div class="empty-text">
                            \${hasFilters ? 'Try adjusting your filters' : 'Changes will appear here automatically'}
                        </div>
                    </div>
                \`;
                return;
            }

            timeline.innerHTML = snapshots.map((s, i) => {
                const fileCount = Object.keys(s.workspaceState).length;
                const isLatest = i === 0 && allSnapshots[0].id === s.id;

                return \`
                    <div class="snapshot \${isLatest ? 'latest' : ''}">
                        <div class="snapshot-header">
                            <div class="snapshot-time">\${formatRelativeTime(s.timestamp)}</div>
                            <div class="snapshot-date">\${formatDateTime(s.timestamp)}</div>
                        </div>
                        <div class="snapshot-body">
                            <div class="snapshot-desc">\${s.description}</div>
                            <div class="snapshot-meta">
                                <span class="badge">📁 \${fileCount}</span>
                                \${isLatest ? '<span class="badge latest">Current</span>' : ''}
                            </div>
                        </div>
                        <div class="snapshot-actions">
                            <button class="snapshot-btn secondary" onclick="viewFiles('\${s.id}')">
                                View Files
                            </button>
                            <button class="snapshot-btn secondary" onclick="renameSnap('\${s.id}', '\${s.description.replace(/'/g, "\\\\'")}')">
                                ✏️ Rename
                            </button>
                            <button class="snapshot-btn secondary" onclick="exportSnap('\${s.id}')">
                                Export
                            </button>
                            <button class="snapshot-btn primary" onclick="jumpTo('\${s.id}')">
                                ⏮️ Jump Here
                            </button>
                        </div>
                    </div>
                \`;
            }).join('');
        }

        function viewFiles(id) {
            vscode.postMessage({ type: 'viewFiles', snapshotId: id });
        }

        function exportSnap(id) {
            vscode.postMessage({ type: 'exportSnapshot', snapshotId: id });
        }

        function jumpTo(id) {
            vscode.postMessage({ type: 'revert', snapshotId: id });
        }

        function renameSnap(id, currentName) {
            vscode.postMessage({ type: 'rename', snapshotId: id, currentName: currentName });
        }

        window.addEventListener('message', e => {
            if (e.data.type === 'update') {
                allSnapshots = e.data.snapshots;
                applyFilters();
            }
        });
    </script>
</body>
</html>`;
    }
}