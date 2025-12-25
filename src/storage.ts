/**
 * Storage - Local persistence layer using sql.js (pure JavaScript SQLite)
 * 
 * Responsibilities:
 * - Persist sessions and diff events to SQLite database
 * - Support append-only storage pattern
 * - Query diffs by sessionId, filePath, and timestamp range
 */

import * as path from 'path';
import * as fs from 'fs';
import initSqlJs, { Database } from 'sql.js';
import { Session } from './sessionManager';
import { DiffEvent } from './diffEngine';

// Database filename
const DB_FILENAME = 'code-time-machine.db';

// Save interval for persisting database to disk (ms)
const DB_SAVE_INTERVAL_MS = 5000;

/**
 * Storage class handles local SQLite persistence
 */
export class Storage {
    private db: Database | null = null;
    private dbPath: string;
    private saveTimer: NodeJS.Timeout | null = null;
    private isDirty: boolean = false;

    constructor(storagePath: string) {
        this.dbPath = path.join(storagePath, DB_FILENAME);
    }

    /**
     * Initialize the database and create tables if needed
     */
    public async initialize(): Promise<void> {
        try {
            // Ensure storage directory exists
            const storageDir = path.dirname(this.dbPath);
            if (!fs.existsSync(storageDir)) {
                fs.mkdirSync(storageDir, { recursive: true });
            }

            // Initialize sql.js
            const SQL = await initSqlJs();

            // Load existing database or create new one
            if (fs.existsSync(this.dbPath)) {
                const fileBuffer = fs.readFileSync(this.dbPath);
                this.db = new SQL.Database(fileBuffer);
                console.log('[CodeTimeMachine] Loaded existing database from:', this.dbPath);
            } else {
                this.db = new SQL.Database();
                console.log('[CodeTimeMachine] Created new database');
            }

            // Create tables
            this.createTables();

            // Start periodic save timer
            this.startSaveTimer();

            console.log('[CodeTimeMachine] Storage initialized at:', this.dbPath);
        } catch (error) {
            console.error('[CodeTimeMachine] Failed to initialize storage:', error);
            throw error;
        }
    }

    /**
     * Create database tables
     */
    private createTables(): void {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        // Sessions table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                repository_name TEXT,
                branch_name TEXT,
                start_time INTEGER NOT NULL,
                last_activity_time INTEGER NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL
            )
        `);

        // Diff events table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS diff_events (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                file_path TEXT NOT NULL,
                patch TEXT NOT NULL,
                base_content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                cursor_line INTEGER NOT NULL,
                cursor_character INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(session_id)
            )
        `);

        // Create indexes for efficient querying
        this.db.run(`
            CREATE INDEX IF NOT EXISTS idx_diff_events_session_id 
            ON diff_events(session_id)
        `);

        this.db.run(`
            CREATE INDEX IF NOT EXISTS idx_diff_events_file_path 
            ON diff_events(file_path)
        `);

        this.db.run(`
            CREATE INDEX IF NOT EXISTS idx_diff_events_timestamp 
            ON diff_events(timestamp)
        `);

        // Composite index for common query pattern
        this.db.run(`
            CREATE INDEX IF NOT EXISTS idx_diff_events_file_timestamp 
            ON diff_events(file_path, timestamp)
        `);

        // Initial file snapshots table (stores first known state of files)
        this.db.run(`
            CREATE TABLE IF NOT EXISTS file_snapshots (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                file_path TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(session_id)
            )
        `);

        this.db.run(`
            CREATE INDEX IF NOT EXISTS idx_file_snapshots_file_path 
            ON file_snapshots(file_path)
        `);

        // Add unique constraint for file snapshots
        this.db.run(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_file_snapshots_unique 
            ON file_snapshots(file_path, session_id)
        `);
    }

    /**
     * Start periodic save timer
     */
    private startSaveTimer(): void {
        this.saveTimer = setInterval(() => {
            if (this.isDirty) {
                this.saveToDisk();
            }
        }, DB_SAVE_INTERVAL_MS);
    }

    /**
     * Save database to disk
     */
    private saveToDisk(): void {
        if (!this.db) {
            return;
        }

        try {
            const data = this.db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(this.dbPath, buffer);
            this.isDirty = false;
            console.log('[CodeTimeMachine] Database saved to disk');
        } catch (error) {
            console.error('[CodeTimeMachine] Failed to save database:', error);
        }
    }

    /**
     * Mark database as dirty (needs saving)
     */
    private markDirty(): void {
        this.isDirty = true;
    }

    /**
     * Save a session to the database
     */
    public saveSession(session: Session): void {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO sessions 
            (session_id, repository_name, branch_name, start_time, last_activity_time, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run([
            session.sessionId,
            session.repositoryName,
            session.branchName,
            session.startTime,
            session.lastActivityTime,
            session.isActive ? 1 : 0,
            Date.now()
        ]);

        stmt.free();
        this.markDirty();

        console.log('[CodeTimeMachine] Session saved:', session.sessionId);
    }

    /**
     * Update session's last activity time
     */
    public updateSessionActivity(sessionId: string, lastActivityTime: number): void {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        this.db.run(
            `UPDATE sessions SET last_activity_time = ? WHERE session_id = ?`,
            [lastActivityTime, sessionId]
        );

        this.markDirty();
    }

    /**
     * Mark a session as ended (inactive)
     */
    public endSession(sessionId: string): void {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        this.db.run(
            `UPDATE sessions SET is_active = 0, last_activity_time = ? WHERE session_id = ?`,
            [Date.now(), sessionId]
        );

        this.markDirty();
        console.log('[CodeTimeMachine] Session ended in storage:', sessionId);
    }

    /**
     * Save a diff event to the database (append-only)
     */
    public saveDiffEvent(diffEvent: DiffEvent): void {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        const stmt = this.db.prepare(`
            INSERT INTO diff_events 
            (id, session_id, file_path, patch, base_content, timestamp, cursor_line, cursor_character, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run([
            diffEvent.id,
            diffEvent.sessionId,
            diffEvent.filePath,
            diffEvent.patch,
            diffEvent.baseContent,
            diffEvent.timestamp,
            diffEvent.cursor.line,
            diffEvent.cursor.character,
            Date.now()
        ]);

        stmt.free();
        this.markDirty();

        console.log('[CodeTimeMachine] Diff event saved:', diffEvent.id, 'for file:', diffEvent.filePath);
    }

    /**
     * Save initial file snapshot
     */
    public saveFileSnapshot(sessionId: string, filePath: string, content: string, timestamp: number): void {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        try {
            const stmt = this.db.prepare(`
                INSERT OR IGNORE INTO file_snapshots 
                (id, session_id, file_path, content, timestamp, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `);

            const id = `${sessionId}-${filePath}`;
            stmt.run([id, sessionId, filePath, content, timestamp, Date.now()]);
            stmt.free();
            this.markDirty();
        } catch (error) {
            // Ignore duplicate key errors
            console.log('[CodeTimeMachine] Snapshot already exists or error:', error);
        }
    }

    /**
     * Get the earliest file snapshot for a file
     */
    public getEarliestSnapshot(filePath: string): { content: string; timestamp: number } | null {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        const stmt = this.db.prepare(`
            SELECT content, timestamp 
            FROM file_snapshots 
            WHERE file_path = ?
            ORDER BY timestamp ASC
            LIMIT 1
        `);

        stmt.bind([filePath]);
        
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return {
                content: row['content'] as string,
                timestamp: row['timestamp'] as number
            };
        }
        
        stmt.free();
        return null;
    }

    /**
     * Get diff events by session ID
     */
    public getDiffEventsBySession(sessionId: string): DiffEvent[] {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        const stmt = this.db.prepare(`
            SELECT * FROM diff_events 
            WHERE session_id = ?
            ORDER BY timestamp ASC
        `);

        stmt.bind([sessionId]);
        const results: DiffEvent[] = [];

        while (stmt.step()) {
            results.push(this.rowToDiffEvent(stmt.getAsObject()));
        }

        stmt.free();
        return results;
    }

    /**
     * Get diff events by file path
     */
    public getDiffEventsByFilePath(filePath: string): DiffEvent[] {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        const stmt = this.db.prepare(`
            SELECT * FROM diff_events 
            WHERE file_path = ?
            ORDER BY timestamp ASC
        `);

        stmt.bind([filePath]);
        const results: DiffEvent[] = [];

        while (stmt.step()) {
            results.push(this.rowToDiffEvent(stmt.getAsObject()));
        }

        stmt.free();
        return results;
    }

    /**
     * Get diff events by file path up to a specific timestamp
     */
    public getDiffEventsUpToTimestamp(filePath: string, timestamp: number): DiffEvent[] {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        const stmt = this.db.prepare(`
            SELECT * FROM diff_events 
            WHERE file_path = ? AND timestamp <= ?
            ORDER BY timestamp ASC
        `);

        stmt.bind([filePath, timestamp]);
        const results: DiffEvent[] = [];

        while (stmt.step()) {
            results.push(this.rowToDiffEvent(stmt.getAsObject()));
        }

        stmt.free();
        return results;
    }

    /**
     * Get diff events in a timestamp range
     */
    public getDiffEventsInRange(
        filePath: string, 
        startTimestamp: number, 
        endTimestamp: number
    ): DiffEvent[] {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        const stmt = this.db.prepare(`
            SELECT * FROM diff_events 
            WHERE file_path = ? AND timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp ASC
        `);

        stmt.bind([filePath, startTimestamp, endTimestamp]);
        const results: DiffEvent[] = [];

        while (stmt.step()) {
            results.push(this.rowToDiffEvent(stmt.getAsObject()));
        }

        stmt.free();
        return results;
    }

    /**
     * Get all sessions
     */
    public getAllSessions(): Session[] {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        const stmt = this.db.prepare(`
            SELECT * FROM sessions 
            ORDER BY start_time DESC
        `);

        const results: Session[] = [];

        while (stmt.step()) {
            results.push(this.rowToSession(stmt.getAsObject()));
        }

        stmt.free();
        return results;
    }

    /**
     * Get a session by ID
     */
    public getSession(sessionId: string): Session | null {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        const stmt = this.db.prepare(`
            SELECT * FROM sessions 
            WHERE session_id = ?
        `);

        stmt.bind([sessionId]);
        
        if (stmt.step()) {
            const result = this.rowToSession(stmt.getAsObject());
            stmt.free();
            return result;
        }

        stmt.free();
        return null;
    }

    /**
     * Get all unique file paths that have been tracked
     */
    public getTrackedFilePaths(): string[] {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        const stmt = this.db.prepare(`
            SELECT DISTINCT file_path FROM diff_events
            ORDER BY file_path ASC
        `);

        const results: string[] = [];

        while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push(row['file_path'] as string);
        }

        stmt.free();
        return results;
    }

    /**
     * Get the first diff event for a file (contains initial base content)
     */
    public getFirstDiffEvent(filePath: string): DiffEvent | null {
        if (!this.db) {
            throw new Error('Database not initialized');
        }

        const stmt = this.db.prepare(`
            SELECT * FROM diff_events 
            WHERE file_path = ?
            ORDER BY timestamp ASC
            LIMIT 1
        `);

        stmt.bind([filePath]);
        
        if (stmt.step()) {
            const result = this.rowToDiffEvent(stmt.getAsObject());
            stmt.free();
            return result;
        }

        stmt.free();
        return null;
    }

    /**
     * Convert database row to DiffEvent
     */
    private rowToDiffEvent(row: Record<string, unknown>): DiffEvent {
        return {
            id: row['id'] as string,
            sessionId: row['session_id'] as string,
            filePath: row['file_path'] as string,
            patch: row['patch'] as string,
            baseContent: row['base_content'] as string,
            timestamp: row['timestamp'] as number,
            cursor: {
                line: row['cursor_line'] as number,
                character: row['cursor_character'] as number
            }
        };
    }

    /**
     * Convert database row to Session
     */
    private rowToSession(row: Record<string, unknown>): Session {
        return {
            sessionId: row['session_id'] as string,
            repositoryName: row['repository_name'] as string | null,
            branchName: row['branch_name'] as string | null,
            startTime: row['start_time'] as number,
            lastActivityTime: row['last_activity_time'] as number,
            isActive: row['is_active'] === 1
        };
    }

    /**
     * Close the database connection
     */
    public close(): void {
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
            this.saveTimer = null;
        }

        // Final save before closing
        if (this.isDirty) {
            this.saveToDisk();
        }

        if (this.db) {
            this.db.close();
            this.db = null;
            console.log('[CodeTimeMachine] Storage closed');
        }
    }

    /**
     * Check if database is initialized
     */
    public isInitialized(): boolean {
        return this.db !== null;
    }
}
