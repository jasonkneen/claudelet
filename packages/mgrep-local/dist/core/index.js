/**
 * Core library exports for mgrep-local
 *
 * This module provides the pure library functionality
 * with no Electron or MCP dependencies.
 */
// Classes - Standard (single database)
export { Embedder } from './Embedder.js';
export { VectorStore } from './VectorStore.js';
export { Chunker } from './Chunker.js';
export { Indexer } from './Indexer.js';
export { Searcher } from './Searcher.js';
// Classes - GPU Acceleration
export { MlxEmbedder, checkMlxServer } from './MlxEmbedder.js';
export { LlamaCppEmbedder, checkGpuAvailable, listEmbeddingModels, EMBEDDING_MODELS } from './LlamaCppEmbedder.js';
export { createEmbedder, createEmbedderWithBackend } from './embedder-factory.js';
// Classes - OpenAI API Embeddings
export { OpenAIEmbedder, checkOpenAIAvailable } from './OpenAIEmbedder.js';
// Classes - Sharded (multiple databases with meta-index)
export { ShardedVectorStore } from './ShardedVectorStore.js';
export { ShardedIndexer } from './ShardedIndexer.js';
export { ShardedSearcher } from './ShardedSearcher.js';
//# sourceMappingURL=index.js.map