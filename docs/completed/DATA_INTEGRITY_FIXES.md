# Claudelet Data Integrity - Quick Fix Guide

## Critical Fixes - Implement First

### Fix 1: Atomic Session Saves (session-storage.ts)

**Current Code (UNSAFE):**
```typescript
export async function saveSession(session: SessionData): Promise<string> {
  await ensureSessionsDir();
  const filePath = getSessionPath(session.sessionId, session.createdAt);
  session.updatedAt = new Date().toISOString();
  await fsp.writeFile(filePath, JSON.stringify(session, null, 2));
  return filePath;
}
```

**Fixed Code (SAFE):**
```typescript
export async function saveSession(session: SessionData): Promise<string> {
  await ensureSessionsDir();
  const filePath = getSessionPath(session.sessionId, session.createdAt);
  const tmpPath = filePath + '.tmp';

  session.updatedAt = new Date().toISOString();

  // Write to temp file first
  const json = JSON.stringify(session, null, 2);
  await fsp.writeFile(tmpPath, json, 'utf-8');

  // Atomic rename - prevents corruption
  try {
    await fsp.rename(tmpPath, filePath);
  } catch (err) {
    // Cleanup on failure
    await fsp.unlink(tmpPath).catch(() => {});
    throw err;
  }

  return filePath;
}
```

**Also Fix Sync Version:**
```typescript
export function saveSessionSync(session: SessionData): string {
  const dir = getSessionsDir();
  fs.mkdirSync(dir, { recursive: true });

  const filePath = getSessionPath(session.sessionId, session.createdAt);
  session.updatedAt = new Date().toISOString();

  const json = JSON.stringify(session, null, 2);
  const tmpPath = filePath + '.tmp';

  // Write to temp, then atomically rename
  fs.writeFileSync(tmpPath, json, 'utf-8');
  fs.renameSync(tmpPath, filePath);

  return filePath;
}
```

---

### Fix 2: Async Graceful Shutdown (claudelet-opentui.tsx)

**Current Code (UNSAFE):**
```typescript
process.on('SIGINT', () => {
  debugLog('SIGINT received');
  safeCleanup();
  process.exit(0); // ← Doesn't wait for async operations
});
```

**Fixed Code (SAFE):**
```typescript
async function gracefulShutdown() {
  try {
    debugLog('Starting graceful shutdown...');

    // 1. Save session (wait for it)
    if (sessionDataRef.current) {
      debugLog('Saving session...');
      await autoSaveSession().catch(err => {
        debugLog(`Auto-save failed: ${err}`);
      });
    }

    // 2. Dispose AI tools
    if (state.aiTools) {
      debugLog('Disposing AI tools...');
      await state.aiTools.dispose().catch(err => {
        debugLog(`Dispose failed: ${err}`);
      });
    }

    // 3. Cleanup terminal
    debugLog('Cleaning up terminal...');
    cleanup();

  } catch (err) {
    debugLog(`Shutdown error: ${err}`);
  } finally {
    debugLog('Shutdown complete, exiting');
    process.exit(0);
  }
}

process.on('SIGINT', async () => {
  if (!cleanupCalled) {
    cleanupCalled = true;
    await gracefulShutdown();
  }
});

process.on('SIGTERM', async () => {
  if (!cleanupCalled) {
    cleanupCalled = true;
    await gracefulShutdown();
  }
});

process.on('uncaughtException', async (err) => {
  debugLog(`Uncaught exception: ${err}`);
  if (!cleanupCalled) {
    cleanupCalled = true;
    await gracefulShutdown();
  }
});
```

---

### Fix 3: Session Schema Validation (session-storage.ts)

**Install Zod:**
```bash
npm install zod
```

**Add Validation:**
```typescript
import { z } from 'zod';

const StoredMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().min(1),
  timestamp: z.string().datetime(),
  toolName: z.string().optional(),
  toolInput: z.record(z.unknown()).optional(),
  toolResult: z.string().optional()
});

const SessionDataSchema = z.object({
  sessionId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  model: z.string(),
  workingDirectory: z.string(),
  messages: z.array(StoredMessageSchema),
  inputTokens: z.number().int().non_negative(),
  outputTokens: z.number().int().non_negative(),
  status: z.enum(['active', 'completed']).default('active')
});

type SessionData = z.infer<typeof SessionDataSchema>;

export async function loadSession(filePath: string): Promise<SessionData | null> {
  try {
    const content = await fsp.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);

    // Validate schema
    const result = SessionDataSchema.safeParse(parsed);

    if (!result.success) {
      console.error(`Session validation failed for ${filePath}`);
      console.error('Errors:', result.error.errors);

      // Save a backup of corrupted file
      await fsp.copyFile(filePath, filePath + '.corrupted').catch(() => {});

      return null;
    }

    return result.data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null; // File doesn't exist
    }
    console.error(`Failed to load session from ${filePath}:`, err);
    return null;
  }
}
```

---

### Fix 4: Encrypt Auth Storage (auth-storage.ts)

**Install dependency:**
```bash
npm install crypto # (built-in, no install needed)
```

**Replace auth-storage.ts:**
```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import type { OAuthTokens } from '@anthropic-ai/anthropic-oauth';

const AUTH_FILE = path.join(os.homedir(), '.claude-agent-auth.json');
const AUTH_KEY_FILE = path.join(os.homedir(), '.claude-agent-key');

export interface StoredAuth {
  type: 'api-key' | 'oauth';
  apiKey?: string;
  oauthTokens?: OAuthTokens;
}

// Ensure encryption key exists (one-time setup)
function ensureEncryptionKey(): Buffer {
  try {
    if (fs.existsSync(AUTH_KEY_FILE)) {
      return fs.readFileSync(AUTH_KEY_FILE);
    }

    // Create new key with restricted permissions
    const key = crypto.randomBytes(32);
    fs.writeFileSync(AUTH_KEY_FILE, key, { mode: 0o600 });
    return key;
  } catch (error) {
    console.error('Failed to manage encryption key:', error);
    throw new Error('Failed to initialize auth encryption');
  }
}

function encryptAuth(auth: StoredAuth): string {
  try {
    const key = ensureEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const json = JSON.stringify(auth);
    let encrypted = cipher.update(json, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return JSON.stringify({
      version: 1,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      data: encrypted
    });
  } catch (error) {
    console.error('Encryption failed:', error);
    throw new Error('Failed to encrypt auth data');
  }
}

function decryptAuth(encrypted: string): StoredAuth {
  try {
    const key = ensureEncryptionKey();
    const { iv, authTag, data } = JSON.parse(encrypted);

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error('Failed to decrypt auth data - may be corrupted');
  }
}

export function loadAuth(): StoredAuth | null {
  try {
    if (!fs.existsSync(AUTH_FILE)) {
      return null;
    }

    const encrypted = fs.readFileSync(AUTH_FILE, 'utf8');
    return decryptAuth(encrypted);
  } catch (error) {
    console.error('Failed to load auth:', error);
    return null;
  }
}

export function saveAuth(auth: StoredAuth): void {
  try {
    const encrypted = encryptAuth(auth);
    // Write with restricted permissions (owner only)
    fs.writeFileSync(AUTH_FILE, encrypted, { mode: 0o600, encoding: 'utf8' });
    debugLog('Auth saved securely');
  } catch (error) {
    console.error('Failed to save auth:', error);
    throw error;
  }
}

export function clearAuth(): void {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      fs.unlinkSync(AUTH_FILE);
    }
    // Also clear key on logout (forces re-setup next time)
    if (fs.existsSync(AUTH_KEY_FILE)) {
      fs.unlinkSync(AUTH_KEY_FILE);
    }
  } catch (error) {
    console.error('Failed to clear auth:', error);
  }
}
```

---

### Fix 5: File Watcher Race Condition (claudelet-ai-tools.ts)

**Current Code (UNSAFE):**
```typescript
private async handleFileChange(filePath: string, event: 'add' | 'change' | 'unlink') {
  const ext = path.extname(filePath).toLowerCase();
  const codeExts = ['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs', '.java'];

  if (!codeExts.includes(ext)) return;

  try {
    if (event === 'unlink') {
      if ('deleteFile' in this.indexer) {
        await (this.indexer as any).deleteFile(filePath);
      }
    } else {
      const content = await fsp.readFile(filePath, 'utf-8');
      await this.indexer.indexFile(filePath, content); // ← Can race!
    }
  } catch (err) {
    // Silent error
  }
}
```

**Fixed Code (SAFE):**
```typescript
private fileIndexingQueue = new Map<string, Promise<void>>();

private async handleFileChange(filePath: string, event: 'add' | 'change' | 'unlink') {
  const ext = path.extname(filePath).toLowerCase();
  const codeExts = ['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.md', '.json'];

  if (!codeExts.includes(ext)) return;

  // Get the previous operation for this file (if any)
  const previousPromise = this.fileIndexingQueue.get(filePath);

  // Chain this operation after the previous one
  const newPromise = (previousPromise || Promise.resolve())
    .then(async () => {
      try {
        if (event === 'unlink') {
          if ('deleteFile' in this.indexer) {
            await (this.indexer as any).deleteFile(filePath);
          }
        } else {
          // Read file content
          const content = await fsp.readFile(filePath, 'utf-8');
          // Index it (no concurrent operations for same file)
          await this.indexer.indexFile(filePath, content);
        }
      } catch (err) {
        console.error(`[AiTools] Error handling file ${filePath}:`, err);
      }
    });

  // Store the new promise
  this.fileIndexingQueue.set(filePath, newPromise);

  // Clean up when done
  newPromise.finally(() => {
    if (this.fileIndexingQueue.get(filePath) === newPromise) {
      this.fileIndexingQueue.delete(filePath);
    }
  });
}
```

---

## High Priority Fixes

### Fix 6: Persistent Message Queue

**Location:** `src/message-queue-persistence.ts` (NEW FILE)

```typescript
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export interface QueuedMessage {
  id: string;
  text: string;
  priority: 'urgent' | 'normal' | 'todo';
  addedAt: string;
}

export class PersistentMessageQueue {
  private queueFile: string;

  constructor(sessionId: string) {
    const queueDir = path.join(os.homedir(), '.claudelet', 'queues');
    this.queueFile = path.join(queueDir, `${sessionId}.json`);
  }

  async loadQueue(): Promise<QueuedMessage[]> {
    try {
      const content = await fsp.readFile(this.queueFile, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      return [];
    }
  }

  async saveQueue(messages: QueuedMessage[]): Promise<void> {
    const dir = path.dirname(this.queueFile);
    await fsp.mkdir(dir, { recursive: true });

    const tmpPath = this.queueFile + '.tmp';
    await fsp.writeFile(tmpPath, JSON.stringify(messages, null, 2), 'utf-8');
    await fsp.rename(tmpPath, this.queueFile);
  }

  async clearQueue(): Promise<void> {
    try {
      await fsp.unlink(this.queueFile);
    } catch (err) {
      // File doesn't exist, that's fine
    }
  }
}
```

**Update SessionData schema:**
```typescript
export interface SessionData {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  workingDirectory: string;
  messages: StoredMessage[];
  inputTokens: number;
  outputTokens: number;
  status: SessionStatus;
  pendingMessages?: QueuedMessage[]; // ← Add this
}
```

---

### Fix 7: Session Locking

**Location:** `src/session-lock.ts` (NEW FILE)

```typescript
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { getSessionsDir } from './session-storage';

export class SessionLock {
  private lockPath: string;
  private lockAcquired = false;
  private lockTimeout: NodeJS.Timeout | null = null;

  constructor(sessionId: string) {
    this.lockPath = path.join(getSessionsDir(), `.lock_${sessionId}`);
  }

  async acquire(timeoutMs = 5000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Try to create lock file exclusively
        await fsp.writeFile(this.lockPath, process.pid.toString(), {
          flag: 'wx' // fail if exists
        });

        this.lockAcquired = true;

        // Refresh lock every second (prevent stale locks)
        this.lockTimeout = setInterval(async () => {
          try {
            await fsp.writeFile(this.lockPath, process.pid.toString());
          } catch (err) {
            // Lost lock, exit
            process.exit(1);
          }
        }, 1000);

        return;
      } catch (err) {
        if ((err as any).code !== 'EEXIST') throw err;

        // Lock exists, wait and retry
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    throw new Error(`Failed to acquire session lock after ${timeoutMs}ms`);
  }

  async release(): Promise<void> {
    if (this.lockTimeout) {
      clearInterval(this.lockTimeout);
    }

    if (this.lockAcquired) {
      try {
        await fsp.unlink(this.lockPath);
        this.lockAcquired = false;
      } catch (err) {
        console.error('Failed to release lock:', err);
      }
    }
  }
}
```

---

## Testing Checklist

Before deploying, test these scenarios:

```bash
# Test 1: Crash during session save
# 1. Start claudelet, send a message
# 2. Kill -9 PID during response
# 3. Restart and verify session recovered

# Test 2: Concurrent instances
# 1. Start claudelet in two terminals with same session
# 2. Send message in both
# 3. Verify no data loss (check .claudelet/sessions/*.json)

# Test 3: File watcher race
# 1. Create rapidly changing file
# 2. Verify indexer doesn't corrupt embeddings
# 3. Check .opencode/vectors integrity

# Test 4: Auth encryption
# 1. Save OAuth tokens
# 2. Verify ~/.claude-agent-auth.json is encrypted
# 3. Verify file permissions are 600

# Test 5: Queue persistence
# 1. Queue messages while responding
# 2. Kill process mid-response
# 3. Verify queued messages survive restart
```

---

## Migration Script

Run this to fix existing sessions:

```bash
#!/bin/bash
# migrate-sessions.sh

SESSIONS_DIR="$HOME/.claudelet/sessions"

for file in "$SESSIONS_DIR"/*.json; do
  if [ -f "$file" ]; then
    # Try to parse and re-save atomically
    if jq empty "$file" 2>/dev/null; then
      echo "✓ Valid: $file"
    else
      echo "✗ Corrupted: $file"
      if [ -f "${file}.corrupted" ]; then
        echo "  Already has backup"
      else
        mv "$file" "${file}.corrupted"
        echo "  Saved backup: ${file}.corrupted"
      fi
    fi
  fi
done

echo "Migration complete"
```

---

## Dependencies to Add

```json
{
  "dependencies": {
    "zod": "^3.22.0"
  }
}
```

---

## Timeline

- **Day 1**: Implement atomic writes + async shutdown + schema validation
- **Day 2**: Add encryption + session locking
- **Day 3**: Fix file watcher + persistent queue
- **Day 4**: Testing + migration
- **Day 5**: Documentation + deployment

---

## Monitoring & Alerts

Add this to your logging:

```typescript
const INTEGRITY_ERRORS = {
  SESSION_SAVE_FAILED: 'session:save:failed',
  SESSION_LOAD_FAILED: 'session:load:failed',
  VALIDATION_ERROR: 'session:validation:failed',
  RACE_CONDITION: 'file:race:detected',
  LOCK_TIMEOUT: 'session:lock:timeout'
};

// Log critical events
async function logIntegrityEvent(code: string, details: any) {
  console.error(`[INTEGRITY] ${code}`, details);
  // Send to monitoring system (Sentry, DataDog, etc.)
}
```

This ensures you catch data integrity issues in production before they become catastrophic.
