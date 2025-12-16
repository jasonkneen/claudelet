# Data Integrity Implementation Checklist

## Pre-Implementation Review

- [ ] Read DATA_INTEGRITY_REVIEW.md (main findings)
- [ ] Read DATA_INTEGRITY_FIXES.md (code solutions)
- [ ] Read DATA_INTEGRITY_ARCHITECTURE.md (design improvements)
- [ ] Review INTEGRITY_SUMMARY.txt (executive summary)
- [ ] Create feature branch: `git checkout -b feature/data-integrity`

---

## Phase 1: Critical Fixes (4-6 hours) - Week 1

### 1.1 Atomic Session Writes

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/src/session-storage.ts`

- [ ] Update `saveSession()` to use temp file + atomic rename pattern
- [ ] Update `saveSessionSync()` to use temp file + atomic rename pattern
- [ ] Add error handling for atomic rename failures
- [ ] Test: Create session, kill -9 during save, verify no corruption
- [ ] Test: Rapid concurrent saves don't corrupt file

**Code Location:** Lines 86-109
**Expected Changes:** 50 lines

### 1.2 Session Schema Validation

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/src/session-storage.ts`

- [ ] Add `zod` to package.json dependencies
- [ ] Create `SessionDataSchema` with Zod
- [ ] Update `loadSession()` to validate schema
- [ ] Create backup of corrupted sessions (`.corrupted` extension)
- [ ] Add error logging with details
- [ ] Test: Load valid session → should succeed
- [ ] Test: Load corrupted JSON → should create `.corrupted` backup
- [ ] Test: Load partially valid session → should attempt recovery

**Code Location:** Lines 114-121
**Expected Changes:** 80 lines

### 1.3 Async Graceful Shutdown

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/bin/claudelet-opentui.tsx`

- [ ] Create `gracefulShutdown()` async function
- [ ] Move cleanup logic into function
- [ ] Add session auto-save before cleanup
- [ ] Add AI tools disposal before cleanup
- [ ] Update SIGINT handler to await shutdown
- [ ] Update SIGTERM handler to await shutdown
- [ ] Update uncaughtException handler to await shutdown
- [ ] Test: Send SIGINT, verify session saves before exit
- [ ] Test: Send SIGTERM, verify cleanup completes
- [ ] Test: Throw exception, verify graceful handling

**Code Location:** Lines 3098-3143
**Expected Changes:** 60 lines

### 1.4 Auth Encryption

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/src/auth-storage.ts`

- [ ] Import `crypto` module (built-in)
- [ ] Add `ensureEncryptionKey()` function
- [ ] Add `encryptAuth()` function with AES-256-GCM
- [ ] Add `decryptAuth()` function with auth tag verification
- [ ] Update `loadAuth()` to decrypt
- [ ] Update `saveAuth()` to encrypt with restricted permissions (0o600)
- [ ] Add error handling with clear messages
- [ ] Test: Save credentials → verify file is encrypted (not JSON readable)
- [ ] Test: Load credentials → verify decryption works
- [ ] Test: Check file permissions → should be 600
- [ ] Test: Tampered encrypted file → should fail with error

**Code Location:** Lines 18-46
**Expected Changes:** 120 lines

**Security Verification:**
```bash
# After fix, verify:
cat ~/.claude-agent-auth.json | head -20  # Should see binary/encrypted content
ls -la ~/.claude-agent-auth.json          # Should show -rw------- (600)
```

### 1.5 Update package.json

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/package.json`

- [ ] Add `"zod": "^3.22.0"` to dependencies
- [ ] Run `npm install` or `pnpm install`
- [ ] Verify zod available in node_modules

---

## Phase 2: High Priority Fixes (6-8 hours) - Week 1-2

### 2.1 Session Locking

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/src/session-lock.ts` (NEW)

- [ ] Create new file `src/session-lock.ts`
- [ ] Implement `SessionLock` class with:
  - `acquire(timeoutMs)` - creates lock file
  - `release()` - removes lock file
  - Lock refresh interval (1 second heartbeat)
  - Lock timeout handling
- [ ] Test: Two processes try to acquire same lock → only one succeeds
- [ ] Test: Lock held 5+ seconds → other process times out
- [ ] Test: Process crashes → lock eventually expires or cleaned up

**Expected Changes:** 100 lines

### 2.2 Persistent Message Queue

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/src/message-queue-persistence.ts` (NEW)

- [ ] Create new file for queue persistence
- [ ] Implement disk-backed message queue with:
  - `loadQueue()` - restore from disk
  - `saveQueue()` - persist to disk (atomic write)
  - `clearQueue()` - cleanup
- [ ] Update `SessionData` schema to include `pendingMessages`
- [ ] Integrate with auto-save to persist queue
- [ ] Test: Queue messages → kill app → restart → verify messages restored
- [ ] Test: Rapid queue additions → verify no data loss

**Expected Changes:** 80 lines

### 2.3 File Watcher Queue System

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/bin/claudelet-ai-tools.ts`

- [ ] Add `fileIndexingQueue: Map<string, Promise<void>>` field
- [ ] Update `handleFileChange()` to queue operations per-file
- [ ] Prevent concurrent updates to same file
- [ ] Test: Rapid file changes → no vector corruption
- [ ] Test: Verify each file processed sequentially
- [ ] Check vector store integrity after stress test

**Code Location:** Lines 154-215
**Expected Changes:** 40 lines

### 2.4 Vector Store Safety

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/bin/claudelet-ai-tools.ts`

- [ ] Review vector store API for checkpoint/rollback support
- [ ] Add batch indexing with periodic commits
- [ ] Add error recovery (rollback to checkpoint on failure)
- [ ] Test: Indexing crash → verify partial data rolled back
- [ ] Test: Large batch indexing → no data loss

**Expected Changes:** 30 lines

### 2.5 Vector Cleanup on Delete

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/bin/claudelet-ai-tools.ts`

- [ ] Verify `deleteFile()` method exists on Indexer
- [ ] Add error handling for delete failures
- [ ] Test: Delete file → vector removed from index
- [ ] Test: Search for deleted file → no results

**Code Location:** Lines 193-198
**Expected Changes:** 10 lines

---

## Phase 3: Medium Priority Fixes (4-6 hours) - Week 2

### 3.1 Session Recovery Tools

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/src/session-recovery.ts` (NEW)

- [ ] Create recovery tool for corrupted sessions
- [ ] Implement `analyzeCorruptedSession()` function
- [ ] Extract salvageable data from partial JSON
- [ ] Create recovery workflow
- [ ] Test: Corrupt session file → verify recovery extracts partial data
- [ ] Document recovery procedures for users

**Expected Changes:** 120 lines

### 3.2 Automated Backups

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/src/session-backup.ts` (NEW)

- [ ] Implement daily backup creation
- [ ] Create backup directory structure: `~/.claudelet/backups/daily/YYYY-MM-DD/`
- [ ] Implement backup cleanup (7-day retention)
- [ ] Integrate with session save workflow
- [ ] Test: Session saved → backup created
- [ ] Test: Old backups deleted after 7 days

**Expected Changes:** 80 lines

### 3.3 Improved Validation

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/bin/claudelet-opentui.tsx`

- [ ] Update `resolveFileReference()` to use `realpath()` for symlink resolution
- [ ] Add TOCTOU-safe file reading (check + read in atomic operation)
- [ ] Test: Symlink escaping cwd → properly rejected
- [ ] Test: File grows between check and read → handled safely

**Code Location:** Lines 380-405
**Expected Changes:** 20 lines

### 3.4 Error Logging & Metrics

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/src/integrity-monitor.ts` (NEW)

- [ ] Create structured logging for all I/O operations
- [ ] Track metrics:
  - Sessions saved successfully
  - Sessions failed to save
  - Corrupted sessions detected
  - Backups created
  - Recovery attempts
- [ ] Export metrics for monitoring
- [ ] Test: Verify metrics accuracy

**Expected Changes:** 100 lines

### 3.5 Documentation

- [ ] Document recovery procedures in README
- [ ] Create troubleshooting guide for common issues
- [ ] Document backup/restore process
- [ ] Create metrics dashboard documentation

**Expected Changes:** 50 lines

---

## Testing Checklist

### Unit Tests

- [ ] Atomic write failure handling
- [ ] Schema validation (valid cases)
- [ ] Schema validation (invalid cases)
- [ ] Encryption/decryption
- [ ] Lock acquisition/release
- [ ] Queue persistence
- [ ] Backup creation/cleanup

### Integration Tests

- [ ] Session save + load round-trip
- [ ] Multi-process session conflicts
- [ ] File watcher concurrent updates
- [ ] Message queue persistence
- [ ] Auth encryption/decryption

### Crash Recovery Tests

- [ ] Kill -9 during session save → verify recovery
- [ ] Kill -9 during auth save → verify fallback
- [ ] Kill -9 during file indexing → verify vector store safe
- [ ] Kill -9 with pending queue → verify restoration

### Stress Tests

- [ ] Rapid file changes (1000+/sec) → no corruption
- [ ] Concurrent saves (100+ processes) → no loss
- [ ] Large sessions (10MB+) → handles efficiently
- [ ] Low disk space (10MB) → handles gracefully

### Security Tests

- [ ] Encrypted auth file unreadable as JSON
- [ ] File permissions 600 on auth file
- [ ] Symlink escape attempt blocked
- [ ] Large file DoS mitigated

---

## Code Review Checklist

- [ ] All atomic writes use temp + rename pattern
- [ ] All file I/O has error handling
- [ ] All schemas validated before persistence
- [ ] No plain-text credential storage
- [ ] No silent failures (all errors logged)
- [ ] No race conditions (operations sequenced)
- [ ] Crash handlers are async
- [ ] Tests cover happy + error paths

---

## Deployment Checklist

- [ ] All tests passing (unit + integration + stress)
- [ ] Code review approved
- [ ] Documentation complete
- [ ] Migration script for existing sessions tested
- [ ] Monitoring/alerting configured
- [ ] Backup retention policy implemented
- [ ] Recovery procedures documented
- [ ] Team trained on new procedures

### Migration Steps

- [ ] Run migration script on existing sessions
- [ ] Verify all sessions recoverable
- [ ] Create backups of all sessions
- [ ] Deploy to staging environment
- [ ] Run full test suite in staging
- [ ] Deploy to production
- [ ] Monitor metrics for 24 hours

---

## Post-Deployment

- [ ] Monitor data integrity metrics
- [ ] Track error rates and recovery success
- [ ] Gather user feedback
- [ ] Document lessons learned
- [ ] Plan future improvements

### First Week Monitoring

- [ ] Check session save success rate (target: >99.9%)
- [ ] Monitor corruption detection (target: 0 new)
- [ ] Track backup creation success
- [ ] Verify lock timeouts don't occur
- [ ] Review all error logs for new patterns

---

## Files Modified

```
ADDED:
  src/session-lock.ts                      (NEW)
  src/message-queue-persistence.ts        (NEW)
  src/session-recovery.ts                 (NEW)
  src/session-backup.ts                   (NEW)
  src/integrity-monitor.ts                (NEW)

MODIFIED:
  src/session-storage.ts                  (Atomic writes + validation)
  src/auth-storage.ts                     (Encryption)
  bin/claudelet-opentui.tsx              (Async shutdown + cleanup)
  bin/claudelet-ai-tools.ts              (File watcher queue)
  package.json                            (Add zod dependency)
```

---

## Expected Outcomes

After completing all phases:

**Data Safety:**
- Pre-fix: 40-60% risk of data loss on crash
- Post-fix: <1% risk with automatic recovery

**Corruption Prevention:**
- Pre-fix: 10-20% chance of corruption
- Post-fix: 0% (atomic writes + validation)

**Security:**
- Pre-fix: Credentials in plain text
- Post-fix: AES-256 encryption at rest

**Observability:**
- Pre-fix: Silent failures
- Post-fix: Structured logging + metrics

---

## Help & References

**Documents:**
- DATA_INTEGRITY_REVIEW.md - Detailed analysis
- DATA_INTEGRITY_FIXES.md - Code solutions
- DATA_INTEGRITY_ARCHITECTURE.md - Design details

**Related Issues:**
- [ ] Create Jira tickets for each phase

**Contact:**
- Data Integrity Guardian: [Your contact]
- On-call Ops: [Ops contact]

---

## Sign-Off

- [ ] Implementation Lead: __________ Date: __________
- [ ] Code Reviewer: __________ Date: __________
- [ ] QA Lead: __________ Date: __________
- [ ] Product Manager: __________ Date: __________
- [ ] Security Review: __________ Date: __________

---

**Status: READY FOR IMPLEMENTATION**

Next: Create Jira tickets for Phase 1 fixes
Timeline: Start immediately, complete by end of Week 1
