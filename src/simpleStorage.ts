/**
 * Simple Storage Mock - For testing purposes
 */
export class SimpleStorage {
    constructor(storagePath: string) {
        console.log('[SimpleStorage] Initialized with path:', storagePath);
    }

    async initialize(): Promise<void> {
        console.log('[SimpleStorage] Initialization complete');
    }

    saveSession(session: any): void {
        console.log('[SimpleStorage] Session saved:', session);
    }

    close(): void {
        console.log('[SimpleStorage] Storage closed');
    }
}