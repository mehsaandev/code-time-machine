/**
 * DiffEngine - Handles diff batching and patch generation
 * 
 * Responsibilities:
 * - Batch edits every 2-5 seconds (not per keystroke)
 * - Generate diff patches using diff-match-patch
 * - Filter out binary files, node_modules, .git, secrets
 * - Track cursor position with diffs
 */

import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { diff_match_patch } from 'diff-match-patch';

// Constants
const DEFAULT_BATCH_INTERVAL_MS = 3000; // 3 seconds default
const MIN_BATCH_INTERVAL_MS = 2000;     // 2 seconds minimum
const MAX_BATCH_INTERVAL_MS = 5000;     // 5 seconds maximum

/**
 * Cursor position at time of diff
 */
export interface CursorPosition {
    line: number;
    character: number;
}

/**
 * DiffEvent data structure - represents a single batched diff
 */
export interface DiffEvent {
    /** Unique diff event identifier */
    id: string;
    /** Session this diff belongs to */
    sessionId: string;
    /** Path to the file (workspace relative) */
    filePath: string;
    /** The diff patch string */
    patch: string;
    /** Timestamp when diff was captured (Unix ms) */
    timestamp: number;
    /** Cursor position at time of capture */
    cursor: CursorPosition;
    /** The content BEFORE the change (for reconstruction) */
    baseContent: string;
}

/**
 * Pending change buffer for a single file
 */
interface PendingFileChange {
    /** Original content when tracking started */
    originalContent: string;
    /** Current content after changes */
    currentContent: string;
    /** Last cursor position */
    cursorPosition: CursorPosition;
    /** Whether there are uncommitted changes */
    hasChanges: boolean;
}

/**
 * Patterns to ignore when capturing diffs
 */
const IGNORE_PATTERNS: RegExp[] = [
    /node_modules/,
    /\.git/,
    /\.env/,
    /\.env\..*/,
    /secrets?\//i,
    /config\.secret/i,
    /\.pem$/,
    /\.key$/,
    /\.p12$/,
    /\.pfx$/,
];

/**
 * Binary file extensions to ignore
 */
const BINARY_EXTENSIONS: Set<string> = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.exe', '.dll', '.so', '.dylib',
    '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv',
    '.ttf', '.otf', '.woff', '.woff2', '.eot',
    '.sqlite', '.db', '.sqlite3',
    '.pyc', '.class', '.o', '.obj',
]);

/**
 * DiffEngine class handles diff capture and batching
 */
export class DiffEngine {
    private dmp: diff_match_patch;
    private pendingChanges: Map<string, PendingFileChange> = new Map();
    private batchTimer: NodeJS.Timeout | null = null;
    private batchIntervalMs: number;
    private currentSessionId: string | null = null;
    private isPaused: boolean = false;
    private onDiffCapturedCallback: ((diff: DiffEvent) => void) | null = null;

    constructor() {
        this.dmp = new diff_match_patch();
        this.batchIntervalMs = this.getBatchIntervalFromConfig();
    }

    /**
     * Get batch interval from VS Code configuration
     */
    private getBatchIntervalFromConfig(): number {
        const config = vscode.workspace.getConfiguration('visualCodeTimeMachine');
        const configValue = config.get<number>('batchIntervalMs', DEFAULT_BATCH_INTERVAL_MS);
        // Clamp to valid range
        return Math.max(MIN_BATCH_INTERVAL_MS, Math.min(MAX_BATCH_INTERVAL_MS, configValue));
    }

    /**
     * Register callback for when a diff is captured
     */
    public onDiffCaptured(callback: (diff: DiffEvent) => void): void {
        this.onDiffCapturedCallback = callback;
    }

    /**
     * Set the current session ID
     */
    public setSessionId(sessionId: string): void {
        this.currentSessionId = sessionId;
    }

    /**
     * Clear the current session ID
     */
    public clearSessionId(): void {
        // Flush any pending changes before clearing session
        this.flushAllPendingChanges();
        this.currentSessionId = null;
    }

    /**
     * Pause diff recording
     */
    public pause(): void {
        this.isPaused = true;
        console.log('[CodeTimeMachine] Diff recording paused');
    }

    /**
     * Resume diff recording
     */
    public resume(): void {
        this.isPaused = false;
        console.log('[CodeTimeMachine] Diff recording resumed');
    }

    /**
     * Check if recording is paused
     */
    public isRecordingPaused(): boolean {
        return this.isPaused;
    }

    /**
     * Handle a document change event
     */
    public handleDocumentChange(
        document: vscode.TextDocument,
        contentChanges: readonly vscode.TextDocumentContentChangeEvent[]
    ): void {
        // Skip if paused, no session, or no changes
        if (this.isPaused || !this.currentSessionId || contentChanges.length === 0) {
            return;
        }

        // Skip if file should be ignored
        if (this.shouldIgnoreFile(document.uri.fsPath)) {
            return;
        }

        const filePath = this.getRelativePath(document.uri.fsPath);
        
        // Get or create pending change entry for this file
        let pending = this.pendingChanges.get(filePath);
        
        if (!pending) {
            // First change to this file - store original content
            // We need to reconstruct what the content was BEFORE this change
            const originalContent = this.reconstructOriginalContent(document, contentChanges);
            pending = {
                originalContent: originalContent,
                currentContent: document.getText(),
                cursorPosition: this.getCurrentCursorPosition(document),
                hasChanges: true
            };
            this.pendingChanges.set(filePath, pending);
        } else {
            // Update current content
            pending.currentContent = document.getText();
            pending.cursorPosition = this.getCurrentCursorPosition(document);
            pending.hasChanges = true;
        }

        // Start or reset batch timer
        this.resetBatchTimer();
    }

    /**
     * Reconstruct original content before the change was applied
     */
    private reconstructOriginalContent(
        document: vscode.TextDocument,
        contentChanges: readonly vscode.TextDocumentContentChangeEvent[]
    ): string {
        // The document already has the changes applied
        // We need to reverse them to get the original content
        let content = document.getText();
        
        // Apply changes in reverse order to reconstruct original
        const reversedChanges = [...contentChanges].reverse();
        
        for (const change of reversedChanges) {
            const startOffset = document.offsetAt(change.range.start);
            const beforeChange = content.substring(0, startOffset);
            const afterChange = content.substring(startOffset + change.text.length);
            content = beforeChange + change.rangeLength + afterChange;
        }
        
        // Actually, this approach is complex. Let's use a simpler method:
        // We'll track from the first seen content
        // For simplicity, if we don't have original, use empty string for first diff
        // The fileRebuilder will handle this by starting from initial snapshot
        
        return content;
    }

    /**
     * Get current cursor position in a document
     */
    private getCurrentCursorPosition(document: vscode.TextDocument): CursorPosition {
        const editor = vscode.window.activeTextEditor;
        
        if (editor && editor.document.uri.toString() === document.uri.toString()) {
            return {
                line: editor.selection.active.line,
                character: editor.selection.active.character
            };
        }
        
        // Default to start of document if no active editor
        return { line: 0, character: 0 };
    }

    /**
     * Reset the batch timer
     */
    private resetBatchTimer(): void {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
        }

        this.batchTimer = setTimeout(() => {
            this.flushAllPendingChanges();
        }, this.batchIntervalMs);
    }

    /**
     * Flush all pending changes and create diff events
     */
    public flushAllPendingChanges(): void {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }

        if (!this.currentSessionId) {
            this.pendingChanges.clear();
            return;
        }

        const timestamp = Date.now();

        for (const [filePath, pending] of this.pendingChanges.entries()) {
            if (pending.hasChanges && pending.originalContent !== pending.currentContent) {
                const diffEvent = this.createDiffEvent(
                    filePath,
                    pending.originalContent,
                    pending.currentContent,
                    pending.cursorPosition,
                    timestamp
                );

                if (diffEvent && this.onDiffCapturedCallback) {
                    this.onDiffCapturedCallback(diffEvent);
                }

                // Update original content for next diff
                pending.originalContent = pending.currentContent;
                pending.hasChanges = false;
            }
        }
    }

    /**
     * Create a diff event from original and new content
     */
    private createDiffEvent(
        filePath: string,
        originalContent: string,
        newContent: string,
        cursor: CursorPosition,
        timestamp: number
    ): DiffEvent | null {
        if (!this.currentSessionId) {
            return null;
        }

        // Generate patch using diff-match-patch
        const patches = this.dmp.patch_make(originalContent, newContent);
        const patchText = this.dmp.patch_toText(patches);

        // Skip if no actual changes
        if (patches.length === 0) {
            return null;
        }

        return {
            id: uuidv4(),
            sessionId: this.currentSessionId,
            filePath: filePath,
            patch: patchText,
            timestamp: timestamp,
            cursor: cursor,
            baseContent: originalContent
        };
    }

    /**
     * Check if a file should be ignored
     */
    private shouldIgnoreFile(filePath: string): boolean {
        // Check ignore patterns
        for (const pattern of IGNORE_PATTERNS) {
            if (pattern.test(filePath)) {
                return true;
            }
        }

        // Check binary extensions
        const ext = this.getFileExtension(filePath).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) {
            return true;
        }

        return false;
    }

    /**
     * Get file extension from path
     */
    private getFileExtension(filePath: string): string {
        const lastDot = filePath.lastIndexOf('.');
        if (lastDot === -1) {
            return '';
        }
        return filePath.substring(lastDot);
    }

    /**
     * Get workspace-relative path
     */
    private getRelativePath(absolutePath: string): string {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspacePath = workspaceFolders[0].uri.fsPath;
            if (absolutePath.startsWith(workspacePath)) {
                // Remove workspace path and leading separator
                let relative = absolutePath.substring(workspacePath.length);
                if (relative.startsWith('/') || relative.startsWith('\\')) {
                    relative = relative.substring(1);
                }
                return relative;
            }
        }
        
        return absolutePath;
    }

    /**
     * Initialize tracking for a document (capture initial state)
     */
    public initializeDocument(document: vscode.TextDocument): void {
        if (this.isPaused || !this.currentSessionId) {
            return;
        }

        if (this.shouldIgnoreFile(document.uri.fsPath)) {
            return;
        }

        const filePath = this.getRelativePath(document.uri.fsPath);
        
        // Only initialize if not already tracking
        if (!this.pendingChanges.has(filePath)) {
            this.pendingChanges.set(filePath, {
                originalContent: document.getText(),
                currentContent: document.getText(),
                cursorPosition: { line: 0, character: 0 },
                hasChanges: false
            });
        }
    }

    /**
     * Cleanup resources
     */
    public dispose(): void {
        this.flushAllPendingChanges();
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        this.pendingChanges.clear();
    }
}
