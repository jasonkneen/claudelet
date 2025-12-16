/**
 * MLX Server Manager - Setup and manage the qwen3-embeddings-mlx server
 *
 * Provides automated setup and management of the MLX embedding server
 * for GPU-accelerated embeddings on Apple Silicon.
 */
import { ChildProcess } from 'child_process';
export interface MlxSetupOptions {
    installDir?: string;
    verbose?: boolean;
    pythonPath?: string;
}
export interface MlxServerOptions {
    port?: number;
    model?: '0.6B' | '4B' | '8B';
    verbose?: boolean;
}
/**
 * Check if MLX server is already set up
 */
export declare function isMlxInstalled(installDir?: string): boolean;
/**
 * Get the server directory path
 */
export declare function getMlxServerDir(installDir?: string): string;
/**
 * Setup the MLX embedding server
 */
export declare function setupMlxServer(options?: MlxSetupOptions): Promise<void>;
/**
 * Start the MLX server
 */
export declare function startMlxServer(options?: MlxServerOptions): ChildProcess;
/**
 * Stop the MLX server
 */
export declare function stopMlxServer(): boolean;
/**
 * Check if MLX server is running
 */
export declare function isMlxServerRunning(): boolean;
/**
 * Get MLX server status
 */
export declare function getMlxStatus(serverUrl?: string): Promise<{
    installed: boolean;
    running: boolean;
    serverUrl: string;
    modelLoaded: boolean;
    installDir: string;
}>;
/**
 * Wait for server to be ready
 */
export declare function waitForServer(serverUrl?: string, timeoutMs?: number): Promise<boolean>;
//# sourceMappingURL=mlx-manager.d.ts.map