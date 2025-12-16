# Phase 1 Refactoring: Business Logic Extraction

## Overview

This document guides the extraction of business logic from `claudelet-opentui.tsx` (3,344 lines) into reusable React hooks.

**Status:** Phase 1 Complete - Hook Creation ✅

## Phase 1: Business Logic Extraction

### Completed Hooks

#### 1. useAuthFlow Hook
**File:** `bin/hooks/useAuthFlow.ts`

**Extracted Logic:**
- OAuth authentication flow (both Anthropic Console and Claude Max)
- API key authentication
- Credential persistence (load/save from storage)
- Authentication state management
- Auth error handling

**Extracted Functions:**
- `promptAuthMethod()` - Let user choose auth method
- `handleOAuthFlow()` - Complete OAuth flow with code exchange
- `handleApiKeyAuth()` - Handle API key authentication

**Benefits:**
- Centralizes all authentication logic
- Can be reused in other components
- Testable independently
- Clear separation of concerns

**Usage:**
```typescript
const {
  apiKey,
  oauthToken,
  authManager,
  isAuthenticated,
  authError,
  logout,
  ensureAuthenticated
} = useAuthFlow();
```

#### 2. useSessionManager Hook
**File:** `bin/hooks/useSessionManager.ts`

**Extracted Logic:**
- Session lifecycle management (create, load, save, complete)
- Session persistence to disk
- Session listing and filtering
- Auto-save with debouncing (500ms)
- Session metadata tracking

**Methods:**
- `createNewSession()` - Create new session with model
- `loadSessionById()` - Load session from disk
- `saveCurrentSession()` - Manually save current session
- `completeCurrentSession()` - Mark session as completed
- `listAllSessions()` - Refresh all sessions list
- `getActiveSessions()` - Get non-completed sessions
- `deleteSession()` - Delete a session
- `autoSaveSession()` - Auto-save with 500ms debounce

**Benefits:**
- Encapsulates session storage layer
- Auto-save prevents data loss
- Session switching is now easy
- Can support session browsing UI

**Usage:**
```typescript
const {
  currentSession,
  sessions,
  activeSessions,
  isLoading,
  sessionError,
  createNewSession,
  loadSessionById,
  saveCurrentSession,
  autoSaveSession
} = useSessionManager();
```

#### 3. useMessageQueue Hook
**File:** `bin/hooks/useMessageQueue.ts`

**Extracted Logic:**
- Smart message queue management
- Message buffering during AI responses
- Urgent vs normal message priority
- Auto-injection timing
- Queue persistence to todos file

**Methods:**
- `addMessage()` - Add message to queue
- `getNextMessage()` - Get next message
- `injectNext()` - Auto-inject next message
- `clearQueue()` - Clear all queued messages
- `shouldAutoInject()` - Check if auto-inject should trigger
- `hasUrgentMessages()` - Check for urgent messages

**Benefits:**
- Prevents message loss during AI responses
- Smart injection timing
- Reduces global state pollution
- Easy to test queue logic

**Usage:**
```typescript
const {
  pendingCount,
  hasUrgent,
  queue,
  addMessage,
  injectNext,
  clearQueue
} = useMessageQueue();
```

#### 4. useFileUpload Hook
**File:** `bin/hooks/useFileUpload.ts`

**Extracted Logic:**
- File reference resolution and validation
- File size limit enforcement (500KB)
- Security checks (path traversal prevention)
- File content caching
- Token estimation for files

**Methods:**
- `resolveFileReference()` - Load and validate file
- `addFileChip()` - Add file to upload queue
- `estimateTokenCount()` - Estimate tokens for text
- `removeFile()` - Remove cached file
- `clearFiles()` - Clear all cached files

**Helper Functions:**
- `segmentsToMessageContent()` - Convert segments with file content
- `segmentsToDisplayString()` - Convert segments for UI display

**Benefits:**
- Centralized file handling
- Security validation in one place
- Token estimation is testable
- Can be used by other components

**Usage:**
```typescript
const {
  uploadProgress,
  uploadError,
  uploadedFiles,
  resolveFileReference,
  addFileChip,
  estimateTokenCount,
  removeFile,
  clearFiles
} = useFileUpload();
```

### Utility Modules

#### debugLog Utility
**File:** `bin/utils/debug.ts`

**Exported Functions:**
- `ensureDebugDir()` - Initialize debug directory
- `debugLog()` - Log to ~/.claudelet/debug.log
- `getDebugLog()` - Read debug log content
- `clearDebugLog()` - Clear debug log

**Features:**
- Only logs when CLAUDELET_DEBUG=true
- Sanitizes sensitive information
- Non-blocking file writes
- Proper file permissions (0o600)

## Phase 2: UI Components (Next)

The following UI components will be extracted in Phase 2:

1. **ChatInterface Component** - Message display and chat area
2. **SettingsPanel Component** - Settings and configuration UI
3. **FileUploader Component** - File upload UI with chip display
4. **ModelSelector Component** - Model selection dialog

## Phase 3: Services (Later)

The following services will be extracted in Phase 3:

1. **AuthService** - Wrap useAuthFlow for non-React code
2. **SessionService** - Wrap useSessionManager for non-React code
3. **DebugLogger** - Wrap debugLog for organized logging

## Integration Plan

### Step 1: Update Main Component
1. Import all hooks at top of `claudelet-opentui.tsx`
2. Replace inline logic with hook calls
3. Remove extracted functions
4. Test thoroughly

### Step 2: Verify Tests Pass
1. Run existing tests
2. Ensure no regressions
3. Check TypeScript compiles

### Step 3: Create Hook Tests
1. Unit tests for each hook
2. Integration tests for hook interactions
3. Edge case testing

### Step 4: Documentation
1. Create API documentation for hooks
2. Add usage examples
3. Document error handling

## File Structure After Refactoring

```
bin/
├── claudelet-opentui.tsx (< 300 lines) - Main orchestrator
├── claudelet-ai-tools.ts
├── claudelet-tui.tsx
├── claudelet.ts
├── hooks/
│   ├── useAuthFlow.ts (150 lines)
│   ├── useSessionManager.ts (200 lines)
│   ├── useMessageQueue.ts (120 lines)
│   └── useFileUpload.ts (180 lines)
├── utils/
│   └── debug.ts (60 lines)
└── (UI components - Phase 2)
    ├── ChatInterface.tsx
    ├── SettingsPanel.tsx
    ├── FileUploader.tsx
    └── ModelSelector.tsx

src/
├── auth-storage.ts
├── env-sanitizer.ts
├── markdown-renderer.tsx
├── session-storage.ts
└── index.ts
```

## Testing Strategy

### Hook Testing
Each hook should have unit tests covering:
- Initial state
- State updates
- Side effects
- Error cases
- Cleanup

**Test Files:**
```
tests/
├── hooks/
│   ├── useAuthFlow.test.ts
│   ├── useSessionManager.test.ts
│   ├── useMessageQueue.test.ts
│   └── useFileUpload.test.ts
└── utils/
    └── debug.test.ts
```

### Integration Testing
End-to-end flows should be tested:
- Authentication → Session Creation → Message Handling
- File Upload → Message Composition → Message Sending
- Session Load → Resume Conversation → Auto-Save

## Metrics Target

**Current State:**
- 3,344 lines total
- 44 React hooks
- 12+ responsibilities
- SOLID Score: 3/10

**After Phase 1:**
- Main file: ~2,800 lines (removed 400-500 lines of hook logic)
- Hook files: ~650 lines total
- Hooks per file: 2-3 per hook
- Test coverage: +30%

**After Phases 1-3 Complete:**
- Main file: < 300 lines
- Component files: 100-200 lines each
- Service files: 100-150 lines each
- SOLID Score: 8/10
- Test coverage: 85%+

## Migration Checklist

- [x] Create hooks directory
- [x] Extract useAuthFlow hook
- [x] Extract useSessionManager hook
- [x] Extract useMessageQueue hook
- [x] Extract useFileUpload hook
- [x] Create debug utility module
- [ ] Create hook unit tests
- [ ] Integrate hooks into main component
- [ ] Verify no regressions
- [ ] Update main component imports
- [ ] Delete extracted code from main
- [ ] Phase 2: Extract UI components
- [ ] Phase 3: Extract services

## Notes

1. **Backward Compatibility:** All extracted hooks maintain the same logic and behavior as the original code.

2. **Type Safety:** All hooks use TypeScript with explicit return types and interface definitions.

3. **Error Handling:** Errors are caught and returned as state, not thrown (React hook best practice).

4. **Testing:** Hooks are designed to be easily testable with vitest and mocking.

5. **Documentation:** Each hook includes JSDoc comments and usage examples.

6. **Performance:** Auto-save and debouncing prevent excessive updates and file writes.

## Next Steps

1. Create unit tests for extracted hooks
2. Integrate hooks into main component
3. Verify tests pass and no regressions
4. Begin Phase 2 (UI component extraction)

---

**Created:** 2025-12-16
**Phase:** 1 of 3
**Status:** Hooks Created - Ready for Integration
