/**
 * LSP Server Installer
 *
 * Handles automatic downloading and installation of LSP servers.
 * Three installation methods:
 * 1. NPM packages (via bundled bun or system npm)
 * 2. Go packages (via go install)
 * 3. GitHub releases (binary downloads)
 *
 * Binaries are cached in app data directory for persistence.
 */
import type { InstallProgressCallback, CacheInfo } from './types';
export declare const CACHE_VERSION = "1";
/**
 * Initialize the installer with options
 */
export declare function initInstaller(options: {
    appName?: string;
    cacheDir?: string;
    bunPath?: string;
}): void;
/**
 * Get the LSP cache directory (XDG-compliant on Linux/macOS)
 */
export declare function getCacheDir(): string;
/**
 * Get the bin directory for installed LSP servers
 */
export declare function getBinDir(): string;
/**
 * Get the node_modules directory for npm packages
 */
export declare function getNodeModulesDir(): string;
/**
 * Ensure cache directories exist and validate cache version
 */
export declare function ensureCacheDir(): Promise<void>;
/**
 * Clear the entire LSP cache
 */
export declare function clearCache(): Promise<void>;
/**
 * Get cache info for display
 */
export declare function getCacheInfo(): Promise<CacheInfo>;
/**
 * Check if a binary exists in PATH using execFileSync (safe, no shell injection)
 */
export declare function which(binary: string): string | null;
/**
 * Get path to bundled bun binary
 */
export declare function getBundledBunPath(): string | null;
/**
 * Get path to system npm
 */
export declare function getNpmPath(): string | null;
/**
 * Install an npm package
 */
export declare function installNpmPackage(options: {
    packageName: string;
    entryPoint: string;
}, onProgress?: InstallProgressCallback): Promise<string>;
/**
 * Install a Go package
 */
export declare function installGoPackage(options: {
    packagePath: string;
    binaryName: string;
}, onProgress?: InstallProgressCallback): Promise<string>;
/**
 * Download and install from GitHub releases
 */
export declare function installFromGitHub(options: {
    repo: string;
    binaryName: string;
    getAssetName: (release: {
        tag_name: string;
    }, platform: NodeJS.Platform, arch: NodeJS.Architecture) => string | null;
}, onProgress?: InstallProgressCallback): Promise<string>;
/**
 * Check if a binary exists in our cache
 */
export declare function isCached(binaryName: string): Promise<boolean>;
/**
 * Get the path to a cached binary
 */
export declare function getCachedBinaryPath(binaryName: string): string;
/**
 * Get path to an npm package binary
 */
export declare function getNpmBinaryPath(entryPoint: string): string;
//# sourceMappingURL=installer.d.ts.map