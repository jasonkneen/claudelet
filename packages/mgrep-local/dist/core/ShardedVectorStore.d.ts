/**
 * ShardedVectorStore - Hierarchical sharded vector storage
 *
 * Architecture:
 * - Meta-index: Contains shard centroids for fast routing
 * - Shards: N separate VectorStores, each handling a partition
 *
 * Benefits:
 * - Parallel indexing across shards
 * - Faster search (query relevant shards only)
 * - Progressive results ("image coming into focus")
 */
import { VectorStore } from './VectorStore.js';
import type { VectorStoreOptions, VectorInsertOptions, SearchResult, IndexStats, Vector } from './types.js';
/**
 * Shard metadata stored in meta-index
 */
export interface ShardInfo {
    id: number;
    path: string;
    fileCount: number;
    chunkCount: number;
    centroid: number[] | null;
}
/**
 * Search result with shard info for progressive loading
 */
export interface ShardedSearchResult extends SearchResult {
    shardId: number;
}
/**
 * Options for ShardedVectorStore
 */
export interface ShardedVectorStoreOptions extends VectorStoreOptions {
    shardCount?: number;
}
/**
 * Callback for progressive search results
 */
export type ProgressiveSearchCallback = (results: ShardedSearchResult[], shardId: number, complete: boolean) => void;
export declare class ShardedVectorStore {
    private basePath;
    private shardCount;
    private shards;
    private metaStore;
    private shardInfos;
    private initialized;
    constructor(options?: ShardedVectorStoreOptions);
    /**
     * Initialize all shards and meta-index
     */
    initialize(): Promise<void>;
    /**
     * Get shard ID for a file path (consistent hashing)
     */
    getShardId(filePath: string): number;
    /**
     * Get paths to all shard databases for worker threads
     */
    getShardPaths(): Map<number, string>;
    /**
     * Get number of shards
     */
    getShardCount(): number;
    /**
     * Get a specific shard's VectorStore
     */
    getShard(shardId: number): VectorStore;
    /**
     * Insert vectors into the appropriate shard
     */
    insert(options: VectorInsertOptions): Promise<string>;
    /**
     * Batch insert - groups by shard for efficiency
     */
    insertBatch(options: VectorInsertOptions[]): Promise<string[]>;
    /**
     * Search across all shards with progressive results
     *
     * Returns results as each shard completes, "coming into focus"
     */
    searchProgressive(embedding: number[], limit?: number, threshold?: number, onProgress?: ProgressiveSearchCallback): Promise<ShardedSearchResult[]>;
    /**
     * Standard search (non-progressive) - for compatibility
     */
    search(embedding: number[], limit?: number, threshold?: number): Promise<SearchResult[]>;
    /**
     * Parallel search - search all shards concurrently
     */
    searchParallel(embedding: number[], limit?: number, threshold?: number): Promise<ShardedSearchResult[]>;
    /**
     * Delete vectors for a file from its shard
     */
    deleteVectorsForFile(filePath: string): Promise<number>;
    /**
     * Get vectors for a file from its shard
     */
    getVectorsForFile(filePath: string): Promise<Vector[]>;
    /**
     * Track a file in its shard
     */
    trackFile(filePath: string, hash: string, language: string, chunksCount: number): Promise<void>;
    /**
     * Get file hash from its shard
     */
    getFileHash(filePath: string): Promise<string | null>;
    /**
     * Get combined stats from all shards
     */
    getStats(): Promise<IndexStats & {
        shardCount: number;
        shardStats: ShardInfo[];
    }>;
    /**
     * Clear all shards and meta-index
     */
    clear(): Promise<void>;
    /**
     * Dispose all resources
     */
    dispose(): Promise<void>;
    /**
     * Update shard centroids for better search routing
     *
     * Call this after indexing to improve search performance
     */
    updateCentroids(): Promise<void>;
    private ensureInitialized;
    /**
     * Rank shards by similarity to query (using centroids if available)
     *
     * Falls back to round-robin if no centroids
     */
    private rankShards;
    /**
     * Refresh shard info from actual stats
     */
    private refreshShardInfos;
    /**
     * Get the number of shards
     */
    get shardCountValue(): number;
}
//# sourceMappingURL=ShardedVectorStore.d.ts.map