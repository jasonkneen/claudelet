# Track 001: Add Test Suite

## Summary
Set up a comprehensive test suite using vitest for Claudelet's core functionality. This establishes the foundation for TDD workflow and ensures stability as new features are added.

## Goals
1. Configure vitest for the monorepo
2. Add unit tests for core modules
3. Add integration tests for key workflows
4. Establish test patterns and utilities

## Scope

### In Scope
- vitest configuration for root and workspace packages
- Unit tests for `src/` modules:
  - `auth-storage.ts` - Auth persistence
  - `session-storage.ts` - Session persistence
  - `security-validator.ts` - Security utilities
  - `message-pagination.ts` - Pagination logic
  - `env-sanitizer.ts` - Environment sanitization
- Unit tests for `bin/hooks/`:
  - `useFileUpload.ts`
  - `useMessageQueue.ts`
  - `useSessionManager.ts`
- Test utilities and mocks
- CI configuration for running tests

### Out of Scope
- E2E tests (future track)
- Visual regression tests
- Performance benchmarks
- Tests for UI components (requires terminal mocking)

## Acceptance Criteria
- [ ] `bun test` runs all tests successfully
- [ ] Code coverage report generated
- [ ] At least 80% coverage on core modules
- [ ] Tests run in CI on push/PR
- [ ] Test utilities documented

## Technical Notes
- Use vitest for consistency with modern TypeScript tooling
- Mock file system operations using memfs or similar
- Mock network requests for auth testing
- Use test fixtures for sample data

## Dependencies
- None (foundational track)

## Estimated Effort
- Setup: Small
- Core module tests: Medium
- Hook tests: Medium
- CI integration: Small
