# Claudelet Security Fixes - Quick Reference Checklist

## Critical (Deploy Today)

### Fix #1: Auth File Permissions
- **File:** `src/auth-storage.ts`
- **Change:** Add `fs.chmodSync(AUTH_FILE, 0o600)` after line 32
- **Verify:** `ls -la ~/.claude-agent-auth.json | grep " 600"`
- **Time:** 5 minutes
- **Risk if not done:** Any user can read your API keys

```typescript
fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), 'utf8');
fs.chmodSync(AUTH_FILE, 0o600);  // ← ADD THIS LINE
```

---

## High Priority (This Week)

### Fix #2: Debug Logging
- **File:** `bin/claudelet-opentui.tsx`
- **Changes:**
  - Line 52: Change `DEBUG = true` to `DEBUG = process.env.CLAUDELET_DEBUG === 'true'`
  - Line 53: Change DEBUG_LOG path to `path.join(os.homedir(), '.cache', 'claudelet', 'debug.log')`
  - Add chmod to debug logging function
- **Verify:** `grep -i "token\|oauth" ~/.cache/claudelet/debug.log` (should be empty)
- **Time:** 30 minutes
- **Risk if not done:** Debug logs contain auth information in world-readable /tmp

### Fix #3: OAuth Code Validation
- **File:** `packages/anthropic-oauth/src/oauth-client.ts`
- **Change:** Add validateAuthorizationCode() method and call it in exchangeCodeForTokens()
- **Verify:** Test with malformed codes - should reject
- **Time:** 45 minutes
- **Risk if not done:** Malformed OAuth codes could cause issues, potential injection

### Fix #4: Environment Variable Safety
- **File:** `bin/claudelet-opentui.tsx`
- **Changes:**
  - Don't display the actual ANTHROPIC_API_KEY value
  - Delete from process.env after reading
  - Never include env vars in error messages
- **Verify:** Test with API key in env - should not leak to stdout/stderr
- **Time:** 20 minutes
- **Risk if not done:** API keys visible in error messages or process inspection

---

## Medium Priority (Next 2 Weeks)

### Fix #5: Clipboard Security
- **File:** `bin/claudelet-opentui.tsx`
- **Changes:**
  - Add timeout: 5000ms
  - Add maxBuffer: 10MB
  - Add sanitization function for null bytes/control chars
- **Verify:** Paste large content - should not hang
- **Time:** 45 minutes
- **Risk if not done:** DOS via clipboard content, application hang

### Fix #6: Search Query Validation
- **File:** `bin/claudelet-ai-tools.ts`
- **Changes:**
  - Add validateSearchQuery() method
  - Check query length (max 1000 chars)
  - Block ReDoS patterns
  - Add execution timeout (10 seconds)
- **Verify:** Search query timeout working
- **Time:** 1 hour
- **Risk if not done:** DOS via regex attack, CPU spike

### Fix #7: Symlink Attack Prevention
- **File:** `src/session-storage.ts`
- **Changes:**
  - Use fs.lstatSync() instead of checking existence
  - Detect symlinks before writing
  - Set directory perms to 0o700
  - Set file perms to 0o600
- **Verify:** Create symlink, verify rejection
- **Time:** 1 hour
- **Risk if not done:** Attacker can overwrite arbitrary files

---

## Low Priority (Next Release)

### Fix #8: Configurable OAuth Client ID
- **File:** `packages/anthropic-oauth/src/oauth-client.ts`
- **Change:** Allow ANTHROPIC_OAUTH_CLIENT_ID environment variable
- **Verify:** Set env var, verify it's used
- **Time:** 10 minutes
- **Risk if not done:** Shared client ID across all apps (operational issue only)

---

## Testing Checklist

After each fix, verify:

- [ ] Code compiles without errors
- [ ] No TypeScript errors: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Unit tests pass: `npm test`
- [ ] Manual functional test passes
- [ ] File permissions correct (where applicable)
- [ ] No console output of secrets

---

## Quick Test Commands

```bash
# Check auth file permissions (should be 600)
stat ~/.claude-agent-auth.json | grep Access

# Check debug log is not world-readable
stat ~/.cache/claudelet/debug.log | grep Access

# Verify no secrets in debug log
grep -i "token\|oauth\|sk-ant" ~/.cache/claudelet/debug.log

# Check sessions directory is not a symlink
file ~/.claudelet/sessions/

# Verify sessions are not world-readable
stat ~/.claudelet/sessions/*.json | grep Access
```

---

## Priority Matrix

| Fix | Severity | Effort | Impact | Do First? |
|-----|----------|--------|--------|-----------|
| Auth file chmod | CRITICAL | 5m | HIGH | YES |
| Debug logging | HIGH | 30m | HIGH | YES |
| OAuth validation | HIGH | 45m | MEDIUM | YES |
| Env var safety | HIGH | 20m | MEDIUM | YES |
| Clipboard timeout | MEDIUM | 45m | MEDIUM | THEN |
| Search validation | MEDIUM | 60m | MEDIUM | THEN |
| Symlink check | MEDIUM | 60m | HIGH | THEN |
| Client ID config | LOW | 10m | LOW | LATER |

---

## Deployment Steps

1. **Create feature branch:**
   ```bash
   git checkout -b security/fix-vulnerabilities
   ```

2. **Apply fixes in order** (Critical → High → Medium → Low)

3. **Test each fix:**
   ```bash
   npm run typecheck
   npm run lint
   npm run format:check
   ```

4. **Manual testing:**
   - Test authentication
   - Test debug logging
   - Test OAuth flow
   - Test clipboard
   - Test search

5. **Create PR with description:**
   ```
   Security: Fix 8 vulnerabilities from audit

   - Critical: Auth file permissions
   - High: Debug logging, OAuth validation, env vars
   - Medium: Clipboard, search, symlinks
   - Low: Client ID config

   Fixes #ISSUE_NUMBER
   ```

6. **Code review required**

7. **Merge to main**

8. **Tag release:**
   ```bash
   git tag -a v1.0.1-security -m "Security fixes for audit findings"
   git push origin v1.0.1-security
   ```

9. **Notify users:**
   - Create security advisory
   - Recommend upgrade
   - Request API key regeneration for critical fix

---

## Files to Modify

```
src/auth-storage.ts                  ← FIX #1
src/session-storage.ts               ← FIX #7

bin/claudelet-opentui.tsx            ← FIX #2, #4, #5
bin/claudelet-ai-tools.ts            ← FIX #6

packages/anthropic-oauth/src/oauth-client.ts          ← FIX #3, #8
packages/claude-agent-loop/examples/auth-storage.ts   ← FIX #1 (duplicate)
```

---

## What NOT to Do

- ❌ Don't modify security-critical code without tests
- ❌ Don't skip code review for security changes
- ❌ Don't merge to production without team approval
- ❌ Don't forget to update CHANGELOG
- ❌ Don't deploy without notifying users
- ❌ Don't use hardcoded secrets in fixes
- ❌ Don't ignore error messages during implementation

---

## Success Criteria

All fixes are complete when:

- ✅ All 8 vulnerabilities addressed
- ✅ All files have correct permissions (600/700)
- ✅ No secrets in logs or error messages
- ✅ Tests pass 100%
- ✅ Code review approved
- ✅ Users notified
- ✅ Release tagged and deployed
- ✅ No regressions reported

---

## Emergency Contacts

- **Security Issue:** Document and contact security team
- **Implementation Question:** Review SECURITY_FIXES.md
- **User Report:** File issue and reference SECURITY_ADVISORY.md
- **Regression:** Rollback and investigate

---

## Documents for Reference

1. **SECURITY_AUDIT_REPORT.md** - Full detailed audit
2. **SECURITY_FIXES.md** - Complete code implementations
3. **SECURITY_SUMMARY.txt** - Executive summary
4. **This file** - Quick reference checklist

---

**Last Updated:** 2025-12-16
**Status:** Ready for Implementation
**Estimated Total Time:** 6-8 hours
**Team Required:** 1 developer + 1 reviewer
