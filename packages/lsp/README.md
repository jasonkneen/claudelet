# @ai-cluso/lsp-client

Portable LSP client manager for AI code assistants. Auto-installs and manages language servers for TypeScript, Python, Go, Rust, and more.

## Installation

```bash
npm install @ai-cluso/lsp-client
# or
pnpm add @ai-cluso/lsp-client
```

## Usage

### Single Project
```typescript
import { createLSPManager, formatDiagnostic } from '@ai-cluso/lsp-client'

// Create manager with project path (recommended)
const manager = createLSPManager({
  appName: 'my-app',
  projectPath: '/path/to/project'
})

// Listen for diagnostics
manager.on('diagnostics', (event) => {
  console.log(`Diagnostics for ${event.path}:`)
  event.diagnostics.forEach(d => console.log(formatDiagnostic(d)))
})

// Touch a file to trigger LSP analysis
await manager.touchFile('/path/to/project/src/index.ts', true)

// Get diagnostics
const diags = manager.getDiagnosticsForFile('/path/to/project/src/index.ts')

// Cleanup
await manager.shutdown()
```

### Multiple Projects (Multi-Session)
```typescript
// Shell 1 - analyzing project-a
const managerA = createLSPManager({
  projectPath: '/path/to/project-a'
})

// Shell 2 - analyzing project-b (runs concurrently, fully isolated)
const managerB = createLSPManager({
  projectPath: '/path/to/project-b'
})

// Both managers can run simultaneously without interference
await Promise.all([
  managerA.touchFile('/path/to/project-a/src/index.ts'),
  managerB.touchFile('/path/to/project-b/src/app.ts')
])

// Each manager has its own instance ID for debugging
console.log('Manager A:', managerA.getInstanceId()) // e.g., "a1b2c3d4"
console.log('Manager B:', managerB.getInstanceId()) // e.g., "e5f6g7h8"

// Cleanup
await managerA.shutdown()
await managerB.shutdown()
```

## Features

- **Auto-installation**: Language servers are downloaded and cached automatically
- **Multi-language support**: TypeScript, Python, Go, Rust, and more
- **Event-based diagnostics**: Get real-time error/warning notifications
- **Portable**: Works across platforms with self-contained binaries
- **Multi-session support**: Analyze multiple projects concurrently in different shell instances
- **Per-project isolation**: Each project gets its own LSP server instances and state
- **Retry logic**: Automatic recovery from server failures with exponential backoff
- **Graceful shutdown**: Properly cleans up all server processes on exit

## Supported Languages

| Language | Server | Auto-install |
|----------|--------|--------------|
| TypeScript/JavaScript | typescript-language-server | Yes |
| Python | pylsp | Yes |
| Go | gopls | Yes |
| Rust | rust-analyzer | Yes |
| CSS/SCSS | vscode-css-languageserver | Yes |
| HTML | vscode-html-languageserver | Yes |
| JSON | vscode-json-languageserver | Yes |

## API

### `createLSPManager(options?)`

Create a new LSP manager instance.

```typescript
interface LSPManagerOptions {
  appName?: string        // Used for cache directory naming (default: 'lsp-client')
  cacheDir?: string       // Custom cache directory (overrides appName)
  bunPath?: string        // Path to bundled bun binary (for npm installs)
  projectPath?: string    // Project root path (default: process.cwd())
}

const manager = createLSPManager({
  appName: 'my-app',
  projectPath: '/path/to/project'
})
```

### `manager.getProjectPath()`

Get the project path for this manager instance.

```typescript
const path = manager.getProjectPath()
```

### `manager.getInstanceId()`

Get the unique instance ID (8-char hash of project path) for debugging.

```typescript
const id = manager.getInstanceId() // e.g., "a1b2c3d4"
```

### `manager.setProjectPath(path)` [Deprecated]

Set the project root path for LSP analysis.

**Note**: This method is deprecated. Use `projectPath` in constructor options instead. Creating a new LSPManager instance is preferred for switching projects.

### `manager.touchFile(path, waitForDiagnostics?)`

Notify the LSP that a file has been opened/changed.

```typescript
// Trigger analysis without waiting
await manager.touchFile('/path/to/file.ts')

// Wait for diagnostics to arrive (max 3s)
await manager.touchFile('/path/to/file.ts', true)
```

### `manager.getDiagnosticsForFile(path)`

Get current diagnostics for a specific file.

```typescript
const diags = manager.getDiagnosticsForFile('/path/to/file.ts')
```

### `manager.getAllDiagnostics()`

Get all diagnostics across all files in the project.

```typescript
const allDiags = manager.getAllDiagnostics()
// Returns: { [filePath: string]: Diagnostic[] }
```

### `manager.getStatus()`

Get status of all language servers (for UI/debugging).

```typescript
const status = await manager.getStatus()
// Returns array of ServerStatus objects with install/running state
```

### `manager.shutdown()`

Cleanup and shutdown all LSP servers.

```typescript
await manager.shutdown()
```

## Events

The LSPManager extends EventEmitter and emits the following events:

```typescript
manager.on('diagnostics', (event: { path: string; diagnostics: Diagnostic[] }) => {
  // Diagnostics updated for a file
})

manager.on('server-started', (event: { serverId: string; root: string }) => {
  // LSP server started
})

manager.on('server-closed', (event: { serverId: string; root: string }) => {
  // LSP server closed
})

manager.on('server-status-changed', (event: { serverId: string; enabled: boolean }) => {
  // Server enabled/disabled
})

manager.on('server-installing', (event: { serverId: string; progress: InstallProgress }) => {
  // Server installation progress
})

manager.on('server-retrying', (event: { serverId: string; root: string; attempt: number }) => {
  // Server retry attempt
})
```

## License

MIT
