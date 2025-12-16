import type { ModelVariant, ModelInfo, FastApplyStatus } from './types';
import { Downloader } from './Downloader';
import { InferenceEngine } from './InferenceEngine';
/**
 * Manages model selection, storage, and lifecycle
 */
export declare class ModelManager {
    private storageDir;
    private activeModel;
    private enabled;
    private downloader;
    private engine;
    private configPath;
    constructor(storageDir?: string);
    /**
     * Get the downloader instance (for event forwarding)
     */
    getDownloader(): Downloader;
    /**
     * Get the inference engine instance (for event forwarding)
     */
    getEngine(): InferenceEngine;
    /**
     * Get the storage directory path
     */
    getStorageDir(): string;
    /**
     * Get information about all available models
     */
    listModels(): Promise<ModelInfo[]>;
    /**
     * Get the currently active model variant
     */
    getActiveModel(): ModelVariant | null;
    /**
     * Set the active model variant (downloads if needed)
     */
    setActiveModel(variant: ModelVariant, autoDownload?: boolean): Promise<void>;
    /**
     * Ensure a model is loaded and ready for inference
     */
    ensureLoaded(): Promise<void>;
    /**
     * Get current status
     */
    getStatus(): Promise<FastApplyStatus>;
    /**
     * Download a model
     */
    download(variant?: ModelVariant): Promise<string>;
    /**
     * Cancel ongoing download
     */
    cancelDownload(): void;
    /**
     * Delete a model
     */
    deleteModel(variant: ModelVariant): Promise<void>;
    /**
     * Unload the current model to free memory
     */
    unload(): Promise<void>;
    /**
     * Dispose all resources
     */
    dispose(): Promise<void>;
    /**
     * Load configuration from disk
     */
    private loadConfig;
    /**
     * Save configuration to disk
     */
    private saveConfig;
    /**
     * Get whether fast apply should auto-load on startup
     */
    isEnabled(): boolean;
    /**
     * Set whether fast apply should auto-load on startup
     */
    setEnabled(enabled: boolean): void;
}
//# sourceMappingURL=ModelManager.d.ts.map