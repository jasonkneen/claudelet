/**
 * Core types for mgrep-local semantic code search
 */
/**
 * Metadata associated with a code chunk
 */
export interface ChunkMetadata {
    startLine: number;
    endLine: number;
    language: string;
    functionName?: string;
    classScope?: string;
    isDocstring?: boolean;
}
/**
 * A chunk of code before embedding
 */
export interface Chunk {
    content: string;
    metadata: ChunkMetadata;
}
/**
 * A vector stored in the database with its embedding
 */
export interface Vector {
    id: string;
    filePath: string;
    chunkIndex: number;
    content: string;
    embedding: number[];
    metadata: ChunkMetadata;
}
/**
 * Options for vector insertion
 */
export interface VectorInsertOptions {
    filePath: string;
    chunkIndex: number;
    content: string;
    embedding: number[];
    metadata: ChunkMetadata;
}
/**
 * A single search result with similarity score
 */
export interface SearchResult {
    filePath: string;
    chunkIndex: number;
    content: string;
    similarity: number;
    metadata: ChunkMetadata;
    highlight?: string;
}
/**
 * Options for search queries
 */
export interface SearchOptions {
    limit?: number;
    threshold?: number;
    returnContext?: boolean;
    contextLines?: number;
}
/**
 * Statistics about the current index
 */
export interface IndexStats {
    totalFiles: number;
    totalChunks: number;
    totalEmbeddings: number;
    databaseSize: number;
    lastIndexedAt: Date | null;
}
/**
 * Progress update during indexing operations
 */
export interface IndexProgress {
    phase: 'scanning' | 'chunking' | 'embedding' | 'storing';
    current: number;
    total: number;
    currentFile?: string;
}
/**
 * Callback for index progress updates
 */
export type IndexProgressCallback = (progress: IndexProgress) => void;
/**
 * Event types for file changes
 */
export type FileEventType = 'added' | 'modified' | 'deleted';
/**
 * File change event pushed by the host application
 */
export interface FileChangeEvent {
    filePath: string;
    eventType: FileEventType;
    timestamp: number;
    content?: string;
}
/**
 * Options for the Embedder class
 */
export interface EmbedderOptions {
    modelName?: string;
    cacheDir?: string;
    verbose?: boolean;
    onProgress?: (progress: ModelDownloadProgress) => void;
}
/**
 * MLX model sizes available
 */
export type MlxModelSize = '0.6B' | '4B' | '8B';
/**
 * Options for MLX GPU-accelerated embedder
 */
export interface MlxEmbedderOptions extends EmbedderOptions {
    serverUrl?: string;
    modelSize?: MlxModelSize;
    timeout?: number;
}
/**
 * OpenAI embedding models
 */
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
/**
 * Options for embedder factory (auto-selects best available)
 */
export interface EmbedderFactoryOptions extends EmbedderOptions {
    preferMlx?: boolean;
    mlxServerUrl?: string;
    mlxModelSize?: MlxModelSize;
}
/**
 * Progress during model download
 */
export interface ModelDownloadProgress {
    status: 'downloading' | 'loading' | 'ready';
    progress?: number;
    file?: string;
}
/**
 * Model information
 */
export interface ModelInfo {
    name: string;
    dimensions: number;
    maxTokens: number;
}
/**
 * Options for the VectorStore class
 */
export interface VectorStoreOptions {
    dbPath?: string;
    readonly?: boolean;
}
/**
 * Options for the Chunker class
 */
export interface ChunkerOptions {
    maxChunkSize?: number;
    overlapSize?: number;
    respectBoundaries?: boolean;
}
/**
 * Options for the Indexer class
 */
export interface IndexerOptions {
    embedder: Embedder;
    vectorStore: VectorStore;
    chunker?: Chunker;
    batchSize?: number;
    progressCallback?: IndexProgressCallback;
}
/**
 * Options for the Searcher class
 */
export interface SearcherOptions {
    embedder: Embedder;
    vectorStore: VectorStore;
}
/**
 * Options for MgrepLocalService
 */
export interface MgrepLocalServiceOptions {
    workspaceDir: string;
    dbPath?: string;
    modelCacheDir?: string;
    autoIndex?: boolean;
}
/**
 * Service status
 */
export interface ServiceStatus {
    ready: boolean;
    indexing: boolean;
    stats: IndexStats | null;
    error?: string;
}
export interface Embedder {
    initialize(): Promise<void>;
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    getModelInfo(): ModelInfo;
    dispose(): Promise<void>;
}
export interface VectorStore {
    initialize(): Promise<void>;
    insert(options: VectorInsertOptions): Promise<string>;
    insertBatch(options: VectorInsertOptions[]): Promise<string[]>;
    search(embedding: number[], limit?: number, threshold?: number): Promise<SearchResult[]>;
    getVectorsForFile(filePath: string): Promise<Vector[]>;
    deleteVectorsForFile(filePath: string): Promise<number>;
    getStats(): Promise<IndexStats>;
    clear(): Promise<void>;
    dispose(): Promise<void>;
}
export interface Chunker {
    chunk(code: string, filePath?: string): Chunk[];
    detectLanguage(filePath: string, content?: string): string;
}
export interface Indexer {
    indexFile(filePath: string, content: string): Promise<number>;
    updateFile(filePath: string, content: string): Promise<number>;
    deleteFile(filePath: string): Promise<void>;
    getStats(): Promise<IndexStats>;
}
export interface Searcher {
    search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
    hybridSearch(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}
//# sourceMappingURL=types.d.ts.map