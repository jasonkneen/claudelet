# Track 001: Implementation Plan

## Phase 1: Setup (vitest configuration)

### 1.1 Install dependencies
```bash
bun add -d vitest @vitest/coverage-v8 @testing-library/react memfs
```

### 1.2 Create vitest.config.ts
- Configure for ESM
- Set up path aliases
- Configure coverage thresholds
- Set up test file patterns

### 1.3 Add test scripts to package.json
- `test` - Run tests
- `test:watch` - Watch mode
- `test:coverage` - With coverage report

## Phase 2: Test Utilities

### 2.1 Create test helpers
- `tests/helpers/` directory
- File system mocks
- Auth token fixtures
- Session state fixtures

### 2.2 Create mock factories
- `createMockAuthStorage()`
- `createMockSession()`
- `createMockMessage()`

## Phase 3: Core Module Tests

### 3.1 auth-storage.test.ts
- Test load/save auth tokens
- Test token refresh logic
- Test invalid token handling
- Test file permission errors

### 3.2 session-storage.test.ts
- Test session persistence
- Test session recovery
- Test concurrent access

### 3.3 security-validator.test.ts
- Test path validation
- Test input sanitization
- Test security boundary checks

### 3.4 message-pagination.test.ts
- Test page calculation
- Test boundary conditions
- Test empty message lists

### 3.5 env-sanitizer.test.ts
- Test sensitive key detection
- Test value redaction
- Test safe value passthrough

## Phase 4: Hook Tests

### 4.1 useFileUpload.test.ts
- Test file reading
- Test size limits
- Test error handling

### 4.2 useMessageQueue.test.ts
- Test message queuing
- Test priority ordering
- Test queue clearing

### 4.3 useSessionManager.test.ts
- Test session lifecycle
- Test reconnection logic
- Test state persistence

## Phase 5: CI Integration

### 5.1 GitHub Actions workflow
- Create `.github/workflows/test.yml`
- Run on push and PR
- Cache dependencies
- Report coverage

### 5.2 Pre-commit hook (optional)
- Run tests before commit
- Fail on test failures

## File Structure
```
claudelet/
├── vitest.config.ts
├── tests/
│   ├── helpers/
│   │   ├── mocks.ts
│   │   └── fixtures.ts
│   ├── src/
│   │   ├── auth-storage.test.ts
│   │   ├── session-storage.test.ts
│   │   ├── security-validator.test.ts
│   │   ├── message-pagination.test.ts
│   │   └── env-sanitizer.test.ts
│   └── hooks/
│       ├── useFileUpload.test.ts
│       ├── useMessageQueue.test.ts
│       └── useSessionManager.test.ts
└── .github/
    └── workflows/
        └── test.yml
```

## Success Metrics
- All tests pass
- Coverage >= 80% on core modules
- CI runs < 2 minutes
- No flaky tests
