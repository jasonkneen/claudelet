/**
 * MCP Tool Definitions for mgrep-local
 *
 * Defines the tools exposed by the MCP server.
 */
/**
 * Tool definition type (matches MCP SDK)
 */
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, {
            type: string;
            description: string;
            default?: unknown;
        }>;
        required?: string[];
    };
}
/**
 * Semantic search tool - search codebase by meaning
 */
export declare const SEMANTIC_SEARCH_TOOL: ToolDefinition;
/**
 * Index status tool - get indexing statistics
 */
export declare const INDEX_STATUS_TOOL: ToolDefinition;
/**
 * Index directory tool - index all code files in a directory
 */
export declare const INDEX_DIRECTORY_TOOL: ToolDefinition;
/**
 * Index file tool - index a single file
 */
export declare const INDEX_FILE_TOOL: ToolDefinition;
/**
 * Clear index tool - remove all indexed data
 */
export declare const CLEAR_INDEX_TOOL: ToolDefinition;
/**
 * All tools exported by the MCP server
 */
export declare const ALL_TOOLS: ToolDefinition[];
//# sourceMappingURL=tools.d.ts.map