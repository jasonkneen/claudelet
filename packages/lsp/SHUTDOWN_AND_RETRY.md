# LSP Resource Management & Graceful Shutdown

## Overview

This document describes the resource management improvements made to the LSP system, focusing on graceful shutdown and retry logic.

## Changes Made

### 1. Graceful Process Exit Handlers (`bin/claudelet-opentui.tsx`)

**Problem**: LSP servers were left running as orphaned processes when the application exited.

**Solution**:
- Added async `safeCleanup()` function that calls `AiToolsService.dispose()`
- Updated SIGTERM and SIGINT handlers to properly await cleanup
- Ensured process waits for shutdown before exiting

**Code Changes**:
```typescript
process.on('SIGINT', async () => {
  debugLog('SIGINT received')
  await safeCleanup()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  debugLog('SIGTERM received')
  await safeCleanup()
  process.exit(0)
})
```

### 2. Timeout-Aware Shutdown (`packages/lsp/src/client.ts`)

**Problem**: Server shutdown could hang indefinitely if servers didn't respond.

**Solution**:
- Implemented 5-second timeout for graceful shutdown
- Force kill with SIGKILL if server doesn't exit
- Properly close stdio pipes to prevent resource leaks

**Implementation**:
```typescript
async shutdown(): Promise<void> {
  const SHUTDOWN_TIMEOUT = 5000

  // Send shutdown request
  await this._sendRequest('shutdown', null)
  this._sendNotification('exit', null)

  // Wait with timeout
  await Promise.race([
    waitForExit(),
    timeout(SHUTDOWN_TIMEOUT)
  ])

  // Force kill if needed
  if (!this.process.killed) {
    this.process.kill('SIGKILL')
  }

  // Close pipes
  this.process.stdin?.end()
  this.process.stdout?.destroy()
  this.process.stderr?.destroy()
}
```

### 3. Retry Logic with Exponential Backoff (`packages/lsp/src/manager.ts`)

**Problem**: Failed servers were marked as broken and never restarted.

**Solution**:
- Created `RetryStrategy` class with exponential backoff
- Retry delays: 1s, 2s, 4s, 8s, 16s (max 5 attempts)
- Clear broken state after successful retry
- Emit `server-retrying` event for debugging

**RetryStrategy API**:
```typescript
class RetryStrategy {
  scheduleRetry(key: string, retryFn: () => Promise<void>): void
  clearRetries(key: string): void
  cancelAll(): void
  getRetryCount(key: string): number
}
```

**Integration**:
```typescript
// On spawn failure
this.retryStrategy.scheduleRetry(key, async () => {
  this.emit('server-retrying', { serverId, root, attempt })
  await this._retrySpawn(server, root, key)
})

// On successful spawn
this.retryStrategy.clearRetries(key)
this.broken.delete(key)

// On shutdown
this.retryStrategy.cancelAll()
```

### 4. Test Coverage

Created comprehensive test suites:

**`tests/shutdown.test.ts`**:
- Timeout-aware shutdown behavior
- Force kill after timeout
- Stdio pipe cleanup
- Already-exited process handling

**`tests/retry.test.ts`**:
- Exponential backoff validation
- Retry event emission
- Retry cancellation on shutdown

**`tests/integration.test.ts`**:
- Full lifecycle testing
- Resource leak prevention
- Concurrent operations
- Multiple init/shutdown cycles

## Event Types

Added new event type to `LSPManagerEvents`:

```typescript
export interface LSPManagerEvents {
  // ... existing events
  'server-retrying': { serverId: string; root: string; attempt: number }
}
```

## Usage

### Monitoring Retries

```typescript
lspManager.on('server-retrying', (event) => {
  console.log(`Retry ${event.attempt}/5 for ${event.serverId}`)
})
```

### Graceful Shutdown

```typescript
// In main process
process.on('SIGTERM', async () => {
  const aiTools = AiToolsService.getInstance(process.cwd())
  await aiTools.dispose() // Shuts down LSP servers
  process.exit(0)
})
```

## Testing

Run tests:
```bash
cd packages/lsp
npm test
```

Run with coverage:
```bash
npm run test:coverage
```

Watch mode:
```bash
npm run test:watch
```

## Retry Behavior

| Attempt | Delay | Cumulative Time |
|---------|-------|-----------------|
| 1       | 1s    | 1s              |
| 2       | 2s    | 3s              |
| 3       | 4s    | 7s              |
| 4       | 8s    | 15s             |
| 5       | 16s   | 31s             |

After 5 failed attempts, the server remains in the broken set until manually re-enabled or the application restarts.

## Resource Management Checklist

✅ Exit handlers registered for SIGTERM/SIGINT
✅ Async cleanup awaited before exit
✅ Timeout-aware shutdown (5 second limit)
✅ Force kill for unresponsive servers
✅ Stdio pipes properly closed
✅ Retry logic with exponential backoff
✅ Broken state cleared on success
✅ All retries cancelled on shutdown
✅ Comprehensive test coverage

## Known Limitations

1. **Max Retries**: After 5 failed attempts, manual intervention required
2. **Timeout Fixed**: 5 second timeout is not configurable
3. **Retry Delays**: Exponential backoff schedule is fixed

## Future Improvements

- [ ] Make shutdown timeout configurable
- [ ] Add configurable retry strategy
- [ ] Implement circuit breaker pattern
- [ ] Add metrics for retry success rate
- [ ] Support custom backoff strategies
