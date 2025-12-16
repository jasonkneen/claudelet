/**
 * @ai-cluso/lsp-client
 *
 * Portable LSP client manager for AI code assistants.
 * Auto-installs and manages language servers.
 *
 * @example
 * ```typescript
 * import { createLSPManager, formatDiagnostic } from '@ai-cluso/lsp-client'
 *
 * // Create manager with custom app name (for cache directory)
 * const manager = createLSPManager({ appName: 'my-app' })
 *
 * // Set project path
 * manager.setProjectPath('/path/to/project')
 *
 * // Listen for diagnostics
 * manager.on('diagnostics', (event) => {
 *   console.log(`Diagnostics for ${event.path}:`)
 *   event.diagnostics.forEach(d => console.log(formatDiagnostic(d)))
 * })
 *
 * // Touch a file to trigger LSP analysis
 * await manager.touchFile('/path/to/project/src/index.ts', true)
 *
 * // Get diagnostics
 * const diags = manager.getDiagnosticsForFile('/path/to/project/src/index.ts')
 *
 * // Cleanup
 * await manager.shutdown()
 * ```
 */
export * from './types';
export { LANGUAGE_EXTENSIONS, getLanguageId, getExtensionForLanguage } from './language';
export { CACHE_VERSION, initInstaller, getCacheDir, getBinDir, getNodeModulesDir, ensureCacheDir, clearCache, getCacheInfo, which, getBundledBunPath, getNpmPath, installNpmPackage, installGoPackage, installFromGitHub, isCached, getCachedBinaryPath, getNpmBinaryPath, } from './installer';
export { SERVERS, findProjectRoot, getServersForExtension, getServer, getAllServers } from './servers';
export { LSPClient } from './client';
export { LSPManager, formatDiagnostic } from './manager';
import { LSPManager } from './manager';
import type { LSPManagerOptions } from './types';
/**
 * Create a new LSP manager instance
 */
export declare function createLSPManager(options?: LSPManagerOptions): LSPManager;
//# sourceMappingURL=index.d.ts.map