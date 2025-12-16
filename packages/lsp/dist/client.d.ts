/**
 * LSP Client
 *
 * Handles JSON-RPC 2.0 communication with LSP servers over stdio.
 * Manages the lifecycle of a single LSP server connection.
 */
import { EventEmitter } from 'events';
import type { LSPClientOptions, Diagnostic, Hover, CompletionItem, Location, DiagnosticsEvent } from './types';
export interface LSPClientEvents {
    diagnostics: (event: DiagnosticsEvent) => void;
    close: (code: number | null) => void;
    error: (error: Error) => void;
}
/**
 * Create an LSP client for a server process
 */
export declare class LSPClient extends EventEmitter {
    readonly serverID: string;
    readonly root: string;
    private process;
    private initialization;
    private requestId;
    private pendingRequests;
    private _diagnostics;
    private _openDocuments;
    private documentVersions;
    private buffer;
    private initialized;
    private capabilities;
    constructor(options: LSPClientOptions);
    get diagnostics(): Map<string, Diagnostic[]>;
    get openDocuments(): Set<string>;
    private _setupProcessHandlers;
    private _processBuffer;
    private _handleMessage;
    private _handleNotification;
    private _handleRequest;
    private _handleDiagnostics;
    private _sendMessage;
    private _sendRequest;
    private _sendNotification;
    /**
     * Initialize the LSP connection
     */
    initialize(): Promise<unknown>;
    /**
     * Notify server that a document was opened
     */
    openDocument(filePath: string): Promise<void>;
    /**
     * Notify server that a document changed
     */
    changeDocument(filePath: string, content: string): Promise<void>;
    /**
     * Notify server that a document was saved
     */
    saveDocument(filePath: string): Promise<void>;
    /**
     * Notify server that a document was closed
     */
    closeDocument(filePath: string): void;
    /**
     * Get hover information at a position
     */
    hover(filePath: string, line: number, character: number): Promise<Hover | null>;
    /**
     * Get completions at a position
     */
    completion(filePath: string, line: number, character: number): Promise<CompletionItem[] | {
        items: CompletionItem[];
    } | null>;
    /**
     * Get definition at a position
     */
    definition(filePath: string, line: number, character: number): Promise<Location | Location[] | null>;
    /**
     * Get references at a position
     */
    references(filePath: string, line: number, character: number): Promise<Location[]>;
    /**
     * Get all diagnostics
     */
    getDiagnostics(): Record<string, Diagnostic[]>;
    /**
     * Wait for diagnostics for a specific file
     */
    waitForDiagnostics(filePath: string, timeout?: number): Promise<Diagnostic[]>;
    /**
     * Shutdown the LSP server with timeout-aware cleanup
     */
    shutdown(): Promise<void>;
    /**
     * Get client info for UI display
     */
    getInfo(): {
        serverID: string;
        root: string;
        initialized: boolean;
        openDocuments: string[];
        diagnosticCount: number;
    };
}
//# sourceMappingURL=client.d.ts.map