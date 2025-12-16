/**
 * File watcher worker thread.
 * Runs chokidar in a separate thread to avoid blocking the main event loop.
 */
import { parentPort, workerData } from 'worker_threads';
import * as chokidar from 'chokidar';
import * as path from 'path';
import * as fs from 'fs';

interface WatcherConfig {
  projectPath: string;
}

const config = workerData as WatcherConfig;

// Build ignored patterns from .gitignore
const ignored: string[] = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.cache/**',
  '**/.opencode/**'
];

const gitignorePath = path.join(config.projectPath, '.gitignore');
try {
  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
  const gitignorePatterns = gitignoreContent
    .split('\n')
    .map((line: string) => line.trim())
    .filter((line: string) => line && !line.startsWith('#'))
    .map((pattern: string) => {
      if (pattern.startsWith('/')) {
        return pattern.slice(1);
      }
      return `**/${pattern}`;
    });
  ignored.push(...gitignorePatterns);
  parentPort?.postMessage({ type: 'log', message: `Loaded ${gitignorePatterns.length} patterns from .gitignore` });
} catch {
  ignored.push('**/dist/**', '**/build/**', '**/*.log', '**/*.lock');
}

// Create watcher
const startTime = Date.now();
parentPort?.postMessage({ type: 'log', message: `Starting watcher for ${config.projectPath}...` });

const watcher = chokidar.watch(config.projectPath, {
  ignored,
  persistent: true,
  ignoreInitial: true,
  usePolling: false,
  useFsEvents: true,
  atomic: true
});

watcher.on('ready', () => {
  parentPort?.postMessage({
    type: 'ready',
    elapsed: Date.now() - startTime
  });
});

watcher.on('add', (filePath: string) => {
  parentPort?.postMessage({ type: 'change', event: 'add', path: filePath });
});

watcher.on('change', (filePath: string) => {
  parentPort?.postMessage({ type: 'change', event: 'change', path: filePath });
});

watcher.on('unlink', (filePath: string) => {
  parentPort?.postMessage({ type: 'change', event: 'unlink', path: filePath });
});

watcher.on('error', (error: Error) => {
  parentPort?.postMessage({ type: 'error', message: error.message });
});

// Handle shutdown
parentPort?.on('message', (msg) => {
  if (msg.type === 'shutdown') {
    watcher.close().then(() => {
      parentPort?.postMessage({ type: 'closed' });
      process.exit(0);
    });
  }
});
