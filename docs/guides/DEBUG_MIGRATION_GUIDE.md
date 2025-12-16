# Debug Logging Migration Guide

This document describes the changes made to debug logging in Claudelet and how to migrate from the old insecure logging to the new secure implementation.

## Security Issue Fixed

**Problem:** Debug logging was hardcoded to `true` and writing to `/tmp/claudelet-opentui-debug.log` with world-readable permissions, exposing sensitive data:
- OAuth tokens
- API keys
- User messages
- Authentication responses

**Solution:** Implemented secure debug logging that:
- Is disabled by default (opt-in via environment variable)
- Writes to user home directory (`~/.claudelet/debug.log`)
- Restricts permissions to user only (0o600)
- Automatically sanitizes sensitive data patterns
- Provides clear documentation on safe usage

## Changes Made

### Code Changes

**File:** `bin/claudelet-opentui.tsx`

1. **DEBUG constant** - Now controlled by environment variable
   ```typescript
   // OLD: const DEBUG = true; // ❌ Always enabled

   // NEW: Only enabled when explicitly set
   const DEBUG = process.env.CLAUDELET_DEBUG === 'true';
   ```

2. **Log location** - Moved to secure user directory
   ```typescript
   // OLD: const DEBUG_LOG = '/tmp/claudelet-opentui-debug.log'; // ❌ World-readable

   // NEW: User home directory with proper structure
   const DEBUG_DIR = path.join(os.homedir(), '.claudelet');
   const DEBUG_LOG = path.join(DEBUG_DIR, 'debug.log');
   ```

3. **New sanitization function** - Automatically redacts sensitive data
   ```typescript
   function sanitizeSensitiveData(message: string): string {
     // Redacts:
     // - Bearer tokens
     // - OAuth tokens (access_token, refresh_token)
     // - API keys (sk-ant-*, generic api_key)
     // - Generic token fields
   }
   ```

4. **Enhanced debugLog function** - Includes directory creation, sanitization, and permissions
   ```typescript
   const debugLog = (msg: string): void => {
     if (!DEBUG) return;

     // Creates ~/.claudelet/ if needed
     // Sanitizes sensitive data
     // Sets permissions to 0o600 (user read/write only)
     // Handles errors gracefully
   }
   ```

5. **Session initialization** - Ensures proper permissions at startup
   ```typescript
   // When DEBUG is true at startup:
   // - Creates ~/.claudelet/ with mode 0o700
   // - Initializes debug.log with mode 0o600
   ```

### Documentation Changes

**File:** `README.md`

Added "Debug Logging" section under Development:
- How to enable debug mode
- Where logs are stored
- What data is sanitized
- How to clean up logs

## Migration Instructions

### For Users

**If you were using debug logs before:**

1. Stop the application
2. Clean up old logs:
   ```bash
   rm /tmp/claudelet-opentui-debug.log
   ```
3. Verify no other files:
   ```bash
   ls -la /tmp/claudelet*
   ```

**To use debug mode going forward:**

```bash
# Enable debug logging for this session
CLAUDELET_DEBUG=true bun run dev

# Or with npm
CLAUDELET_DEBUG=true npm run tui:opentui
```

### For Developers

**Testing the fix:**

1. **Verify disabled by default:**
   ```bash
   bun run dev
   # Check that ~/.claudelet/debug.log is NOT created
   ls -la ~/.claudelet/ 2>/dev/null || echo "Directory not created"
   ```

2. **Verify enabled with env var:**
   ```bash
   CLAUDELET_DEBUG=true bun run dev
   # Check that ~/.claudelet/debug.log exists with correct permissions
   ls -l ~/.claudelet/debug.log
   # Should show: -rw------- (owner read/write only)
   ```

3. **Verify sanitization:**
   ```bash
   CLAUDELET_DEBUG=true bun run dev
   # Look at log file
   cat ~/.claudelet/debug.log
   # Should show [REDACTED] for tokens/keys
   ```

4. **Clean up test logs:**
   ```bash
   rm ~/.claudelet/debug.log
   ```

## Security Verification Checklist

- [x] DEBUG defaults to false (disabled in production)
- [x] Debug mode only enabled via `CLAUDELET_DEBUG=true` environment variable
- [x] Log file location changed to `~/.claudelet/debug.log`
- [x] Log file permissions set to 0o600 (user read/write only)
- [x] Directory permissions set to 0o700 (user read/write/execute only)
- [x] Sensitive patterns sanitized:
  - [x] Bearer tokens
  - [x] OAuth access tokens
  - [x] OAuth refresh tokens
  - [x] API keys (sk-ant-*)
  - [x] Generic api_key patterns
  - [x] Generic token fields
- [x] Sanitization tested with multiple patterns
- [x] Documentation updated in README.md
- [x] No changes to production build or default behavior
- [x] Error handling graceful (fails silently if debug log can't be written)

## Compatibility

This change is **fully backward compatible:**
- Default behavior unchanged (debug logging disabled)
- Existing code that checks `DEBUG` variable continues to work
- No breaking changes to any APIs
- All existing debugLog calls continue to work (with added sanitization)

## Environment Variable Reference

**CLAUDELET_DEBUG**
- Type: Boolean string
- Valid values: `'true'` (case-sensitive)
- Default: Not set (debug disabled)
- Example: `CLAUDELET_DEBUG=true bun run dev`

## Sensitive Data Patterns

The sanitization function automatically redacts the following patterns:

| Pattern | Redaction | Regex |
|---------|-----------|-------|
| Bearer tokens | `Bearer [REDACTED]` | `Bearer\s+[A-Za-z0-9._-]+` |
| Access tokens | `"access_token": "[REDACTED]"` | `"access_token":\s*"[^"]+"` |
| Refresh tokens | `"refresh_token": "[REDACTED]"` | `"refresh_token":\s*"[^"]+"` |
| API keys (Anthropic) | `sk-ant-[REDACTED]` | `sk-ant-[A-Za-z0-9]+` |
| Generic API keys | `"api_key": "[REDACTED]"` | `"api_key":\s*"[^"]+"` |
| Generic tokens | `"token": "[REDACTED]"` | `"token":\s*"[^"]+"` |

## Questions?

For more information about debug logging, see:
- Security Audit Report: `SECURITY_AUDIT_REPORT.md` (Vulnerability #2)
- OWASP A09:2021 - Security Logging and Monitoring Failures
- CWE-532 - Insertion of Sensitive Information into Log File

## Related Issues

- Issue #001: File Permission Security (auth storage)
- Issue #002: Debug Logging with Sensitive Data (this issue)
