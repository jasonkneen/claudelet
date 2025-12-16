import { EventEmitter } from 'events';
import type { ModelVariant, DownloadProgress } from './types';
export interface DownloaderEvents {
    'progress': (progress: DownloadProgress) => void;
    'complete': (modelPath: string) => void;
    'error': (error: Error) => void;
}
export declare class Downloader extends EventEmitter {
    private storageDir;
    private currentDownload;
    constructor(storageDir: string);
    /**
     * Get the full path where a model would be stored
     */
    getModelPath(variant: ModelVariant): string;
    /**
     * Check if a model is already downloaded
     */
    isDownloaded(variant: ModelVariant): Promise<boolean>;
    /**
     * Get list of all downloaded models
     */
    getDownloadedModels(): Promise<ModelVariant[]>;
    /**
     * Download a model from HuggingFace
     */
    download(variant: ModelVariant): Promise<string>;
    /**
     * Cancel ongoing download
     */
    cancel(): void;
    /**
     * Delete a downloaded model
     */
    delete(variant: ModelVariant): Promise<void>;
    /**
     * Download file with progress tracking
     */
    private downloadFile;
    /**
     * Check if there's enough disk space
     */
    private checkDiskSpace;
}
export declare interface Downloader {
    on<K extends keyof DownloaderEvents>(event: K, listener: DownloaderEvents[K]): this;
    emit<K extends keyof DownloaderEvents>(event: K, ...args: Parameters<DownloaderEvents[K]>): boolean;
}
//# sourceMappingURL=Downloader.d.ts.map