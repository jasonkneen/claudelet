#!/usr/bin/env node
/**
 * Search Worker - Parallel search worker thread
 *
 * Each worker searches one or more shards in parallel.
 */
import { parentPort, workerData } from 'worker_threads';
import { VectorStore } from '../VectorStore.js';
async function runWorker() {
    const data = workerData;
    const startTime = Date.now();
    const allResults = [];
    // Search each shard
    for (const [shardIdStr, dbPath] of Object.entries(data.shardDbPaths)) {
        const shardId = parseInt(shardIdStr);
        try {
            const store = new VectorStore({
                dbPath,
            });
            await store.initialize();
            const results = await store.search(data.queryEmbedding, data.topK);
            // Add shard ID to results
            for (const result of results) {
                if (result.similarity >= data.minScore) {
                    allResults.push({ ...result, shardId });
                }
            }
            await store.dispose();
        }
        catch (error) {
            parentPort?.postMessage({
                type: 'error',
                workerId: data.workerId,
                shardId,
                error: String(error),
            });
        }
    }
    // Sort by similarity descending and take top K
    allResults.sort((a, b) => b.similarity - a.similarity);
    const topResults = allResults.slice(0, data.topK);
    const finalResult = {
        workerId: data.workerId,
        results: topResults,
        durationMs: Date.now() - startTime,
    };
    parentPort?.postMessage({ type: 'done', result: finalResult });
}
// Run if we're in a worker thread
if (parentPort) {
    runWorker().catch(error => {
        parentPort?.postMessage({ type: 'error', error: String(error) });
    });
}
//# sourceMappingURL=search-worker.js.map