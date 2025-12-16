"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FastApply = void 0;
const events_1 = require("events");
const config_1 = require("./config");
const ModelManager_1 = require("./ModelManager");
/**
 * FastApply - Local AI model for instant code merging
 *
 * @example
 * ```typescript
 * const fastApply = new FastApply({
 *   storageDir: '~/.cluso/models',
 *   autoDownload: true,
 * })
 *
 * // Listen for download progress
 * fastApply.on('download:progress', (progress) => {
 *   console.log(`Downloading: ${progress.percent}%`)
 * })
 *
 * // Apply a code change
 * const result = await fastApply.apply(originalCode, 'Change button color to blue')
 * if (result.success) {
 *   console.log('Merged code:', result.code)
 * }
 * ```
 */
class FastApply extends events_1.EventEmitter {
    constructor(options) {
        super();
        this.options = {
            defaultModel: config_1.DEFAULT_MODEL,
            autoDownload: false,
            ...options,
        };
        this.manager = new ModelManager_1.ModelManager(options?.storageDir);
        // Forward events from downloader
        const downloader = this.manager.getDownloader();
        downloader.on('progress', (progress) => {
            this.emit('download:progress', progress);
        });
        downloader.on('complete', (path) => {
            this.emit('download:complete', path);
        });
        downloader.on('error', (error) => {
            this.emit('download:error', error);
        });
        // Forward events from engine
        const engine = this.manager.getEngine();
        engine.on('loaded', () => {
            this.emit('model:loaded');
        });
        engine.on('unloaded', () => {
            this.emit('model:unloaded');
        });
    }
    // ============================================
    // Model Management
    // ============================================
    /**
     * Get information about all available models
     */
    async listModels() {
        return this.manager.listModels();
    }
    /**
     * Get the currently active model variant
     */
    getActiveModel() {
        return this.manager.getActiveModel();
    }
    /**
     * Set the active model variant
     * Downloads the model if not present and autoDownload is true
     */
    async setActiveModel(variant) {
        await this.manager.setActiveModel(variant, this.options.autoDownload);
    }
    /**
     * Get whether fast apply should auto-load on startup
     */
    isEnabled() {
        return this.manager.isEnabled();
    }
    /**
     * Set whether fast apply should auto-load on startup
     */
    setEnabled(enabled) {
        this.manager.setEnabled(enabled);
    }
    // ============================================
    // Download
    // ============================================
    /**
     * Download a model variant
     * @param variant The model variant to download (default: Q4_K_M)
     * @returns Path to the downloaded model
     */
    async download(variant) {
        return this.manager.download(variant || this.options.defaultModel);
    }
    /**
     * Cancel an ongoing download
     */
    cancelDownload() {
        this.manager.cancelDownload();
    }
    /**
     * Delete a downloaded model to free disk space
     */
    async deleteModel(variant) {
        await this.manager.deleteModel(variant);
    }
    // ============================================
    // Inference
    // ============================================
    /**
     * Apply code changes using the Fast Apply model
     *
     * @param originalCode The original source code
     * @param updateSnippet Description of changes to apply, or a code snippet with updates
     * @returns Result containing the merged code or an error
     *
     * @example
     * ```typescript
     * // Using natural language
     * const result = await fastApply.apply(code, 'Change the button color to blue')
     *
     * // Using code snippet
     * const result = await fastApply.apply(code, `
     *   // Update button styles
     *   backgroundColor: 'blue',
     *   color: 'white'
     * `)
     * ```
     */
    async apply(originalCode, updateSnippet) {
        try {
            // Ensure model is loaded
            await this.manager.ensureLoaded();
            // Run inference
            const engine = this.manager.getEngine();
            return await engine.apply(originalCode, updateSnippet);
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
    // ============================================
    // Lifecycle
    // ============================================
    /**
     * Get current status of FastApply
     */
    async getStatus() {
        return this.manager.getStatus();
    }
    /**
     * Load the active model into memory
     * Call this to pre-warm the model for faster first inference
     */
    async load() {
        await this.manager.ensureLoaded();
    }
    /**
     * Unload the model to free memory
     * The model will be automatically reloaded on next apply() call
     */
    async unload() {
        await this.manager.unload();
    }
    /**
     * Dispose all resources
     * Call this when you're done using FastApply
     */
    async dispose() {
        await this.manager.dispose();
    }
}
exports.FastApply = FastApply;
//# sourceMappingURL=FastApply.js.map