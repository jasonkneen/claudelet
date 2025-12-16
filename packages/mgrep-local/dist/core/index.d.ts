/**
 * Core library exports for mgrep-local
 *
 * This module provides the pure library functionality
 * with no Electron or MCP dependencies.
 */
export { Embedder } from './Embedder.js';
export { VectorStore } from './VectorStore.js';
export { Chunker } from './Chunker.js';
export { Indexer } from './Indexer.js';
export { Searcher } from './Searcher.js';
export { MlxEmbedder, checkMlxServer } from './MlxEmbedder.js';
export { LlamaCppEmbedder, checkGpuAvailable, listEmbeddingModels, EMBEDDING_MODELS } from './LlamaCppEmbedder.js';
export { createEmbedder, createEmbedderWithBackend, type EmbedderBackend, type GpuEmbedderOptions } from './embedder-factory.js';
export { OpenAIEmbedder, checkOpenAIAvailable, type OpenAIEmbeddingModel, type OpenAIEmbedderOptions } from './OpenAIEmbedder.js';
export { ShardedVectorStore } from './ShardedVectorStore.js';
export { ShardedIndexer } from './ShardedIndexer.js';
export { ShardedSearcher } from './ShardedSearcher.js';
export type { Vector, VectorInsertOptions, Chunk, ChunkMetadata, SearchResult, SearchOptions, IndexStats, IndexProgress, IndexProgressCallback, FileEventType, FileChangeEvent, EmbedderOptions, MlxEmbedderOptions, MlxModelSize, EmbedderFactoryOptions, ModelDownloadProgress, ModelInfo, VectorStoreOptions, ChunkerOptions, IndexerOptions, SearcherOptions, MgrepLocalServiceOptions, ServiceStatus, } from './types.js';
export type { LlamaCppEmbedderOptions, EmbeddingModelName } from './LlamaCppEmbedder.js';
export type { ShardInfo, ShardedSearchResult, ShardedVectorStoreOptions, ProgressiveSearchCallback, } from './ShardedVectorStore.js';
export type { ShardedIndexerOptions, FileToIndex, IndexBatchResult, ShardedIndexProgress, } from './ShardedIndexer.js';
export type { ShardedSearchOptions, SearchStats, } from './ShardedSearcher.js';
//# sourceMappingURL=index.d.ts.map