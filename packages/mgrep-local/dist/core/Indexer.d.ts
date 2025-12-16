/**
 * Indexer - Orchestrates the file → chunks → embeddings → store pipeline
 *
 * Features:
 * - Incremental indexing (only re-index changed files)
 * - Batch embedding for efficiency
 * - Progress reporting
 */
import type { IndexerOptions, IndexStats, Indexer as IIndexer } from './types.js';
export declare class Indexer implements IIndexer {
    private embedder;
    private vectorStore;
    private chunker;
    private batchSize;
    private progressCallback?;
    constructor(options: IndexerOptions);
    /**
     * Index a single file
     * Returns the number of chunks created
     */
    indexFile(filePath: string, content: string): Promise<number>;
    /**
     * Update a file (same as indexFile, but named for clarity)
     */
    updateFile(filePath: string, content: string): Promise<number>;
    /**
     * Delete a file from the index
     */
    deleteFile(filePath: string): Promise<void>;
    /**
     * Index multiple files with progress reporting
     */
    indexFiles(files: Array<{
        filePath: string;
        content: string;
    }>): Promise<{
        totalChunks: number;
        filesProcessed: number;
    }>;
    /**
     * Get current index statistics
     */
    getStats(): Promise<IndexStats>;
    /**
     * Clear the entire index
     */
    clear(): Promise<void>;
    /**
     * Embed texts in batches for efficiency
     */
    private embedBatched;
    /**
     * Hash file content for change detection
     */
    private hashContent;
    /**
     * Report indexing progress
     */
    private reportProgress;
}
//# sourceMappingURL=Indexer.d.ts.map