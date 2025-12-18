import { FastApply } from '@ai-cluso/fast-apply';
import { createLSPManager, formatDiagnostic } from '@ai-cluso/lsp-client';
import {
  Embedder,
  VectorStore,
  Chunker,
  Indexer,
  Searcher
} from '@ai-cluso/mgrep-local';
import * as path from 'path';
import * as os from 'os';
import * as fsp from 'fs/promises';
import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { SecurityValidator } from '../src/security-validator.js';

/**
 * Type definition for FastApply supported model types.
 * These are the quantization variants available for patch generation.
 */
type PatchModel = 'Q4_K_M' | 'Q5_K_M' | 'Q8_0' | 'F16';

/**
 * Type guard to validate if a string is a valid PatchModel.
 * Provides runtime validation with compile-time type narrowing.
 */
function isPatchModel(model: string): model is PatchModel {
  return ['Q4_K_M', 'Q5_K_M', 'Q8_0', 'F16'].includes(model);
}

/**
 * Extended Indexer interface that includes deleteFile method.
 * Used with type assertion to safely call deleteFile when available.
 * The method may not exist on all Indexer implementations.
 */
interface IndexerWithDelete {
  deleteFile?(filePath: string): Promise<void>;
}

export interface HybridSearchResult {
  filePath: string;
  content: string;
  similarity: number;
  metadata: {
    startLine: number;
    endLine: number;
  };
  source: 'semantic' | 'grep';
}

// NOTE: AiToolsService is intentionally NOT a singleton.
// Create one instance per UI process and dispose it on shutdown.

export class AiToolsService extends EventEmitter {
  public fastApply: FastApply;
  public lspManager: ReturnType<typeof createLSPManager>;

  // Mgrep components
  public embedder: Embedder;
  public vectorStore: VectorStore;
  public chunker: Chunker;
  public indexer: Indexer;
  public searcher: Searcher;

  // Watcher
  private watcher: Worker | null = null;
  private projectPath: string;
  private cacheBase: string;
  private currentPatchModel: PatchModel = 'Q4_K_M';
  private disposed: boolean = false;
  private processHandlersRegistered = false;
  private onBeforeExit?: () => void;
  private onSigInt?: () => void;
  private onSigTerm?: () => void;

  constructor(projectPath: string) {
    super();
    this.projectPath = projectPath;
    const homeDir = os.homedir();
    this.cacheBase = path.join(homeDir, '.cache', 'claudelet');

    // 1. Fast Apply
    this.fastApply = new FastApply({
      storageDir: path.join(this.cacheBase, 'fast-apply'),
      defaultModel: this.currentPatchModel,
      autoDownload: true,
    });
    this.attachFastApplyListeners();

    // 2. LSP - pass projectPath via constructor for multi-session support
    this.lspManager = createLSPManager({
      appName: 'claudelet',
      cacheDir: path.join(this.cacheBase, 'lsp'),
      projectPath: projectPath,
    });

    // 3. Mgrep
    this.embedder = new Embedder({
      cacheDir: path.join(this.cacheBase, 'mgrep', 'models'),
      verbose: false 
    });

    this.vectorStore = new VectorStore({
      dbPath: path.join(projectPath, '.opencode', 'vectors') // Store vectors in project
    });

    this.chunker = new Chunker({
      maxChunkSize: 500,
      overlapSize: 50,
      respectBoundaries: true
    });

    this.indexer = new Indexer({
      embedder: this.embedder,
      vectorStore: this.vectorStore,
      chunker: this.chunker,
      batchSize: 32,
      progressCallback: (p) => {
        // Active phases are: scanning, chunking, embedding, storing
        const activePhases = ['scanning', 'chunking', 'embedding', 'storing'];
        this.indexerStats = {
          ...this.indexerStats,
          isIndexing: activePhases.includes(p.phase),
          current: p.current,
          total: p.total,
          phase: p.phase
        };
        this.emit('status:change', this.getStats());
      }
    });

    this.searcher = new Searcher(this.embedder, this.vectorStore);

    // Track LSP Stats
    this.lspManager.on('server-started', () => {
      this.lspStats.activeServers++;
      this.emit('status:change', this.getStats());
    });
    this.lspManager.on('server-closed', () => {
      this.lspStats.activeServers = Math.max(0, this.lspStats.activeServers - 1);
      this.emit('status:change', this.getStats());
    });
    this.lspManager.on('diagnostics', (e) => {
      // Simple count of files with errors/warnings
      this.lspStats.filesWithDiagnostics = Object.keys(this.lspManager.getAllDiagnostics()).length;
      this.emit('status:change', this.getStats());
    });

    // Track installation progress
    this.lspManager.on('server-installing', (data) => {
      const { serverId, progress } = data;
      const percentage = this.getInstallPercentage(progress.stage);
      const status = this.getInstallStatusMessage(serverId, progress);

      console.error(`[AiTools] ${status}`);
      this.emit('status:change', this.getStats());
    });
  }

  /**
   * Convert installation stage to percentage
   */
  private getInstallPercentage(stage: string): number {
    switch (stage) {
      case 'fetching': return 10;
      case 'downloading': return 30;
      case 'installing': return 50;
      case 'extracting': return 80;
      case 'complete': return 100;
      default: return 0;
    }
  }

  /**
   * Get human-readable installation status message
   */
  private getInstallStatusMessage(serverId: string, progress: { stage: string; package: string }): string {
    const serverName = serverId.charAt(0).toUpperCase() + serverId.slice(1);
    const percentage = this.getInstallPercentage(progress.stage);

    switch (progress.stage) {
      case 'fetching':
        return `Fetching ${serverName} language server... (${percentage}%)`;
      case 'downloading':
        return `Downloading ${serverName} language server... (${percentage}%)`;
      case 'installing':
        return `Installing ${serverName} language server... (${percentage}%)`;
      case 'extracting':
        return `Extracting ${serverName} language server... (${percentage}%)`;
      case 'complete':
        return `${serverName} language server installed successfully`;
      default:
        return `Installing ${serverName} language server...`;
    }
  }

  // Stats State
  private lspStats = { activeServers: 0, filesWithDiagnostics: 0 };
  private indexerStats = { isIndexing: false, current: 0, total: 0, phase: 'idle', totalFiles: 0, totalChunks: 0 };
  private watcherStatus: 'off' | 'starting' | 'ready' | 'watching' | 'error' = 'off';

  /**
   * Factory for creating a new AiToolsService instance.
   * Registers process shutdown handlers for clean disposal.
   */
  public static create(projectPath: string): AiToolsService {
    const instance = new AiToolsService(path.resolve(projectPath));
    instance.registerProcessHandlers();
    return instance;
  }

  private registerProcessHandlers(): void {
    if (this.processHandlersRegistered) return;
    this.processHandlersRegistered = true;

    const safeDispose = () => {
      void this.dispose();
    };

    this.onBeforeExit = safeDispose;
    this.onSigInt = safeDispose;
    this.onSigTerm = safeDispose;

    process.once('beforeExit', this.onBeforeExit);
    process.once('SIGINT', this.onSigInt);
    process.once('SIGTERM', this.onSigTerm);
  }

  /**
   * Get project path for this instance
   */
  public getProjectPath(): string {
    return this.projectPath;
  }

  public async initialize() {
    await this.embedder.initialize();
    await this.vectorStore.initialize();
    
    // Initial stats
    const stats = await this.vectorStore.getStats();
    this.indexerStats.totalFiles = stats.totalFiles;
    this.indexerStats.totalChunks = stats.totalChunks;
    this.emit('status:change', this.getStats());

    // Don't start watcher during init - it blocks the event loop for 15+ seconds
    // The watcher will start lazily on first file change detection request
    // or can be started manually via ensureWatcher()
  }

  /**
   * Ensure the file watcher is running. Call this before operations that need it.
   * The watcher setup is deferred to avoid blocking during app startup.
   */
  public ensureWatcher() {
    if (!this.watcher && !this.disposed) {
      this.startWatcher();
    }
  }
  
  public getStats() {
    return {
      lsp: this.lspStats,
      indexer: this.indexerStats,
      patchModel: this.currentPatchModel,
      watcher: this.watcherStatus
    };
  }

  private startWatcher() {
    if (this.watcher) return;

    this.watcherStatus = 'starting';
    this.emit('status:change', this.getStats());
    console.error(`[AiTools] Starting file watcher worker for ${this.projectPath}...`);

    // Get the worker script path (same directory as this file)
    const workerPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'watcher-worker.ts');

    try {
      this.watcher = new Worker(workerPath, {
        workerData: { projectPath: this.projectPath }
      });

      this.watcher.on('message', (msg: { type: string; event?: string; path?: string; message?: string; elapsed?: number }) => {
        if (msg.type === 'ready') {
          console.error(`[AiTools] Watcher ready in ${msg.elapsed}ms (worker thread)`);
          this.watcherStatus = 'ready';
          this.emit('status:change', this.getStats());
        } else if (msg.type === 'change' && msg.event && msg.path) {
          // Flash "watching" status briefly when file changes detected
          this.watcherStatus = 'watching';
          this.emit('status:change', this.getStats());
          this.handleFileChange(msg.path, msg.event as 'add' | 'change' | 'unlink');
          // Reset to ready after a short delay
          setTimeout(() => {
            if (this.watcherStatus === 'watching') {
              this.watcherStatus = 'ready';
              this.emit('status:change', this.getStats());
            }
          }, 500);
        } else if (msg.type === 'log') {
          console.error(`[AiTools] ${msg.message}`);
        } else if (msg.type === 'error') {
          console.error(`[AiTools] Watcher error: ${msg.message}`);
          this.watcherStatus = 'error';
          this.emit('status:change', this.getStats());
        }
      });

      this.watcher.on('error', (err) => {
        console.error(`[AiTools] Watcher worker error: ${err.message}`);
        this.watcherStatus = 'error';
        this.emit('status:change', this.getStats());
      });

      this.watcher.on('exit', (code) => {
        if (code !== 0) {
          console.error(`[AiTools] Watcher worker exited with code ${code}`);
          this.watcherStatus = 'error';
        } else {
          this.watcherStatus = 'off';
        }
        this.watcher = null;
        this.emit('status:change', this.getStats());
      });

      console.error(`[AiTools] Watcher worker spawned`);
    } catch (err) {
      console.error(`[AiTools] Failed to start watcher worker: ${err}`);
      this.watcherStatus = 'error';
      this.emit('status:change', this.getStats());
    }
  }

  /**
   * Stop the watcher worker. Call this on cleanup/exit.
   */
  public stopWatcher() {
    if (this.watcher) {
      console.error(`[AiTools] Stopping watcher worker...`);
      this.watcher.postMessage({ type: 'shutdown' });
      // Force terminate after 1 second if it doesn't exit gracefully
      setTimeout(() => {
        if (this.watcher) {
          this.watcher.terminate();
          this.watcher = null;
          this.watcherStatus = 'off';
        }
      }, 1000);
    }
  }

  private async handleFileChange(filePath: string, event: 'add' | 'change' | 'unlink') {
    // Basic filter for code files - can be improved
    const ext = path.extname(filePath).toLowerCase();
    const codeExts = ['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.md', '.json', '.html', '.css'];

    if (!codeExts.includes(ext)) return;

    try {
      // Validate file path for safety (prevents symlink attacks, directory traversal)
      const validatedPath = await SecurityValidator.validateFilePath(filePath, this.projectPath);

      if (event === 'unlink') {
        // Remove from index using type-safe method check
        const indexerWithDelete = this.indexer as IndexerWithDelete;
        if (indexerWithDelete.deleteFile) {
          await indexerWithDelete.deleteFile(validatedPath);
        }
      } else {
        // Add/Update index
        const content = await fsp.readFile(validatedPath, 'utf-8');
        await this.indexer.indexFile(validatedPath, content);
      }
      
      // Also notify LSP if possible (LSP manager handles its own file watching usually, 
      // but we can trigger validation if needed)
      if (event !== 'unlink') {
        await this.lspManager.touchFile(filePath, true);
      }
      
    } catch (err) {
      // Silent error or log to debug file if we had one here
      // console.error(`[AiTools] Error handling file ${filePath}:`, err);
    }
  }

  /**
   * Cleanup method that properly disposes all resources.
   * Should be called when shutting down or when the component unmounts.
   */
  public async dispose() {
    if (this.disposed) {
      return; // Already disposed, prevent double cleanup
    }

    this.disposed = true;

    try {
      // Remove process handlers (registered via create())
      if (this.processHandlersRegistered) {
        if (this.onBeforeExit) process.off('beforeExit', this.onBeforeExit);
        if (this.onSigInt) process.off('SIGINT', this.onSigInt);
        if (this.onSigTerm) process.off('SIGTERM', this.onSigTerm);
        this.processHandlersRegistered = false;
        this.onBeforeExit = undefined;
        this.onSigInt = undefined;
        this.onSigTerm = undefined;
      }

      // Stop file watcher worker thread
      this.stopWatcher();

      // Dispose FastApply instance
      await this.fastApply.dispose();

      // Shutdown LSP servers
      await this.lspManager.shutdown();

      // Dispose embedder
      await this.embedder.dispose();

      // Dispose vector store
      await this.vectorStore.dispose();

      // Remove all event listeners
      this.removeAllListeners();
    } catch (err) {
      // Log but don't throw on cleanup errors to ensure full cleanup
      console.error('[AiToolsService] Error during disposal:', err);
    }
  }

  // --- Model Management ---

  /**
   * Sets the patching model with validation.
   * Throws an error if the model is not supported.
   *
   * @param model - Must be one of the supported PatchModel types
   * @throws Error if model is invalid
   */
  public async setPatchingModel(model: string): Promise<void> {
    // Validate model type with type guard
    if (!isPatchModel(model)) {
      throw new Error(
        `Invalid patch model: ${model}. Supported models: ${this.getAvailablePatchingModels().join(', ')}`
      );
    }

    if (this.currentPatchModel === model && this.fastApply) return;

    // Dispose old
    if (this.fastApply) {
      await this.fastApply.dispose();
    }

    this.currentPatchModel = model;
    // Re-create with validated model type
    this.fastApply = new FastApply({
      storageDir: path.join(this.cacheBase, 'fast-apply'),
      defaultModel: this.currentPatchModel,
      autoDownload: true
    });

    // Re-attach listeners
    this.attachFastApplyListeners();

    // Kick off a best-effort preload to trigger download if needed.
    // Do not await here: model availability depends on local downloads and should not
    // block UI startup or unit tests.
    void this.fastApply.load().catch(() => {});
  }

  /**
   * Gets the currently active patching model.
   *
   * @returns The active PatchModel
   */
  public getPatchingModel(): PatchModel {
    return this.currentPatchModel;
  }

  /**
   * Gets all available patching models.
   *
   * @returns Array of supported PatchModel values
   */
  public getAvailablePatchingModels(): PatchModel[] {
    return ['Q4_K_M', 'Q5_K_M', 'Q8_0', 'F16'];
  }

  private attachFastApplyListeners() {
      this.fastApply.on('download:progress', (p) => this.emit('download:progress', p));
      this.fastApply.on('download:complete', (p) => this.emit('download:complete', p));
      this.fastApply.on('model:loaded', () => this.emit('model:loaded'));
  }

  // --- Wrapper Methods ---

  public async semanticSearch(query: string, limit = 5) {
    return this.searcher.search(query, { limit, returnContext: true });
  }

  public async indexFile(filePath: string, content: string) {
    return this.indexer.indexFile(filePath, content);
  }

  public async getDiagnostics(filePath: string) {
    // Ensure absolute path
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

    // Trigger analysis
    await this.lspManager.touchFile(absPath, true);

    // Get results
    return this.lspManager.getDiagnosticsForFile(absPath);
  }

  /**
   * Get all diagnostics for the project.
   * Returns a map of file paths to their diagnostics arrays.
   */
  public getDiagnosticsForProject(): Record<string, any[]> {
    return this.lspManager.getAllDiagnostics();
  }

  /**
   * Subscribe to diagnostics updates from LSP servers.
   * Returns an unsubscribe function.
   *
   * @param callback - Called when diagnostics change for any file
   * @returns Function to unsubscribe
   */
  public subscribeToDiagnostics(callback: (event: { path: string; diagnostics: any[] }) => void): () => void {
    this.lspManager.on('diagnostics', callback);
    return () => {
      this.lspManager.off('diagnostics', callback);
    };
  }

  public async applyPatch(originalCode: string, patch: string) {
    return this.fastApply.apply(originalCode, patch);
  }

  // --- Hybrid Search: Semantic + Grep Fallback with On-Demand Indexing ---

  /**
   * Performs hybrid search: tries semantic search first, falls back to grep if needed.
   * Files found via grep are indexed on-demand for future semantic searches.
   */
  public async hybridSearch(
    query: string,
    limit = 10,
    options?: {
      signal?: AbortSignal;
      onResult?: (result: HybridSearchResult) => void;
      onProgress?: (count: number) => void;
    }
  ): Promise<{ results: HybridSearchResult[]; source: 'semantic' | 'grep' | 'hybrid' }> {
    const MIN_SIMILARITY_THRESHOLD = 0.3;
    const MIN_RESULTS_FOR_SEMANTIC = 2;

    // Validate query for safety (prevents DoS attacks via catastrophic backtracking)
    try {
      SecurityValidator.validateSearchQuery(query);
    } catch (error) {
      throw new Error(`Invalid search query: ${(error as Error).message}`);
    }

    // Check for abort
    if (options?.signal?.aborted) {
      return { results: [], source: 'grep' };
    }

    // 1. Try semantic search first
    try {
      const semanticResults = await this.searcher.search(query, { limit, returnContext: true });

      // Filter by quality threshold
      const goodResults = semanticResults.filter(r => r.similarity >= MIN_SIMILARITY_THRESHOLD);

      if (goodResults.length >= MIN_RESULTS_FOR_SEMANTIC) {
        // Semantic search worked well - stream results
        const mappedResults = goodResults.map(r => ({
          filePath: r.filePath,
          content: r.content,
          similarity: r.similarity,
          metadata: r.metadata,
          source: 'semantic' as const
        }));

        mappedResults.forEach((r, idx) => {
          if (options?.onResult) options.onResult(r);
          if (options?.onProgress) options.onProgress(idx + 1);
        });

        return {
          results: mappedResults,
          source: 'semantic'
        };
      }
    } catch (err) {
      // Semantic search failed, will fall back to grep
    }

    // 2. Fallback to grep with streaming support
    const grepResults: HybridSearchResult[] = [];
    await this.grepSearchStream(
      query,
      limit * 2, // Get more from grep to filter
      (result) => {
        grepResults.push(result);
        if (options?.onResult) options.onResult(result);
        if (options?.onProgress) options.onProgress(grepResults.length);
      },
      options?.signal
    );

    if (grepResults.length === 0) {
      return { results: [], source: 'grep' };
    }

    // 3. On-demand indexing: index the files we found
    // Use Array.from with Set to get unique file paths (avoids Set iteration TypeScript issue)
    const filesToIndex = Array.from(new Set(grepResults.map(r => r.filePath)));
    const indexedFiles: string[] = [];

    for (const filePath of filesToIndex.slice(0, 20)) { // Limit to 20 files to avoid blocking
      // Check for abort
      if (options?.signal?.aborted) {
        return { results: grepResults.slice(0, limit), source: 'grep' };
      }

      try {
        const content = await fsp.readFile(filePath, 'utf-8');
        await this.indexer.indexFile(filePath, content);
        indexedFiles.push(filePath);
      } catch (err) {
        // Skip files that can't be read
      }
    }

    // Update stats
    if (indexedFiles.length > 0) {
      const stats = await this.vectorStore.getStats();
      this.indexerStats.totalFiles = stats.totalFiles;
      this.indexerStats.totalChunks = stats.totalChunks;
      this.emit('status:change', this.getStats());
    }

    // 4. Try semantic search again on newly indexed files
    if (indexedFiles.length > 0) {
      try {
        const retryResults = await this.searcher.search(query, { limit, returnContext: true });
        const goodRetry = retryResults.filter(r => r.similarity >= MIN_SIMILARITY_THRESHOLD);

        if (goodRetry.length > 0) {
          return {
            results: goodRetry.map(r => ({
              filePath: r.filePath,
              content: r.content,
              similarity: r.similarity,
              metadata: r.metadata,
              source: 'semantic' as const
            })),
            source: 'hybrid' // Grep found files, semantic ranked them
          };
        }
      } catch (err) {
        // Fall through to grep results
      }
    }

    // 5. Return grep results as-is
    return {
      results: grepResults.slice(0, limit),
      source: 'grep'
    };
  }

  /**
   * Streams grep/ripgrep search results as they arrive
   */
  private async grepSearchStream(
    query: string,
    limit: number,
    onResult: (result: HybridSearchResult) => void,
    signal?: AbortSignal
  ): Promise<void> {
    return new Promise((resolve) => {
      const results: HybridSearchResult[] = [];

      // Try ripgrep first, fall back to grep
      const useRg = true;
      const cmd = useRg ? 'rg' : 'grep';
      const args = useRg
        ? [
            '--json',
            '--max-count', '3',
            '--max-filesize', '500K',
            '--type-add', 'code:*.{ts,js,tsx,jsx,py,go,rs,java,c,cpp,h,hpp,md,json}',
            '--type', 'code',
            '-i',
            query,
            this.projectPath
          ]
        : [
            '-r', '-n', '-i',
            '--include=*.ts', '--include=*.js', '--include=*.tsx', '--include=*.jsx',
            '--include=*.py', '--include=*.go', '--include=*.rs', '--include=*.java',
            query,
            this.projectPath
          ];

      const proc = spawn(cmd, args, {
        cwd: this.projectPath,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      proc.stdout.on('data', (data) => {
        stdout += data.toString();

        // Try to parse complete JSON objects for ripgrep
        if (useRg) {
          const lines = stdout.split('\n');
          // Keep the last incomplete line in stdout
          stdout = lines[lines.length - 1];

          for (let i = 0; i < lines.length - 1; i++) {
            if (lines[i].trim()) {
              try {
                const parsed = JSON.parse(lines[i]);
                if (parsed.type === 'match' && results.length < limit) {
                  const match = parsed.data;
                  const result: HybridSearchResult = {
                    filePath: match.path.text,
                    content: match.lines.text.trim(),
                    similarity: 0.5,
                    metadata: {
                      startLine: match.line_number,
                      endLine: match.line_number
                    },
                    source: 'grep'
                  };
                  results.push(result);
                  onResult(result);
                }
              } catch (e) {
                // Skip malformed lines
              }
            }
          }
        }
      });

      proc.stderr.on('data', () => { /* suppress */ });

      proc.on('close', () => {
        try {
          // Process remaining stdout if not ripgrep
          if (!useRg && stdout.trim()) {
            const lines = stdout.split('\n').filter(l => l.trim());
            for (const line of lines) {
              if (results.length >= limit) break;
              const match = line.match(/^(.+?):(\d+):(.+)$/);
              if (match) {
                const result: HybridSearchResult = {
                  filePath: match[1],
                  content: match[3].trim(),
                  similarity: 0.5,
                  metadata: {
                    startLine: parseInt(match[2]),
                    endLine: parseInt(match[2])
                  },
                  source: 'grep'
                };
                results.push(result);
                onResult(result);
              }
            }
          }
        } catch (err) {
          // Return empty on parse error
        }

        resolve();
      });

      proc.on('error', () => {
        resolve();
      });

      // Register abort signal
      signal?.addEventListener('abort', () => {
        proc.kill();
      });

      // Timeout after 5 seconds (reduced from 10 since we show progress as results arrive)
      const timeout = setTimeout(() => {
        proc.kill();
        resolve();
      }, 5000);

      proc.on('close', () => clearTimeout(timeout));
    });
  }

  /**
   * Performs grep/ripgrep search as fallback
   */
  private async grepSearch(query: string, limit: number): Promise<HybridSearchResult[]> {
    return new Promise((resolve) => {
      const results: HybridSearchResult[] = [];

      // Try ripgrep first, fall back to grep
      const useRg = true; // Most systems with dev tools have rg
      const cmd = useRg ? 'rg' : 'grep';
      const args = useRg
        ? [
            '--json',
            '--max-count', '3', // Max matches per file
            '--max-filesize', '500K',
            '--type-add', 'code:*.{ts,js,tsx,jsx,py,go,rs,java,c,cpp,h,hpp,md,json}',
            '--type', 'code',
            '-i', // Case insensitive
            query,
            this.projectPath
          ]
        : [
            '-r', '-n', '-i',
            '--include=*.ts', '--include=*.js', '--include=*.tsx', '--include=*.jsx',
            '--include=*.py', '--include=*.go', '--include=*.rs', '--include=*.java',
            query,
            this.projectPath
          ];

      const proc = spawn(cmd, args, {
        cwd: this.projectPath,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      proc.stdout.on('data', (data) => { stdout += data.toString(); });

      // Consume stderr to prevent it from interfering with TUI
      proc.stderr.on('data', () => { /* suppress */ });

      proc.on('close', () => {
        try {
          if (useRg) {
            // Parse ripgrep JSON output
            const lines = stdout.split('\n').filter(l => l.trim());
            for (const line of lines) {
              try {
                const parsed = JSON.parse(line);
                if (parsed.type === 'match') {
                  const match = parsed.data;
                  results.push({
                    filePath: match.path.text,
                    content: match.lines.text.trim(),
                    similarity: 0.5, // Grep matches get a fixed score
                    metadata: {
                      startLine: match.line_number,
                      endLine: match.line_number
                    },
                    source: 'grep'
                  });
                }
              } catch (e) {
                // Skip malformed lines
              }
            }
          } else {
            // Parse standard grep output: file:line:content
            const lines = stdout.split('\n').filter(l => l.trim());
            for (const line of lines) {
              const match = line.match(/^(.+?):(\d+):(.+)$/);
              if (match) {
                results.push({
                  filePath: match[1],
                  content: match[3].trim(),
                  similarity: 0.5,
                  metadata: {
                    startLine: parseInt(match[2]),
                    endLine: parseInt(match[2])
                  },
                  source: 'grep'
                });
              }
            }
          }
        } catch (err) {
          // Return empty on parse error
        }

        resolve(results.slice(0, limit));
      });

      proc.on('error', () => {
        // If rg not found, could retry with grep, but for simplicity just return empty
        resolve([]);
      });

      // Timeout after 5 seconds (reduced from 10)
      setTimeout(() => {
        proc.kill();
        resolve(results.slice(0, limit));
      }, 5000);
    });
  }
}
