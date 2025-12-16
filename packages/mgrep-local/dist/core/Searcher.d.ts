/**
 * Searcher - Semantic search with optional hybrid keyword boosting
 *
 * Provides:
 * - Pure vector search (semantic similarity)
 * - Hybrid search (vector + keyword boost)
 * - Context extraction and highlighting
 */
import type { SearchOptions, SearchResult, Searcher as ISearcher } from './types.js';
import { Embedder } from './Embedder.js';
import { VectorStore } from './VectorStore.js';
export declare class Searcher implements ISearcher {
    private embedder;
    private vectorStore;
    constructor(embedder: Embedder, vectorStore: VectorStore);
    /**
     * Pure semantic search
     */
    search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
    /**
     * Hybrid search: vector similarity + keyword matching boost
     *
     * This improves precision by boosting results that also contain
     * query keywords, without sacrificing semantic understanding.
     */
    hybridSearch(query: string, options?: SearchOptions): Promise<SearchResult[]>;
    /**
     * Extract meaningful keywords from query
     */
    private extractKeywords;
    /**
     * Count how many keywords appear in content
     */
    private countKeywordMatches;
    /**
     * Create a highlighted context snippet
     */
    private createHighlight;
    /**
     * Escape special regex characters
     */
    private escapeRegex;
}
//# sourceMappingURL=Searcher.d.ts.map