/**
 * LSP Manager
 *
 * Orchestrates LSP servers for a project:
 * - Automatically spawns servers based on file extensions
 * - Deduplicates spawn requests
 * - Manages client lifecycle
 * - Aggregates diagnostics across all servers
 */
import { EventEmitter } from 'events';
import { LSPClient } from './client';
import type { Diagnostic, ServerStatus, LSPManagerOptions, LSPManagerEvents, Hover, CompletionItem, Location } from './types';
export interface LSPManagerEventEmitter {
    on<K extends keyof LSPManagerEvents>(event: K, listener: (data: LSPManagerEvents[K]) => void): this;
    off<K extends keyof LSPManagerEvents>(event: K, listener: (data: LSPManagerEvents[K]) => void): this;
    emit<K extends keyof LSPManagerEvents>(event: K, data: LSPManagerEvents[K]): boolean;
}
/**
 * LSP Manager class - manages all LSP servers for a project
 *
 * Multi-Session Support:
 * Each LSPManager instance is isolated to a specific project path.
 * Multiple instances can run concurrently in different shell sessions.
 */
export declare class LSPManager extends EventEmitter implements LSPManagerEventEmitter {
    private clients;
    private spawning;
    private broken;
    private projectPath;
    private enabled;
    private disabled;
    private lazyMode;
    private retryStrategy;
    private installerOptions;
    private installerInitialized;
    private readonly instanceId;
    constructor(options?: LSPManagerOptions);
    /**
     * Hash a path to create a stable identifier
     * Simple hash function for creating project-specific identifiers
     */
    private _hashPath;
    /**
     * Lazy initialize the installer on first server spawn
     */
    private ensureInstallerInitialized;
    /**
     * Get the project path for this manager instance
     */
    getProjectPath(): string;
    /**
     * Get the instance ID (hash of project path)
     */
    getInstanceId(): string;
    /**
     * Set the current project path
     * @deprecated Use constructor options instead. This method is kept for backward compatibility.
     * Creating a new LSPManager instance is preferred for switching projects.
     */
    setProjectPath(projectPath: string): void;
    /**
     * Enable or disable a server
     */
    setServerEnabled(serverId: string, enabled: boolean): void;
    /**
     * Check if a server is enabled
     */
    isServerEnabled(serverId: string): boolean;
    /**
     * Shutdown all clients for a specific server
     */
    private _shutdownServer;
    /**
     * Get or spawn clients for a file
     */
    getClientsForFile(filePath: string): Promise<LSPClient[]>;
    /**
     * Spawn a new LSP client
     */
    private _spawnClient;
    /**
     * Retry spawning a failed server
     */
    private _retrySpawn;
    /**
     * Notify LSP servers that a file was opened/touched
     */
    touchFile(filePath: string, waitForDiagnostics?: boolean): Promise<number>;
    /**
     * Notify LSP servers that a file changed
     */
    fileChanged(filePath: string, content?: string): Promise<void>;
    /**
     * Notify LSP servers that a file was saved
     */
    fileSaved(filePath: string): Promise<void>;
    /**
     * Get all diagnostics across all servers
     */
    getAllDiagnostics(): Record<string, Diagnostic[]>;
    /**
     * Get diagnostics for a specific file
     */
    getDiagnosticsForFile(filePath: string): Diagnostic[];
    /**
     * Get hover info at a position
     */
    hover(filePath: string, line: number, character: number): Promise<Hover | null>;
    /**
     * Get completions at a position
     */
    completion(filePath: string, line: number, character: number): Promise<CompletionItem[]>;
    /**
     * Get definition at a position
     */
    definition(filePath: string, line: number, character: number): Promise<Location | Location[] | null>;
    /**
     * Get references at a position
     */
    references(filePath: string, line: number, character: number): Promise<Location[]>;
    /**
     * Get status of all servers (for Settings UI)
     */
    getStatus(): Promise<ServerStatus[]>;
    /**
     * Shutdown all LSP servers and cancel pending retries
     */
    shutdown(): Promise<void>;
}
/**
 * Format a diagnostic for display
 */
export declare function formatDiagnostic(diagnostic: Diagnostic): string;
//# sourceMappingURL=manager.d.ts.map