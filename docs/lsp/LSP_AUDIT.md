# LSP (Language Server Protocol) Audit & Action Plan

## Current Status: Active but Underutilized

LSP **IS being used** in this app but with incomplete integration and resource management issues.

---

## What's Working ✓

| Aspect | Status | Details |
|--------|--------|---------|
| **Core Implementation** | ✓ | Proper JSON-RPC 2.0 protocol over stdio |
| **Multi-Language Support** | ✓ | 10+ servers: TypeScript, Python, Go, Rust, JSON, HTML, CSS, YAML, Tailwind |
| **Auto-Installation** | ✓ | Missing servers auto-install to `~/.cache/claudelet/lsp/` |
| **Event System** | ✓ | Proper event-driven architecture for diagnostics & server lifecycle |
| **Code Quality** | ✓ | Clean separation in `@ai-cluso/lsp-client` package, zero runtime deps |
| **Diagnostics Collection** | ✓ | Actively collects via `textDocument/publishDiagnostics` |
| **File Tracking** | ✓ | Tracks files with diagnostics, active server count |

---

## Problems Identified ⚠️

### 1. **Diagnostics Collected But Not Displayed**
- **Location**: `claudelet-ai-tools.ts:434` collects diagnostics
- **Status**: Unknown if UI actually displays them
- **Impact**: Users get no visibility into code quality issues
- **Fix Needed**: Trace diagnostics from LSP → UI pipeline

### 2. **No Retry Logic for Failed Servers**
- **Location**: `packages/lsp/src/manager.ts`
- **Problem**: Broken servers stored in `this.broken` set but never retried
- **Impact**: If a server crashes, it stays dead until app restart
- **Fix Needed**: Implement exponential backoff retry mechanism

### 3. **Resource Leak on App Exit**
- **Location**: `claudelet-ai-tools.ts` singleton lifecycle
- **Problem**: `shutdown()` only called in `dispose()`, may not be invoked on exit
- **Impact**: LSP servers left running in background
- **Fix Needed**: Ensure `shutdown()` called on SIGTERM/process.exit

### 4. **Auto-Install Blocks First Use**
- **Location**: `packages/lsp/src/installer.ts`
- **Problem**: First server access can hang 30+ seconds with no UI feedback
- **Impact**: App appears frozen during initial setup
- **Fix Needed**: Show progress UI or move to background

### 5. **Singleton Pattern Limits Scalability**
- **Location**: `claudelet-ai-tools.ts` - single AiToolsService instance
- **Problem**: Can only analyze one project at a time
- **Impact**: Multi-project support blocked
- **Fix Needed**: Consider per-project LSP managers (future)

### 6. **Unused Capabilities**
- **Available**: Hover, code completion, go-to-definition, find references
- **Used**: Only diagnostics collection
- **Impact**: Significant potential features not leveraged
- **Fix Needed**: Determine if these should be exposed to users

### 7. **Limited Error Handling for Diagnostics**
- **Location**: `packages/lsp/src/client.ts` - notification handler
- **Problem**: Only handles `publishDiagnostics`, ignores other notifications (log message, show message)
- **Impact**: Server warnings/errors silently logged to console
- **Fix Needed**: Route all notifications to UI appropriately

### 8. **No Project Root Detection**
- **Location**: `claudelet-ai-tools.ts:88` - just uses `process.cwd()`
- **Problem**: Won't find `tsconfig.json` or `package.json` if not at root
- **Impact**: Language servers may not work optimally in nested projects
- **Fix Needed**: Implement root detection (look for workspace files)

---

## Integration Points

### Where LSP Is Currently Used

**File**: `bin/claudelet-ai-tools.ts`

```
AiToolsService (singleton)
  ├─ createLSPManager() → LSPManager
  │   ├─ LSPClient (per language/project)
  │   │   └─ Spawns language server process
  │   └─ Installer (auto-downloads servers)
  │
  ├─ Events Emitted:
  │   ├─ server-started
  │   ├─ server-closed
  │   └─ diagnostics
  │
  └─ Methods:
      ├─ touchFile(path) → Open file for analysis
      └─ getDiagnosticsForFile(path) → Retrieve diagnostics
```

### What Calls LSP

- Line 309: `await this.lspManager.touchFile(filePath, true)` - Open file
- Line 431-434: Touch file and get diagnostics for analysis
- Lines 131-143: Listen to LSP events and track stats

### What Should Call LSP But Doesn't (Potentially)

- UI diagnostics display (unclear if implemented)
- Code completion in editor
- Hover information
- Go-to-definition navigation

---

## Statistics Being Tracked

Current metrics collected:
- `activeServers` - Number of running language servers
- `filesWithDiagnostics` - Count of files with issues found

**Status**: Emitted via `status:change` events, but unclear if displayed to user.

---

## Architecture Issues

From `ARCHITECTURE_ANALYSIS.md`:
- **Fragile Dependency**: LSP client is `file://` dependency (workspace package)
- **Mixed Concerns**: LSP deeply integrated in 3,166-line `AiToolsService` component
- **Recommendation**: Create adapter layer for better abstraction

---

## Potential Quick Wins

1. ✅ Add `process.exit` handler to gracefully shutdown LSP
2. ✅ Implement retry logic with exponential backoff for failed servers
3. ✅ Trace diagnostics pipeline - verify they reach UI
4. ✅ Show installation progress during first-time setup
5. ✅ Add project root detection (walk up directory tree)
6. ✅ Create LSP adapter layer to reduce coupling

---

## Questions Before Action

1. **Diagnostics Display**: Should LSP diagnostics appear in the UI? Where?
2. **Server Retry**: Should failed servers auto-retry with backoff, or require manual reset?
3. **Installation UX**: Should installation happen silently in background, or show progress?
4. **Additional Features**: Should hover/completion/go-to-def be exposed to users?
5. **Project Scope**: Will this app ever need to analyze multiple projects simultaneously?
6. **Error Messages**: Should server warnings/errors be shown to users or stay silent?

---

## Next Steps

- [ ] Answer questions above
- [ ] Verify UI actually displays LSP diagnostics
- [ ] Implement resource cleanup on app exit
- [ ] Add retry logic for failed servers
- [ ] Consider moving installer to background
- [ ] Create LSP adapter layer (future refactor)
