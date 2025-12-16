import { EventEmitter } from 'events';
import type { FastApplyOptions, ModelVariant, ModelInfo, ApplyResult, DownloadProgress, FastApplyStatus } from './types';
export interface FastApplyEvents {
    'download:progress': (progress: DownloadProgress) => void;
    'download:complete': (path: string) => void;
    'download:error': (error: Error) => void;
    'model:loaded': () => void;
    'model:unloaded': () => void;
}
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
export declare class FastApply extends EventEmitter {
    private manager;
    private options;
    constructor(options?: FastApplyOptions);
    /**
     * Get information about all available models
     */
    listModels(): Promise<ModelInfo[]>;
    /**
     * Get the currently active model variant
     */
    getActiveModel(): ModelVariant | null;
    /**
     * Set the active model variant
     * Downloads the model if not present and autoDownload is true
     */
    setActiveModel(variant: ModelVariant): Promise<void>;
    /**
     * Get whether fast apply should auto-load on startup
     */
    isEnabled(): boolean;
    /**
     * Set whether fast apply should auto-load on startup
     */
    setEnabled(enabled: boolean): void;
    /**
     * Download a model variant
     * @param variant The model variant to download (default: Q4_K_M)
     * @returns Path to the downloaded model
     */
    download(variant?: ModelVariant): Promise<string>;
    /**
     * Cancel an ongoing download
     */
    cancelDownload(): void;
    /**
     * Delete a downloaded model to free disk space
     */
    deleteModel(variant: ModelVariant): Promise<void>;
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
    apply(originalCode: string, updateSnippet: string): Promise<ApplyResult>;
    /**
     * Get current status of FastApply
     */
    getStatus(): Promise<FastApplyStatus>;
    /**
     * Load the active model into memory
     * Call this to pre-warm the model for faster first inference
     */
    load(): Promise<void>;
    /**
     * Unload the model to free memory
     * The model will be automatically reloaded on next apply() call
     */
    unload(): Promise<void>;
    /**
     * Dispose all resources
     * Call this when you're done using FastApply
     */
    dispose(): Promise<void>;
}
export declare interface FastApply {
    on<K extends keyof FastApplyEvents>(event: K, listener: FastApplyEvents[K]): this;
    once<K extends keyof FastApplyEvents>(event: K, listener: FastApplyEvents[K]): this;
    emit<K extends keyof FastApplyEvents>(event: K, ...args: Parameters<FastApplyEvents[K]>): boolean;
    off<K extends keyof FastApplyEvents>(event: K, listener: FastApplyEvents[K]): this;
}
//# sourceMappingURL=FastApply.d.ts.map