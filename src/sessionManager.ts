/**
 * SessionManager - Manages work session lifecycle
 * 
 * Responsibilities:
 * - Start sessions when workspace opens or first edit occurs
 * - End sessions after 15 minutes of inactivity or VS Code closes
 * - Track session metadata (id, repo, branch, timestamps)
 */

import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';

// Constants for session management
const DEFAULT_IDLE_TIMEOUT_MINUTES = 15;
const IDLE_CHECK_INTERVAL_MS = 60000; // Check every minute

/**
 * Session data structure
 */
export interface Session {
    /** Unique session identifier (UUID) */
    sessionId: string;
    /** Name of the git repository (if available) */
    repositoryName: string | null;
    /** Current git branch (if available) */
    branchName: string | null;
    /** Session start timestamp (Unix ms) */
    startTime: number;
    /** Last activity timestamp (Unix ms) */
    lastActivityTime: number;
    /** Whether the session is currently active */
    isActive: boolean;
}

/**
 * SessionManager class handles session lifecycle
 */
export class SessionManager {
    private currentSession: Session | null = null;
    private idleCheckTimer: NodeJS.Timeout | null = null;
    private idleTimeoutMinutes: number;
    private onSessionStartCallback: ((session: Session) => void) | null = null;
    private onSessionEndCallback: ((session: Session) => void) | null = null;

    constructor() {
        this.idleTimeoutMinutes = this.getIdleTimeoutFromConfig();
    }

    /**
     * Get idle timeout from VS Code configuration
     */
    private getIdleTimeoutFromConfig(): number {
        const config = vscode.workspace.getConfiguration('codeTimeMachine');
        return config.get<number>('idleTimeoutMinutes', DEFAULT_IDLE_TIMEOUT_MINUTES);
    }

    /**
     * Register callback for session start events
     */
    public onSessionStart(callback: (session: Session) => void): void {
        this.onSessionStartCallback = callback;
    }

    /**
     * Register callback for session end events
     */
    public onSessionEnd(callback: (session: Session) => void): void {
        this.onSessionEndCallback = callback;
    }

    /**
     * Start a new session
     * @returns The newly created session
     */
    public async startSession(): Promise<Session> {
        // If session already active, return it
        if (this.currentSession?.isActive) {
            console.log('[CodeTimeMachine] Session already active:', this.currentSession.sessionId);
            return this.currentSession;
        }

        const now = Date.now();
        const gitInfo = await this.getGitInfo();

        this.currentSession = {
            sessionId: uuidv4(),
            repositoryName: gitInfo.repositoryName,
            branchName: gitInfo.branchName,
            startTime: now,
            lastActivityTime: now,
            isActive: true
        };

        // Start idle check timer
        this.startIdleCheck();

        console.log('[CodeTimeMachine] Session started:', this.currentSession.sessionId);
        
        // Notify listeners
        if (this.onSessionStartCallback) {
            this.onSessionStartCallback(this.currentSession);
        }

        return this.currentSession;
    }

    /**
     * Stop the current session
     * @returns The ended session or null if no session was active
     */
    public stopSession(): Session | null {
        if (!this.currentSession) {
            console.log('[CodeTimeMachine] No active session to stop');
            return null;
        }

        // Stop idle check timer
        this.stopIdleCheck();

        // Mark session as inactive
        this.currentSession.isActive = false;
        const endedSession = { ...this.currentSession };

        console.log('[CodeTimeMachine] Session stopped:', endedSession.sessionId);

        // Notify listeners
        if (this.onSessionEndCallback) {
            this.onSessionEndCallback(endedSession);
        }

        this.currentSession = null;
        return endedSession;
    }

    /**
     * Update last activity time (call this on edits)
     */
    public recordActivity(): void {
        if (this.currentSession?.isActive) {
            this.currentSession.lastActivityTime = Date.now();
        }
    }

    /**
     * Get the current session
     */
    public getCurrentSession(): Session | null {
        return this.currentSession;
    }

    /**
     * Check if a session is currently active
     */
    public isSessionActive(): boolean {
        return this.currentSession?.isActive ?? false;
    }

    /**
     * Get git repository information from workspace
     */
    private async getGitInfo(): Promise<{ repositoryName: string | null; branchName: string | null }> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return { repositoryName: null, branchName: null };
        }

        const workspacePath = workspaceFolders[0].uri.fsPath;
        const gitDir = path.join(workspacePath, '.git');

        // Check if .git directory exists
        if (!fs.existsSync(gitDir)) {
            return { repositoryName: null, branchName: null };
        }

        let repositoryName: string | null = null;
        let branchName: string | null = null;

        // Get repository name from folder name
        repositoryName = path.basename(workspacePath);

        // Get branch name from .git/HEAD
        try {
            const headPath = path.join(gitDir, 'HEAD');
            if (fs.existsSync(headPath)) {
                const headContent = fs.readFileSync(headPath, 'utf-8').trim();
                // HEAD file contains "ref: refs/heads/branch-name"
                const refPrefix = 'ref: refs/heads/';
                if (headContent.startsWith(refPrefix)) {
                    branchName = headContent.substring(refPrefix.length);
                }
            }
        } catch (error) {
            console.error('[CodeTimeMachine] Error reading git HEAD:', error);
        }

        return { repositoryName, branchName };
    }

    /**
     * Start the idle check timer
     */
    private startIdleCheck(): void {
        this.stopIdleCheck(); // Clear any existing timer

        this.idleCheckTimer = setInterval(() => {
            this.checkIdleTimeout();
        }, IDLE_CHECK_INTERVAL_MS);
    }

    /**
     * Stop the idle check timer
     */
    private stopIdleCheck(): void {
        if (this.idleCheckTimer) {
            clearInterval(this.idleCheckTimer);
            this.idleCheckTimer = null;
        }
    }

    /**
     * Check if session should end due to idle timeout
     */
    private checkIdleTimeout(): void {
        if (!this.currentSession?.isActive) {
            return;
        }

        const now = Date.now();
        const idleMs = now - this.currentSession.lastActivityTime;
        const idleTimeoutMs = this.idleTimeoutMinutes * 60 * 1000;

        if (idleMs >= idleTimeoutMs) {
            console.log('[CodeTimeMachine] Session idle timeout reached');
            this.stopSession();
        }
    }

    /**
     * Cleanup resources
     */
    public dispose(): void {
        this.stopIdleCheck();
        if (this.currentSession?.isActive) {
            this.stopSession();
        }
    }
}
