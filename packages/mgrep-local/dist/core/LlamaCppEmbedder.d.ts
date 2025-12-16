/**
 * LlamaCppEmbedder - GPU-accelerated embeddings using node-llama-cpp
 *
 * Uses Metal GPU on Apple Silicon for fast embedding generation.
 * Pure TypeScript - no Python or external servers required.
 *
 * Supported models:
 * - bge-small-en-v1.5 (384 dims, ~130MB) - Fast, good quality
 * - bge-base-en-v1.5 (768 dims, ~420MB) - Balanced
 * - bge-large-en-v1.5 (1024 dims, ~1.3GB) - Best quality
 * - nomic-embed-text-v1.5 (768 dims, ~270MB) - Great for code
 *
 * Usage:
 *   const embedder = new LlamaCppEmbedder({ modelPath: 'path/to/model.gguf' })
 *   await embedder.initialize()
 *   const embedding = await embedder.embed('hello world')
 */
import type { EmbedderOptions, ModelInfo, Embedder as IEmbedder } from './types.js';
export declare const EMBEDDING_MODELS: {
    readonly 'bge-small-en-v1.5': {
        readonly url: "https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf";
        readonly filename: "bge-small-en-v1.5-q8_0.gguf";
        readonly dimensions: 384;
        readonly size: "130MB";
    };
    readonly 'bge-base-en-v1.5': {
        readonly url: "https://huggingface.co/CompendiumLabs/bge-base-en-v1.5-gguf/resolve/main/bge-base-en-v1.5-q8_0.gguf";
        readonly filename: "bge-base-en-v1.5-q8_0.gguf";
        readonly dimensions: 768;
        readonly size: "420MB";
    };
    readonly 'nomic-embed-text-v1.5': {
        readonly url: "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf";
        readonly filename: "nomic-embed-text-v1.5.Q8_0.gguf";
        readonly dimensions: 768;
        readonly size: "270MB";
    };
};
export type EmbeddingModelName = keyof typeof EMBEDDING_MODELS;
export interface LlamaCppEmbedderOptions extends EmbedderOptions {
    modelPath?: string;
    modelName?: EmbeddingModelName;
    cacheDir?: string;
    gpuLayers?: number;
}
export declare class LlamaCppEmbedder implements IEmbedder {
    private modelPath?;
    private modelName;
    private cacheDir;
    private gpuLayers?;
    private verbose;
    private onProgress?;
    private llama?;
    private model?;
    private context?;
    private initialized;
    constructor(options?: LlamaCppEmbedderOptions);
    /**
     * Initialize the embedder - loads model into GPU memory
     */
    initialize(): Promise<void>;
    /**
     * Generate embedding for a single text
     */
    embed(text: string): Promise<number[]>;
    /**
     * Generate embeddings for multiple texts
     */
    embedBatch(texts: string[]): Promise<number[][]>;
    /**
     * Get model information
     */
    getModelInfo(): ModelInfo;
    /**
     * Check if embedder is ready
     */
    isAvailable(): boolean;
    /**
     * Clean up resources
     */
    dispose(): Promise<void>;
    private getModelPath;
    private downloadModel;
    private log;
}
/**
 * Check if GPU is available for llama.cpp
 */
export declare function checkGpuAvailable(): Promise<{
    available: boolean;
    type: string;
}>;
/**
 * List available embedding models
 */
export declare function listEmbeddingModels(): Array<{
    name: string;
    dimensions: number;
    size: string;
}>;
//# sourceMappingURL=LlamaCppEmbedder.d.ts.map