/**
 * OpenAIEmbedder - Generate embeddings using OpenAI's API
 *
 * Features:
 * - Uses text-embedding-3-small (1536 dims) or text-embedding-3-large (3072 dims)
 * - Parallel API calls for high throughput
 * - Configurable concurrency and batch size
 * - Rate limiting support
 */
import type { EmbedderOptions, ModelInfo, Embedder as IEmbedder } from './types.js';
export type OpenAIEmbeddingModel = 'text-embedding-3-small' | 'text-embedding-3-large' | 'text-embedding-ada-002';
/**
 * Options for OpenAI embedder
 */
export interface OpenAIEmbedderOptions extends EmbedderOptions {
    apiKey?: string;
    model?: OpenAIEmbeddingModel;
    baseUrl?: string;
    batchSize?: number;
    concurrency?: number;
    retries?: number;
    dimensions?: number;
}
export declare class OpenAIEmbedder implements IEmbedder {
    private apiKey;
    private model;
    private baseUrl;
    private batchSize;
    private concurrency;
    private retries;
    private dimensions?;
    private verbose;
    private onProgress?;
    private initialized;
    private totalTokensUsed;
    constructor(options?: OpenAIEmbedderOptions);
    /**
     * Initialize (no-op for OpenAI, but maintains interface compatibility)
     */
    initialize(): Promise<void>;
    /**
     * Generate embedding for a single text
     */
    embed(text: string): Promise<number[]>;
    /**
     * Generate embeddings for multiple texts with parallel batching
     *
     * This is the high-performance path. It:
     * 1. Splits texts into batches of `batchSize`
     * 2. Runs up to `concurrency` batches in parallel
     * 3. Merges results preserving order
     */
    embedBatch(texts: string[]): Promise<number[][]>;
    /**
     * Get model information
     */
    getModelInfo(): ModelInfo;
    /**
     * Get usage statistics
     */
    getUsageStats(): {
        totalTokens: number;
    };
    /**
     * Clean up resources
     */
    dispose(): Promise<void>;
    /**
     * Call OpenAI API with retry logic
     */
    private callApiWithRetry;
    /**
     * Call OpenAI embeddings API
     */
    private callApi;
    /**
     * Truncate text to fit within token limit
     * Uses rough estimate of 4 characters per token
     */
    private truncateText;
    private sleep;
    private log;
}
/**
 * Check if OpenAI API key is available
 */
export declare function checkOpenAIAvailable(): boolean;
//# sourceMappingURL=OpenAIEmbedder.d.ts.map