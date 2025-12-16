/**
 * ShardedIndexer - Parallel indexing across multiple shards
 *
 * Features:
 * - Distributes files across shards by consistent hashing
 * - Parallel embedding generation using worker pool
 * - Progress tracking per shard
 */
import { cpus } from 'os';
import { createHash } from 'crypto';
import { Chunker } from './Chunker.js';
import { runParallelIndex } from './workers/pool.js';
export class ShardedIndexer {
    shardedStore;
    embedder;
    chunker;
    batchSize;
    workerCount;
    progressCallback;
    embedderConfig;
    parallel;
    constructor(options) {
        this.shardedStore = options.shardedStore;
        this.embedder = options.embedder;
        this.chunker = options.chunker ?? new Chunker();
        this.batchSize = options.batchSize ?? 32;
        this.workerCount = options.workerCount ?? Math.max(1, cpus().length - 1);
        this.progressCallback = options.progressCallback;
        this.embedderConfig = options.embedderConfig;
        this.parallel = options.parallel ?? true;
    }
    /**
     * Index a single file into its shard
     */
    async indexFile(filePath, content) {
        // Check if file needs re-indexing
        const contentHash = this.hashContent(content);
        const existingHash = await this.shardedStore.getFileHash(filePath);
        if (existingHash === contentHash) {
            return 0; // File unchanged
        }
        // Delete existing vectors
        await this.shardedStore.deleteVectorsForFile(filePath);
        // Chunk the content
        const chunks = this.chunker.chunk(content, filePath);
        if (chunks.length === 0) {
            return 0;
        }
        // Generate embeddings
        const embeddings = await this.embedBatched(chunks.map(c => c.content));
        // Prepare insert options
        const insertOptions = chunks.map((chunk, i) => ({
            filePath,
            chunkIndex: i,
            content: chunk.content,
            embedding: embeddings[i],
            metadata: chunk.metadata,
        }));
        // Insert into shard
        await this.shardedStore.insertBatch(insertOptions);
        // Track the file
        await this.shardedStore.trackFile(filePath, contentHash, chunks[0]?.metadata.language ?? 'unknown', chunks.length);
        return chunks.length;
    }
    /**
     * Delete a file from its shard
     */
    async deleteFile(filePath) {
        await this.shardedStore.deleteVectorsForFile(filePath);
    }
    /**
     * Index multiple files with parallel processing by shard
     *
     * Files are grouped by their target shard, then each shard's
     * files are processed in parallel batches.
     */
    async indexFiles(files) {
        // Group files by target shard
        const byShardId = new Map();
        for (const file of files) {
            const shardId = this.shardedStore.getShardId(file.filePath);
            const group = byShardId.get(shardId) ?? [];
            group.push(file);
            byShardId.set(shardId, group);
        }
        // Process each shard's files
        let totalChunks = 0;
        let filesProcessed = 0;
        const results = new Map();
        const shardCount = byShardId.size;
        let shardsComplete = 0;
        // Process shards (could be parallelized with worker threads)
        for (const [shardId, shardFiles] of byShardId) {
            const startTime = Date.now();
            let shardChunks = 0;
            let shardFilesProcessed = 0;
            let shardErrors = 0;
            for (let i = 0; i < shardFiles.length; i++) {
                const file = shardFiles[i];
                this.reportProgress({
                    phase: 'chunking',
                    current: i + 1,
                    total: shardFiles.length,
                    currentFile: file.filePath,
                    shardId,
                    shardsComplete,
                    totalShards: shardCount,
                });
                try {
                    const chunks = await this.indexFile(file.filePath, file.content);
                    if (chunks > 0) {
                        shardFilesProcessed++;
                        shardChunks += chunks;
                    }
                }
                catch (error) {
                    shardErrors++;
                }
            }
            const result = {
                shardId,
                filesIndexed: shardFilesProcessed,
                chunksCreated: shardChunks,
                errors: shardErrors,
                durationMs: Date.now() - startTime,
            };
            results.set(shardId, result);
            totalChunks += shardChunks;
            filesProcessed += shardFilesProcessed;
            shardsComplete++;
        }
        // Update centroids after indexing
        await this.shardedStore.updateCentroids();
        return { totalChunks, filesProcessed, byShardId: results };
    }
    /**
     * Index files in parallel using worker threads
     *
     * This is the high-performance path for large codebases.
     * Each worker handles a subset of shards with its own embedder.
     */
    async indexFilesParallel(files) {
        const startTime = Date.now();
        // If parallel is disabled or no embedder config, fall back to sequential
        // Disable parallel for GPU mode (auto/llamacpp) as Metal can't handle
        // multiple concurrent model loads - workers crash with trace trap
        // BUT allow parallel for OpenAI (API-based, no GPU contention) and other backends
        const isLocalGpuMode = this.embedderConfig?.backend === 'auto' ||
            this.embedderConfig?.backend === 'llamacpp';
        const isParallelSafe = this.embedderConfig?.backend === 'openai' ||
            this.embedderConfig?.backend === 'mlx' ||
            this.embedderConfig?.backend === 'cpu';
        if (!this.parallel || !this.embedderConfig || (isLocalGpuMode && !isParallelSafe)) {
            const result = await this.indexFiles(files);
            return {
                totalChunks: result.totalChunks,
                filesProcessed: result.filesProcessed,
                durationMs: Date.now() - startTime,
            };
        }
        // Group files by shard
        const filesByShardId = new Map();
        for (const file of files) {
            const shardId = this.shardedStore.getShardId(file.filePath);
            const group = filesByShardId.get(shardId) ?? [];
            group.push({ filePath: file.filePath, content: file.content });
            filesByShardId.set(shardId, group);
        }
        // Get shard DB paths
        const shardDbPaths = this.shardedStore.getShardPaths();
        // Run parallel indexing
        const result = await runParallelIndex(shardDbPaths, filesByShardId, this.embedderConfig, { workerCount: this.workerCount, verbose: this.embedderConfig.verbose }, (progress) => {
            this.reportProgress({
                phase: 'chunking',
                current: progress.chunks,
                total: files.length,
                currentFile: progress.file,
                shardId: progress.shardId,
            });
        });
        // Update centroids after indexing
        await this.shardedStore.updateCentroids();
        return {
            totalChunks: result.totalChunks,
            filesProcessed: result.totalFiles,
            durationMs: result.durationMs,
        };
    }
    /**
     * Get stats from the sharded store
     */
    async getStats() {
        return this.shardedStore.getStats();
    }
    /**
     * Clear all shards
     */
    async clear() {
        await this.shardedStore.clear();
    }
    // ==========================================================================
    // Private helpers
    // ==========================================================================
    /**
     * Generate embeddings in batches
     */
    async embedBatched(texts) {
        const allEmbeddings = [];
        for (let i = 0; i < texts.length; i += this.batchSize) {
            const batch = texts.slice(i, i + this.batchSize);
            this.reportProgress({
                phase: 'embedding',
                current: Math.min(i + this.batchSize, texts.length),
                total: texts.length,
            });
            const embeddings = await this.embedder.embedBatch(batch);
            allEmbeddings.push(...embeddings);
        }
        return allEmbeddings;
    }
    /**
     * Hash content for change detection
     */
    hashContent(content) {
        return createHash('sha256').update(content).digest('hex').substring(0, 16);
    }
    /**
     * Report progress
     */
    reportProgress(progress) {
        if (this.progressCallback) {
            this.progressCallback(progress);
        }
    }
}
//# sourceMappingURL=ShardedIndexer.js.map