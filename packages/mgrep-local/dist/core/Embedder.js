/**
 * Embedder - Generates vector embeddings using @xenova/transformers
 *
 * Uses the all-MiniLM-L6-v2 model by default:
 * - 384-dimensional embeddings
 * - ~90MB model size
 * - Fast inference (~10ms per text on CPU)
 */
import { pipeline, env } from '@xenova/transformers';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync } from 'fs';
// Default model configuration
const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_CACHE_DIR = join(homedir(), '.cache', 'mgrep-local', 'models');
const MODEL_DIMENSIONS = 384;
const MAX_TOKENS = 256; // Model's max sequence length
export class Embedder {
    modelName;
    cacheDir;
    verbose;
    onProgress;
    pipeline = null;
    initPromise = null;
    initialized = false;
    constructor(options = {}) {
        this.modelName = options.modelName ?? DEFAULT_MODEL;
        this.cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
        this.verbose = options.verbose ?? false;
        this.onProgress = options.onProgress;
        // Configure transformers.js cache directory
        env.cacheDir = this.cacheDir;
        env.allowLocalModels = true;
        env.allowRemoteModels = true;
        // Ensure cache directory exists
        if (!existsSync(this.cacheDir)) {
            mkdirSync(this.cacheDir, { recursive: true });
        }
    }
    /**
     * Initialize the embedding model (lazy loading)
     * Safe to call multiple times - will only load once
     */
    async initialize() {
        if (this.initialized) {
            return;
        }
        // Prevent concurrent initialization
        if (this.initPromise) {
            return this.initPromise;
        }
        this.initPromise = this.loadModel();
        await this.initPromise;
        this.initialized = true;
    }
    async loadModel() {
        this.log('Loading embedding model:', this.modelName);
        this.onProgress?.({
            status: 'loading',
            progress: 0,
        });
        try {
            // Create the feature extraction pipeline
            this.pipeline = await pipeline('feature-extraction', this.modelName, {
                progress_callback: (progress) => {
                    if (progress.status === 'downloading') {
                        this.onProgress?.({
                            status: 'downloading',
                            progress: progress.progress,
                            file: progress.file,
                        });
                    }
                },
            });
            this.onProgress?.({
                status: 'ready',
                progress: 100,
            });
            this.log('Model loaded successfully');
        }
        catch (error) {
            this.log('Failed to load model:', error);
            throw new Error(`Failed to load embedding model: ${error}`);
        }
    }
    /**
     * Generate embedding for a single text
     */
    async embed(text) {
        await this.initialize();
        if (!this.pipeline) {
            throw new Error('Embedder not initialized');
        }
        // Truncate text if too long (simple character-based truncation)
        const truncatedText = this.truncateText(text);
        const result = await this.pipeline(truncatedText, {
            pooling: 'mean',
            normalize: true,
        });
        // Convert to regular array
        return Array.from(result.data);
    }
    /**
     * Generate embeddings for multiple texts efficiently
     */
    async embedBatch(texts) {
        await this.initialize();
        if (!this.pipeline) {
            throw new Error('Embedder not initialized');
        }
        if (texts.length === 0) {
            return [];
        }
        // Truncate all texts
        const truncatedTexts = texts.map((t) => this.truncateText(t));
        const results = [];
        // Process in smaller batches to avoid memory issues
        const batchSize = 32;
        for (let i = 0; i < truncatedTexts.length; i += batchSize) {
            const batch = truncatedTexts.slice(i, i + batchSize);
            // Process each text in the batch
            // Note: transformers.js doesn't support true batching yet,
            // so we process sequentially but this is still faster due to
            // model being cached in memory
            for (const text of batch) {
                const result = await this.pipeline(text, {
                    pooling: 'mean',
                    normalize: true,
                });
                results.push(Array.from(result.data));
            }
        }
        return results;
    }
    /**
     * Get model information
     */
    getModelInfo() {
        return {
            name: this.modelName,
            dimensions: MODEL_DIMENSIONS,
            maxTokens: MAX_TOKENS,
        };
    }
    /**
     * Clean up resources
     */
    async dispose() {
        this.pipeline = null;
        this.initialized = false;
        this.initPromise = null;
        this.log('Embedder disposed');
    }
    /**
     * Truncate text to fit within model's token limit
     * Uses a simple character-based approach (roughly 4 chars per token)
     */
    truncateText(text) {
        const maxChars = MAX_TOKENS * 4; // Rough estimate
        if (text.length <= maxChars) {
            return text;
        }
        return text.substring(0, maxChars);
    }
    log(...args) {
        if (this.verbose) {
            console.log('[Embedder]', ...args);
        }
    }
}
//# sourceMappingURL=Embedder.js.map