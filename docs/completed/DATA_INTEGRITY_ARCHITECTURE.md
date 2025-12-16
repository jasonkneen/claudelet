# Claudelet Data Integrity - Architecture Improvements

## Current Data Flow (UNSAFE)

```
User Input
    ↓
State Update (React)
    ↓
    ├─→ Display to User (sync) ✓
    │
    └─→ Auto-Save to Disk (async, no wait)
            ↓
        File System Write (VULNERABLE)
            ├─→ Race: Multiple writes
            ├─→ No atomicity
            └─→ No validation on load

Claude Response
    ↓
Parse Response
    ↓
Update State + Messages
    ↓
    ├─→ Display to User (sync) ✓
    │
    └─→ Auto-Save to Disk (no transaction)
            ↓
        Partial State Written (CRASH HERE = LOSS)
```

**Problems:**
- No atomicity between state update and save
- Concurrent saves corrupt files
- Crashes lose recent data
- No recovery mechanism

---

## Proposed Data Flow (SAFE)

```
User Input
    ↓
    ├─→ Acquire Session Lock
    │       ├─→ Wait if locked
    │       └─→ Timeout if held too long
    │
    ├─→ Update Local State (React)
    │
    ├─→ Write to Disk Atomically
    │   ├─→ Write to temp file
    │   ├─→ Validate JSON schema
    │   └─→ Atomic rename (no corruption possible)
    │
    ├─→ Update Message Queue (if applicable)
    │   ├─→ Persist to disk
    │   └─→ Atomic write
    │
    └─→ Release Session Lock
            ↓
        Display to User

Claude Response
    ↓
    ├─→ Acquire Session Lock
    │
    ├─→ Parse Response
    │
    ├─→ Begin Transaction
    │   ├─→ Update messages in memory
    │   ├─→ Update tokens
    │   ├─→ Prepare all state changes
    │   │
    │   ├─→ Atomic Write Session
    │   │   ├─→ Temp file
    │   │   ├─→ Validate
    │   │   └─→ Rename
    │   │
    │   └─→ Commit (all-or-nothing)
    │
    ├─→ Release Session Lock
    │
    └─→ Display to User
```

**Benefits:**
- Atomicity: All-or-nothing updates
- Consistency: Schema validated before save
- Isolation: File locks prevent concurrent writes
- Durability: Atomic renames guarantee no corruption

---

## Transaction Model

### Message Add Transaction

```typescript
async function addMessageTransaction(
  session: SessionData,
  message: StoredMessage
): Promise<void> {
  const lock = new SessionLock(session.sessionId);

  try {
    // 1. Acquire exclusive lock
    await lock.acquire(5000);

    // 2. Prepare changes in memory
    const updatedSession = {
      ...session,
      messages: [...session.messages, message],
      updatedAt: new Date().toISOString()
    };

    // 3. Validate new state
    const validation = SessionDataSchema.safeParse(updatedSession);
    if (!validation.success) {
      throw new Error(`Validation failed: ${validation.error.message}`);
    }

    // 4. Atomic write (temp + rename)
    await saveSession(updatedSession);

    // 5. Update in-memory reference
    Object.assign(session, updatedSession);

  } finally {
    // 6. Release lock
    await lock.release();
  }
}
```

### Response Transaction

```typescript
async function completeResponseTransaction(
  session: SessionData,
  assistantMessage: StoredMessage,
  newTokens: { input: number; output: number }
): Promise<void> {
  const lock = new SessionLock(session.sessionId);

  try {
    await lock.acquire(5000);

    const updatedSession = {
      ...session,
      messages: [...session.messages, assistantMessage],
      inputTokens: session.inputTokens + newTokens.input,
      outputTokens: session.outputTokens + newTokens.output,
      updatedAt: new Date().toISOString()
    };

    // Validate entire state before writing
    const validation = SessionDataSchema.safeParse(updatedSession);
    if (!validation.success) {
      throw new Error(`Response transaction validation failed`);
    }

    // Atomic write
    await saveSession(updatedSession);

    // Update reference
    Object.assign(session, updatedSession);

  } finally {
    await lock.release();
  }
}
```

---

## Directory Structure (Improved)

```
~/.claudelet/
├── sessions/              # Session data
│   ├── 2024-12-16_14-30_a1b2c3d4.json
│   ├── 2024-12-16_14-30_a1b2c3d4.json.corrupted  # Backups of failures
│   ├── .lock_sessionId1   # Lock files (temp)
│   └── .lock_sessionId2
│
├── queues/               # Persistent message queues
│   ├── sessionId1.json
│   ├── sessionId1.json.tmp
│   └── sessionId2.json
│
├── backups/              # Backup copies of sessions
│   ├── daily/
│   │   └── 2024-12-16/
│   │       ├── a1b2c3d4.json
│   │       └── e5f6g7h8.json
│   └── recovered/        # Sessions recovered from corruption
│       └── a1b2c3d4.json
│
├── recovery/             # Recovery journal for crash handling
│   ├── transaction.log   # Current transaction in progress
│   └── failed/           # Failed transactions
│       └── 2024-12-16_14-30.json
│
└── cache/                # LSP cache, embeddings, etc.
    ├── lsp/
    ├── fast-apply/
    └── mgrep/
```

---

## Recovery Mechanisms

### Automatic Recovery (On Startup)

```typescript
export async function recoverCorruptedSessions(): Promise<void> {
  const sessionsDir = getSessionsDir();
  const files = await fsp.readdir(sessionsDir);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const filePath = path.join(sessionsDir, file);

    try {
      // Try to load and validate
      const content = await fsp.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      SessionDataSchema.parse(parsed);

      // Valid file, skip
      continue;

    } catch (err) {
      console.warn(`Corrupted session found: ${file}`);

      // 1. Try to recover from backup
      const backupPath = path.join(sessionsDir, file.replace('.json', '.bak'));
      if (fs.existsSync(backupPath)) {
        console.log(`Recovering from backup: ${backupPath}`);
        await fsp.copyFile(backupPath, filePath);
        continue;
      }

      // 2. If corrupted file, move it and create empty placeholder
      const corruptedPath = path.join(sessionsDir, file.replace('.json', '.corrupted'));
      await fsp.rename(filePath, corruptedPath);

      console.log(`Moved to: ${corruptedPath}`);
      console.log('User should review corrupted file for manual recovery');
    }
  }
}
```

### Manual Recovery Tools

```typescript
/**
 * Analyze corrupted session file and extract what's salvageable
 */
export async function analyzeCorruptedSession(filePath: string): Promise<{
  isPartiallyValid: boolean;
  recoverable: Partial<SessionData> | null;
  errors: string[];
}> {
  try {
    const content = await fsp.readFile(filePath, 'utf-8');

    // Try to find JSON object boundaries
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      return {
        isPartiallyValid: false,
        recoverable: null,
        errors: ['No JSON object found in file']
      };
    }

    const partial = JSON.parse(match[0]);

    // Check what fields are present
    const errors: string[] = [];
    const recoverable: Partial<SessionData> = {};

    if (partial.sessionId) recoverable.sessionId = partial.sessionId;
    else errors.push('Missing sessionId');

    if (partial.messages) {
      // Try to salvage messages array
      if (Array.isArray(partial.messages)) {
        const validMessages = partial.messages.filter((m: any) =>
          m.role && m.content && m.timestamp
        );
        if (validMessages.length > 0) {
          recoverable.messages = validMessages;
        } else {
          errors.push('Messages array present but empty or invalid');
        }
      }
    } else {
      errors.push('Missing messages array');
    }

    // Copy other fields if present
    if (partial.createdAt) recoverable.createdAt = partial.createdAt;
    if (partial.updatedAt) recoverable.updatedAt = partial.updatedAt;
    if (partial.model) recoverable.model = partial.model;
    if (typeof partial.inputTokens === 'number') recoverable.inputTokens = partial.inputTokens;
    if (typeof partial.outputTokens === 'number') recoverable.outputTokens = partial.outputTokens;
    if (partial.status) recoverable.status = partial.status;
    if (partial.workingDirectory) recoverable.workingDirectory = partial.workingDirectory;

    return {
      isPartiallyValid: Object.keys(recoverable).length > 2,
      recoverable: Object.keys(recoverable).length > 0 ? recoverable : null,
      errors
    };

  } catch (err) {
    return {
      isPartiallyValid: false,
      recoverable: null,
      errors: [`Parse failed: ${err.message}`]
    };
  }
}
```

---

## Backup Strategy

### Automatic Backups

```typescript
export async function createBackup(session: SessionData): Promise<string> {
  const backupDir = path.join(getSessionsDir(), 'backups', 'daily', getTodayDate());
  await fsp.mkdir(backupDir, { recursive: true });

  const backupFile = path.join(backupDir, `${session.sessionId}.json`);
  const json = JSON.stringify(session, null, 2);

  await fsp.writeFile(backupFile, json, 'utf-8');
  return backupFile;
}

// Call after every major operation
export async function saveSessionWithBackup(session: SessionData): Promise<void> {
  // Create backup first (in case save fails)
  try {
    await createBackup(session);
  } catch (err) {
    console.warn('Backup failed:', err);
    // Continue anyway - backup not critical
  }

  // Then save
  await saveSession(session);
}

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}
```

### Cleanup Old Backups

```typescript
export async function cleanupOldBackups(daysToKeep = 7): Promise<void> {
  const backupDir = path.join(getSessionsDir(), 'backups', 'daily');
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  try {
    const dateFolders = await fsp.readdir(backupDir);

    for (const dateFolder of dateFolders) {
      const folderDate = new Date(dateFolder);
      if (folderDate < cutoffDate) {
        const folderPath = path.join(backupDir, dateFolder);
        await fsp.rm(folderPath, { recursive: true });
        console.log(`Deleted old backup: ${dateFolder}`);
      }
    }
  } catch (err) {
    console.warn('Backup cleanup failed:', err);
  }
}
```

---

## Vector Store Safety

### Safe Indexing with Transactions

```typescript
async function indexFilesSafely(files: string[]): Promise<void> {
  const batchSize = 32;
  const vectorStore = this.vectorStore;

  // Create checkpoint before indexing
  const checkpointId = crypto.randomBytes(8).toString('hex');
  const checkpoint = await vectorStore.createCheckpoint(checkpointId);

  try {
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);

      for (const filePath of batch) {
        const content = await fsp.readFile(filePath, 'utf-8');
        await this.indexer.indexFile(filePath, content);
      }

      // Periodic checkpoints every 32 files
      if ((i + batchSize) % 128 === 0) {
        await vectorStore.commit(); // Persist this batch
        console.log(`Indexed ${i + batchSize}/${files.length} files`);
      }
    }

    // Final commit
    await vectorStore.commit();

  } catch (err) {
    console.error('Indexing failed, rolling back to checkpoint:', err);
    await vectorStore.rollback(checkpoint);
    throw err;
  }
}
```

---

## Monitoring & Observability

### Data Integrity Metrics

```typescript
export interface IntegrityMetrics {
  sessionsWritten: number;
  sessionsFailed: number;
  corruptedSessionsDetected: number;
  corruptedSessionsRecovered: number;
  saveLatencyMs: { avg: number; p95: number; p99: number };
  lockWaitTimeMs: { avg: number; max: number };
  validationErrors: number;
}

class IntegrityMonitor {
  private metrics: IntegrityMetrics = {
    sessionsWritten: 0,
    sessionsFailed: 0,
    corruptedSessionsDetected: 0,
    corruptedSessionsRecovered: 0,
    saveLatencyMs: { avg: 0, p95: 0, p99: 0 },
    lockWaitTimeMs: { avg: 0, max: 0 },
    validationErrors: 0
  };

  async recordSave(latencyMs: number, success: boolean): Promise<void> {
    if (success) {
      this.metrics.sessionsWritten++;
    } else {
      this.metrics.sessionsFailed++;
    }

    // Update latency tracking
    this.updateLatency(latencyMs);
  }

  recordCorruptionDetected(): void {
    this.metrics.corruptedSessionsDetected++;
  }

  recordCorruptionRecovered(): void {
    this.metrics.corruptedSessionsRecovered++;
  }

  recordValidationError(): void {
    this.metrics.validationErrors++;
  }

  getMetrics(): IntegrityMetrics {
    return { ...this.metrics };
  }

  private updateLatency(latencyMs: number): void {
    // Simplified - in production use proper percentile calculation
    const current = this.metrics.saveLatencyMs.avg;
    this.metrics.saveLatencyMs.avg = (current + latencyMs) / 2;
  }
}

// Export metrics periodically
setInterval(async () => {
  const metrics = monitor.getMetrics();
  console.log('[METRICS]', JSON.stringify(metrics));
  // Send to monitoring system (Datadog, New Relic, etc.)
}, 60000); // Every minute
```

---

## Deployment Checklist

- [ ] Atomic write implementation (session-storage.ts)
- [ ] Schema validation with Zod
- [ ] Async shutdown handlers
- [ ] Encryption for auth storage
- [ ] Session locking mechanism
- [ ] File watcher queue system
- [ ] Persistent message queue
- [ ] Recovery tools + backups
- [ ] Monitoring & metrics
- [ ] Testing suite (crash scenarios)
- [ ] Migration script for existing sessions
- [ ] Documentation for ops team

---

## Performance Considerations

### Latency Impact

| Operation | Current | With Safety | Delta |
|-----------|---------|------------|-------|
| Save Session | 2-5ms | 5-10ms | +3-5ms |
| Acquire Lock | N/A | 0-1ms | +0-1ms |
| Validate Schema | N/A | 1-2ms | +1-2ms |
| Atomic Rename | N/A | <1ms | <1ms |

**Total overhead: ~5-10ms per save operation**

This is acceptable for CLI app (saves happen every 1-2 seconds max).

### Scalability

- File locking: Works for single user, multiple terminals (recommended limit: 5 concurrent)
- Message queue: Persistent disk storage (no memory limits)
- Backups: Daily folders (7-day retention = ~350MB typical)

---

## Future Improvements

1. **SQLite for Session Storage**: Replace JSON files with structured database
   - Built-in transactions
   - ACID guarantees
   - Better concurrency control
   - Efficient querying

2. **Event Sourcing**: Track all changes as immutable events
   - Complete audit trail
   - Point-in-time recovery
   - Replay capability
   - Easier debugging

3. **Vector Store with WAL**: Write-ahead logging for embeddings
   - Crash recovery
   - Transaction support
   - Atomic bulk updates

4. **Distributed Locking**: Redis or similar for multi-machine sessions
   - Share sessions across devices
   - True concurrent access
   - Centralized coordination

This architecture prioritizes **safety, consistency, and recoverability** while maintaining acceptable performance for a CLI application.
