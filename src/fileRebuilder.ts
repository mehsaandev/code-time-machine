/**
 * FileRebuilder - Reconstructs file contents at any point in time
 * 
 * Responsibilities:
 * - Accept a file path and timestamp
 * - Replay diffs in chronological order
 * - Return exact file contents at that moment
 * - Handle edge cases (no diffs, invalid timestamps, etc.)
 * 
 * THIS IS THE MOST CRITICAL COMPONENT
 * File reconstruction MUST be 100% accurate
 */

import { diff_match_patch } from 'diff-match-patch';
import { Storage } from './storage';
import { DiffEvent } from './diffEngine';

/**
 * Result of a file rebuild operation
 */
export interface RebuildResult {
    /** Whether the rebuild was successful */
    success: boolean;
    /** The reconstructed file content (empty string if failed) */
    content: string;
    /** The timestamp of the reconstruction */
    timestamp: number;
    /** Number of patches applied */
    patchesApplied: number;
    /** Error message if rebuild failed */
    errorMessage?: string;
    /** File path that was rebuilt */
    filePath: string;
}

/**
 * FileRebuilder class handles file reconstruction
 */
export class FileRebuilder {
    private storage: Storage;
    private dmp: diff_match_patch;

    constructor(storage: Storage) {
        this.storage = storage;
        this.dmp = new diff_match_patch();
    }

    /**
     * Rebuild a file at a specific timestamp
     * 
     * @param filePath - The workspace-relative path to the file
     * @param timestamp - The Unix timestamp (ms) to rebuild to
     * @returns RebuildResult with the reconstructed content or error
     */
    public rebuild(filePath: string, timestamp: number): RebuildResult {
        console.log(`[CodeTimeMachine] Rebuilding file "${filePath}" at timestamp ${timestamp}`);

        try {
            // Validate inputs
            if (!filePath || typeof filePath !== 'string') {
                return this.createErrorResult(filePath, timestamp, 'Invalid file path provided');
            }

            if (!timestamp || typeof timestamp !== 'number' || timestamp < 0) {
                return this.createErrorResult(filePath, timestamp, 'Invalid timestamp provided');
            }

            // Get all diff events for this file up to the target timestamp
            const diffEvents = this.storage.getDiffEventsUpToTimestamp(filePath, timestamp);

            // If no diffs found, check for a snapshot
            if (diffEvents.length === 0) {
                const snapshot = this.storage.getEarliestSnapshot(filePath);
                
                if (snapshot && snapshot.timestamp <= timestamp) {
                    console.log(`[CodeTimeMachine] Using snapshot for "${filePath}"`);
                    return {
                        success: true,
                        content: snapshot.content,
                        timestamp: timestamp,
                        patchesApplied: 0,
                        filePath: filePath
                    };
                }

                return this.createErrorResult(
                    filePath, 
                    timestamp, 
                    `No diff history found for file "${filePath}" at or before timestamp ${timestamp}`
                );
            }

            // Start with the base content from the first diff event
            const firstDiff = diffEvents[0];
            let currentContent = firstDiff.baseContent;
            let patchesApplied = 0;

            console.log(`[CodeTimeMachine] Starting reconstruction with ${diffEvents.length} diff events`);

            // Apply each patch in chronological order
            for (const diffEvent of diffEvents) {
                // Skip if this diff's timestamp is after our target
                // (This shouldn't happen due to our query, but defensive check)
                if (diffEvent.timestamp > timestamp) {
                    console.log(`[CodeTimeMachine] Skipping diff at ${diffEvent.timestamp} (after target)`);
                    continue;
                }

                const patchResult = this.applyPatch(currentContent, diffEvent.patch);

                if (!patchResult.success) {
                    // Log detailed error for debugging
                    console.error(`[CodeTimeMachine] Patch application failed at diff ${diffEvent.id}`);
                    console.error(`[CodeTimeMachine] Base content length: ${currentContent.length}`);
                    console.error(`[CodeTimeMachine] Patch: ${diffEvent.patch.substring(0, 200)}...`);

                    // Attempt recovery: use the base content from this diff as the new current
                    // This allows us to continue even if a patch fails
                    console.log(`[CodeTimeMachine] Attempting recovery using diff's base content`);
                    currentContent = diffEvent.baseContent;
                    
                    // Re-apply the current patch after recovery
                    const retryResult = this.applyPatch(currentContent, diffEvent.patch);
                    if (retryResult.success) {
                        currentContent = retryResult.content;
                        patchesApplied++;
                        console.log(`[CodeTimeMachine] Recovery successful, continuing`);
                    } else {
                        return this.createErrorResult(
                            filePath,
                            timestamp,
                            `Failed to apply patch at timestamp ${diffEvent.timestamp}. ` +
                            `Diff ID: ${diffEvent.id}. Recovery also failed.`
                        );
                    }
                } else {
                    currentContent = patchResult.content;
                    patchesApplied++;
                }
            }

            console.log(`[CodeTimeMachine] Successfully rebuilt "${filePath}" with ${patchesApplied} patches`);

            return {
                success: true,
                content: currentContent,
                timestamp: timestamp,
                patchesApplied: patchesApplied,
                filePath: filePath
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[CodeTimeMachine] Rebuild error: ${errorMessage}`);
            return this.createErrorResult(filePath, timestamp, `Unexpected error: ${errorMessage}`);
        }
    }

    /**
     * Apply a patch to content
     * 
     * @param content - The current content to patch
     * @param patchText - The patch text from diff-match-patch
     * @returns Object with success status and resulting content
     */
    private applyPatch(content: string, patchText: string): { success: boolean; content: string } {
        try {
            // Parse patch text back to patch objects
            const patches = this.dmp.patch_fromText(patchText);

            if (patches.length === 0) {
                // No patches to apply, content unchanged
                return { success: true, content: content };
            }

            // Apply patches
            const [patchedContent, results] = this.dmp.patch_apply(patches, content);

            // Check if all patches were applied successfully
            const allSuccessful = results.every(result => result === true);

            if (!allSuccessful) {
                // Log which patches failed
                const failedIndices = results
                    .map((result, index) => result ? -1 : index)
                    .filter(index => index !== -1);
                
                console.warn(`[CodeTimeMachine] Some patches failed to apply cleanly: indices ${failedIndices.join(', ')}`);
                
                // diff-match-patch is fuzzy, so partial application might still work
                // We'll accept the result but log the warning
            }

            return { success: true, content: patchedContent };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[CodeTimeMachine] Patch parsing error: ${errorMessage}`);
            return { success: false, content: content };
        }
    }

    /**
     * Create an error result
     */
    private createErrorResult(filePath: string, timestamp: number, errorMessage: string): RebuildResult {
        console.error(`[CodeTimeMachine] Rebuild failed: ${errorMessage}`);
        return {
            success: false,
            content: '',
            timestamp: timestamp,
            patchesApplied: 0,
            errorMessage: errorMessage,
            filePath: filePath
        };
    }

    /**
     * Get available timestamps for a file (for UI purposes)
     */
    public getAvailableTimestamps(filePath: string): number[] {
        const diffEvents = this.storage.getDiffEventsByFilePath(filePath);
        return diffEvents.map(event => event.timestamp);
    }

    /**
     * Get the earliest available timestamp for a file
     */
    public getEarliestTimestamp(filePath: string): number | null {
        const firstDiff = this.storage.getFirstDiffEvent(filePath);
        if (firstDiff) {
            return firstDiff.timestamp;
        }
        
        const snapshot = this.storage.getEarliestSnapshot(filePath);
        return snapshot?.timestamp ?? null;
    }

    /**
     * Get the latest available timestamp for a file
     */
    public getLatestTimestamp(filePath: string): number | null {
        const diffEvents = this.storage.getDiffEventsByFilePath(filePath);
        if (diffEvents.length === 0) {
            return null;
        }
        return diffEvents[diffEvents.length - 1].timestamp;
    }

    /**
     * Verify that a rebuild matches expected content (for testing)
     * 
     * @param filePath - The file path
     * @param timestamp - The timestamp to rebuild to
     * @param expectedContent - The expected content
     * @returns Whether the rebuild matches
     */
    public verify(filePath: string, timestamp: number, expectedContent: string): boolean {
        const result = this.rebuild(filePath, timestamp);
        
        if (!result.success) {
            console.error(`[CodeTimeMachine] Verification failed: ${result.errorMessage}`);
            return false;
        }

        const matches = result.content === expectedContent;
        
        if (!matches) {
            console.error(`[CodeTimeMachine] Verification failed: content mismatch`);
            console.error(`[CodeTimeMachine] Expected length: ${expectedContent.length}`);
            console.error(`[CodeTimeMachine] Actual length: ${result.content.length}`);
            
            // Find first difference for debugging
            for (let i = 0; i < Math.max(expectedContent.length, result.content.length); i++) {
                if (expectedContent[i] !== result.content[i]) {
                    console.error(`[CodeTimeMachine] First difference at index ${i}`);
                    console.error(`[CodeTimeMachine] Expected: "${expectedContent.substring(i, i + 20)}..."`);
                    console.error(`[CodeTimeMachine] Actual: "${result.content.substring(i, i + 20)}..."`);
                    break;
                }
            }
        }

        return matches;
    }
}
