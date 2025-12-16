# Environment Variable Sanitization

This document describes the environment variable sanitization system implemented to prevent API keys, tokens, and other sensitive data from appearing in logs and error messages.

## Overview

The sanitization system automatically redacts sensitive environment variables and secrets from:
- Debug logs
- Error messages
- Console output
- Log files
- Serialized objects

## Protected Variables

The system protects the following environment variable patterns:

### Explicit Keys
- `ANTHROPIC_API_KEY` - Anthropic API key
- `CLAUDELET_AUTH_TOKEN` - Claude authentication token

### Pattern-Based (Case-Insensitive)
- `*_API_KEY` - Any API key variable
- `*_SECRET` - Any secret variable
- `*_TOKEN` - Any token variable
- `*_PASSWORD` - Any password variable
- `*_PRIVATE*` - Any private key
- `*_AUTH*` - Any authentication-related variable
- `*_KEY*` - Any key variable
- `*_CREDENTIAL*` - Any credential variable

## Usage

### 1. Basic Text Sanitization

```typescript
import { sanitizeText } from './src/env-sanitizer'

// Sanitize a message before logging
const message = 'Failed to authenticate: sk-ant-secret123'
console.error(sanitizeText(message))
// Output: Failed to authenticate: [REDACTED]
```

### 2. Sanitize Environment Objects

```typescript
import { sanitizeEnv } from './src/env-sanitizer'

// Sanitize environment before logging
console.log(sanitizeEnv(process.env))
// ANTHROPIC_API_KEY will show as [REDACTED]
// NODE_ENV will show normally
```

### 3. Using the Sanitized Proxy

```typescript
import { sanitizedEnv } from './src/env-sanitizer'

// Use proxy instead of process.env for logging
console.log(sanitizedEnv)
// Sensitive keys are hidden from enumeration
// JSON.stringify(sanitizedEnv) won't expose secrets
```

### 4. Creating a Sanitizing Logger

```typescript
import { createSanitizingLogger } from './src/env-sanitizer'

const debugLog = createSanitizingLogger('MyModule')

debugLog('Starting with token:', myToken)
// Output: [2025-12-16T...] [MyModule] Starting with token: [REDACTED]
```

### 5. Check if Key is Sensitive

```typescript
import { isSensitiveKey } from './src/env-sanitizer'

if (isSensitiveKey('ANTHROPIC_API_KEY')) {
  // Handle sensitive key specially
}
```

## Implementation Details

### Files Modified

1. **src/env-sanitizer.ts** (NEW)
   - Core sanitization utilities
   - Pattern matching for sensitive keys
   - Proxy implementation for safe environment access

2. **src/index.ts**
   - Exports all sanitization functions for library usage

3. **bin/claudelet-opentui.tsx**
   - Updated `debugLog` to use `sanitizeText`
   - Imports sanitization utilities

4. **bin/claudelet.ts**
   - Updated `logDebug` to use `sanitizeText`
   - Imports sanitization utilities

5. **bin/claudelet-tui.tsx**
   - Added import for sanitization utilities (ready for use)

6. **src/auth-storage.ts**
   - Updated error handlers to sanitize error messages
   - Prevents token/key exposure in error logs

### Sanitization Patterns

The system redacts:

1. **API Keys** - Matches `sk-ant-*` and similar patterns
2. **Bearer Tokens** - Matches `Bearer <token>`
3. **JSON Tokens** - Matches `"access_token": "..."`, `"refresh_token": "..."`, etc.
4. **Key-Value Pairs** - Matches `KEY=value` where KEY is sensitive

Example redactions:
```
"Failed with token: sk-ant-secret123" → "Failed with token: [REDACTED]"
"Bearer eyJhbGciOiJIUzI1NiJ9" → "Bearer [REDACTED]"
'{"access_token": "xyz123"}' → '{"access_token": "[REDACTED]"}'
"ANTHROPIC_API_KEY=secret" → "ANTHROPIC_API_KEY=[REDACTED]"
```

## Testing

Comprehensive tests are provided in `tests/env-sanitizer.test.ts`:

```bash
npm run test tests/env-sanitizer.test.ts
```

### Test Coverage

- **Pattern Detection** - Verifies sensitive keys are identified
- **Text Sanitization** - Ensures secrets are redacted from strings
- **Environment Objects** - Tests sanitization of env variable objects
- **Proxy Behavior** - Verifies sanitizedEnv hides sensitive keys
- **Logger Creation** - Tests sanitizing logger functionality
- **Integration** - End-to-end tests across multiple methods

## Best Practices

### 1. Always Sanitize Before Logging

```typescript
// WRONG - exposes secrets
console.error(`Auth failed:`, authData)

// RIGHT - sanitizes output
console.error(`Auth failed:`, sanitizeText(JSON.stringify(authData)))
```

### 2. Use the Proxy for Environment Access

```typescript
// WRONG - might expose secrets
console.log('Config:', process.env)

// RIGHT - hides sensitive keys
console.log('Config:', sanitizedEnv)
```

### 3. Sanitize Error Messages

```typescript
// WRONG - error might contain tokens
catch (error) {
  console.error('Error:', error.message)
}

// RIGHT - sanitize before logging
catch (error) {
  console.error('Error:', sanitizeText(error.message))
}
```

### 4. Use Sanitizing Logger

```typescript
// Create once at module level
const logger = createSanitizingLogger('ModuleName')

// Use for all debug output
logger('Processing:', data)
logger('Token:', token)  // Automatically sanitized
```

## Security Considerations

### What This Protects

- Prevents secrets from appearing in log files
- Prevents secrets from being visible in console output
- Protects against accidental serialization of environment variables
- Reduces risk of secrets being captured in error reports

### What This Does NOT Protect

- **Actual secret usage** - Code that reads and uses `process.env.ANTHROPIC_API_KEY` still gets the real value
- **Memory** - Secrets remain in memory (use full encryption for sensitive apps)
- **Stored files** - If secrets are written to files, the files themselves must be protected
- **Network requests** - API calls still use the real secrets (this is necessary)

### File Permissions

The system ensures log files are created with restrictive permissions (0o600 = user read/write only):

```typescript
fs.chmodSync(DEBUG_LOG, 0o600)  // Only owner can read/write
```

## Environment Variables

### Configuration

The system recognizes these environment variables:

- `CLAUDELET_DEBUG` - Enable debug logging to file (`true` or `false`)
- `DEBUG` - Legacy debug flag (`1`, `true`, or any truthy value)

Debug logs are stored in:
- Default: `~/.claudelet/debug.log`
- File permissions: 0o600 (user read/write only)

### Example

```bash
# Enable debug logging
CLAUDELET_DEBUG=true bun run claudelet

# View debug log
cat ~/.claudelet/debug.log
```

## Examples

### Example 1: OAuth Token Protection

```typescript
const result = await authManager.completeOAuthFlow(code, verifier, state)
if (result.tokens?.access_token) {
  // WRONG - token might appear in logs
  console.log('Token received:', result.tokens.access_token)

  // RIGHT - automatically sanitized
  debugLog(`Token received: ${result.tokens.access_token}`)
}
```

### Example 2: Error Handler Protection

```typescript
try {
  const auth = await loadAuth()
} catch (error) {
  // WRONG - error might contain path with secrets
  console.error('Failed to load auth:', error)

  // RIGHT - error is sanitized
  const sanitized = sanitizeText(String(error))
  console.error('Failed to load auth:', sanitized)
}
```

### Example 3: Configuration Logging

```typescript
// WRONG - exposes entire env
function logConfig() {
  console.log('Current configuration:', process.env)
}

// RIGHT - hides sensitive keys
function logConfig() {
  console.log('Current configuration:', sanitizedEnv)
}
```

## Maintenance

### Adding New Sensitive Patterns

To add new patterns, edit `src/env-sanitizer.ts`:

```typescript
const SENSITIVE_PATTERNS: SensitivePattern[] = [
  'ANTHROPIC_API_KEY',
  'CLAUDELET_AUTH_TOKEN',
  /API_KEY/i,
  /SECRET/i,
  // Add new pattern here:
  /CUSTOM_SENSITIVE_VAR/i,
]
```

### Adding New Redaction Rules

To add new text sanitization rules, update `sanitizeText()`:

```typescript
export function sanitizeText(text: string): string {
  return text
    // ... existing rules ...
    // Add new rule:
    .replace(/custom-pattern-[a-zA-Z0-9]+/gi, '[REDACTED]')
}
```

## FAQ

**Q: Will this slow down my application?**
A: No. The overhead is minimal (regex matching only happens during logging, not normal execution).

**Q: Can I still access the real values in code?**
A: Yes. Using `process.env.ANTHROPIC_API_KEY` returns the actual value. The sanitization only affects logging output.

**Q: What if a new secret type is used in the future?**
A: Add it to `SENSITIVE_PATTERNS` in `src/env-sanitizer.ts` to automatically protect it.

**Q: Does this prevent all secret leaks?**
A: No. This prevents *accidental* exposure through logging. Use additional security measures (encryption, secret management systems) for comprehensive protection.

**Q: Can I disable sanitization for testing?**
A: The sanitization is always active, but tests can verify it's working correctly (see `tests/env-sanitizer.test.ts`).
