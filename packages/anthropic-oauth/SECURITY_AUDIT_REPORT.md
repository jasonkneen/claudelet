# Security Audit Report: @anthropic-ai/anthropic-oauth

**Date:** December 3, 2025
**Auditor:** Application Security Specialist
**Package:** @anthropic-ai/anthropic-oauth v1.0.0
**Scope:** OAuth 2.0 PKCE Implementation Analysis

---

## Executive Summary

**Overall Risk Assessment: CRITICAL SEVERITY**

The OAuth package contains **3 Critical vulnerabilities** and **2 High severity issues** that compromise the security of the OAuth 2.0 PKCE flow. The most severe issue is the misuse of the PKCE verifier as the OAuth state parameter, which violates the OAuth 2.0 specification and enables CSRF attacks and authorization code interception.

**Immediate Actions Required:** Halt use of this package in production until vulnerabilities are remediated.

---

## Risk Matrix

| Severity | Count | Issues |
|----------|-------|--------|
| **Critical** | 3 | PKCE verifier as state, missing state validation, error information leakage |
| **High** | 2 | Missing response validation, incomplete PKCE flow specification |
| **Medium** | 1 | Hardcoded client ID, missing HTTPS enforcement |
| **Low** | 2 | Token expiration timing, API key exposure in logs |

---

## Detailed Findings

### Finding 1: CRITICAL - PKCE Verifier Used as OAuth State Parameter

**Severity:** CRITICAL
**Location:** `/src/oauth-client.ts:79`
**CWE:** CWE-352 (Cross-Site Request Forgery), CWE-640 (Weak Password Recovery Mechanism)

#### Description

The code uses the PKCE verifier directly as the OAuth state parameter:

```typescript
// Line 79 - CRITICAL ISSUE
url.searchParams.set('state', pkce.verifier)
```

**This violates OAuth 2.0 specification (RFC 6234) and creates multiple security vulnerabilities:**

1. **CSRF Attack Vector**: The state parameter should be cryptographically random and independent from the PKCE verifier. An attacker can predict the state value if they can predict the PKCE verifier.

2. **Authorization Code Interception**: By knowing both the state AND using the same PKCE challenge, an attacker can:
   - Initiate their own OAuth flow to get a state value
   - Intercept a victim's authorization code
   - Since the state matches their prediction, the code will be accepted
   - Use the PKCE verifier to exchange the code for tokens

3. **No CSRF Protection**: State should be unpredictable per-session. Using a predictable value that's derived from PKCE challenge defeats CSRF protection.

#### Proof of Concept

```typescript
// Attacker's attack scenario:
1. Start OAuth flow: GET /authorize?state=<attacker_predictable_value>&code_challenge=X
2. Intercept victim's authorization code from callback
3. Since state is predictable and matches attacker's expectation, code is accepted
4. Exchange code using same PKCE verifier → attacker gains access token

// The flow should be:
state: (random, cryptographically strong, stored server-side)
code_challenge: (PKCE challenge, different from state)
```

#### Exploitability

**HIGH** - An attacker with network access (man-in-the-middle) or access to browser history can:
- Predict state values
- Intercept authorization codes
- Exchange codes for tokens using known PKCE verifiers

#### Impact

- **Confidentiality:** COMPROMISED - Attacker can obtain access tokens
- **Integrity:** COMPROMISED - Attacker can act as the user
- **Availability:** COMPROMISED - Account takeover possible

#### Remediation

```typescript
// INCORRECT (Current):
url.searchParams.set('state', pkce.verifier)

// CORRECT:
import crypto from 'crypto'

// Generate independent, random state
const state = crypto.randomBytes(32).toString('hex')
// Store state along with verifier for later validation
sessionStorage.set(`oauth_state_${state}`, { verifier: pkce.verifier })
url.searchParams.set('state', state)

// In completeLogin(), validate that returned state matches stored state
```

---

### Finding 2: CRITICAL - Missing State Parameter Validation

**Severity:** CRITICAL
**Location:** `/src/oauth-client.ts:115-136` (missing validation)
**CWE:** CWE-352 (Cross-Site Request Forgery)

#### Description

The `completeLogin()` method receives the state parameter from the callback but **never validates it**:

```typescript
// Lines 120-123 - Extracts state but never validates it
const splits = code.split('#')
const authCode = splits[0]
const state = splits[1]  // State is extracted but never used for validation

// Lines 131-132 - State is sent to server but never verified against original
body: JSON.stringify({
  code: authCode,
  state: state,  // Sent to server, but no client-side validation
  // ...
})
```

**The vulnerability:**

1. No comparison of returned state against a stored/expected state value
2. No validation that state format is correct
3. No protection against state substitution attacks
4. The application blindly trusts any state value returned by the OAuth server

#### Attack Scenario

```
1. Attacker intercepts OAuth callback
2. Modifies state parameter to arbitrary value
3. Client code accepts the modified state without validation
4. Application proceeds with login, assuming state validation passed
5. CSRF protection is completely bypassed
```

#### Remediation

```typescript
async completeLogin(
  code: string,
  verifier: string,
  createKey = false
): Promise<OAuthCompleteResult> {
  const splits = code.split('#')
  const authCode = splits[0]
  const returnedState = splits[1]

  // REQUIRED: Retrieve and validate stored state
  const storedStateData = this.getStoredState(returnedState)
  if (!storedStateData) {
    throw new Error('Invalid state parameter: no matching session found')
  }

  // Validate state matches expectations
  if (storedStateData.verifier !== verifier) {
    throw new Error('State validation failed: verifier mismatch')
  }

  // Clear stored state (prevent replay attacks)
  this.clearStoredState(returnedState)

  // Continue with token exchange...
}
```

---

### Finding 3: CRITICAL - Sensitive Error Information Leakage

**Severity:** CRITICAL
**Location:** `/src/oauth-client.ts:140-143, 174-177, 242-245`
**CWE:** CWE-209 (Information Exposure Through an Error Message)

#### Description

Error messages expose sensitive information about OAuth server responses:

```typescript
// Line 142
throw new Error(`Failed to exchange code for tokens: ${response.statusText} - ${errorText}`)

// Line 176
throw new Error(`Failed to create API key: ${response.statusText} - ${errorText}`)

// Line 244
throw new Error(`Failed to refresh access token: ${response.statusText} - ${errorText}`)
```

**The vulnerability:**

1. **Server Error Details Exposed**: The response body (`errorText`) may contain:
   - Server implementation details
   - Internal API structure
   - Sensitive error codes
   - Database error messages
   - Temporary credentials or session IDs

2. **Information Gathering for Attacks**: Error messages logged to console or displayed to users can reveal:
   - Which OAuth server version is running
   - Internal validation logic
   - Rate limiting details
   - Account status information

3. **Client-Side Information Disclosure**: In browser/Electron contexts, these errors are logged to:
   - Browser console (visible to developer tools)
   - Application logs
   - Crash reporting systems
   - Error tracking services (Sentry, etc.)

#### Examples of Leaked Data

```
// Potential error responses that would be exposed:
"Failed to exchange code for tokens: Unauthorized - Invalid code: 12345678..."
"Failed to create API key: Too Many Requests - Rate limit exceeded until 2025-12-03T15:30:00Z"
"Failed to refresh access token: Bad Request - User account suspended due to policy violation"
```

#### Remediation

```typescript
// INCORRECT (Current):
if (!response.ok) {
  const errorText = await response.text()
  throw new Error(`Failed to exchange code for tokens: ${response.statusText} - ${errorText}`)
}

// CORRECT:
if (!response.ok) {
  // Log full details internally for debugging only
  const errorText = await response.text()
  console.error('[OAuth] Token exchange failed:', {
    status: response.status,
    statusText: response.statusText,
    body: errorText
  })

  // Expose only safe, generic error to caller
  if (response.status === 401) {
    throw new Error('Authorization failed: Invalid or expired code')
  } else if (response.status === 429) {
    throw new Error('Too many requests: Please try again in a few moments')
  } else {
    throw new Error('Authentication failed: Unable to complete login')
  }
}
```

---

### Finding 4: HIGH - Missing Response Content-Type Validation

**Severity:** HIGH
**Location:** `/src/oauth-client.ts:125-149, 166-181, 230-259`
**CWE:** CWE-347 (Improper Verification of Cryptographic Signature)

#### Description

The code assumes all responses are valid JSON without validating the response content-type or structure:

```typescript
// Line 145-149 - No content-type check, assumes JSON
const json = (await response.json()) as {
  refresh_token: string
  access_token: string
  expires_in: number
}

// If server returns HTML (error page), response.json() will fail silently or throw
// If server returns text instead of JSON, type casting with 'as' provides false security
```

**The vulnerability:**

1. **No Content-Type Validation**: Server could return HTML error page instead of JSON
2. **Weak Type Assertion**: The `as` keyword provides zero runtime type checking
3. **No Field Validation**: Missing required fields (`access_token`, `refresh_token`, `expires_in`) are not verified
4. **Type Spoofing**: Server could return fields with wrong types (e.g., `expires_in: "3600"` as string instead of number)

#### Attack Scenario

```
1. Attacker MitM's the token endpoint response
2. Returns valid JSON but missing required fields: {"access_token": "invalid"}
3. Code assigns undefined to refresh_token (no validation)
4. Application stores invalid token object
5. Later token operations fail cryptically
```

#### Remediation

```typescript
private async exchangeCodeForTokens(code: string, verifier: string): Promise<OAuthTokens> {
  // ... fetch call ...

  if (!response.ok) { /* error handling */ }

  // REQUIRED: Validate content-type
  const contentType = response.headers.get('content-type')
  if (!contentType?.includes('application/json')) {
    throw new Error('Invalid response: Expected JSON content-type')
  }

  const json = await response.json()

  // REQUIRED: Validate all required fields exist and have correct types
  if (typeof json.access_token !== 'string' || !json.access_token) {
    throw new Error('Invalid token response: Missing access_token')
  }
  if (typeof json.refresh_token !== 'string' || !json.refresh_token) {
    throw new Error('Invalid token response: Missing refresh_token')
  }
  if (typeof json.expires_in !== 'number' || json.expires_in <= 0) {
    throw new Error('Invalid token response: Invalid expires_in')
  }

  return {
    type: 'oauth',
    refresh: json.refresh_token,
    access: json.access_token,
    expires: Date.now() + json.expires_in * 1000
  }
}
```

---

### Finding 5: HIGH - No HTTPS Enforcement for Callback Handling

**Severity:** HIGH
**Location:** `/src/oauth-client.ts:31-42` (examples), `/src/types.ts:48` (documentation)
**CWE:** CWE-295 (Improper Certificate Validation)

#### Description

The code accepts callback URLs without validating they use HTTPS:

```typescript
// From examples/cli-example.ts (line 38-40)
const url = new URL(callbackUrl)
const code = url.searchParams.get('code')
// No validation that URL uses HTTPS

// From examples/api-key-example.ts (line 33-34)
const url = new URL(callbackUrl)
const code = url.searchParams.get('code')
// Still no HTTPS validation
```

**The vulnerability:**

1. **Unencrypted Callback Handling**: User could paste `http://` callback URL
2. **Authorization Code Leakage**: Authorization codes transmitted over HTTP are visible to network attackers
3. **MitM Attack**: Attacker on local network could intercept the callback code
4. **No Redirect URI Validation**: Code doesn't verify callback matches the registered redirect URI

#### Attack Scenario

```
1. User on public WiFi receives auth URL
2. Attacker also starts OAuth flow, gets similar URL
3. User's browser redirects to http://localhost:3000?code=XXXXX (unencrypted)
4. Attacker sniffs the HTTP traffic
5. Obtains authorization code
6. Uses it with their own PKCE verifier to get tokens
```

#### Remediation

```typescript
async completeLogin(
  code: string,
  verifier: string,
  createKey = false
): Promise<OAuthCompleteResult> {
  const splits = code.split('#')
  const authCode = splits[0]
  const state = splits[1]

  // REQUIRED: Validate authorization code format
  if (!authCode || authCode.length < 10) {
    throw new Error('Invalid authorization code format')
  }

  // In examples, validate the callback URL
  // callback must be HTTPS in production
  const exampleCodeWithValidation = `
    const callbackUrl = await rl.question('Paste the callback URL: ')
    const url = new URL(callbackUrl)

    // Validate HTTPS in production (allow http://localhost for development only)
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new Error('Callback URL must use HTTPS for security')
    }

    const code = url.searchParams.get('code')
  `

  // Continue with token exchange...
}
```

---

### Finding 6: MEDIUM - Hardcoded Default Client ID

**Severity:** MEDIUM
**Location:** `/src/oauth-client.ts:12`
**CWE:** CWE-798 (Use of Hard-coded Credentials)

#### Description

A default client ID is hardcoded in the source:

```typescript
const DEFAULT_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
```

**The vulnerability:**

1. **Public Knowledge**: Client ID is visible in source code, repositories, and built artifacts
2. **Rate Limiting**: If this client ID is shared across all installations, OAuth server rate limits apply collectively
3. **Attribution**: OAuth server can't distinguish between legitimate users and attackers using the same client ID
4. **Token Association**: All tokens created with this ID are associated with the same client, reducing granularity

#### Risk Assessment

While client IDs are intended to be public (unlike client secrets), hardcoding one creates operational risks:

- All instances of Claude Agent Desktop share the same client ID
- OAuth server sees all traffic as coming from one "super user"
- Easier for attackers to identify legitimate vs. fraudulent OAuth flows
- No per-installation tracking or management

#### Remediation

```typescript
// For production applications, consider:
// 1. Making client ID configurable via environment variable
// 2. Dynamically registering client IDs per installation
// 3. Using different IDs for different deployment environments

const DEFAULT_CLIENT_ID = process.env.ANTHROPIC_OAUTH_CLIENT_ID || '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
```

---

### Finding 7: MEDIUM - Missing HTTPS Enforcement for Endpoints

**Severity:** MEDIUM
**Location:** `/src/oauth-client.ts:13-17`
**CWE:** CWE-297 (Improper Validation of Certificate with Host Mismatch)

#### Description

While endpoints use HTTPS, there's no runtime validation that all requests go to HTTPS:

```typescript
const AUTHORIZATION_ENDPOINT_MAX = 'https://claude.ai/oauth/authorize'
const AUTHORIZATION_ENDPOINT_CONSOLE = 'https://console.anthropic.com/oauth/authorize'
const TOKEN_ENDPOINT = 'https://console.anthropic.com/v1/oauth/token'
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback'
const CREATE_API_KEY_ENDPOINT = 'https://api.anthropic.com/api/oauth/claude_cli/create_api_key'
```

**While the hardcoded URLs are HTTPS, consider:**

1. No validation that fetch requests actually use HTTPS
2. No certificate pinning
3. No validation against downgrade attacks
4. In Node.js/Electron, no HTTPS agent enforcement

#### Low-Risk Mitigation

This is mitigated by:
- Hardcoded HTTPS URLs (not user-configurable)
- Standard HTTPS validation by fetch/Node.js

However, best practice would be:

```typescript
// Add explicit HTTPS validation
private validateEndpointUrl(url: string): void {
  if (!url.startsWith('https://')) {
    throw new Error('OAuth endpoints must use HTTPS')
  }
}

// In constructor or methods:
this.validateEndpointUrl(TOKEN_ENDPOINT)
this.validateEndpointUrl(CREATE_API_KEY_ENDPOINT)
```

---

### Finding 8: LOW - Token Expiration Timing Window

**Severity:** LOW
**Location:** `/src/oauth-client.ts:267-270`
**CWE:** CWE-367 (Time-of-check Time-of-use Race Condition)

#### Description

Token expiration check uses a 5-minute buffer, but there's a race condition:

```typescript
isTokenExpired(tokens: OAuthTokens): boolean {
  const fiveMinutes = 5 * 60 * 1000
  return tokens.expires < Date.now() + fiveMinutes  // Line 269
}
```

**The vulnerability:**

1. Time-of-check time-of-use (TOCTOU) race: Token is checked as valid, then immediately used and fails
2. Token could expire between `isTokenExpired()` check and actual API call
3. No retry mechanism or automatic refresh on 401 responses

#### Exploitation Likelihood

**LOW** - This is a timing-based issue that requires:
- Token to expire between check and use (rare with 5-min buffer)
- Concurrent requests in the same millisecond window

#### Remediation

```typescript
// Better approach: Handle 401 responses with automatic refresh
private async fetchWithTokenRefresh(
  tokens: OAuthTokens,
  request: () => Promise<Response>
): Promise<Response> {
  const response = await request()

  if (response.status === 401) {
    // Token expired mid-request, refresh and retry
    const newTokens = await this.refreshAccessToken(tokens.refresh)
    // Caller should use new tokens for retry
    throw new TokenExpiredError(newTokens)
  }

  return response
}
```

---

### Finding 9: LOW - API Key Exposure in Examples

**Severity:** LOW
**Location:** `/examples/api-key-example.ts:48, 52`
**CWE:** CWE-532 (Insertion of Sensitive Information into Log File)

#### Description

Example code prints generated API keys to console:

```typescript
// Line 48: Displays in console
console.log('\n✅ API Key created successfully!\n')
console.log('API Key:', result.apiKey)

// Lines 51-53: Shows full code with API key in it
console.log(`const anthropic = new Anthropic({`)
console.log(`  apiKey: '${result.apiKey}'`)
console.log(`})`)
```

**The issue:**

1. In development environments, console output may be logged to files
2. API keys are visible in terminal history
3. Terminal scrollback buffer may be captured
4. Screenshots or screen sharing could expose the key

#### Real-World Risk

**LOW** - This is intentional for example purposes, but:
- Users following the example will expose keys in terminal history
- Keys should be stored to files with restricted permissions, not printed

#### Remediation

```typescript
// Better practice in examples:
if (result.apiKey) {
  console.log('\n✅ API Key created successfully!')
  console.log('\nTo use this key, save it to a secure file:')
  console.log('\n  mkdir -p ~/.anthropic')
  console.log(`  chmod 600 ~/.anthropic/api_key`)
  console.log(`  echo "${result.apiKey}" > ~/.anthropic/api_key`)
  console.log('\nDo NOT share this key!')
}
```

---

## OWASP Top 10 Mapping

| OWASP Category | Status | Notes |
|---|---|---|
| A01:2021 - Broken Access Control | **VULNERABLE** | State validation missing, CSRF protection bypassed |
| A02:2021 - Cryptographic Failures | **COMPLIANT** | Uses standard OAuth 2.0 PKCE, HTTPS for endpoints |
| A03:2021 - Injection | **COMPLIANT** | URL parameters properly sanitized via URL API |
| A04:2021 - Insecure Design | **VULNERABLE** | PKCE verifier misused as state parameter |
| A05:2021 - Security Misconfiguration | **VULNERABLE** | Missing HTTPS validation on callbacks |
| A06:2021 - Vulnerable Components | **CHECK REQUIRED** | Depends on @openauthjs/openauth - audit that package |
| A07:2021 - Identification & Authentication | **VULNERABLE** | State validation missing, code interception possible |
| A08:2021 - Software/Data Integrity Failures | **VULNERABLE** | No response validation, missing type checks |
| A09:2021 - Logging & Monitoring | **VULNERABLE** | Sensitive error details logged and exposed |
| A10:2021 - SSRF | **COMPLIANT** | Endpoints are hardcoded, no user-supplied URLs |

---

## Secure Storage Considerations

**Current Implementation Assessment:**

The code **does NOT handle token storage** - it returns tokens to the caller:

```typescript
return { tokens }  // Line 214
return { tokens, apiKey }  // Line 211
```

**Recommendations for Callers:**

1. **Never store tokens in localStorage** (vulnerable to XSS)
2. **Use secure, HttpOnly cookies** for web applications
3. **Use Electron's safeStorage** for desktop apps
4. **Use OS keychain** for CLI tools
5. **Never log tokens** to files or console
6. **Clear tokens on logout** from memory immediately

---

## Dependency Security

**Package:** @openauthjs/openauth ^0.4.3

**Recommendation:**
- Audit @openauthjs/openauth package for PKCE implementation correctness
- Ensure cryptographically secure random generation is used
- Verify no known vulnerabilities in current version

---

## Summary of Required Fixes

### Blocking Issues (Fix Before Production Use)

1. **Replace PKCE verifier with independent random state** - Line 79
2. **Add state validation in completeLogin()** - Line 202-215
3. **Remove sensitive error details** - Lines 142, 176, 244
4. **Add response content-type and field validation** - Lines 145-149, 179-180, 247-251

### High Priority Issues

5. **Add HTTPS enforcement for callbacks** - Examples
6. **Validate authorization code format** - Line 122

### Medium Priority Issues

7. **Make client ID configurable** - Line 12
8. **Add explicit HTTPS validation** - All fetch endpoints
9. **Add token refresh on 401 responses** - Token usage

### Low Priority Issues

10. **Update examples to not expose API keys** - Examples
11. **Add retry logic for race conditions** - isTokenExpired()

---

## Testing Recommendations

### Unit Tests Needed

```typescript
// Test 1: Verify state is independent from PKCE verifier
// Test 2: Verify state validation occurs before token exchange
// Test 3: Verify error messages don't contain sensitive data
// Test 4: Verify response validation for missing fields
// Test 5: Verify PKCE challenge/verifier are cryptographically random
// Test 6: Verify authorization code exchange with invalid code fails safely
// Test 7: Verify state tampering is detected
// Test 8: Verify callback URL HTTPS validation (if implemented)
```

### Integration Tests Needed

```typescript
// Test 1: Full OAuth flow with state validation
// Test 2: Token refresh cycle
// Test 3: API key creation flow
// Test 4: Error handling for invalid responses
// Test 5: Concurrent token refresh attempts
```

### Security Tests Needed

```typescript
// Test 1: CSRF attack with modified state
// Test 2: Authorization code interception
// Test 3: Man-in-the-middle callback URL modification
// Test 4: Token validation with modified fields
// Test 5: Error message information disclosure
```

---

## Incident Response

If this package has been used in production:

1. **Invalidate all tokens** issued by affected applications
2. **Audit OAuth logs** for suspicious state parameter values
3. **Check for account takeovers** in affected services
4. **Notify users** to re-authenticate after the fix is deployed
5. **Monitor for unauthorized access** using the affected client ID

---

## Remediation Timeline

| Priority | Issue | Target Date | Owner |
|----------|-------|------------|-------|
| CRITICAL | State validation | Immediate | Security Team |
| CRITICAL | Error information leakage | Immediate | Security Team |
| CRITICAL | PKCE verifier as state | Immediate | Security Team |
| HIGH | Response validation | Within 24 hours | Development |
| HIGH | HTTPS enforcement | Within 24 hours | Development |
| MEDIUM | Client ID configurability | Within 1 week | Development |

---

## Sign-Off

This audit identified critical vulnerabilities in the OAuth 2.0 PKCE implementation that must be fixed before production deployment. The primary issue is the misuse of the PKCE verifier as the state parameter, which defeats CSRF protection and enables authorization code interception attacks.

**Recommendation:** DO NOT USE IN PRODUCTION until all Critical and High severity issues are resolved.

---

## Appendix: Reference Materials

- [RFC 6234 - The Use of HMAC-SHA-256 within DTLS](https://tools.ietf.org/html/rfc6234)
- [RFC 7636 - Proof Key for Public Clients (PKCE)](https://tools.ietf.org/html/rfc7636)
- [RFC 6749 - OAuth 2.0 Authorization Framework](https://tools.ietf.org/html/rfc6749)
- [OWASP OAuth 2.0 Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OAuth_2_Cheat_Sheet.html)
- [CWE-352: Cross-Site Request Forgery](https://cwe.mitre.org/data/definitions/352.html)
- [CWE-209: Information Exposure Through Error Messages](https://cwe.mitre.org/data/definitions/209.html)

---

**Report Generated:** December 3, 2025
**Auditor:** Application Security Specialist
**Confidentiality:** Internal Use Only
