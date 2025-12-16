"use strict";
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const config_1 = require("./config");
const Downloader_1 = require("./Downloader");
const InferenceEngine_1 = require("./InferenceEngine");
/**
 * Manages model selection, storage, and lifecycle
 */
class ModelManager {
    constructor(storageDir) {
        this.activeModel = null;
        this.enabled = false; // Whether fast apply should auto-load on startup
        // Resolve storage directory
        if (storageDir) {
            this.storageDir = storageDir.startsWith('~')
                ? path.join(os.homedir(), storageDir.slice(1))
                : storageDir;
        }
        else {
            this.storageDir = path.join(os.homedir(), config_1.DEFAULT_STORAGE_DIR);
        }
        this.configPath = path.join(this.storageDir, 'config.json');
        this.downloader = new Downloader_1.Downloader(this.storageDir);
        this.engine = new InferenceEngine_1.InferenceEngine();
        // Load saved configuration
        this.loadConfig();
    }
    /**
     * Get the downloader instance (for event forwarding)
     */
    getDownloader() {
        return this.downloader;
    }
    /**
     * Get the inference engine instance (for event forwarding)
     */
    getEngine() {
        return this.engine;
    }
    /**
     * Get the storage directory path
     */
    getStorageDir() {
        return this.storageDir;
    }
    /**
     * Get information about all available models
     */
    async listModels() {
        const downloadedModels = await this.downloader.getDownloadedModels();
        return Object.keys(config_1.MODELS).map(variant => {
            const def = config_1.MODELS[variant];
            const downloaded = downloadedModels.includes(variant);
            return {
                variant,
                file: def.file,
                size: def.size,
                quality: def.quality,
                memory: def.memory,
                description: def.description,
                downloaded,
                path: downloaded ? this.downloader.getModelPath(variant) : undefined,
            };
        });
    }
    /**
     * Get the currently active model variant
     */
    getActiveModel() {
        return this.activeModel;
    }
    /**
     * Set the active model variant (downloads if needed)
     */
    async setActiveModel(variant, autoDownload = true) {
        // Validate variant
        if (!config_1.MODELS[variant]) {
            throw new Error(`Unknown model variant: ${variant}`);
        }
        // Check if model is downloaded
        const isDownloaded = await this.downloader.isDownloaded(variant);
        if (!isDownloaded) {
            if (autoDownload) {
                await this.downloader.download(variant);
            }
            else {
                throw new Error(`Model ${variant} is not downloaded`);
            }
        }
        // If a different model is loaded, unload it
        if (this.engine.isLoaded()) {
            const currentPath = this.engine.getLoadedModelPath();
            const newPath = this.downloader.getModelPath(variant);
            if (currentPath !== newPath) {
                await this.engine.unload();
            }
        }
        this.activeModel = variant;
        this.saveConfig();
    }
    /**
     * Ensure a model is loaded and ready for inference
     */
    async ensureLoaded() {
        if (!this.activeModel) {
            // Try to use default model
            const isDownloaded = await this.downloader.isDownloaded(config_1.DEFAULT_MODEL);
            if (isDownloaded) {
                this.activeModel = config_1.DEFAULT_MODEL;
            }
            else {
                throw new Error('No model available. Please download a model first.');
            }
        }
        if (!this.engine.isLoaded()) {
            const modelPath = this.downloader.getModelPath(this.activeModel);
            await this.engine.load(modelPath);
        }
    }
    /**
     * Get current status
     */
    async getStatus() {
        const downloadedModels = await this.downloader.getDownloadedModels();
        return {
            ready: this.engine.isLoaded(),
            activeModel: this.activeModel,
            modelLoaded: this.engine.isLoaded(),
            downloadedModels,
            storageDir: this.storageDir,
        };
    }
    /**
     * Download a model
     */
    async download(variant = config_1.DEFAULT_MODEL) {
        return this.downloader.download(variant);
    }
    /**
     * Cancel ongoing download
     */
    cancelDownload() {
        this.downloader.cancel();
    }
    /**
     * Delete a model
     */
    async deleteModel(variant) {
        // Unload if this is the active model
        if (this.activeModel === variant && this.engine.isLoaded()) {
            await this.engine.unload();
        }
        // If this was the active model, clear it
        if (this.activeModel === variant) {
            this.activeModel = null;
            this.saveConfig();
        }
        await this.downloader.delete(variant);
    }
    /**
     * Unload the current model to free memory
     */
    async unload() {
        await this.engine.unload();
    }
    /**
     * Dispose all resources
     */
    async dispose() {
        await this.engine.dispose();
    }
    /**
     * Load configuration from disk
     */
    loadConfig() {
        try {
            const data = fs.readFileSync(this.configPath, 'utf-8');
            const config = JSON.parse(data);
            if (config.activeModel && config_1.MODELS[config.activeModel]) {
                this.activeModel = config.activeModel;
            }
            if (typeof config.enabled === 'boolean') {
                this.enabled = config.enabled;
            }
        }
        catch {
            // Config doesn't exist yet, use defaults
        }
    }
    /**
     * Save configuration to disk
     */
    saveConfig() {
        try {
            fs.mkdirSync(this.storageDir, { recursive: true });
            const config = {
                activeModel: this.activeModel,
                enabled: this.enabled,
                lastUpdated: new Date().toISOString(),
            };
            fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
        }
        catch (error) {
            console.warn('[FastApply] Failed to save config:', error);
        }
    }
    /**
     * Get whether fast apply should auto-load on startup
     */
    isEnabled() {
        return this.enabled;
    }
    /**
     * Set whether fast apply should auto-load on startup
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        this.saveConfig();
    }
}
exports.ModelManager = ModelManager;
//# sourceMappingURL=ModelManager.js.map