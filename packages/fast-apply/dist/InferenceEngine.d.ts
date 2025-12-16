import { EventEmitter } from 'events';
import type { ApplyResult } from './types';
export interface InferenceEngineEvents {
    'loaded': () => void;
    'unloaded': () => void;
    'error': (error: Error) => void;
}
export declare class InferenceEngine extends EventEmitter {
    private llama;
    private model;
    private context;
    private modelPath;
    private loading;
    /**
     * Check if a model is currently loaded
     */
    isLoaded(): boolean;
    /**
     * Get the path of the currently loaded model
     */
    getLoadedModelPath(): string | null;
    /**
     * Load a model from disk
     */
    load(modelPath: string): Promise<void>;
    /**
     * Unload the current model to free memory
     */
    unload(): Promise<void>;
    /**
     * Run inference to apply code changes
     */
    apply(originalCode: string, updateSnippet: string): Promise<ApplyResult>;
    /**
     * Dispose all resources
     */
    dispose(): Promise<void>;
}
export declare interface InferenceEngine {
    on<K extends keyof InferenceEngineEvents>(event: K, listener: InferenceEngineEvents[K]): this;
    emit<K extends keyof InferenceEngineEvents>(event: K, ...args: Parameters<InferenceEngineEvents[K]>): boolean;
}
//# sourceMappingURL=InferenceEngine.d.ts.map