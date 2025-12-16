/**
 * VectorStore - LanceDB-based vector storage with similarity search
 *
 * Uses LanceDB for efficient vector similarity search.
 * Pure JS/WASM - no native module compilation issues.
 */
import type { VectorStoreOptions, VectorInsertOptions, Vector, SearchResult, IndexStats, VectorStore as IVectorStore } from './types.js';
export declare class VectorStore implements IVectorStore {
    private dbPath;
    private readonly;
    private db;
    private vectorsTable;
    private filesTable;
    private initialized;
    constructor(options?: VectorStoreOptions);
    /**
     * Initialize the database and create tables
     */
    initialize(): Promise<void>;
    /**
     * Insert a single vector
     */
    insert(options: VectorInsertOptions): Promise<string>;
    /**
     * Insert multiple vectors in a batch
     */
    insertBatch(options: VectorInsertOptions[]): Promise<string[]>;
    /**
     * Search for similar vectors using vector similarity
     */
    search(embedding: number[], limit?: number, threshold?: number): Promise<SearchResult[]>;
    /**
     * Get all vectors for a specific file
     */
    getVectorsForFile(filePath: string): Promise<Vector[]>;
    /**
     * Delete all vectors for a specific file
     */
    deleteVectorsForFile(filePath: string): Promise<number>;
    /**
     * Get index statistics
     */
    getStats(): Promise<IndexStats>;
    /**
     * Clear the entire index
     */
    clear(): Promise<void>;
    /**
     * Close the database connection
     */
    dispose(): Promise<void>;
    /**
     * Track an indexed file
     */
    trackFile(filePath: string, hash: string, language: string, chunksCount: number): Promise<void>;
    /**
     * Check if a file needs re-indexing
     */
    getFileHash(filePath: string): Promise<string | null>;
    private ensureInitialized;
    private getDirectorySize;
}
//# sourceMappingURL=VectorStore.d.ts.map