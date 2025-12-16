"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDiagnostic = exports.LSPManager = exports.LSPClient = exports.getAllServers = exports.getServer = exports.getServersForExtension = exports.findProjectRoot = exports.SERVERS = exports.getNpmBinaryPath = exports.getCachedBinaryPath = exports.isCached = exports.installFromGitHub = exports.installGoPackage = exports.installNpmPackage = exports.getNpmPath = exports.getBundledBunPath = exports.which = exports.getCacheInfo = exports.clearCache = exports.ensureCacheDir = exports.getNodeModulesDir = exports.getBinDir = exports.getCacheDir = exports.initInstaller = exports.CACHE_VERSION = exports.getExtensionForLanguage = exports.getLanguageId = exports.LANGUAGE_EXTENSIONS = void 0;
exports.createLSPManager = createLSPManager;
// Types
__exportStar(require("./types"), exports);
// Language mappings
var language_1 = require("./language");
Object.defineProperty(exports, "LANGUAGE_EXTENSIONS", { enumerable: true, get: function () { return language_1.LANGUAGE_EXTENSIONS; } });
Object.defineProperty(exports, "getLanguageId", { enumerable: true, get: function () { return language_1.getLanguageId; } });
Object.defineProperty(exports, "getExtensionForLanguage", { enumerable: true, get: function () { return language_1.getExtensionForLanguage; } });
// Installer
var installer_1 = require("./installer");
Object.defineProperty(exports, "CACHE_VERSION", { enumerable: true, get: function () { return installer_1.CACHE_VERSION; } });
Object.defineProperty(exports, "initInstaller", { enumerable: true, get: function () { return installer_1.initInstaller; } });
Object.defineProperty(exports, "getCacheDir", { enumerable: true, get: function () { return installer_1.getCacheDir; } });
Object.defineProperty(exports, "getBinDir", { enumerable: true, get: function () { return installer_1.getBinDir; } });
Object.defineProperty(exports, "getNodeModulesDir", { enumerable: true, get: function () { return installer_1.getNodeModulesDir; } });
Object.defineProperty(exports, "ensureCacheDir", { enumerable: true, get: function () { return installer_1.ensureCacheDir; } });
Object.defineProperty(exports, "clearCache", { enumerable: true, get: function () { return installer_1.clearCache; } });
Object.defineProperty(exports, "getCacheInfo", { enumerable: true, get: function () { return installer_1.getCacheInfo; } });
Object.defineProperty(exports, "which", { enumerable: true, get: function () { return installer_1.which; } });
Object.defineProperty(exports, "getBundledBunPath", { enumerable: true, get: function () { return installer_1.getBundledBunPath; } });
Object.defineProperty(exports, "getNpmPath", { enumerable: true, get: function () { return installer_1.getNpmPath; } });
Object.defineProperty(exports, "installNpmPackage", { enumerable: true, get: function () { return installer_1.installNpmPackage; } });
Object.defineProperty(exports, "installGoPackage", { enumerable: true, get: function () { return installer_1.installGoPackage; } });
Object.defineProperty(exports, "installFromGitHub", { enumerable: true, get: function () { return installer_1.installFromGitHub; } });
Object.defineProperty(exports, "isCached", { enumerable: true, get: function () { return installer_1.isCached; } });
Object.defineProperty(exports, "getCachedBinaryPath", { enumerable: true, get: function () { return installer_1.getCachedBinaryPath; } });
Object.defineProperty(exports, "getNpmBinaryPath", { enumerable: true, get: function () { return installer_1.getNpmBinaryPath; } });
// Servers
var servers_1 = require("./servers");
Object.defineProperty(exports, "SERVERS", { enumerable: true, get: function () { return servers_1.SERVERS; } });
Object.defineProperty(exports, "findProjectRoot", { enumerable: true, get: function () { return servers_1.findProjectRoot; } });
Object.defineProperty(exports, "getServersForExtension", { enumerable: true, get: function () { return servers_1.getServersForExtension; } });
Object.defineProperty(exports, "getServer", { enumerable: true, get: function () { return servers_1.getServer; } });
Object.defineProperty(exports, "getAllServers", { enumerable: true, get: function () { return servers_1.getAllServers; } });
// Client
var client_1 = require("./client");
Object.defineProperty(exports, "LSPClient", { enumerable: true, get: function () { return client_1.LSPClient; } });
// Manager
var manager_1 = require("./manager");
Object.defineProperty(exports, "LSPManager", { enumerable: true, get: function () { return manager_1.LSPManager; } });
Object.defineProperty(exports, "formatDiagnostic", { enumerable: true, get: function () { return manager_1.formatDiagnostic; } });
// Convenience factory
const manager_2 = require("./manager");
/**
 * Create a new LSP manager instance
 */
function createLSPManager(options = {}) {
    return new manager_2.LSPManager(options);
}
//# sourceMappingURL=index.js.map