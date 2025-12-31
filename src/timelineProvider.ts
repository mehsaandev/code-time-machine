import * as vscode from 'vscode';
import * as path from 'path';
import { HistoryManager, Snapshot } from './historyManager';

// File tree types for hierarchical display
interface FileTreeFile {
    name: string;
    type: 'file';
    path: string;
}

interface FileTreeFolder {
    name: string;
    type: 'folder';
    children: { [key: string]: FileTreeNode };
    path: string;
}

type FileTreeNode = FileTreeFile | FileTreeFolder;

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
        const fileTree = this.buildFileTree(sortedFiles);
        const fileTreeHtml = this.renderFileTree(fileTree, 0);

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
                    .result-count {
                        font-size: 13px;
                        color: var(--vscode-descriptionForeground);
                        margin-bottom: 16px;
                    }
                    
                    /* Tree structure styles - VS Code Explorer like */
                    .file-tree {
                        font-size: 13px;
                        line-height: 22px;
                        user-select: none;
                    }
                    
                    .tree-item {
                        display: flex;
                        align-items: center;
                        padding: 2px 8px;
                        cursor: pointer;
                        border-radius: 4px;
                        white-space: nowrap;
                    }
                    
                    .tree-item:hover {
                        background: var(--vscode-list-hoverBackground);
                    }
                    
                    .tree-item.selected {
                        background: var(--vscode-list-activeSelectionBackground);
                        color: var(--vscode-list-activeSelectionForeground);
                    }
                    
                    .tree-children {
                        overflow: hidden;
                    }
                    
                    .tree-children.collapsed {
                        display: none;
                    }
                    
                    .tree-indent {
                        display: inline-block;
                        width: 16px;
                        flex-shrink: 0;
                    }
                    
                    .tree-indent-guide {
                        border-left: 1px solid var(--vscode-tree-indentGuidesStroke, rgba(128, 128, 128, 0.4));
                        height: 22px;
                        margin-left: 7px;
                    }
                    
                    .tree-arrow {
                        width: 16px;
                        height: 22px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        flex-shrink: 0;
                        color: var(--vscode-foreground);
                        opacity: 0.8;
                        font-size: 10px;
                        transition: transform 0.1s ease;
                    }
                    
                    .tree-arrow.expanded {
                        transform: rotate(90deg);
                    }
                    
                    .tree-arrow.hidden {
                        visibility: hidden;
                    }
                    
                    .tree-icon {
                        width: 16px;
                        height: 16px;
                        margin-right: 6px;
                        flex-shrink: 0;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    
                    .tree-icon svg {
                        width: 16px;
                        height: 16px;
                    }
                    
                    .tree-label {
                        flex: 1;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    
                    .tree-actions {
                        display: none;
                        margin-left: auto;
                        padding-left: 8px;
                    }
                    
                    .tree-item:hover .tree-actions {
                        display: flex;
                    }
                    
                    .action-btn {
                        padding: 2px 8px;
                        background: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                        border: none;
                        border-radius: 3px;
                        font-size: 11px;
                        cursor: pointer;
                        transition: all 0.1s;
                    }
                    
                    .action-btn:hover {
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                    }
                    
                    .folder-count {
                        margin-left: 8px;
                        font-size: 11px;
                        color: var(--vscode-descriptionForeground);
                        opacity: 0.8;
                    }
                    
                    .hidden { display: none !important; }
                    
                    /* File type colors */
                    .icon-folder { color: #dcb67a; }
                    .icon-folder-open { color: #dcb67a; }
                    .icon-ts { color: #3178c6; }
                    .icon-tsx { color: #3178c6; }
                    .icon-js { color: #f1e05a; }
                    .icon-jsx { color: #f1e05a; }
                    .icon-json { color: #cbcb41; }
                    .icon-html { color: #e34c26; }
                    .icon-css { color: #563d7c; }
                    .icon-scss { color: #c6538c; }
                    .icon-less { color: #1d365d; }
                    .icon-md { color: #083fa1; }
                    .icon-py { color: #3572A5; }
                    .icon-java { color: #b07219; }
                    .icon-c { color: #555555; }
                    .icon-cpp { color: #f34b7d; }
                    .icon-cs { color: #178600; }
                    .icon-go { color: #00ADD8; }
                    .icon-rs { color: #dea584; }
                    .icon-rb { color: #701516; }
                    .icon-php { color: #4F5D95; }
                    .icon-vue { color: #41b883; }
                    .icon-svelte { color: #ff3e00; }
                    .icon-yaml { color: #cb171e; }
                    .icon-yml { color: #cb171e; }
                    .icon-xml { color: #e34c26; }
                    .icon-svg { color: #ffb13b; }
                    .icon-png { color: #a074c4; }
                    .icon-jpg { color: #a074c4; }
                    .icon-gif { color: #a074c4; }
                    .icon-ico { color: #a074c4; }
                    .icon-git { color: #f05032; }
                    .icon-env { color: #ecd53f; }
                    .icon-lock { color: #8b8b8b; }
                    .icon-sh { color: #89e051; }
                    .icon-bat { color: #c1f12e; }
                    .icon-sql { color: #e38c00; }
                    .icon-graphql { color: #e535ab; }
                    .icon-docker { color: #2496ed; }
                    .icon-default { color: var(--vscode-foreground); opacity: 0.7; }
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
                
                <div class="file-tree" id="fileTree">
                    ${fileTreeHtml}
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const searchInput = document.getElementById('searchInput');
                    const resultCount = document.getElementById('resultCount');
                    const totalFiles = ${files.length};
                    
                    // Toggle folder expand/collapse
                    function toggleFolder(element, event) {
                        event.stopPropagation();
                        const parent = element.closest('.tree-node');
                        const children = parent.querySelector('.tree-children');
                        const arrow = element.querySelector('.tree-arrow');
                        const folderIcon = element.querySelector('.tree-icon');
                        
                        if (children) {
                            const isCollapsed = children.classList.toggle('collapsed');
                            arrow.classList.toggle('expanded', !isCollapsed);
                            
                            // Update folder icon
                            if (isCollapsed) {
                                folderIcon.innerHTML = getFolderIcon(false);
                            } else {
                                folderIcon.innerHTML = getFolderIcon(true);
                            }
                        }
                    }
                    
                    function getFolderIcon(isOpen) {
                        if (isOpen) {
                            return '<svg class="icon-folder-open" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 14h13a.5.5 0 0 0 .5-.5V5a.5.5 0 0 0-.5-.5H7.707l-1-1H1.5a.5.5 0 0 0-.5.5v9.5a.5.5 0 0 0 .5.5zm0-10H6.293l1 1H14v7H2V4z"/></svg>';
                        }
                        return '<svg class="icon-folder" viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3H7.71l-1-1H1.5A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 14.5 3zm.5 9.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h4.79l1 1H14.5a.5.5 0 0 1 .5.5v8z"/></svg>';
                    }
                    
                    // Show diff for file
                    function showDiff(filePath, event) {
                        event.stopPropagation();
                        vscode.postMessage({ type: 'showDiff', filePath: filePath });
                    }
                    
                    // Expand all folders
                    function expandAll() {
                        document.querySelectorAll('.tree-children').forEach(el => {
                            el.classList.remove('collapsed');
                        });
                        document.querySelectorAll('.tree-arrow').forEach(el => {
                            if (!el.classList.contains('hidden')) {
                                el.classList.add('expanded');
                            }
                        });
                        document.querySelectorAll('.tree-node.folder .tree-icon').forEach(el => {
                            el.innerHTML = getFolderIcon(true);
                        });
                    }
                    
                    // Collapse all folders
                    function collapseAll() {
                        document.querySelectorAll('.tree-children').forEach(el => {
                            el.classList.add('collapsed');
                        });
                        document.querySelectorAll('.tree-arrow').forEach(el => {
                            el.classList.remove('expanded');
                        });
                        document.querySelectorAll('.tree-node.folder .tree-icon').forEach(el => {
                            el.innerHTML = getFolderIcon(false);
                        });
                    }
                    
                    // Search functionality
                    searchInput.addEventListener('input', (e) => {
                        const query = e.target.value.toLowerCase().trim();
                        const allNodes = document.querySelectorAll('.tree-node');
                        let visibleCount = 0;
                        
                        if (!query) {
                            // Show all and collapse to default state
                            allNodes.forEach(node => {
                                node.classList.remove('hidden');
                                const children = node.querySelector('.tree-children');
                                if (children) {
                                    children.classList.add('collapsed');
                                }
                            });
                            document.querySelectorAll('.tree-arrow').forEach(el => {
                                el.classList.remove('expanded');
                            });
                            document.querySelectorAll('.tree-node.folder .tree-icon').forEach(el => {
                                el.innerHTML = getFolderIcon(false);
                            });
                            resultCount.textContent = 'Showing all ' + totalFiles + ' files';
                            return;
                        }
                        
                        // First, hide all nodes
                        allNodes.forEach(node => {
                            node.classList.add('hidden');
                        });
                        
                        // Find matching files and show them with their parent folders
                        const fileNodes = document.querySelectorAll('.tree-node.file');
                        fileNodes.forEach(node => {
                            const filePath = node.dataset.path.toLowerCase();
                            if (filePath.includes(query)) {
                                visibleCount++;
                                // Show this node and all parent folders
                                let current = node;
                                while (current) {
                                    current.classList.remove('hidden');
                                    const children = current.querySelector('.tree-children');
                                    if (children) {
                                        children.classList.remove('collapsed');
                                    }
                                    const arrow = current.querySelector('.tree-arrow');
                                    if (arrow && !arrow.classList.contains('hidden')) {
                                        arrow.classList.add('expanded');
                                    }
                                    const folderIcon = current.querySelector(':scope > .tree-item > .tree-icon');
                                    if (folderIcon && current.classList.contains('folder')) {
                                        folderIcon.innerHTML = getFolderIcon(true);
                                    }
                                    current = current.parentElement?.closest('.tree-node');
                                }
                            }
                        });
                        
                        resultCount.textContent = 'Showing ' + visibleCount + ' of ' + totalFiles + ' files';
                    });
                </script>
            </body>
            </html>
        `;
    }
    
    private buildFileTree(files: string[]): FileTreeNode {
        const root: FileTreeNode = { name: '', type: 'folder', children: {}, path: '' };
        
        for (const file of files) {
            const parts = file.split('/');
            let current = root;
            let currentPath = '';
            
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                currentPath = currentPath ? `${currentPath}/${part}` : part;
                
                if (i === parts.length - 1) {
                    // It's a file
                    current.children[part] = { name: part, type: 'file', path: file };
                } else {
                    // It's a folder
                    if (!current.children[part]) {
                        current.children[part] = { name: part, type: 'folder', children: {}, path: currentPath };
                    }
                    current = current.children[part] as FileTreeFolder;
                }
            }
        }
        
        return root;
    }
    
    private renderFileTree(node: FileTreeNode, depth: number): string {
        if (node.type === 'file') {
            return '';
        }
        
        const folder = node as FileTreeFolder;
        const entries = Object.values(folder.children);
        
        // Sort: folders first, then files, both alphabetically
        entries.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'folder' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
        
        let html = '';
        
        for (const entry of entries) {
            const indentHtml = this.renderIndent(depth);
            
            if (entry.type === 'folder') {
                const folderNode = entry as FileTreeFolder;
                const fileCount = this.countFiles(folderNode);
                const childrenHtml = this.renderFileTree(folderNode, depth + 1);
                
                html += `
                    <div class="tree-node folder" data-path="${this.escapeHtml(entry.path)}">
                        <div class="tree-item" onclick="toggleFolder(this, event)">
                            ${indentHtml}
                            <span class="tree-arrow">▶</span>
                            <span class="tree-icon">${this.getFolderIconSvg(false)}</span>
                            <span class="tree-label">${this.escapeHtml(entry.name)}</span>
                            <span class="folder-count">${fileCount}</span>
                        </div>
                        <div class="tree-children collapsed">
                            ${childrenHtml}
                        </div>
                    </div>
                `;
            } else {
                const fileNode = entry as FileTreeFile;
                const iconClass = this.getFileIconClass(entry.name);
                const iconSvg = this.getFileIconSvg(entry.name);
                
                html += `
                    <div class="tree-node file" data-path="${this.escapeHtml(fileNode.path)}">
                        <div class="tree-item" onclick="showDiff('${this.escapeJs(fileNode.path)}', event)">
                            ${indentHtml}
                            <span class="tree-arrow hidden">▶</span>
                            <span class="tree-icon ${iconClass}">${iconSvg}</span>
                            <span class="tree-label">${this.escapeHtml(entry.name)}</span>
                            <div class="tree-actions">
                                <button class="action-btn" onclick="showDiff('${this.escapeJs(fileNode.path)}', event)">Compare</button>
                            </div>
                        </div>
                    </div>
                `;
            }
        }
        
        return html;
    }
    
    private renderIndent(depth: number): string {
        let html = '';
        for (let i = 0; i < depth; i++) {
            html += '<span class="tree-indent"><span class="tree-indent-guide"></span></span>';
        }
        return html;
    }
    
    private countFiles(folder: FileTreeFolder): number {
        let count = 0;
        for (const child of Object.values(folder.children)) {
            if (child.type === 'file') {
                count++;
            } else {
                count += this.countFiles(child as FileTreeFolder);
            }
        }
        return count;
    }
    
    private getFileIconClass(filename: string): string {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const name = filename.toLowerCase();
        
        // Special files
        if (name === '.gitignore' || name === '.gitattributes') return 'icon-git';
        if (name === '.env' || name.startsWith('.env.')) return 'icon-env';
        if (name === 'dockerfile' || name.endsWith('.dockerfile')) return 'icon-docker';
        if (name === 'package-lock.json' || name === 'yarn.lock' || name === 'pnpm-lock.yaml') return 'icon-lock';
        
        const iconMap: { [key: string]: string } = {
            'ts': 'icon-ts', 'tsx': 'icon-tsx', 'mts': 'icon-ts', 'cts': 'icon-ts',
            'js': 'icon-js', 'jsx': 'icon-jsx', 'mjs': 'icon-js', 'cjs': 'icon-js',
            'json': 'icon-json', 'jsonc': 'icon-json',
            'html': 'icon-html', 'htm': 'icon-html',
            'css': 'icon-css',
            'scss': 'icon-scss', 'sass': 'icon-scss',
            'less': 'icon-less',
            'md': 'icon-md', 'markdown': 'icon-md', 'mdx': 'icon-md',
            'py': 'icon-py', 'pyw': 'icon-py', 'pyx': 'icon-py',
            'java': 'icon-java', 'jar': 'icon-java',
            'c': 'icon-c', 'h': 'icon-c',
            'cpp': 'icon-cpp', 'cc': 'icon-cpp', 'cxx': 'icon-cpp', 'hpp': 'icon-cpp',
            'cs': 'icon-cs',
            'go': 'icon-go',
            'rs': 'icon-rs',
            'rb': 'icon-rb', 'erb': 'icon-rb',
            'php': 'icon-php',
            'vue': 'icon-vue',
            'svelte': 'icon-svelte',
            'yaml': 'icon-yaml', 'yml': 'icon-yml',
            'xml': 'icon-xml', 'xsl': 'icon-xml',
            'svg': 'icon-svg',
            'png': 'icon-png', 'jpg': 'icon-jpg', 'jpeg': 'icon-jpg', 'gif': 'icon-gif', 'ico': 'icon-ico', 'webp': 'icon-png',
            'sh': 'icon-sh', 'bash': 'icon-sh', 'zsh': 'icon-sh',
            'bat': 'icon-bat', 'cmd': 'icon-bat', 'ps1': 'icon-bat',
            'sql': 'icon-sql',
            'graphql': 'icon-graphql', 'gql': 'icon-graphql'
        };
        
        return iconMap[ext] || 'icon-default';
    }
    
    private getFileIconSvg(filename: string): string {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const name = filename.toLowerCase();
        
        // Special files
        if (name === '.gitignore' || name === '.gitattributes') {
            return '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
        }
        if (name === '.env' || name.startsWith('.env.')) {
            return '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H4zm1 3h6v1H5V6zm0 2h6v1H5V8zm0 2h4v1H5v-1z"/></svg>';
        }
        if (name === 'dockerfile' || name.endsWith('.dockerfile')) {
            return '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8.5 2.5v2h2v-2h-2zm3 0v2h2v-2h-2zm-6 3v2h2v-2h-2zm3 0v2h2v-2h-2zm3 0v2h2v-2h-2zm-9 3v2h2v-2h-2zm3 0v2h2v-2h-2zm3 0v2h2v-2h-2zm3 0v2h2v-2h-2z"/></svg>';
        }
        
        // Default file icon
        return '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M10.854 2.146a.5.5 0 0 1 0 .708L8.707 5H13.5a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-8a.5.5 0 0 1 .5-.5h4.793L5.146 2.854a.5.5 0 1 1 .708-.708L8 4.293l2.146-2.147a.5.5 0 0 1 .708 0zM3 6v7h10V6H3z"/><path d="M10.5 0H5.707L4 1.707V4h1V2h4v2.5a.5.5 0 0 0 .5.5H12v1h1V4.293L10.5 0zM10 2V1h.293L11 1.707V2h-1z"/></svg>';
    }
    
    private getFolderIconSvg(isOpen: boolean): string {
        if (isOpen) {
            return '<svg class="icon-folder-open" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 14h13a.5.5 0 0 0 .5-.5V5a.5.5 0 0 0-.5-.5H7.707l-1-1H1.5a.5.5 0 0 0-.5.5v9.5a.5.5 0 0 0 .5.5zm0-10H6.293l1 1H14v7H2V4z"/></svg>';
        }
        return '<svg class="icon-folder" viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3H7.71l-1-1H1.5A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 14.5 3zm.5 9.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h4.79l1 1H14.5a.5.5 0 0 1 .5.5v8z"/></svg>';
    }
    
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
    
    private escapeJs(text: string): string {
        return text
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"');
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