/**
 * Worker Pool - Manages parallel worker threads for indexing and search
 */
import { Worker } from 'worker_threads';
import { cpus } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
/**
 * Run parallel indexing across worker threads
 */
export async function runParallelIndex(shardDbPaths, filesByShardId, embedderOptions, options = {}, onProgress) {
    const workerCount = Math.min(options.workerCount ?? Math.max(1, cpus().length - 1), filesByShardId.size);
    if (workerCount === 0 || filesByShardId.size === 0) {
        return { totalChunks: 0, totalFiles: 0, durationMs: 0, workerResults: [] };
    }
    const startTime = Date.now();
    // Distribute shards across workers
    const shardIds = Array.from(filesByShardId.keys());
    const workerAssignments = new Map(); // workerId -> shardIds
    for (let i = 0; i < shardIds.length; i++) {
        const workerId = i % workerCount;
        const assignments = workerAssignments.get(workerId) ?? [];
        assignments.push(shardIds[i]);
        workerAssignments.set(workerId, assignments);
    }
    // Create worker promises
    const workerPromises = [];
    for (let workerId = 0; workerId < workerCount; workerId++) {
        const assignedShards = workerAssignments.get(workerId) ?? [];
        if (assignedShards.length === 0)
            continue;
        // Collect files for this worker
        const workerFiles = [];
        const workerShardPaths = {};
        for (const shardId of assignedShards) {
            workerShardPaths[shardId.toString()] = shardDbPaths.get(shardId);
            const files = filesByShardId.get(shardId) ?? [];
            for (const file of files) {
                workerFiles.push({ shardId, ...file });
            }
        }
        const workerData = {
            shardDbPaths: workerShardPaths,
            files: workerFiles,
            embedderOptions,
            workerId,
        };
        workerPromises.push(runIndexWorker(workerData, onProgress));
    }
    // Wait for all workers
    const results = await Promise.all(workerPromises);
    // Aggregate results
    let totalChunks = 0;
    let totalFiles = 0;
    const workerResults = [];
    for (const result of results) {
        totalChunks += result.totalChunks;
        totalFiles += result.totalFiles;
        workerResults.push({
            workerId: result.workerId,
            totalChunks: result.totalChunks,
            totalFiles: result.totalFiles,
            durationMs: result.durationMs,
        });
    }
    return {
        totalChunks,
        totalFiles,
        durationMs: Date.now() - startTime,
        workerResults,
    };
}
/**
 * Run parallel search across worker threads
 */
export async function runParallelSearch(shardDbPaths, queryEmbedding, topK, minScore, options = {}) {
    const workerCount = Math.min(options.workerCount ?? Math.max(1, cpus().length - 1), shardDbPaths.size);
    if (workerCount === 0 || shardDbPaths.size === 0) {
        return [];
    }
    // Distribute shards across workers
    const shardIds = Array.from(shardDbPaths.keys());
    const workerAssignments = new Map();
    for (let i = 0; i < shardIds.length; i++) {
        const workerId = i % workerCount;
        const assignments = workerAssignments.get(workerId) ?? [];
        assignments.push(shardIds[i]);
        workerAssignments.set(workerId, assignments);
    }
    // Create worker promises
    const workerPromises = [];
    for (let workerId = 0; workerId < workerCount; workerId++) {
        const assignedShards = workerAssignments.get(workerId) ?? [];
        if (assignedShards.length === 0)
            continue;
        const workerShardPaths = {};
        for (const shardId of assignedShards) {
            workerShardPaths[shardId.toString()] = shardDbPaths.get(shardId);
        }
        const workerData = {
            shardDbPaths: workerShardPaths,
            queryEmbedding,
            topK,
            minScore,
            workerId,
        };
        workerPromises.push(runSearchWorker(workerData));
    }
    // Wait for all workers and merge results
    const allResults = await Promise.all(workerPromises);
    const merged = allResults.flat();
    // Sort by score and take top K
    merged.sort((a, b) => b.score - a.score);
    return merged.slice(0, topK);
}
/**
 * Run a single index worker
 */
function runIndexWorker(workerData, onProgress) {
    return new Promise((resolve, reject) => {
        const workerPath = join(__dirname, 'index-worker.js');
        const worker = new Worker(workerPath, { workerData });
        worker.on('message', (message) => {
            if (message.type === 'progress' && onProgress) {
                onProgress(message);
            }
            else if (message.type === 'done') {
                resolve(message.result);
            }
            else if (message.type === 'error') {
                console.error(`[Worker ${workerData.workerId}] Error:`, message.error);
            }
        });
        worker.on('error', reject);
        worker.on('exit', (code) => {
            if (code !== 0) {
                reject(new Error(`Worker stopped with exit code ${code}`));
            }
        });
    });
}
/**
 * Run a single search worker
 */
function runSearchWorker(workerData) {
    return new Promise((resolve, reject) => {
        const workerPath = join(__dirname, 'search-worker.js');
        const worker = new Worker(workerPath, { workerData });
        worker.on('message', (message) => {
            if (message.type === 'done') {
                resolve(message.result.results);
            }
            else if (message.type === 'error') {
                console.error(`[Worker ${workerData.workerId}] Error:`, message.error);
            }
        });
        worker.on('error', reject);
        worker.on('exit', (code) => {
            if (code !== 0) {
                reject(new Error(`Worker stopped with exit code ${code}`));
            }
        });
    });
}
//# sourceMappingURL=pool.js.map