# Security Vulnerabilities: Code Location Reference

Quick lookup guide showing exact file paths and line numbers for all identified vulnerabilities.

## Critical Vulnerabilities

### Vulnerability 1: PKCE Verifier Used as State Parameter
- **File:** `src/oauth-client.ts`
- **Line:** 79
- **Code:** `url.searchParams.set('state', pkce.verifier)`
- **Severity:** CRITICAL
- **Fix Location:** See REMEDIATION_GUIDE.md - Fix 1

---

### Vulnerability 2: Missing State Parameter Validation
- **File:** `src/oauth-client.ts`
- **Lines:** 115-136 (completeLogin method)
- **Critical Section:** Lines 120-123 (state extraction without validation)
- **Code:**
  ```typescript
  const splits = code.split('#')
  const authCode = splits[0]
  const state = splits[1]  // Extracted but never validated!
  ```
- **Severity:** CRITICAL
- **Missing Validation:** No comparison with stored/expected state
- **Fix Location:** See REMEDIATION_GUIDE.md - Fix 2

---

### Vulnerability 3: Sensitive Error Information Leakage
- **File:** `src/oauth-client.ts`
- **Line 142:** `throw new Error(\`Failed to exchange code for tokens: ${response.statusText} - ${errorText}\`)`
- **Line 176:** `throw new Error(\`Failed to create API key: ${response.statusText} - ${errorText}\`)`
- **Line 244:** `throw new Error(\`Failed to refresh access token: ${response.statusText} - ${errorText}\`)`
- **Severity:** CRITICAL
- **Issue:** Exposes `errorText` which contains sensitive server details
- **Affected Methods:**
  - `exchangeCodeForTokens()` - Line 142
  - `createApiKey()` - Line 176
  - `refreshAccessToken()` - Line 244
- **Fix Location:** See REMEDIATION_GUIDE.md - Fix 3

---

## High Priority Vulnerabilities

### Vulnerability 4: Missing Response Content-Type and Field Validation
- **File:** `src/oauth-client.ts`
- **Lines:** 145-149 (exchangeCodeForTokens)
  ```typescript
  const json = (await response.json()) as {
    refresh_token: string
    access_token: string
    expires_in: number
  }
  ```
- **Lines:** 179-180 (createApiKey)
  ```typescript
  const json = (await response.json()) as { raw_key: string }
  ```
- **Lines:** 247-251 (refreshAccessToken)
  ```typescript
  const json = (await response.json()) as {
    refresh_token: string
    access_token: string
    expires_in: number
  }
  ```
- **Issues:**
  - No content-type validation
  - Type assertion with 'as' provides zero runtime checking
  - Missing field validation
  - No field content validation
- **Severity:** HIGH
- **Fix Location:** See REMEDIATION_GUIDE.md - Fix 4

---

### Vulnerability 5: Missing HTTPS Enforcement for Callbacks
- **File:** `examples/cli-example.ts`
- **Lines:** 33-40
  ```typescript
  const url = new URL(callbackUrl)
  const code = url.searchParams.get('code')
  // No HTTPS validation!
  ```
- **File:** `examples/api-key-example.ts`
- **Lines:** 33-34
  ```typescript
  const url = new URL(callbackUrl)
  const code = url.searchParams.get('code')
  // No HTTPS validation!
  ```
- **Issue:** Callback URLs accepted without HTTPS validation
- **Severity:** HIGH
- **Fix Location:** See REMEDIATION_GUIDE.md - Fix 5

---

## Medium Priority Vulnerabilities

### Vulnerability 6: Hardcoded Default Client ID
- **File:** `src/oauth-client.ts`
- **Line:** 12
- **Code:** `const DEFAULT_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'`
- **Severity:** MEDIUM
- **Issue:** Client ID visible in source and not configurable
- **Fix Location:** See REMEDIATION_GUIDE.md - Fix 6

---

### Vulnerability 7: No Explicit HTTPS Validation for Endpoints
- **File:** `src/oauth-client.ts`
- **Lines:** 13-17
  ```typescript
  const AUTHORIZATION_ENDPOINT_MAX = 'https://claude.ai/oauth/authorize'
  const AUTHORIZATION_ENDPOINT_CONSOLE = 'https://console.anthropic.com/oauth/authorize'
  const TOKEN_ENDPOINT = 'https://console.anthropic.com/v1/oauth/token'
  const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback'
  const CREATE_API_KEY_ENDPOINT = 'https://api.anthropic.com/api/oauth/claude_cli/create_api_key'
  ```
- **Severity:** MEDIUM
- **Issue:** HTTPS enforced by hardcoding but no runtime validation
- **Note:** Mitigated by hardcoded URLs but best practice would add validation

---

## Low Priority Vulnerabilities

### Vulnerability 8: Token Expiration Race Condition
- **File:** `src/oauth-client.ts`
- **Lines:** 267-270 (isTokenExpired method)
  ```typescript
  isTokenExpired(tokens: OAuthTokens): boolean {
    const fiveMinutes = 5 * 60 * 1000
    return tokens.expires < Date.now() + fiveMinutes
  }
  ```
- **Severity:** LOW
- **Issue:** Time-of-check time-of-use (TOCTOU) race condition
- **Impact:** Token could expire between check and use

---

### Vulnerability 9: API Key Exposure in Examples
- **File:** `examples/api-key-example.ts`
- **Line 48:** `console.log('API Key:', result.apiKey)`
- **Lines 51-53:**
  ```typescript
  console.log(`const anthropic = new Anthropic({`)
  console.log(`  apiKey: '${result.apiKey}'`)
  console.log(`})`)
  ```
- **Severity:** LOW
- **Issue:** API keys printed to console (visible in history)
- **File:** `examples/cli-example.ts`
- **Line 52:** `console.log('Access Token:', result.tokens.access)`
- **Severity:** LOW
- **Issue:** Tokens printed to console

---

## Summary Table

| # | Vulnerability | File | Lines | Severity |
|---|---|---|---|---|
| 1 | PKCE verifier as state | oauth-client.ts | 79 | CRITICAL |
| 2 | Missing state validation | oauth-client.ts | 115-136 | CRITICAL |
| 3 | Error info leakage | oauth-client.ts | 142,176,244 | CRITICAL |
| 4 | Missing response validation | oauth-client.ts | 145-149,179-180,247-251 | HIGH |
| 5 | No HTTPS enforcement | cli-example.ts, api-key-example.ts | 33-40 | HIGH |
| 6 | Hardcoded client ID | oauth-client.ts | 12 | MEDIUM |
| 7 | No HTTPS validation | oauth-client.ts | 13-17 | MEDIUM |
| 8 | Expiration race condition | oauth-client.ts | 267-270 | LOW |
| 9 | Key exposure in examples | api-key-example.ts, cli-example.ts | 48,51-53,52 | LOW |

---

## File Structure for Reference

```
anthropic-oauth/
├── src/
│   ├── oauth-client.ts          ← Contains 7 vulnerabilities (lines 12-270)
│   ├── types.ts                 ← No vulnerabilities
│   └── index.ts                 ← No vulnerabilities
├── examples/
│   ├── cli-example.ts           ← Contains 1 vulnerability (lines 33-40)
│   └── api-key-example.ts       ← Contains 2 vulnerabilities (lines 48,51-53,33-34)
├── dist/                        ← Compiled output (review after fixes)
└── package.json                 ← No vulnerabilities
```

---

## Quick Navigation

**To view a specific vulnerability:**

1. Open the indicated file in your editor
2. Navigate to the specified line number(s)
3. Reference REMEDIATION_GUIDE.md for the fix
4. Use the provided code examples for implementation

**To implement all fixes:**

1. Read REMEDIATION_GUIDE.md in order (Fix 1 → Fix 6)
2. Implement each fix with provided code examples
3. Use this file to verify you've updated all locations
4. Run tests to confirm fixes work correctly

---

## Testing Locations

After implementing fixes, these areas should be thoroughly tested:

- `src/oauth-client.ts` - All public methods (startLogin, completeLogin, refreshAccessToken, etc.)
- `examples/cli-example.ts` - Full OAuth flow with state validation
- `examples/api-key-example.ts` - API key creation with state validation
- Response validation for all three token endpoints (token, create_api_key, refresh)
- Error scenarios and edge cases

---

**Last Updated:** December 3, 2025
**Audit Version:** 1.0
