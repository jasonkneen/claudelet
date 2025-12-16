/**
 * Embedder - Generates vector embeddings using @xenova/transformers
 *
 * Uses the all-MiniLM-L6-v2 model by default:
 * - 384-dimensional embeddings
 * - ~90MB model size
 * - Fast inference (~10ms per text on CPU)
 */
import type { EmbedderOptions, ModelInfo, Embedder as IEmbedder } from './types.js';
export declare class Embedder implements IEmbedder {
    private modelName;
    private cacheDir;
    private verbose;
    private onProgress?;
    private pipeline;
    private initPromise;
    private initialized;
    constructor(options?: EmbedderOptions);
    /**
     * Initialize the embedding model (lazy loading)
     * Safe to call multiple times - will only load once
     */
    initialize(): Promise<void>;
    private loadModel;
    /**
     * Generate embedding for a single text
     */
    embed(text: string): Promise<number[]>;
    /**
     * Generate embeddings for multiple texts efficiently
     */
    embedBatch(texts: string[]): Promise<number[][]>;
    /**
     * Get model information
     */
    getModelInfo(): ModelInfo;
    /**
     * Clean up resources
     */
    dispose(): Promise<void>;
    /**
     * Truncate text to fit within model's token limit
     * Uses a simple character-based approach (roughly 4 chars per token)
     */
    private truncateText;
    private log;
}
//# sourceMappingURL=Embedder.d.ts.map