#!/usr/bin/env node
/**
 * mgrep-local CLI entry point
 *
 * Commands:
 *   mgrep-local index [directory]    - Index a directory (default: current dir)
 *   mgrep-local watch [directory]    - Watch and index changes (default: current dir)
 *   mgrep-local search <query>       - Search the index
 *   mgrep-local serve                - Start MCP server for Claude Code
 *   mgrep-local status               - Show index status
 *   mgrep-local benchmark [directory] - Compare single vs sharded performance
 *
 * Options:
 *   --mlx                Use MLX GPU acceleration (requires qwen3-embeddings-mlx server)
 *   --mlx-server <url>   MLX server URL (default: http://localhost:8000)
 *   --shards <n>         Number of shards (enables sharded mode)
 *   --db-path <path>     Path to the database directory
 *   --model-cache <path> Directory to cache embedding models
 *   --verbose, -v        Enable verbose logging
 *   --help, -h           Show this help message
 *
 * Environment:
 *   MGREP_MLX            Use MLX (1 or true)
 *   MGREP_MLX_SERVER     MLX server URL
 *   MGREP_SHARDS         Number of shards (same as --shards)
 *   MGREP_DB_PATH        Database path (same as --db-path)
 *   MGREP_VERBOSE        Enable verbose logging (1 or true)
 */
export {};
//# sourceMappingURL=cli.d.ts.map