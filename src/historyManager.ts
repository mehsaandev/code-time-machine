import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';

export interface Snapshot {
    id: string;
    timestamp: number;
    description: string;
    affectedFiles: string[];
    workspaceState: { [relativePath: string]: string }; // Complete state hash map
}

interface FileState {
    content: string;
    hash: string;
}

export class HistoryManager {
    private historyDir: string;
    private manifestPath: string;
    private blobsDir: string;
    private snapshots: Snapshot[] = [];
    private workspacePath: string;
    private isReverting: boolean = false;

    constructor(workspacePath: string) {
        this.workspacePath = workspacePath;
        this.historyDir = path.join(workspacePath, '.history_machine');
        this.blobsDir = path.join(this.historyDir, 'blobs');
        this.manifestPath = path.join(this.historyDir, 'manifest.json');
        this.initialize();
    }

    private async initialize() {
        await fs.ensureDir(this.historyDir);
        await fs.ensureDir(this.blobsDir);
        
        if (await fs.pathExists(this.manifestPath)) {
            const data = await fs.readJson(this.manifestPath);
            this.snapshots = data.snapshots || [];
        } else {
            // Create initial snapshot of current workspace
            await this.captureSnapshot('Initial workspace state', []);
        }
    }

    private async saveManifest() {
        await fs.writeJson(this.manifestPath, {
            snapshots: this.snapshots
        }, { spaces: 2 });
    }

    private hashContent(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    private async saveBlob(content: string, hash: string): Promise<void> {
        const blobPath = path.join(this.blobsDir, hash);
        if (!(await fs.pathExists(blobPath))) {
            await fs.writeFile(blobPath, content, 'utf-8');
        }
    }

    private async loadBlob(hash: string): Promise<string> {
        const blobPath = path.join(this.blobsDir, hash);
        return await fs.readFile(blobPath, 'utf-8');
    }

    async captureSnapshot(description: string, affectedFiles: string[]): Promise<void> {
        if (this.isReverting) return; // Don't capture during revert

        const snapshot: Snapshot = {
            id: `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            description,
            affectedFiles: affectedFiles.map(f => path.relative(this.workspacePath, f)),
            workspaceState: {}
        };

        // Capture COMPLETE workspace state
        const allFiles = await this.getAllWorkspaceFiles();
        
        for (const filePath of allFiles) {
            const relativePath = path.relative(this.workspacePath, filePath);
            const content = await fs.readFile(filePath, 'utf-8');
            const hash = this.hashContent(content);
            
            // Save blob if new
            await this.saveBlob(content, hash);
            
            // Store hash reference
            snapshot.workspaceState[relativePath] = hash;
        }

        this.snapshots.push(snapshot);
        await this.saveManifest();
    }

    async revertToSnapshot(snapshotId: string): Promise<void> {
        const snapshot = this.snapshots.find(s => s.id === snapshotId);
        if (!snapshot) {
            throw new Error('Snapshot not found');
        }

        this.isReverting = true;

        try {
            // Get current workspace files
            const currentFiles = await this.getAllWorkspaceFiles();
            const currentRelativePaths = new Set(
                currentFiles.map(f => path.relative(this.workspacePath, f))
            );

            // Get snapshot files
            const snapshotFiles = new Set(Object.keys(snapshot.workspaceState));

            // 1. DELETE files that exist now but didn't exist in snapshot
            for (const relativePath of currentRelativePaths) {
                if (!snapshotFiles.has(relativePath)) {
                    const fullPath = path.join(this.workspacePath, relativePath);
                    await fs.remove(fullPath);
                    console.log(`Deleted: ${relativePath}`);
                }
            }

            // 2. RESTORE/CREATE files from snapshot
            for (const [relativePath, hash] of Object.entries(snapshot.workspaceState)) {
                const fullPath = path.join(this.workspacePath, relativePath);
                const content = await this.loadBlob(hash);
                
                await fs.ensureDir(path.dirname(fullPath));
                await fs.writeFile(fullPath, content, 'utf-8');
                console.log(`Restored: ${relativePath}`);
            }

            // 3. Clean up empty directories
            await this.cleanupEmptyDirectories();

        } finally {
            this.isReverting = false;
        }
    }

    private async cleanupEmptyDirectories() {
        const checkAndRemove = async (dir: string): Promise<boolean> => {
            if (dir === this.workspacePath || dir === this.historyDir) {
                return false;
            }

            try {
                const entries = await fs.readdir(dir);
                
                // Recursively check subdirectories
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry);
                    const stat = await fs.stat(fullPath);
                    
                    if (stat.isDirectory()) {
                        await checkAndRemove(fullPath);
                    }
                }

                // Check again after recursive cleanup
                const remainingEntries = await fs.readdir(dir);
                if (remainingEntries.length === 0) {
                    await fs.rmdir(dir);
                    console.log(`Removed empty directory: ${dir}`);
                    return true;
                }
            } catch (error) {
                // Directory might have been removed already
            }

            return false;
        };

        const allDirs = await this.getAllDirectories();
        for (const dir of allDirs) {
            await checkAndRemove(dir);
        }
    }

    private async getAllDirectories(): Promise<string[]> {
        const dirs: string[] = [];
        
        const scan = async (dir: string) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.name === '.history_machine' || entry.name === 'node_modules' || entry.name === '.git') {
                    continue;
                }
                
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    dirs.push(fullPath);
                    await scan(fullPath);
                }
            }
        };

        await scan(this.workspacePath);
        return dirs.sort().reverse(); // Sort deepest first
    }

    private async getAllWorkspaceFiles(): Promise<string[]> {
        const files: string[] = [];
        
        const scan = async (dir: string) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.name === '.history_machine' || entry.name === 'node_modules' || entry.name === '.git') {
                    continue;
                }
                
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    await scan(fullPath);
                } else {
                    files.push(fullPath);
                }
            }
        };

        await scan(this.workspacePath);
        return files;
    }

    getSnapshots(): Snapshot[] {
        return [...this.snapshots];
    }

    getSnapshotById(id: string): Snapshot | undefined {
        return this.snapshots.find(s => s.id === id);
    }

    async getSnapshotFileList(snapshotId: string): Promise<string[]> {
        const snapshot = this.snapshots.find(s => s.id === snapshotId);
        if (!snapshot) return [];
        return Object.keys(snapshot.workspaceState);
    }

    async clearHistory(): Promise<void> {
        this.snapshots = [];
        await fs.emptyDir(this.historyDir);
        await this.initialize();
    }

    async exportSnapshot(snapshotId: string, exportPath: string): Promise<void> {
        const snapshot = this.snapshots.find(s => s.id === snapshotId);
        if (!snapshot) {
            throw new Error('Snapshot not found');
        }

        await fs.ensureDir(exportPath);

        for (const [relativePath, hash] of Object.entries(snapshot.workspaceState)) {
            const content = await this.loadBlob(hash);
            const fullPath = path.join(exportPath, relativePath);
            
            await fs.ensureDir(path.dirname(fullPath));
            await fs.writeFile(fullPath, content, 'utf-8');
        }
    }
}