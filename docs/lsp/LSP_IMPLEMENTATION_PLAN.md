# LSP Implementation Plan

**Status**: Ready for swarm execution

## Decisions Made

- ✅ **Diagnostics Display**: Inline in editor (red squiggles, error markers)
- ✅ **Priority**: Stability & resource leaks
- ✅ **Multi-Session**: Support different shell instances (not singleton)
- ✅ **Server Recovery**: Auto-retry with exponential backoff

---

## Critical Issues to Fix

### Issue 1: Resource Leak on App Exit
**Severity**: High | **Impact**: LSP servers left running

**Files to Modify**:
- `bin/claudelet-opentui.tsx` - Main entry point
- `bin/claudelet-ai-tools.ts` - AiToolsService singleton

**Changes**:
1. Add graceful shutdown handler in main CLI entry
2. Register `SIGTERM`, `SIGINT` handlers
3. Call `AiToolsService.dispose()` → `lspManager.shutdown()`
4. Ensure process waits for shutdown before exit (promise)

**Estimated**: 2-3 files, 20-30 lines

---

### Issue 2: Singleton Pattern Blocks Multi-Session Support
**Severity**: Medium | **Impact**: Can't analyze multiple projects in parallel

**Files to Modify**:
- `packages/lsp/src/manager.ts` - LSPManager
- `bin/claudelet-ai-tools.ts` - AiToolsService

**Changes**:
1. Change from singleton instance to per-project instances
2. Use project path as cache key: `{cacheDir}/{hash(projectPath)}/`
3. Allow multiple AiToolsService instances, one per project
4. Update initialization to not assume global state

**Estimated**: 2 files, 40-60 lines

---

### Issue 3: No Retry Logic for Failed Servers
**Severity**: Medium | **Impact**: Dead servers never restart

**Files to Modify**:
- `packages/lsp/src/manager.ts` - Add retry system

**Changes**:
1. Create `RetryStrategy` class with exponential backoff
2. On server failure, add to retry queue with delay
3. Retry with delays: 1s, 2s, 4s, 8s, 16s (max 5 attempts)
4. Clear `broken` set after successful retry
5. Emit `server-retrying` event for debugging

**Estimated**: 1 file, 60-80 lines

---

### Issue 4: Missing Graceful Shutdown
**Severity**: Medium | **Impact**: Child processes left orphaned

**Files to Modify**:
- `packages/lsp/src/client.ts` - LSPClient process management
- `packages/lsp/src/manager.ts` - Orchestration

**Changes**:
1. Add timeout-aware shutdown in LSPClient (5 second timeout)
2. Send `exit` notification to server before kill
3. Force kill if server doesn't respond
4. Properly close stdio pipes
5. Manager waits for all clients to shutdown

**Estimated**: 2 files, 40-50 lines

---

### Issue 5: Inline Diagnostics Not Displayed
**Severity**: High | **Impact**: Diagnostics collected but invisible

**Files to Modify**:
- `bin/claudelet-opentui.tsx` - Main UI
- `bin/claudelet-ai-tools.ts` - AiToolsService API expansion

**Changes**:
1. Export LSP diagnostics from AiToolsService
2. Add method: `getDiagnosticsForProject(projectPath)`
3. Create diagnostics consumer in main UI component
4. Display inline markers in code view (red squiggles for errors, yellow for warnings)
5. Show diagnostics on hover or in gutter

**Estimated**: 2-3 files, 80-100 lines (UI component creation)

---

### Issue 6: Installation Blocks Startup
**Severity**: Low | **Impact**: First use hangs for 30+ seconds

**Files to Modify**:
- `packages/lsp/src/manager.ts` - Async initialization
- `bin/claudelet-ai-tools.ts` - Startup flow

**Changes**:
1. Move server auto-installation to lazy initialization
2. Show progress callback: `onInstallProgress(server, percent)`
3. Allow app to start while servers install in background
4. Queue tool requests until server ready (with timeout)

**Estimated**: 2 files, 50-70 lines

---

## Implementation Strategy

### Phase 1: Foundation (High Priority)
**Focus**: Stability, resource management, multi-session support

**Tasks**:
- [ ] Task 1: Add process exit handlers to gracefully shutdown LSP
- [ ] Task 2: Convert singleton to per-project instances
- [ ] Task 3: Implement retry logic with exponential backoff
- [ ] Task 4: Add timeout-aware graceful shutdown to LSPClient

**Order**: Sequential (each builds on previous)
**Interdependencies**: Low (mostly independent changes)

### Phase 2: User-Facing (Medium Priority)
**Focus**: Displaying diagnostics, showing progress

**Tasks**:
- [ ] Task 5: Expand AiToolsService API to expose diagnostics
- [ ] Task 6: Create inline diagnostics UI component
- [ ] Task 7: Integrate diagnostics with editor/code view

**Order**: Sequential (5 → 6 → 7)
**Interdependencies**: 6 depends on 5

### Phase 3: Performance (Lower Priority)
**Focus**: Startup speed

**Tasks**:
- [ ] Task 8: Move server installation to lazy/background initialization
- [ ] Task 9: Add installation progress callbacks

**Order**: Sequential (8 → 9)
**Interdependencies**: Low

---

## Swarm Task Breakdown

### Agent 1: Resource Management & Shutdown
**Responsibility**: Issues #1, #3, #4

**Files**:
- `bin/claudelet-opentui.tsx`
- `packages/lsp/src/client.ts`
- `packages/lsp/src/manager.ts`

**Deliverables**:
- ✅ Exit handlers registered
- ✅ Graceful shutdown implemented
- ✅ Retry logic with backoff
- ✅ Tests for shutdown flow

---

### Agent 2: Architecture & Multi-Session
**Responsibility**: Issue #2

**Files**:
- `packages/lsp/src/manager.ts`
- `bin/claudelet-ai-tools.ts`

**Deliverables**:
- ✅ Per-project instance support
- ✅ Cache key by project path
- ✅ Multiple concurrent sessions
- ✅ Tests for multi-session isolation

---

### Agent 3: Diagnostics Pipeline
**Responsibility**: Issue #5

**Files**:
- `bin/claudelet-ai-tools.ts`
- `bin/claudelet-opentui.tsx`
- New: `src/components/DiagnosticsDisplay.tsx`

**Deliverables**:
- ✅ API to retrieve diagnostics from AiToolsService
- ✅ Inline diagnostics UI component (red squiggles, hover info)
- ✅ Integration with editor/code view
- ✅ Tests for diagnostics display

---

### Agent 4: Performance & UX
**Responsibility**: Issue #6

**Files**:
- `packages/lsp/src/manager.ts`
- `bin/claudelet-ai-tools.ts`

**Deliverables**:
- ✅ Lazy server initialization
- ✅ Installation progress callbacks
- ✅ Background installation without blocking
- ✅ Tests for lazy loading flow

---

## Testing Strategy

### Unit Tests
- LSPManager retry logic
- Graceful shutdown
- Per-project isolation
- Diagnostics formatting

### Integration Tests
- Multi-session concurrent LSP operations
- Server failure and recovery
- Diagnostics flow from server to UI
- Installation progress reporting

### Manual Tests
- App starts with no LSP servers → servers install → diagnostics appear
- Kill a language server → auto-retries and recovers
- Open 2 projects in different shells → both work independently
- App shutdown cleanly without orphaned processes

---

## Estimated Timeline

**Phase 1 (Foundation)**: 2-3 agent-hours
**Phase 2 (Diagnostics UI)**: 2-3 agent-hours
**Phase 3 (Performance)**: 1-2 agent-hours

**Total Parallel Time**: ~3 hours (agents work simultaneously)
**Sequential Time**: ~7-8 hours (if done one by one)

---

## Rollout Plan

1. **Phase 1 Complete** → Merge to branch, test stability
2. **Phase 2 Complete** → Merge, validate diagnostics display
3. **Phase 3 Complete** → Merge, optimize startup
4. **Final PR** → Code review, integration tests, merge to main

---

## Success Criteria

- ✅ LSP servers gracefully shutdown on app exit
- ✅ Failed servers auto-retry up to 5 times
- ✅ Support multiple projects in different shell instances
- ✅ Diagnostics display inline in editor
- ✅ No orphaned child processes
- ✅ Startup time <100ms (servers load lazily)
- ✅ All tests pass
- ✅ No resource leaks

---

## Known Risks

1. **UI Integration Risk**: May need to refactor code view component to support inline diagnostics
2. **Backward Compatibility**: Multi-session changes may affect existing integrations
3. **Testing Coverage**: LSP process management is tricky, comprehensive tests needed
4. **TypeScript**: Ensure proper typing for new LSP diagnostics format

---

## Dependencies & Prerequisites

- Node ≥ 18.0.0 (current requirement)
- TypeScript compiler (already in devDeps)
- vitest (already in devDeps)
- Access to spawn child processes (already works)

---

## Files Affected

**Core LSP Package**:
- `packages/lsp/src/manager.ts` - Major changes (retry, shutdown, multi-session)
- `packages/lsp/src/client.ts` - Shutdown logic
- `packages/lsp/src/installer.ts` - Lazy loading

**Application**:
- `bin/claudelet-opentui.tsx` - Exit handlers, diagnostics display
- `bin/claudelet-ai-tools.ts` - Architecture changes, API expansion
- `src/components/DiagnosticsDisplay.tsx` - **NEW** - Inline diagnostics UI

**Tests**:
- `packages/lsp/tests/manager.test.ts` - Retry, shutdown, multi-session
- `packages/lsp/tests/client.test.ts` - Graceful shutdown
- New: Integration tests for diagnostics pipeline

---

## Implementation Ready

All decisions made, all issues identified, all tasks scoped.

**Ready for**: `ExitPlanMode` + Swarm launch
