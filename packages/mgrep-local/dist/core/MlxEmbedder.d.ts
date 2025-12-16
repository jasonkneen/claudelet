/**
 * MlxEmbedder - GPU-accelerated embeddings using MLX on Apple Silicon
 *
 * Connects to qwen3-embeddings-mlx REST server for fast embedding generation.
 * Supports Qwen3-Embedding models (0.6B, 4B, 8B variants)
 *
 * Performance comparison:
 * - CPU (all-MiniLM-L6-v2): ~1K tokens/sec
 * - MLX (Qwen3-0.6B): ~44K tokens/sec on M2 Max
 *
 * Usage:
 *   # Clone and install the MLX server first:
 *   git clone https://github.com/jakedahn/qwen3-embeddings-mlx.git
 *   cd qwen3-embeddings-mlx
 *   pip install -r requirements.txt
 *   python server.py
 *
 *   # Then use this embedder:
 *   const embedder = new MlxEmbedder({ serverUrl: 'http://localhost:8000' })
 */
import type { EmbedderOptions, ModelInfo, Embedder as IEmbedder } from './types.js';
declare const MLX_MODELS: {
    readonly '0.6B': {
        readonly dimensions: 1024;
        readonly maxTokens: 8192;
    };
    readonly '4B': {
        readonly dimensions: 2560;
        readonly maxTokens: 8192;
    };
    readonly '8B': {
        readonly dimensions: 3584;
        readonly maxTokens: 8192;
    };
};
type MlxModelSize = keyof typeof MLX_MODELS;
export interface MlxEmbedderOptions extends EmbedderOptions {
    serverUrl?: string;
    modelSize?: MlxModelSize;
    timeout?: number;
}
export declare class MlxEmbedder implements IEmbedder {
    private serverUrl;
    private modelSize;
    private timeout;
    private verbose;
    private onProgress?;
    private initialized;
    private serverAvailable;
    constructor(options?: MlxEmbedderOptions);
    /**
     * Initialize by checking if MLX server is available
     */
    initialize(): Promise<void>;
    /**
     * Generate embedding for a single text
     */
    embed(text: string): Promise<number[]>;
    /**
     * Generate embeddings for multiple texts efficiently
     * Uses /embed_batch endpoint for native batch processing
     */
    embedBatch(texts: string[]): Promise<number[][]>;
    /**
     * Get model information
     */
    getModelInfo(): ModelInfo;
    /**
     * Check if server is available
     */
    isAvailable(): boolean;
    /**
     * Clean up resources
     */
    dispose(): Promise<void>;
    private log;
}
/**
 * Check if MLX server is running
 */
export declare function checkMlxServer(serverUrl?: string): Promise<boolean>;
export {};
//# sourceMappingURL=MlxEmbedder.d.ts.map