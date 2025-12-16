/**
 * ShardedIndexer - Parallel indexing across multiple shards
 *
 * Features:
 * - Distributes files across shards by consistent hashing
 * - Parallel embedding generation using worker pool
 * - Progress tracking per shard
 */
import { ShardedVectorStore } from './ShardedVectorStore.js';
import { Chunker } from './Chunker.js';
import type { IndexProgress, IndexProgressCallback, IndexStats, Embedder as IEmbedder } from './types.js';
/**
 * Embedder configuration for workers
 */
export interface EmbedderConfig {
    backend?: 'auto' | 'llamacpp' | 'mlx' | 'cpu' | 'openai';
    modelName?: string;
    cacheDir?: string;
    verbose?: boolean;
    openaiModel?: 'text-embedding-3-small' | 'text-embedding-3-large' | 'text-embedding-ada-002';
    openaiConcurrency?: number;
}
/**
 * Options for ShardedIndexer
 */
export interface ShardedIndexerOptions {
    shardedStore: ShardedVectorStore;
    embedder: IEmbedder;
    chunker?: Chunker;
    batchSize?: number;
    workerCount?: number;
    progressCallback?: IndexProgressCallback;
    embedderConfig?: EmbedderConfig;
    parallel?: boolean;
}
/**
 * File to index with content
 */
export interface FileToIndex {
    filePath: string;
    content: string;
}
/**
 * Result from indexing a batch
 */
export interface IndexBatchResult {
    shardId: number;
    filesIndexed: number;
    chunksCreated: number;
    errors: number;
    durationMs: number;
}
/**
 * Progress update for sharded indexing
 */
export interface ShardedIndexProgress extends IndexProgress {
    shardId?: number;
    shardsComplete?: number;
    totalShards?: number;
}
export declare class ShardedIndexer {
    private shardedStore;
    private embedder;
    private chunker;
    private batchSize;
    private workerCount;
    private progressCallback?;
    private embedderConfig?;
    private parallel;
    constructor(options: ShardedIndexerOptions);
    /**
     * Index a single file into its shard
     */
    indexFile(filePath: string, content: string): Promise<number>;
    /**
     * Delete a file from its shard
     */
    deleteFile(filePath: string): Promise<void>;
    /**
     * Index multiple files with parallel processing by shard
     *
     * Files are grouped by their target shard, then each shard's
     * files are processed in parallel batches.
     */
    indexFiles(files: FileToIndex[]): Promise<{
        totalChunks: number;
        filesProcessed: number;
        byShardId: Map<number, IndexBatchResult>;
    }>;
    /**
     * Index files in parallel using worker threads
     *
     * This is the high-performance path for large codebases.
     * Each worker handles a subset of shards with its own embedder.
     */
    indexFilesParallel(files: FileToIndex[]): Promise<{
        totalChunks: number;
        filesProcessed: number;
        durationMs: number;
    }>;
    /**
     * Get stats from the sharded store
     */
    getStats(): Promise<IndexStats>;
    /**
     * Clear all shards
     */
    clear(): Promise<void>;
    /**
     * Generate embeddings in batches
     */
    private embedBatched;
    /**
     * Hash content for change detection
     */
    private hashContent;
    /**
     * Report progress
     */
    private reportProgress;
}
//# sourceMappingURL=ShardedIndexer.d.ts.map