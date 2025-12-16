/**
 * Chunker - Code-aware text splitting for semantic search
 *
 * Splits code into meaningful chunks while preserving:
 * - Function/class boundaries
 * - Line number information
 * - Language context
 */
import type { ChunkerOptions, Chunk, Chunker as IChunker } from './types.js';
export declare class Chunker implements IChunker {
    private maxChunkSize;
    private overlapSize;
    private respectBoundaries;
    constructor(options?: ChunkerOptions);
    /**
     * Chunk code into semantic units
     */
    chunk(code: string, filePath?: string): Chunk[];
    /**
     * Detect language from file path and content
     */
    detectLanguage(filePath: string, content?: string): string;
    /**
     * Chunk by code structure (functions, classes, etc.)
     */
    private chunkByStructure;
    /**
     * Chunk by sliding window with overlap
     */
    private chunkBySlidingWindow;
    /**
     * Split a large chunk into smaller pieces
     */
    private splitLargeChunk;
    /**
     * Extract function/class name from code
     */
    private extractFunctionName;
    /**
     * Check if content is primarily a docstring/comment
     */
    private isDocstring;
    /**
     * Get overlap text from end of chunk
     */
    private getOverlapLines;
    /**
     * Convert character index to line number
     */
    private indexToLineNumber;
}
//# sourceMappingURL=Chunker.d.ts.map