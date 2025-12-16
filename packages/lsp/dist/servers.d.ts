/**
 * LSP Server Definitions
 *
 * Each server definition includes:
 * - id: Unique identifier
 * - name: Human-readable name
 * - extensions: File extensions this server handles
 * - rootPatterns: Files/dirs that indicate project root
 * - spawn: Function to spawn the server process
 * - install: Function to install the server (if installable)
 * - checkInstalled: Function to check if installed
 */
import type { ServerDefinition } from './types';
/**
 * Find the nearest directory containing one of the target files
 */
export declare function findProjectRoot(startPath: string, patterns: string[], excludePatterns?: string[]): Promise<string | null>;
/**
 * Server Definitions
 */
export declare const SERVERS: Record<string, ServerDefinition>;
/**
 * Get servers that handle a given file extension
 */
export declare function getServersForExtension(ext: string): ServerDefinition[];
/**
 * Get a server by ID
 */
export declare function getServer(id: string): ServerDefinition | null;
/**
 * Get all server definitions
 */
export declare function getAllServers(): Record<string, ServerDefinition>;
//# sourceMappingURL=servers.d.ts.map