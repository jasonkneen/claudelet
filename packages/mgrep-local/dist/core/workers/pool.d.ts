/**
 * Worker Pool - Manages parallel worker threads for indexing and search
 */
export interface PoolOptions {
    workerCount?: number;
    verbose?: boolean;
}
export interface IndexWorkerData {
    shardDbPaths: {
        [shardId: string]: string;
    };
    files: Array<{
        shardId: number;
        filePath: string;
        content: string;
    }>;
    embedderOptions: {
        backend?: 'auto' | 'llamacpp' | 'mlx' | 'cpu' | 'openai';
        modelName?: string;
        cacheDir?: string;
        verbose?: boolean;
        openaiModel?: 'text-embedding-3-small' | 'text-embedding-3-large' | 'text-embedding-ada-002';
        openaiConcurrency?: number;
    };
    workerId: number;
}
export interface SearchWorkerData {
    shardDbPaths: {
        [shardId: string]: string;
    };
    queryEmbedding: number[];
    topK: number;
    minScore: number;
    workerId: number;
}
export interface IndexProgress {
    workerId: number;
    file: string;
    shardId: number;
    chunks: number;
}
export interface IndexResult {
    totalChunks: number;
    totalFiles: number;
    durationMs: number;
    workerResults: Array<{
        workerId: number;
        totalChunks: number;
        totalFiles: number;
        durationMs: number;
    }>;
}
export interface SearchResult {
    filePath: string;
    chunkIndex: number;
    content: string;
    score: number;
    shardId: number;
}
/**
 * Run parallel indexing across worker threads
 */
export declare function runParallelIndex(shardDbPaths: Map<number, string>, filesByShardId: Map<number, Array<{
    filePath: string;
    content: string;
}>>, embedderOptions: IndexWorkerData['embedderOptions'], options?: PoolOptions, onProgress?: (progress: IndexProgress) => void): Promise<IndexResult>;
/**
 * Run parallel search across worker threads
 */
export declare function runParallelSearch(shardDbPaths: Map<number, string>, queryEmbedding: number[], topK: number, minScore: number, options?: PoolOptions): Promise<SearchResult[]>;
//# sourceMappingURL=pool.d.ts.map