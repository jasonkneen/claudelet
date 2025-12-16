/**
 * ShardedSearcher - Progressive semantic search across shards
 *
 * Features:
 * - Meta-index routing (search centroids first)
 * - Progressive results (stream as shards complete)
 * - Parallel shard querying
 */
import { ShardedVectorStore, ShardedSearchResult } from './ShardedVectorStore.js';
import { Embedder } from './Embedder.js';
import type { SearchResult, SearchOptions } from './types.js';
/**
 * Extended search options for sharded search
 */
export interface ShardedSearchOptions extends SearchOptions {
    progressive?: boolean;
    parallelShards?: number;
    onProgress?: (results: ShardedSearchResult[], shardId: number, complete: boolean) => void;
}
/**
 * Search statistics
 */
export interface SearchStats {
    totalShards: number;
    shardsQueried: number;
    totalResults: number;
    durationMs: number;
    shardDurations: Map<number, number>;
}
export declare class ShardedSearcher {
    private embedder;
    private shardedStore;
    constructor(embedder: Embedder, shardedStore: ShardedVectorStore);
    /**
     * Basic semantic search across all shards
     */
    search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
    /**
     * Hybrid search (semantic + keyword) across shards
     */
    hybridSearch(query: string, options?: ShardedSearchOptions): Promise<SearchResult[]>;
    /**
     * Search with detailed stats
     */
    searchWithStats(query: string, options?: SearchOptions): Promise<{
        results: SearchResult[];
        stats: SearchStats;
    }>;
    /**
     * Find similar code to a given snippet
     */
    findSimilar(code: string, options?: SearchOptions): Promise<SearchResult[]>;
}
//# sourceMappingURL=ShardedSearcher.d.ts.map