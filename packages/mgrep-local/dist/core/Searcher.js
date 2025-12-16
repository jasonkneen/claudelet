/**
 * Searcher - Semantic search with optional hybrid keyword boosting
 *
 * Provides:
 * - Pure vector search (semantic similarity)
 * - Hybrid search (vector + keyword boost)
 * - Context extraction and highlighting
 */
// Default search options
const DEFAULT_LIMIT = 10;
const DEFAULT_THRESHOLD = 0.3;
const DEFAULT_CONTEXT_LINES = 3;
const KEYWORD_BOOST_FACTOR = 0.1;
export class Searcher {
    embedder;
    vectorStore;
    constructor(embedder, vectorStore) {
        this.embedder = embedder;
        this.vectorStore = vectorStore;
    }
    /**
     * Pure semantic search
     */
    async search(query, options = {}) {
        const limit = options.limit ?? DEFAULT_LIMIT;
        const threshold = options.threshold ?? DEFAULT_THRESHOLD;
        // Generate query embedding
        const queryEmbedding = await this.embedder.embed(query);
        // Search vector store
        const results = await this.vectorStore.search(queryEmbedding, limit, threshold);
        // Add context highlighting if requested
        if (options.returnContext) {
            return results.map((result) => ({
                ...result,
                highlight: this.createHighlight(result.content, query, options.contextLines),
            }));
        }
        return results;
    }
    /**
     * Hybrid search: vector similarity + keyword matching boost
     *
     * This improves precision by boosting results that also contain
     * query keywords, without sacrificing semantic understanding.
     */
    async hybridSearch(query, options = {}) {
        const limit = options.limit ?? DEFAULT_LIMIT;
        const threshold = options.threshold ?? DEFAULT_THRESHOLD;
        // Get semantic results (fetch more than needed for re-ranking)
        const queryEmbedding = await this.embedder.embed(query);
        const results = await this.vectorStore.search(queryEmbedding, limit * 2, threshold * 0.8);
        // Extract keywords from query
        const keywords = this.extractKeywords(query);
        // Boost scores based on keyword matches
        const boostedResults = results.map((result) => {
            const keywordMatches = this.countKeywordMatches(result.content, keywords);
            const boost = keywordMatches * KEYWORD_BOOST_FACTOR;
            return {
                ...result,
                similarity: Math.min(1, result.similarity + boost),
            };
        });
        // Re-sort by boosted score
        boostedResults.sort((a, b) => b.similarity - a.similarity);
        // Take top results
        const topResults = boostedResults.slice(0, limit);
        // Add highlighting if requested
        if (options.returnContext) {
            return topResults.map((result) => ({
                ...result,
                highlight: this.createHighlight(result.content, query, options.contextLines),
            }));
        }
        return topResults;
    }
    /**
     * Extract meaningful keywords from query
     */
    extractKeywords(query) {
        // Split on whitespace and punctuation
        const words = query.toLowerCase().split(/[\s\-_.,;:!?()[\]{}'"]+/);
        // Filter out common stop words and short words
        const stopWords = new Set([
            'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
            'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
            'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that',
            'these', 'those', 'it', 'its', 'my', 'your', 'his', 'her', 'our',
            'their', 'what', 'which', 'who', 'whom', 'where', 'when', 'why', 'how',
            'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
            'such', 'no', 'not', 'only', 'same', 'so', 'than', 'too', 'very',
            'just', 'also', 'now', 'here', 'there', 'then', 'if', 'else',
        ]);
        return words.filter((word) => word.length >= 2 && !stopWords.has(word));
    }
    /**
     * Count how many keywords appear in content
     */
    countKeywordMatches(content, keywords) {
        const lowerContent = content.toLowerCase();
        let matches = 0;
        for (const keyword of keywords) {
            if (lowerContent.includes(keyword)) {
                matches++;
            }
        }
        return matches;
    }
    /**
     * Create a highlighted context snippet
     */
    createHighlight(content, query, contextLines = DEFAULT_CONTEXT_LINES) {
        const keywords = this.extractKeywords(query);
        const lines = content.split('\n');
        // Find lines containing keywords
        const matchingLineIndices = [];
        for (let i = 0; i < lines.length; i++) {
            const lowerLine = lines[i].toLowerCase();
            if (keywords.some((kw) => lowerLine.includes(kw))) {
                matchingLineIndices.push(i);
            }
        }
        if (matchingLineIndices.length === 0) {
            // No keyword matches, return first few lines
            return lines.slice(0, contextLines * 2 + 1).join('\n');
        }
        // Get context around first match
        const firstMatch = matchingLineIndices[0];
        const startLine = Math.max(0, firstMatch - contextLines);
        const endLine = Math.min(lines.length - 1, firstMatch + contextLines);
        const contextSnippet = lines.slice(startLine, endLine + 1).join('\n');
        // Highlight keywords in the snippet
        let highlighted = contextSnippet;
        for (const keyword of keywords) {
            const regex = new RegExp(`(${this.escapeRegex(keyword)})`, 'gi');
            highlighted = highlighted.replace(regex, '**$1**');
        }
        return highlighted;
    }
    /**
     * Escape special regex characters
     */
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
//# sourceMappingURL=Searcher.js.map