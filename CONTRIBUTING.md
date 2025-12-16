# Contributing to Claudelet

Thank you for your interest in contributing to Claudelet! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Code Style](#code-style)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Feature Requests](#feature-requests)
- [Bug Reports](#bug-reports)

## Getting Started

### Prerequisites

- **Bun** runtime (latest version)
- **Node.js** 18+ (for some dependencies)
- **Git** for version control
- **TypeScript** knowledge

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR-USERNAME/claude-agent-desktop.git
   cd claude-agent-desktop/packages/claudelet
   ```

3. Add upstream remote:
   ```bash
   git remote add upstream https://github.com/ORIGINAL-OWNER/claude-agent-desktop.git
   ```

## Development Setup

1. **Install dependencies:**
   ```bash
   bun install
   ```

2. **Run in development mode:**
   ```bash
   bun run dev
   ```

3. **Build the project:**
   ```bash
   bun run build
   ```

4. **Run type checking:**
   ```bash
   bun run typecheck
   ```

5. **Format code:**
   ```bash
   bun run format
   ```

## Code Style

### TypeScript Guidelines

- **Strict typing**: Use explicit types, avoid `any`
- **Function signatures**: Always specify return types
- **Imports**: Group by type (external, internal, types)
- **Formatting**: 2-space indentation, no semicolons, trailing commas

### Example

```typescript
import { startAgentSession } from 'claude-agent-loop'
import type { AgentSessionHandle } from 'claude-agent-loop'

import { loadAuth, saveAuth } from '../src/auth-storage.js'

interface MyState {
  messages: Message[]
  isResponding: boolean
}

async function handleMessage(input: string): Promise<void> {
  // Implementation
}
```

### Naming Conventions

- **Variables/Functions**: `camelCase`
- **Types/Interfaces**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **Files**: `kebab-case.ts` or `PascalCase.tsx` for components

### Comments

- Use JSDoc for public APIs
- Inline comments for complex logic
- Keep comments concise and relevant

```typescript
/**
 * Resolves a file reference and returns its content
 * @param filePath - Path relative to current working directory
 * @returns File content or null if not found/accessible
 */
async function resolveFileReference(filePath: string): Promise<string | null> {
  // Implementation
}
```

## Making Changes

### Branching Strategy

1. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the code style guidelines

3. **Commit your changes:**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

### Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**
```
feat(chips): add click-to-remove functionality for context chips
fix(input): handle Ctrl+C to clear input before quitting
docs(readme): update keyboard shortcuts section
refactor(ai-tools): extract LSP logic into separate module
```

### Areas for Contribution

**UI/UX Improvements:**
- New keyboard shortcuts
- Visual enhancements
- Accessibility features
- Mouse interaction improvements

**AI Tools:**
- Additional LSP language support
- New code analysis tools
- Search algorithm improvements
- Model integration

**Core Features:**
- Session management
- Context handling
- Provider support
- Performance optimizations

**Documentation:**
- Tutorial improvements
- Code examples
- API documentation
- Troubleshooting guides

## Testing

### Running Tests

```bash
bun test
```

### Writing Tests

- Place tests in `__tests__/` directories
- Name test files `*.test.ts`
- Use descriptive test names
- Test edge cases and error handling

```typescript
import { describe, test, expect } from 'bun:test'
import { segmentsToDisplayString } from '../bin/claudelet-opentui'

describe('segmentsToDisplayString', () => {
  test('converts text segments to string', () => {
    const segments = [{ type: 'text', text: 'hello' }]
    expect(segmentsToDisplayString(segments)).toBe('hello')
  })

  test('converts chip segments to bracketed labels', () => {
    const segments = [
      { type: 'chip', chip: { id: '1', label: 'test.ts', filePath: 'test.ts' } }
    ]
    expect(segmentsToDisplayString(segments)).toBe('[test.ts]')
  })
})
```

### Manual Testing

Before submitting:

1. **Run the application:**
   ```bash
   bun run dev
   ```

2. **Test key features:**
   - Authentication flow
   - Message sending/receiving
   - Context chips (add/remove)
   - File references
   - Keyboard shortcuts
   - AI tools (if applicable)

3. **Check different scenarios:**
   - Empty input
   - Multi-line input
   - Large files
   - Network errors
   - Edge cases

## Submitting Changes

### Pull Request Process

1. **Update your branch:**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Push to your fork:**
   ```bash
   git push origin feature/your-feature-name
   ```

3. **Create Pull Request** on GitHub

4. **Fill out PR template** with:
   - Description of changes
   - Motivation and context
   - Testing performed
   - Screenshots (if UI changes)

### PR Guidelines

- **Keep PRs focused** - One feature/fix per PR
- **Update documentation** - If you change functionality
- **Add tests** - For new features or bug fixes
- **Pass CI checks** - Ensure all checks pass
- **Respond to feedback** - Address review comments promptly

### Review Process

- Maintainers will review your PR
- Address any requested changes
- Once approved, your PR will be merged
- Your contribution will be credited

## Feature Requests

Have an idea for a new feature?

1. **Check existing issues** - It might already be proposed
2. **Open a new issue** with:
   - Clear description of the feature
   - Use case and benefits
   - Proposed implementation (optional)
   - Examples or mockups (if applicable)

## Bug Reports

Found a bug?

1. **Check existing issues** - It might already be reported
2. **Open a new issue** with:
   - Clear description of the bug
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (OS, Bun version, etc.)
   - Screenshots or logs (if applicable)

### Bug Report Template

```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Run '...'
2. Type '...'
3. Press '...'
4. See error

**Expected behavior**
What you expected to happen.

**Screenshots/Logs**
If applicable, add screenshots or log output.

**Environment:**
- OS: [e.g., macOS 14.0]
- Bun version: [e.g., 1.0.0]
- Claudelet version: [e.g., 0.1.0]

**Additional context**
Any other relevant information.
```

## Development Tips

### Debugging

**Enable debug mode:**
```bash
DEBUG=1 bun run dev
```

**Check logs:**
- Look for debug output in terminal
- Check error messages in UI
- Use browser DevTools for blessed-contrib elements

### Common Issues

**TypeScript errors:**
```bash
bun run typecheck
```

**Formatting issues:**
```bash
bun run format
```

**Dependency issues:**
```bash
rm -rf node_modules
bun install
```

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on the code, not the person
- Help create a welcoming environment

## Questions?

- Open an issue for general questions
- Tag maintainers for urgent matters
- Check documentation first

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Claudelet! 🎉
