/**
 * Embedding Worker Thread
 *
 * Runs CPU-intensive embedding operations in a separate thread
 * to avoid blocking the main Electron process.
 *
 * Communication protocol:
 * - Main → Worker: WorkerTask (via postMessage)
 * - Worker → Main: WorkerResult (via postMessage)
 */
export {};
//# sourceMappingURL=worker.d.ts.map