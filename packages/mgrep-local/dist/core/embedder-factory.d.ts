/**
 * Embedder Factory - Auto-selects the best available embedding backend
 *
 * Priority order:
 * 1. OpenAI (if API key available and preferred)
 * 2. LlamaCpp GPU (pure TypeScript, Metal on Apple Silicon)
 * 3. MLX GPU (requires Python server)
 * 4. Xenova/transformers CPU (fallback)
 *
 * Usage:
 *   const embedder = await createEmbedder({ verbose: true })
 *   // Automatically uses best available backend
 */
import { type EmbeddingModelName } from './LlamaCppEmbedder.js';
import { type OpenAIEmbeddingModel } from './OpenAIEmbedder.js';
import type { EmbedderFactoryOptions, Embedder as IEmbedder } from './types.js';
export type EmbedderBackend = 'auto' | 'llamacpp' | 'mlx' | 'cpu' | 'openai';
/**
 * Extended factory options with GPU backend selection
 */
export interface GpuEmbedderOptions extends EmbedderFactoryOptions {
    backend?: EmbedderBackend;
    llamaModel?: EmbeddingModelName;
    gpuLayers?: number;
    openaiApiKey?: string;
    openaiModel?: OpenAIEmbeddingModel;
    openaiConcurrency?: number;
    openaiDimensions?: number;
}
/**
 * Create the best available embedder
 *
 * @param options - Configuration options
 * @returns Initialized embedder (OpenAI > LlamaCpp GPU > MLX GPU > CPU)
 */
export declare function createEmbedder(options?: GpuEmbedderOptions): Promise<IEmbedder>;
/**
 * Create embedder with explicit backend choice (legacy API)
 */
export declare function createEmbedderWithBackend(backend: 'llamacpp' | 'mlx' | 'cpu' | 'openai', options?: GpuEmbedderOptions): Promise<IEmbedder>;
export type { EmbedderFactoryOptions };
//# sourceMappingURL=embedder-factory.d.ts.map