import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export interface Snapshot {
    id: string;
    timestamp: number;
    description: string;
    affectedFiles: string[];
    workspaceState: { [relativePath: string]: string }; // relativePath -> hash
}

// Delta-encoded blob: either full content or a reference + diff
interface BlobEntry {
    type: 'full' | 'delta';
    data: string;        // Full content or diff patch
    baseHash?: string;   // For delta: reference to base blob
}

interface CompressedStore {
    version: 2;
    blobs: { [hash: string]: BlobEntry };
}

// Configuration
const MAX_SNAPSHOTS = 30;
const MAX_FILE_SIZE = 100 * 1024;     // 100KB max file size
const MAX_PACK_SIZE = 8 * 1024 * 1024; // 8MB target pack size
const PACK_FILE_NAME = 'pack.gz';

// Binary file extensions to skip
const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp', '.svg',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2',
    '.exe', '.dll', '.so', '.dylib', '.bin',
    '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv',
    '.sqlite', '.db', '.lock',
    '.vsix', '.min.js', '.min.css', '.map'
]);

export class HistoryManager {
    private historyDir: string;
    private manifestPath: string;
    private packFilePath: string;
    private snapshots: Snapshot[] = [];
    private blobStore: CompressedStore = { version: 2, blobs: {} };
    private workspacePath: string;
    private isReverting: boolean = false;
    private initPromise: Promise<void>;
    private isDirty: boolean = false;

    constructor(workspacePath: string) {
        this.workspacePath = workspacePath;
        this.historyDir = path.join(workspacePath, '.history_machine');
        this.manifestPath = path.join(this.historyDir, 'manifest.json');
        this.packFilePath = path.join(this.historyDir, PACK_FILE_NAME);
        this.initPromise = this.initialize();
    }

    private async initialize() {
        await fs.ensureDir(this.historyDir);
        
        // Load manifest
        if (await fs.pathExists(this.manifestPath)) {
            const data = await fs.readJson(this.manifestPath);
            this.snapshots = data.snapshots || [];
        }

        // Load compressed pack file
        await this.loadPackFile();

        // Migrate from old formats
        await this.migrateOldFormats();

        // Create initial snapshot if none exist
        if (this.snapshots.length === 0) {
            await this.captureSnapshot('Initial workspace state', []);
        }
    }

    private async loadPackFile() {
        if (await fs.pathExists(this.packFilePath)) {
            try {
                const compressed = await fs.readFile(this.packFilePath);
                const decompressed = await gunzip(compressed);
                this.blobStore = JSON.parse(decompressed.toString('utf-8'));
            } catch (e) {
                console.error('Failed to load pack file, starting fresh:', e);
                this.blobStore = { version: 2, blobs: {} };
            }
        }
    }

    private async savePackFile() {
        const json = JSON.stringify(this.blobStore);
        const compressed = await gzip(json, { level: 9 }); // Max compression
        await fs.writeFile(this.packFilePath, compressed);
        
        const sizeMB = compressed.length / (1024 * 1024);
        console.log(`Pack file saved: ${sizeMB.toFixed(2)} MB`);

        // If pack is too large, aggressively prune
        if (compressed.length > MAX_PACK_SIZE) {
            await this.pruneToFitSize();
        }
    }

    private async pruneToFitSize() {
        console.log('Pack file too large, pruning old snapshots...');
        
        // Remove oldest snapshots until we're under limit
        while (this.snapshots.length > 5) {
            this.snapshots.shift();
            this.garbageCollectBlobs();
            
            const json = JSON.stringify(this.blobStore);
            const compressed = await gzip(json, { level: 9 });
            
            if (compressed.length <= MAX_PACK_SIZE) {
                await fs.writeFile(this.packFilePath, compressed);
                await this.saveManifest();
                console.log(`Pruned to ${this.snapshots.length} snapshots`);
                return;
            }
        }
    }

    private async migrateOldFormats() {
        // Migrate from old blobs directory
        const oldBlobsDir = path.join(this.historyDir, 'blobs');
        if (await fs.pathExists(oldBlobsDir)) {
            console.log('Migrating old blob storage...');
            const entries = await fs.readdir(oldBlobsDir);
            
            for (const hash of entries) {
                if (!this.blobStore.blobs[hash]) {
                    const content = await fs.readFile(path.join(oldBlobsDir, hash), 'utf-8');
                    this.blobStore.blobs[hash] = { type: 'full', data: content };
                }
            }
            
            await this.savePackFile();
            await fs.remove(oldBlobsDir);
            console.log('Migration from blobs directory complete.');
        }

        // Migrate from old pack.json
        const oldPackJson = path.join(this.historyDir, 'pack.json');
        if (await fs.pathExists(oldPackJson)) {
            console.log('Migrating old pack.json...');
            const oldData = await fs.readJson(oldPackJson);
            
            if (oldData.blobs) {
                for (const [hash, content] of Object.entries(oldData.blobs)) {
                    if (!this.blobStore.blobs[hash]) {
                        this.blobStore.blobs[hash] = { type: 'full', data: content as string };
                    }
                }
            }
            
            await this.savePackFile();
            await fs.remove(oldPackJson);
            console.log('Migration from pack.json complete.');
        }
    }

    async waitForInitialization(): Promise<void> {
        await this.initPromise;
    }

    private async saveManifest() {
        await fs.writeJson(this.manifestPath, {
            snapshots: this.snapshots
        }, { spaces: 2 });
    }

    private hashContent(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex').substring(0, 12);
    }

    private isBinaryFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return BINARY_EXTENSIONS.has(ext);
    }

    private createDiff(oldContent: string, newContent: string): string | null {
        // Simple line-based diff - only store if it's smaller than full content
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');
        
        const changes: string[] = [];
        let i = 0, j = 0;
        
        while (i < oldLines.length || j < newLines.length) {
            if (i >= oldLines.length) {
                changes.push(`+${j}:${newLines[j]}`);
                j++;
            } else if (j >= newLines.length) {
                changes.push(`-${i}`);
                i++;
            } else if (oldLines[i] === newLines[j]) {
                i++;
                j++;
            } else {
                // Try to find matching line ahead
                let foundOld = -1, foundNew = -1;
                for (let k = 1; k < 10; k++) {
                    if (foundNew === -1 && j + k < newLines.length && oldLines[i] === newLines[j + k]) {
                        foundNew = j + k;
                    }
                    if (foundOld === -1 && i + k < oldLines.length && oldLines[i + k] === newLines[j]) {
                        foundOld = i + k;
                    }
                }
                
                if (foundNew !== -1 && (foundOld === -1 || foundNew - j <= foundOld - i)) {
                    // Lines were added
                    for (let k = j; k < foundNew; k++) {
                        changes.push(`+${k}:${newLines[k]}`);
                    }
                    j = foundNew;
                } else if (foundOld !== -1) {
                    // Lines were deleted
                    for (let k = i; k < foundOld; k++) {
                        changes.push(`-${k}`);
                    }
                    i = foundOld;
                } else {
                    // Replace line
                    changes.push(`=${i}:${newLines[j]}`);
                    i++;
                    j++;
                }
            }
        }
        
        const diffStr = changes.join('\n');
        
        // Only use diff if it's significantly smaller (< 60% of original)
        if (diffStr.length < newContent.length * 0.6) {
            return diffStr;
        }
        return null;
    }

    private applyDiff(baseContent: string, diff: string): string {
        const lines = baseContent.split('\n');
        const changes = diff.split('\n').filter(c => c.length > 0);
        
        // Sort changes to apply deletions from end to start
        const deletions: number[] = [];
        const additions: { line: number; content: string }[] = [];
        const replacements: { line: number; content: string }[] = [];
        
        for (const change of changes) {
            if (change.startsWith('-')) {
                deletions.push(parseInt(change.substring(1)));
            } else if (change.startsWith('+')) {
                const colonIdx = change.indexOf(':');
                additions.push({
                    line: parseInt(change.substring(1, colonIdx)),
                    content: change.substring(colonIdx + 1)
                });
            } else if (change.startsWith('=')) {
                const colonIdx = change.indexOf(':');
                replacements.push({
                    line: parseInt(change.substring(1, colonIdx)),
                    content: change.substring(colonIdx + 1)
                });
            }
        }
        
        // Apply replacements
        for (const rep of replacements) {
            if (rep.line < lines.length) {
                lines[rep.line] = rep.content;
            }
        }
        
        // Apply deletions (from end to start)
        deletions.sort((a, b) => b - a);
        for (const lineNum of deletions) {
            if (lineNum < lines.length) {
                lines.splice(lineNum, 1);
            }
        }
        
        // Apply additions (sorted by line number)
        additions.sort((a, b) => a.line - b.line);
        let offset = 0;
        for (const add of additions) {
            lines.splice(add.line + offset, 0, add.content);
            offset++;
        }
        
        return lines.join('\n');
    }

    private findBestBase(content: string, filePath: string): { hash: string; similarity: number } | null {
        // Look for similar content to use as delta base
        let bestMatch: { hash: string; similarity: number } | null = null;
        
        const contentLines = new Set(content.split('\n').slice(0, 50)); // Sample first 50 lines
        
        for (const [hash, entry] of Object.entries(this.blobStore.blobs)) {
            if (entry.type !== 'full') continue;
            
            const blobLines = new Set(entry.data.split('\n').slice(0, 50));
            let matches = 0;
            
            for (const line of contentLines) {
                if (blobLines.has(line)) matches++;
            }
            
            const similarity = matches / Math.max(contentLines.size, 1);
            
            if (similarity > 0.5 && (!bestMatch || similarity > bestMatch.similarity)) {
                bestMatch = { hash, similarity };
            }
        }
        
        return bestMatch;
    }

    private saveBlob(content: string, hash: string): void {
        if (this.blobStore.blobs[hash]) return;

        // Try to find a similar blob for delta encoding
        const baseMatch = this.findBestBase(content, '');
        
        if (baseMatch && baseMatch.similarity > 0.6) {
            const baseBlob = this.blobStore.blobs[baseMatch.hash];
            if (baseBlob.type === 'full') {
                const diff = this.createDiff(baseBlob.data, content);
                if (diff) {
                    this.blobStore.blobs[hash] = {
                        type: 'delta',
                        data: diff,
                        baseHash: baseMatch.hash
                    };
                    this.isDirty = true;
                    return;
                }
            }
        }

        // Store as full content
        this.blobStore.blobs[hash] = { type: 'full', data: content };
        this.isDirty = true;
    }

    private loadBlob(hash: string): string {
        const entry = this.blobStore.blobs[hash];
        if (!entry) {
            throw new Error(`Blob not found: ${hash}`);
        }

        if (entry.type === 'full') {
            return entry.data;
        }

        // Reconstruct from delta
        if (!entry.baseHash) {
            throw new Error(`Delta blob missing base reference: ${hash}`);
        }
        
        const baseContent = this.loadBlob(entry.baseHash);
        return this.applyDiff(baseContent, entry.data);
    }

    private async buildWorkspaceState(): Promise<{ [relativePath: string]: string }> {
        const state: { [relativePath: string]: string } = {};
        const allFiles = await this.getAllWorkspaceFiles();
        
        for (const filePath of allFiles) {
            try {
                // Skip binary files
                if (this.isBinaryFile(filePath)) continue;

                // Skip large files
                const stats = await fs.stat(filePath);
                if (stats.size > MAX_FILE_SIZE) continue;

                const relativePath = path.relative(this.workspacePath, filePath);
                const content = await fs.readFile(filePath, 'utf-8');
                
                // Skip files with too many null bytes (likely binary)
                if ((content.match(/\0/g) || []).length > 0) continue;

                const hash = this.hashContent(content);
                this.saveBlob(content, hash);
                state[relativePath] = hash;
            } catch {
                // Skip files that can't be read
            }
        }
        
        return state;
    }

    private statesAreEqual(state1: { [key: string]: string }, state2: { [key: string]: string }): boolean {
        const keys1 = Object.keys(state1).sort();
        const keys2 = Object.keys(state2).sort();
        
        if (keys1.length !== keys2.length) return false;
        
        for (let i = 0; i < keys1.length; i++) {
            if (keys1[i] !== keys2[i]) return false;
            if (state1[keys1[i]] !== state2[keys2[i]]) return false;
        }
        
        return true;
    }

    async captureSnapshot(description: string, affectedFiles: string[]): Promise<boolean> {
        if (this.isReverting) return false;

        const workspaceState = await this.buildWorkspaceState();

        // Check if state changed
        const lastSnapshot = this.snapshots[this.snapshots.length - 1];
        if (lastSnapshot && this.statesAreEqual(lastSnapshot.workspaceState, workspaceState)) {
            console.log('No changes detected, skipping snapshot');
            return false;
        }

        const snapshot: Snapshot = {
            id: `snap_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            timestamp: Date.now(),
            description,
            affectedFiles: affectedFiles.map(f => path.relative(this.workspacePath, f)),
            workspaceState
        };

        this.snapshots.push(snapshot);

        // Enforce max snapshots
        if (this.snapshots.length > MAX_SNAPSHOTS) {
            this.snapshots.splice(0, this.snapshots.length - MAX_SNAPSHOTS);
        }

        await this.saveManifest();
        
        if (this.isDirty) {
            this.garbageCollectBlobs();
            await this.savePackFile();
            this.isDirty = false;
        }

        return true;
    }

    private garbageCollectBlobs() {
        const usedHashes = new Set<string>();
        
        // Collect all directly used hashes
        for (const snapshot of this.snapshots) {
            for (const hash of Object.values(snapshot.workspaceState)) {
                usedHashes.add(hash);
            }
        }

        // Also keep base hashes that deltas depend on
        for (const hash of usedHashes) {
            const entry = this.blobStore.blobs[hash];
            if (entry?.type === 'delta' && entry.baseHash) {
                usedHashes.add(entry.baseHash);
            }
        }

        // Remove unused
        let removedCount = 0;
        for (const hash of Object.keys(this.blobStore.blobs)) {
            if (!usedHashes.has(hash)) {
                delete this.blobStore.blobs[hash];
                removedCount++;
            }
        }

        if (removedCount > 0) {
            console.log(`Garbage collected ${removedCount} unused blobs`);
        }
    }

    async revertToSnapshot(snapshotId: string): Promise<void> {
        const snapshot = this.snapshots.find(s => s.id === snapshotId);
        if (!snapshot) {
            throw new Error('Snapshot not found');
        }

        this.isReverting = true;

        try {
            const currentFiles = await this.getAllWorkspaceFiles();
            const currentRelativePaths = new Set(
                currentFiles.map(f => path.relative(this.workspacePath, f))
            );

            const snapshotFiles = new Set(Object.keys(snapshot.workspaceState));

            for (const relativePath of currentRelativePaths) {
                if (!snapshotFiles.has(relativePath)) {
                    const fullPath = path.join(this.workspacePath, relativePath);
                    await fs.remove(fullPath);
                }
            }

            for (const [relativePath, hash] of Object.entries(snapshot.workspaceState)) {
                const fullPath = path.join(this.workspacePath, relativePath);
                const content = this.loadBlob(hash);
                
                await fs.ensureDir(path.dirname(fullPath));
                await fs.writeFile(fullPath, content, 'utf-8');
            }

            await this.cleanupEmptyDirectories();
        } finally {
            this.isReverting = false;
        }
    }

    private async cleanupEmptyDirectories() {
        const checkAndRemove = async (dir: string): Promise<boolean> => {
            if (dir === this.workspacePath || dir === this.historyDir) return false;

            try {
                const entries = await fs.readdir(dir);
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry);
                    const stat = await fs.stat(fullPath);
                    if (stat.isDirectory()) {
                        await checkAndRemove(fullPath);
                    }
                }

                if ((await fs.readdir(dir)).length === 0) {
                    await fs.rmdir(dir);
                    return true;
                }
            } catch { }

            return false;
        };

        for (const dir of await this.getAllDirectories()) {
            await checkAndRemove(dir);
        }
    }

    private async getAllDirectories(): Promise<string[]> {
        const dirs: string[] = [];
        
        const scan = async (dir: string) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (['.history_machine', 'node_modules', '.git', 'dist', 'out', 'build'].includes(entry.name)) continue;
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    dirs.push(fullPath);
                    await scan(fullPath);
                }
            }
        };

        await scan(this.workspacePath);
        return dirs.sort().reverse();
    }

    private async getAllWorkspaceFiles(): Promise<string[]> {
        const files: string[] = [];
        
        const scan = async (dir: string) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (['.history_machine', 'node_modules', '.git', 'dist', 'out', 'build'].includes(entry.name)) continue;
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
        return snapshot ? Object.keys(snapshot.workspaceState) : [];
    }

    async renameSnapshot(snapshotId: string, newDescription: string): Promise<boolean> {
        const snapshot = this.snapshots.find(s => s.id === snapshotId);
        if (!snapshot) return false;
        snapshot.description = newDescription;
        await this.saveManifest();
        return true;
    }

    async getSnapshotFileContent(snapshotId: string, relativePath: string): Promise<string | null> {
        const snapshot = this.snapshots.find(s => s.id === snapshotId);
        if (!snapshot) return null;
        
        const hash = snapshot.workspaceState[relativePath];
        if (!hash) return null;
        
        try {
            return this.loadBlob(hash);
        } catch {
            return null;
        }
    }

    async clearHistory(): Promise<void> {
        this.snapshots = [];
        this.blobStore = { version: 2, blobs: {} };
        await fs.emptyDir(this.historyDir);
        await this.initialize();
    }

    async exportSnapshot(snapshotId: string, exportPath: string): Promise<void> {
        const snapshot = this.snapshots.find(s => s.id === snapshotId);
        if (!snapshot) throw new Error('Snapshot not found');

        await fs.ensureDir(exportPath);

        for (const [relativePath, hash] of Object.entries(snapshot.workspaceState)) {
            const content = this.loadBlob(hash);
            const fullPath = path.join(exportPath, relativePath);
            await fs.ensureDir(path.dirname(fullPath));
            await fs.writeFile(fullPath, content, 'utf-8');
        }
    }
}
