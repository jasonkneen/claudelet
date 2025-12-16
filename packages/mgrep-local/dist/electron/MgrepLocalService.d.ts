/**
 * MgrepLocalService - Singleton service for Electron main process
 *
 * Manages the entire mgrep-local lifecycle:
 * - Embedder initialization (via worker thread)
 * - VectorStore management
 * - File change handling
 * - Search queries
 */
import { EventEmitter } from 'events';
import type { SearchOptions, SearchResult, IndexStats, FileChangeEvent } from '../core/types.js';
import type { MgrepServiceOptions, MgrepServiceStatus, MgrepServiceEventListener } from './types.js';
export declare class MgrepLocalService extends EventEmitter {
    private static instances;
    private options;
    private vectorStore;
    private embedder;
    private chunker;
    private indexer;
    private searcher;
    private worker;
    private pendingTasks;
    private ready;
    private indexing;
    private lastError;
    /**
     * Constructor is now public to allow direct instantiation for multi-project
     */
    constructor(options: MgrepServiceOptions);
    /**
     * Get or create an instance for a specific dbPath (multi-project support)
     * Each unique dbPath gets its own service instance
     */
    static getInstance(options: MgrepServiceOptions): MgrepLocalService;
    /**
     * Get all active instances
     */
    static getAllInstances(): MgrepLocalService[];
    /**
     * Remove an instance by dbPath
     */
    static removeInstance(dbPath: string): void;
    /**
     * Reset all instances (for testing)
     */
    static resetAllInstances(): void;
    /**
     * @deprecated Use resetAllInstances() instead
     */
    static resetInstance(): void;
    /**
     * Initialize the service
     */
    initialize(): Promise<void>;
    /**
     * Search the index
     */
    search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
    /**
     * Index a single file
     */
    indexFile(filePath: string, content: string): Promise<number>;
    /**
     * Delete a file from the index
     */
    deleteFile(filePath: string): Promise<void>;
    /**
     * Handle a file change event (event-driven API)
     */
    onFileChange(event: FileChangeEvent): Promise<void>;
    /**
     * Index multiple files
     */
    indexFiles(files: Array<{
        filePath: string;
        content: string;
    }>): Promise<{
        totalChunks: number;
        filesProcessed: number;
    }>;
    /**
     * Get current status
     */
    getStatus(): Promise<MgrepServiceStatus>;
    /**
     * Get index statistics
     */
    getStats(): Promise<IndexStats>;
    /**
     * Clear the entire index
     */
    clear(): Promise<void>;
    /**
     * Add event listener
     */
    onEvent(listener: MgrepServiceEventListener): () => void;
    /**
     * Clean up resources
     */
    dispose(): Promise<void>;
    private ensureReady;
    private emitEvent;
    private log;
    private initWorker;
    private sendWorkerTask;
}
//# sourceMappingURL=MgrepLocalService.d.ts.map