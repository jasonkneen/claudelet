/**
 * MCP Server for mgrep-local
 *
 * Provides semantic search and indexing capabilities via the Model Context Protocol.
 * Can be used standalone with Claude Code or other MCP-compatible tools.
 */
import type { McpServerConfig } from './types.js';
export declare class MgrepMcpServer {
    private server;
    private config;
    private embedder;
    private vectorStore;
    private chunker;
    private indexer;
    private searcher;
    private ready;
    constructor(config?: McpServerConfig);
    /**
     * Set up MCP request handlers
     */
    private setupHandlers;
    /**
     * Initialize the search infrastructure
     */
    initialize(): Promise<void>;
    /**
     * Handle semantic_search tool call
     */
    private handleSemanticSearch;
    /**
     * Handle index_status tool call
     */
    private handleIndexStatus;
    /**
     * Handle index_directory tool call
     */
    private handleIndexDirectory;
    /**
     * Handle index_file tool call
     */
    private handleIndexFile;
    /**
     * Handle clear_index tool call
     */
    private handleClearIndex;
    /**
     * Start the MCP server
     */
    run(): Promise<void>;
    /**
     * Clean up resources
     */
    dispose(): Promise<void>;
    private ensureReady;
    /**
     * Discover all code files in a directory
     */
    private discoverFiles;
    private formatBytes;
    private log;
}
//# sourceMappingURL=server.d.ts.map