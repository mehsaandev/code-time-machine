import * as fs from 'fs-extra';
import * as path from 'path';
import { diffLines, createPatch } from 'diff';

export interface Snapshot {
    id: string;
    timestamp: number;
    description: string;
    affectedFiles: string[];
    changes: { [filePath: string]: FileChange };
}

interface FileChange {
    type: 'created' | 'modified' | 'deleted';
    diff?: string;
    fullContent?: string;
}

export class HistoryManager {
    private historyDir: string;
    private manifestPath: string;
    private snapshots: Snapshot[] = [];
    private workspacePath: string;
    private latestStateBackup: string | null = null;

    constructor(workspacePath: string) {
        this.workspacePath = workspacePath;
        this.historyDir = path.join(workspacePath, '.history_machine');
        this.manifestPath = path.join(this.historyDir, 'manifest.json');
        this.initialize();
    }

    private async initialize() {
        await fs.ensureDir(this.historyDir);
        
        if (await fs.pathExists(this.manifestPath)) {
            const data = await fs.readJson(this.manifestPath);
            this.snapshots = data.snapshots || [];
            this.latestStateBackup = data.latestStateBackup || null;
        } else {
            await this.saveManifest();
        }
    }

    private async saveManifest() {
        await fs.writeJson(this.manifestPath, {
            snapshots: this.snapshots,
            latestStateBackup: this.latestStateBackup
        }, { spaces: 2 });
    }

    async captureSnapshot(description: string, affectedFiles: string[]): Promise<void> {
        const snapshot: Snapshot = {
            id: `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            description,
            affectedFiles: affectedFiles.map(f => path.relative(this.workspacePath, f)),
            changes: {}
        };

        // Process each affected file
        for (const filePath of affectedFiles) {
            const relativePath = path.relative(this.workspacePath, filePath);
            const exists = await fs.pathExists(filePath);

            if (!exists) {
                // File was deleted
                snapshot.changes[relativePath] = {
                    type: 'deleted'
                };
            } else {
                const currentContent = await fs.readFile(filePath, 'utf-8');
                
                // Find previous content for diff
                const previousContent = await this.getPreviousFileContent(relativePath);
                
                if (previousContent === null) {
                    // New file
                    snapshot.changes[relativePath] = {
                        type: 'created',
                        fullContent: currentContent
                    };
                } else {
                    // Modified file - store diff
                    const diff = createPatch(relativePath, previousContent, currentContent);
                    snapshot.changes[relativePath] = {
                        type: 'modified',
                        diff
                    };
                }
            }
        }

        // Save snapshot data
        const snapshotPath = path.join(this.historyDir, `${snapshot.id}.json`);
        await fs.writeJson(snapshotPath, snapshot, { spaces: 2 });

        this.snapshots.push(snapshot);
        await this.saveManifest();
    }

    private async getPreviousFileContent(relativePath: string): Promise<string | null> {
        // Walk backwards through snapshots to find the last known state
        for (let i = this.snapshots.length - 1; i >= 0; i--) {
            const snapshot = this.snapshots[i];
            if (snapshot.changes[relativePath]) {
                const change = snapshot.changes[relativePath];
                
                if (change.type === 'deleted') {
                    return null;
                } else if (change.type === 'created' && change.fullContent) {
                    return change.fullContent;
                } else if (change.type === 'modified' && change.diff) {
                    // Recursively reconstruct
                    return await this.reconstructFileAtSnapshot(relativePath, i);
                }
            }
        }

        // Check if file exists in workspace
        const fullPath = path.join(this.workspacePath, relativePath);
        if (await fs.pathExists(fullPath)) {
            return await fs.readFile(fullPath, 'utf-8');
        }

        return null;
    }

    private async reconstructFileAtSnapshot(relativePath: string, snapshotIndex: number): Promise<string> {
        let content = '';
        
        // Find the creation point or earliest full content
        for (let i = 0; i <= snapshotIndex; i++) {
            const snapshot = this.snapshots[i];
            const change = snapshot.changes[relativePath];
            
            if (change?.type === 'created' && change.fullContent) {
                content = change.fullContent;
            }
        }

        // Apply all diffs up to the target snapshot
        for (let i = 0; i <= snapshotIndex; i++) {
            const snapshot = this.snapshots[i];
            const change = snapshot.changes[relativePath];
            
            if (change?.type === 'modified' && change.diff) {
                content = this.applyPatch(content, change.diff);
            }
        }

        return content;
    }

    private applyPatch(original: string, patch: string): string {
        // Simple patch application using diff library
        const lines = original.split('\n');
        const patchLines = patch.split('\n');
        
        let result = '';
        let lineIdx = 0;
        
        for (const patchLine of patchLines) {
            if (patchLine.startsWith('@@')) {
                continue;
            } else if (patchLine.startsWith('-')) {
                lineIdx++;
            } else if (patchLine.startsWith('+')) {
                result += patchLine.substring(1) + '\n';
            } else if (patchLine.startsWith(' ')) {
                result += lines[lineIdx] + '\n';
                lineIdx++;
            }
        }

        return result.trim();
    }

    async revertToSnapshot(snapshotId: string): Promise<void> {
        const snapshotIndex = this.snapshots.findIndex(s => s.id === snapshotId);
        if (snapshotIndex === -1) {
            throw new Error('Snapshot not found');
        }

        // First, create a backup of current state
        await this.captureCurrentStateBackup();

        // Reconstruct the workspace state at the snapshot
        const filesAtSnapshot = new Map<string, string>();
        
        for (let i = 0; i <= snapshotIndex; i++) {
            const snapshot = this.snapshots[i];
            
            for (const [relativePath, change] of Object.entries(snapshot.changes)) {
                if (change.type === 'deleted') {
                    filesAtSnapshot.delete(relativePath);
                } else if (change.type === 'created' && change.fullContent) {
                    filesAtSnapshot.set(relativePath, change.fullContent);
                } else if (change.type === 'modified') {
                    const reconstructed = await this.reconstructFileAtSnapshot(relativePath, i);
                    filesAtSnapshot.set(relativePath, reconstructed);
                }
            }
        }

        // Apply the reconstructed state
        for (const [relativePath, content] of filesAtSnapshot.entries()) {
            const fullPath = path.join(this.workspacePath, relativePath);
            await fs.ensureDir(path.dirname(fullPath));
            await fs.writeFile(fullPath, content, 'utf-8');
        }
    }

    private async captureCurrentStateBackup(): Promise<void> {
        const backupId = `backup_${Date.now()}`;
        this.latestStateBackup = backupId;
        
        // Capture all current files
        const allFiles = await this.getAllWorkspaceFiles();
        await this.captureSnapshot('Pre-revert backup', allFiles);
        await this.saveManifest();
    }

    async revertToLatest(): Promise<void> {
        if (!this.latestStateBackup) {
            throw new Error('No latest state backup available');
        }

        const backupSnapshot = this.snapshots.find(s => s.id.startsWith('backup_'));
        if (!backupSnapshot) {
            throw new Error('Backup snapshot not found');
        }

        await this.revertToSnapshot(backupSnapshot.id);
        this.latestStateBackup = null;
        await this.saveManifest();
    }

    private async getAllWorkspaceFiles(): Promise<string[]> {
        const files: string[] = [];
        
        async function scan(dir: string) {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.name === '.history_machine' || entry.name === 'node_modules') {
                    continue;
                }
                
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    await scan(fullPath);
                } else {
                    files.push(fullPath);
                }
            }
        }

        await scan(this.workspacePath);
        return files;
    }

    getSnapshots(): Snapshot[] {
        return [...this.snapshots];
    }

    hasLatestBackup(): boolean {
        return this.latestStateBackup !== null;
    }

    async clearHistory(): Promise<void> {
        this.snapshots = [];
        this.latestStateBackup = null;
        await fs.emptyDir(this.historyDir);
        await this.saveManifest();
    }
}