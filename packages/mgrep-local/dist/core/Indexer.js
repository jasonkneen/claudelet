/**
 * Indexer - Orchestrates the file → chunks → embeddings → store pipeline
 *
 * Features:
 * - Incremental indexing (only re-index changed files)
 * - Batch embedding for efficiency
 * - Progress reporting
 */
import { createHash } from 'crypto';
import { Chunker } from './Chunker.js';
// Default batch size for embedding
const DEFAULT_BATCH_SIZE = 32;
export class Indexer {
    embedder;
    vectorStore;
    chunker;
    batchSize;
    progressCallback;
    constructor(options) {
        this.embedder = options.embedder;
        this.vectorStore = options.vectorStore;
        this.chunker = options.chunker ?? new Chunker();
        this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
        this.progressCallback = options.progressCallback;
    }
    /**
     * Index a single file
     * Returns the number of chunks created
     */
    async indexFile(filePath, content) {
        // Check if file needs re-indexing
        const contentHash = this.hashContent(content);
        const existingHash = await this.vectorStore.getFileHash(filePath);
        if (existingHash === contentHash) {
            // File hasn't changed, skip
            return 0;
        }
        // Delete existing vectors for this file
        await this.vectorStore.deleteVectorsForFile(filePath);
        // Chunk the content
        const chunks = this.chunker.chunk(content, filePath);
        if (chunks.length === 0) {
            return 0;
        }
        // Generate embeddings in batches
        const embeddings = await this.embedBatched(chunks.map((c) => c.content));
        // Prepare insert options
        const insertOptions = chunks.map((chunk, index) => ({
            filePath,
            chunkIndex: index,
            content: chunk.content,
            embedding: embeddings[index],
            metadata: chunk.metadata,
        }));
        // Insert all vectors
        await this.vectorStore.insertBatch(insertOptions);
        // Track the file
        await this.vectorStore.trackFile(filePath, contentHash, chunks[0]?.metadata.language ?? 'unknown', chunks.length);
        return chunks.length;
    }
    /**
     * Update a file (same as indexFile, but named for clarity)
     */
    async updateFile(filePath, content) {
        return this.indexFile(filePath, content);
    }
    /**
     * Delete a file from the index
     */
    async deleteFile(filePath) {
        await this.vectorStore.deleteVectorsForFile(filePath);
    }
    /**
     * Index multiple files with progress reporting
     */
    async indexFiles(files) {
        let totalChunks = 0;
        let filesProcessed = 0;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            this.reportProgress({
                phase: 'chunking',
                current: i + 1,
                total: files.length,
                currentFile: file.filePath,
            });
            const chunks = await this.indexFile(file.filePath, file.content);
            totalChunks += chunks;
            if (chunks > 0) {
                filesProcessed++;
            }
        }
        return { totalChunks, filesProcessed };
    }
    /**
     * Get current index statistics
     */
    async getStats() {
        return this.vectorStore.getStats();
    }
    /**
     * Clear the entire index
     */
    async clear() {
        await this.vectorStore.clear();
    }
    /**
     * Embed texts in batches for efficiency
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
     * Hash file content for change detection
     */
    hashContent(content) {
        return createHash('sha256').update(content).digest('hex').substring(0, 16);
    }
    /**
     * Report indexing progress
     */
    reportProgress(progress) {
        if (this.progressCallback) {
            this.progressCallback(progress);
        }
    }
}
//# sourceMappingURL=Indexer.js.map