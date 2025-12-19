# Development Workflow: TDD (Test-Driven Development)

## Overview
Claudelet uses a TDD workflow where specifications and tests are written before implementation. This ensures features are well-defined and testable from the start.

## Track Lifecycle

### 1. Specification Phase
- Define the feature requirements in a spec document
- Identify acceptance criteria
- Document edge cases and error scenarios
- Get spec approval before proceeding

### 2. Test Phase
- Write failing tests based on spec
- Cover happy path, edge cases, and error conditions
- Tests must fail before implementation (red phase)

### 3. Implementation Phase
- Write minimal code to pass tests
- Follow existing code patterns and style
- Keep changes focused and incremental

### 4. Refactor Phase
- Clean up implementation while tests pass
- Remove duplication
- Improve naming and structure
- Ensure code style compliance

### 5. Review Phase
- Self-review against spec
- Check test coverage
- Verify no regressions
- Update documentation if needed

## Commands

### Build & Run
```bash
bun run dev              # Run OpenTUI (default)
bun run dev:classic      # Run classic CLI
bun run dev:ink          # Run Ink TUI
```

### Quality Checks
```bash
bun run typecheck        # Type checking
bun run format           # Format code
bun run format:check     # Check formatting
bun test                 # Run tests
```

### Build
```bash
bun run build            # Build library
bun run build:cli        # Build CLI binary
bun run build:all        # Build everything
```

## Commit Guidelines
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- Reference track ID in commit messages when applicable
- Keep commits atomic and focused

## File Naming Conventions
- Source files: `kebab-case.ts`
- React components: `PascalCase.tsx`
- Test files: `*.test.ts` or `*.spec.ts`
- Type definitions: `*.d.ts`

## Track File Structure
```
conductor/
├── tracks.md           # Track index
└── tracks/
    └── {track-id}/
        ├── spec.md     # Feature specification
        ├── plan.md     # Implementation plan
        └── notes.md    # Implementation notes (optional)
```
