# OAuth Package Security Remediation Guide

**Status:** CRITICAL - Fix Required Before Production

---

## Fix 1: CRITICAL - Replace PKCE Verifier with Independent State Parameter

### Problem
Line 79 in `src/oauth-client.ts` uses the PKCE verifier as the state parameter, violating OAuth 2.0 specification.

### Current Code
```typescript
// INSECURE - DO NOT USE
url.searchParams.set('state', pkce.verifier)
```

### Why This Is Dangerous
1. State values must be unpredictable and independent from PKCE verifiers
2. Using a predictable state enables CSRF attacks
3. Attacker can intercept authorization codes knowing the state value
4. Defeats the entire purpose of the state parameter

### Fixed Code

**File:** `src/oauth-client.ts`

```typescript
import { generatePKCE } from '@openauthjs/openauth/pkce'
import crypto from 'crypto'

import type {
  AuthMode,
  OAuthClientOptions,
  OAuthCompleteResult,
  OAuthStartResult,
  OAuthTokens,
  PKCEChallenge
} from './types.js'

// ... constants ...

export class AnthropicOAuthClient {
  private readonly clientId: string
  private readonly openUrl?: (url: string) => Promise<void> | void
  private readonly stateStore: Map<string, string> = new Map() // Store state -> verifier mapping

  constructor(options: OAuthClientOptions = {}) {
    this.clientId = options.clientId || DEFAULT_CLIENT_ID
    this.openUrl = options.openUrl
  }

  /**
   * Generate cryptographically random state parameter
   */
  private generateState(): string {
    return crypto.randomBytes(32).toString('hex')
  }

  /**
   * Store state parameter with associated verifier for later validation
   */
  private storeState(state: string, verifier: string): void {
    this.stateStore.set(state, verifier)
  }

  /**
   * Retrieve and clear stored verifier for a state value
   */
  private consumeState(state: string): string | null {
    const verifier = this.stateStore.get(state) || null
    this.stateStore.delete(state) // Prevent replay attacks
    return verifier
  }

  /**
   * Generate the OAuth authorization URL
   */
  private getAuthorizationUrl(mode: AuthMode, pkce: PKCEChallenge, state: string): string {
    const baseUrl = mode === 'max' ? AUTHORIZATION_ENDPOINT_MAX : AUTHORIZATION_ENDPOINT_CONSOLE
    const url = new URL(baseUrl)

    url.searchParams.set('code', 'true')
    url.searchParams.set('client_id', this.clientId)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', REDIRECT_URI)
    url.searchParams.set('scope', SCOPES)
    url.searchParams.set('code_challenge', pkce.challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', state) // FIXED: Use random state, not verifier

    return url.toString()
  }

  /**
   * Start the OAuth login flow
   */
  async startLogin(mode: AuthMode = 'console'): Promise<OAuthStartResult> {
    const pkce = await this.generatePKCEChallenge()
    const state = this.generateState() // FIXED: Generate independent state

    // FIXED: Store state for later validation
    this.storeState(state, pkce.verifier)

    const authUrl = this.getAuthorizationUrl(mode, pkce, state)

    // Optionally open the URL if callback is provided
    if (this.openUrl) {
      await this.openUrl(authUrl)
    }

    return {
      authUrl,
      verifier: pkce.verifier
    }
  }

  /**
   * Complete the OAuth login flow by exchanging the authorization code
   */
  async completeLogin(
    code: string,
    verifier: string,
    createKey = false
  ): Promise<OAuthCompleteResult> {
    // Extract code and state from callback
    const splits = code.split('#')
    const authCode = splits[0]
    const returnedState = splits[1]

    // FIXED: Validate state parameter
    if (!returnedState) {
      throw new Error('Invalid callback: Missing state parameter')
    }

    const storedVerifier = this.consumeState(returnedState)
    if (!storedVerifier) {
      throw new Error('Invalid state parameter: No matching session found (possible CSRF attack)')
    }

    // Verify the verifier matches what we expect
    if (storedVerifier !== verifier) {
      throw new Error('State validation failed: Verifier mismatch')
    }

    // Proceed with token exchange
    const tokens = await this.exchangeCodeForTokens(authCode, verifier, returnedState)

    if (createKey) {
      const apiKey = await this.createApiKey(tokens.access)
      return { tokens, apiKey }
    }

    return { tokens }
  }

  // ... rest of implementation ...
}
```

### Validation Checklist
- [ ] `generateState()` uses `crypto.randomBytes(32)` for cryptographic randomness
- [ ] State is stored in `stateStore` Map before returning from `startLogin()`
- [ ] `completeLogin()` retrieves and validates state before token exchange
- [ ] State is consumed (deleted) after validation to prevent replay attacks
- [ ] Error message clearly indicates CSRF attack detection

---

## Fix 2: CRITICAL - Add State Parameter Validation

### Problem
Lines 115-136 in `src/oauth-client.ts` extract the state but never validate it against stored values.

### Current Code (Vulnerable)
```typescript
async completeLogin(
  code: string,
  verifier: string,
  createKey = false
): Promise<OAuthCompleteResult> {
  // Code extracts state but never validates it
  const splits = code.split('#')
  const authCode = splits[0]
  const state = splits[1]  // Never validated!

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      code: authCode,
      state: state,  // Sent to server, but no validation
      // ... rest ...
    })
  })
  // ...
}
```

### Fixed Code (See Fix 1 above)
The state validation is included in Fix 1's `completeLogin()` implementation:

```typescript
async completeLogin(
  code: string,
  verifier: string,
  createKey = false
): Promise<OAuthCompleteResult> {
  const splits = code.split('#')
  const authCode = splits[0]
  const returnedState = splits[1]

  // FIXED: Validate state exists
  if (!returnedState) {
    throw new Error('Invalid callback: Missing state parameter')
  }

  // FIXED: Validate state matches stored value
  const storedVerifier = this.consumeState(returnedState)
  if (!storedVerifier) {
    throw new Error('Invalid state parameter: No matching session found (possible CSRF attack)')
  }

  // FIXED: Verify verifier matches
  if (storedVerifier !== verifier) {
    throw new Error('State validation failed: Verifier mismatch')
  }

  // Continue with token exchange...
}
```

### Validation Checklist
- [ ] `completeLogin()` checks that `returnedState` is not empty
- [ ] `completeLogin()` retrieves state from `stateStore`
- [ ] Error message distinguishes between missing session and CSRF attack
- [ ] State is consumed (removed) after validation

---

## Fix 3: CRITICAL - Remove Sensitive Error Information

### Problem
Lines 142, 176, 244 in `src/oauth-client.ts` leak sensitive information in error messages.

### Current Code (Vulnerable)
```typescript
// Line 142
if (!response.ok) {
  const errorText = await response.text()
  throw new Error(`Failed to exchange code for tokens: ${response.statusText} - ${errorText}`)
}

// Line 176
if (!response.ok) {
  const errorText = await response.text()
  throw new Error(`Failed to create API key: ${response.statusText} - ${errorText}`)
}

// Line 244
if (!response.ok) {
  const errorText = await response.text()
  throw new Error(`Failed to refresh access token: ${response.statusText} - ${errorText}`)
}
```

### Fixed Code

**File:** `src/oauth-client.ts`

Replace all three error handlers with secure versions:

```typescript
/**
 * Exchange authorization code for access and refresh tokens
 */
private async exchangeCodeForTokens(
  code: string,
  verifier: string,
  state: string
): Promise<OAuthTokens> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      code: code,
      state: state,
      grant_type: 'authorization_code',
      client_id: this.clientId,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier
    })
  })

  // FIXED: Don't expose sensitive error details
  if (!response.ok) {
    const errorText = await response.text()

    // Log full details only for debugging (don't expose to caller)
    if (process.env.NODE_ENV === 'development') {
      console.debug('[OAuth] Token exchange failed:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      })
    }

    // Return only safe, generic errors to caller
    switch (response.status) {
      case 400:
        throw new Error('Invalid authorization code. Please start the authentication process again.')
      case 401:
        throw new Error('Authorization failed. Please verify your credentials.')
      case 429:
        throw new Error('Too many authentication attempts. Please try again later.')
      case 500:
      case 502:
      case 503:
        throw new Error('Authentication service temporarily unavailable. Please try again.')
      default:
        throw new Error('Authentication failed. Please try again.')
    }
  }

  const json = (await response.json()) as {
    refresh_token: string
    access_token: string
    expires_in: number
  }

  return {
    type: 'oauth',
    refresh: json.refresh_token,
    access: json.access_token,
    expires: Date.now() + json.expires_in * 1000
  }
}

/**
 * Create an API key using OAuth access token
 */
private async createApiKey(accessToken: string): Promise<string> {
  const response = await fetch(CREATE_API_KEY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${accessToken}`
    }
  })

  // FIXED: Don't expose sensitive error details
  if (!response.ok) {
    const errorText = await response.text()

    // Log full details only for debugging
    if (process.env.NODE_ENV === 'development') {
      console.debug('[OAuth] API key creation failed:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      })
    }

    // Return only safe, generic errors
    switch (response.status) {
      case 401:
        throw new Error('Invalid access token. Please re-authenticate.')
      case 403:
        throw new Error('You do not have permission to create API keys.')
      case 429:
        throw new Error('Too many requests. Please try again later.')
      default:
        throw new Error('Failed to create API key. Please try again.')
    }
  }

  const json = (await response.json()) as { raw_key: string }
  return json.raw_key
}

/**
 * Refresh the access token using a refresh token
 */
async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.clientId
    })
  })

  // FIXED: Don't expose sensitive error details
  if (!response.ok) {
    const errorText = await response.text()

    // Log full details only for debugging
    if (process.env.NODE_ENV === 'development') {
      console.debug('[OAuth] Token refresh failed:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      })
    }

    // Return only safe, generic errors
    switch (response.status) {
      case 401:
        throw new Error('Refresh token expired. Please re-authenticate.')
      case 429:
        throw new Error('Too many requests. Please try again later.')
      default:
        throw new Error('Failed to refresh token. Please re-authenticate.')
    }
  }

  const json = (await response.json()) as {
    refresh_token: string
    access_token: string
    expires_in: number
  }

  return {
    type: 'oauth',
    refresh: json.refresh_token,
    access: json.access_token,
    expires: Date.now() + json.expires_in * 1000
  }
}
```

### Validation Checklist
- [ ] Error messages are generic and don't contain response body
- [ ] Full error details are only logged in development mode
- [ ] Status codes are mapped to safe error messages
- [ ] No server implementation details are exposed
- [ ] No request/response body contents are leaked

---

## Fix 4: HIGH - Add Response Content-Type and Field Validation

### Problem
Lines 145-149, 179-180, 247-251 assume responses are valid JSON without validation.

### Current Code (Vulnerable)
```typescript
// No content-type check
const json = (await response.json()) as {
  refresh_token: string
  access_token: string
  expires_in: number
}
// Type assertion 'as' provides zero runtime checking
```

### Fixed Code

**File:** `src/oauth-client.ts`

```typescript
/**
 * Exchange authorization code for access and refresh tokens
 */
private async exchangeCodeForTokens(
  code: string,
  verifier: string,
  state: string
): Promise<OAuthTokens> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      code: code,
      state: state,
      grant_type: 'authorization_code',
      client_id: this.clientId,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier
    })
  })

  if (!response.ok) {
    // ... error handling from Fix 3 ...
  }

  // FIXED: Validate content-type header
  const contentType = response.headers.get('content-type')
  if (!contentType?.includes('application/json')) {
    throw new Error('Invalid token response: Expected JSON content-type')
  }

  let json: unknown
  try {
    json = await response.json()
  } catch (error) {
    throw new Error('Invalid token response: Failed to parse JSON')
  }

  // FIXED: Validate all required fields and types
  if (
    typeof json !== 'object' ||
    json === null ||
    typeof (json as Record<string, unknown>).access_token !== 'string' ||
    typeof (json as Record<string, unknown>).refresh_token !== 'string' ||
    typeof (json as Record<string, unknown>).expires_in !== 'number'
  ) {
    throw new Error('Invalid token response: Missing or invalid required fields')
  }

  const typedJson = json as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  // FIXED: Validate field contents
  if (!typedJson.access_token || !typedJson.refresh_token || typedJson.expires_in <= 0) {
    throw new Error('Invalid token response: Invalid field values')
  }

  return {
    type: 'oauth',
    refresh: typedJson.refresh_token,
    access: typedJson.access_token,
    expires: Date.now() + typedJson.expires_in * 1000
  }
}

/**
 * Create an API key using OAuth access token
 */
private async createApiKey(accessToken: string): Promise<string> {
  const response = await fetch(CREATE_API_KEY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${accessToken}`
    }
  })

  if (!response.ok) {
    // ... error handling from Fix 3 ...
  }

  // FIXED: Validate content-type header
  const contentType = response.headers.get('content-type')
  if (!contentType?.includes('application/json')) {
    throw new Error('Invalid API key response: Expected JSON content-type')
  }

  let json: unknown
  try {
    json = await response.json()
  } catch (error) {
    throw new Error('Invalid API key response: Failed to parse JSON')
  }

  // FIXED: Validate required fields
  if (
    typeof json !== 'object' ||
    json === null ||
    typeof (json as Record<string, unknown>).raw_key !== 'string'
  ) {
    throw new Error('Invalid API key response: Missing or invalid raw_key field')
  }

  const typedJson = json as { raw_key: string }

  // FIXED: Validate field contents
  if (!typedJson.raw_key || typedJson.raw_key.length < 10) {
    throw new Error('Invalid API key response: Invalid key format')
  }

  return typedJson.raw_key
}

/**
 * Refresh the access token using a refresh token
 */
async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.clientId
    })
  })

  if (!response.ok) {
    // ... error handling from Fix 3 ...
  }

  // FIXED: Validate content-type header
  const contentType = response.headers.get('content-type')
  if (!contentType?.includes('application/json')) {
    throw new Error('Invalid refresh response: Expected JSON content-type')
  }

  let json: unknown
  try {
    json = await response.json()
  } catch (error) {
    throw new Error('Invalid refresh response: Failed to parse JSON')
  }

  // FIXED: Validate all required fields and types
  if (
    typeof json !== 'object' ||
    json === null ||
    typeof (json as Record<string, unknown>).access_token !== 'string' ||
    typeof (json as Record<string, unknown>).refresh_token !== 'string' ||
    typeof (json as Record<string, unknown>).expires_in !== 'number'
  ) {
    throw new Error('Invalid refresh response: Missing or invalid required fields')
  }

  const typedJson = json as {
    access_token: string
    refresh_token: string
    expires_in: number
  }

  // FIXED: Validate field contents
  if (!typedJson.access_token || !typedJson.refresh_token || typedJson.expires_in <= 0) {
    throw new Error('Invalid refresh response: Invalid field values')
  }

  return {
    type: 'oauth',
    refresh: typedJson.refresh_token,
    access: typedJson.access_token,
    expires: Date.now() + typedJson.expires_in * 1000
  }
}
```

### Validation Checklist
- [ ] Content-Type header is validated before parsing JSON
- [ ] JSON parsing is wrapped in try-catch
- [ ] All required fields are checked for existence
- [ ] All fields are checked for correct types
- [ ] Field values are validated (non-empty, positive numbers, etc.)
- [ ] Error messages indicate which validation failed

---

## Fix 5: HIGH - Add HTTPS Enforcement for Callbacks

### Problem
Examples don't validate that callback URLs use HTTPS.

### Current Example Code (Vulnerable)
```typescript
// From examples/cli-example.ts
const url = new URL(callbackUrl)
const code = url.searchParams.get('code')
// No HTTPS validation
```

### Fixed Example Code

**File:** `examples/cli-example.ts` and `examples/api-key-example.ts`

```typescript
import readline from 'readline/promises'
import { AnthropicOAuthClient } from '../src/index'

async function main(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  console.log('\n🤖 Anthropic OAuth CLI Example\n')

  const client = new AnthropicOAuthClient()

  console.log('Starting OAuth flow...\n')
  const { authUrl, verifier } = await client.startLogin('console')

  console.log('🔐 Authentication Required\n')
  console.log('Please visit this URL to authorize:\n')
  console.log(`  ${authUrl}\n`)
  console.log('After authorizing, you will be redirected to a URL.')
  console.log('Copy and paste that entire URL here.\n')

  const callbackUrl = await rl.question('Paste the callback URL: ')

  try {
    // FIXED: Validate HTTPS before processing
    const url = new URL(callbackUrl)

    // FIXED: Enforce HTTPS for production
    // Allow http://localhost for local development only
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    const isHttps = url.protocol === 'https:'

    if (!isHttps && !isLocalhost) {
      throw new Error(
        'Security error: Callback URL must use HTTPS. ' +
          'Please ensure your OAuth redirect is configured for HTTPS endpoints.'
      )
    }

    if (!isHttps && isLocalhost) {
      console.warn(
        '\n⚠️  Warning: Using HTTP with localhost. ' +
          'Always use HTTPS in production environments.\n'
      )
    }

    // FIXED: Validate authorization code exists
    const code = url.searchParams.get('code')
    if (!code) {
      throw new Error('Error: No authorization code found in callback URL')
    }

    // FIXED: Validate code format (basic check)
    if (code.length < 10) {
      throw new Error('Error: Invalid authorization code format')
    }

    console.log('\n⏳ Exchanging code for tokens...')
    const result = await client.completeLogin(code, verifier)

    console.log('\n✅ Authentication successful!\n')
    console.log('Access Token (first 20 chars):', result.tokens.access.substring(0, 20) + '...')
    console.log('Expires at:', new Date(result.tokens.expires).toLocaleString())

    // FIXED: Don't print tokens or refresh them automatically in examples
    console.log('\n✅ Token exchange complete. Store tokens securely.')
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error))
  }

  rl.close()
}

main().catch(console.error)
```

### Validation Checklist
- [ ] Callback URL is validated before processing
- [ ] HTTPS is enforced except for localhost
- [ ] Localhost development mode is allowed but warns user
- [ ] Authorization code format is validated
- [ ] Authorization code is not printed to console

---

## Fix 6: MEDIUM - Make Client ID Configurable

### Problem
Line 12 hardcodes the client ID.

### Current Code
```typescript
const DEFAULT_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
```

### Fixed Code

**File:** `src/oauth-client.ts`

```typescript
// FIXED: Allow client ID to be configured via environment variable
const DEFAULT_CLIENT_ID =
  process.env.ANTHROPIC_OAUTH_CLIENT_ID || '9d1c250a-e61b-44d9-88ed-5944d1962f5e'

// Add documentation
/**
 * Default OAuth client ID for Claude Agent Desktop
 *
 * Can be overridden via:
 * 1. ANTHROPIC_OAUTH_CLIENT_ID environment variable
 * 2. clientId option in OAuthClientOptions constructor parameter
 *
 * @example
 * // Via environment variable
 * process.env.ANTHROPIC_OAUTH_CLIENT_ID = 'your-custom-id'
 * const client = new AnthropicOAuthClient()
 *
 * @example
 * // Via constructor options
 * const client = new AnthropicOAuthClient({
 *   clientId: 'your-custom-id'
 * })
 */
```

### Validation Checklist
- [ ] Environment variable is checked first
- [ ] Default value is preserved for backward compatibility
- [ ] Constructor option still allows override
- [ ] Documentation explains all three methods

---

## Implementation Priority

1. **Immediate (Today):**
   - Fix 1: Replace PKCE verifier with independent state
   - Fix 2: Add state validation
   - Fix 3: Remove sensitive error information

2. **High Priority (Within 24 hours):**
   - Fix 4: Add response validation
   - Fix 5: Add HTTPS enforcement

3. **Medium Priority (Within 1 week):**
   - Fix 6: Make client ID configurable

---

## Testing the Fixes

### Unit Test Example

```typescript
import { AnthropicOAuthClient } from '../src/oauth-client'

describe('OAuth State Validation', () => {
  it('should generate unique state values', async () => {
    const client = new AnthropicOAuthClient()
    const result1 = await client.startLogin()
    const result2 = await client.startLogin()

    // Verifiers should be different
    expect(result1.verifier).not.toBe(result2.verifier)
  })

  it('should reject tampered state', async () => {
    const client = new AnthropicOAuthClient()
    const { verifier } = await client.startLogin()

    // Try to complete with wrong state
    expect(() =>
      client.completeLogin('code#wrong_state', verifier)
    ).toThrow('Invalid state parameter')
  })

  it('should not expose sensitive errors', async () => {
    const client = new AnthropicOAuthClient()

    // Mock fetch to return server error
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'SELECT * FROM users WHERE password = "leaked"'
    })

    try {
      await client.completeLogin('code#state', 'verifier')
    } catch (error) {
      // Error should not contain the leaked query
      expect(error.message).not.toContain('SELECT')
      expect(error.message).toContain('temporarily unavailable')
    }
  })
})
```

---

## Deployment Checklist

Before deploying to production:

- [ ] All three CRITICAL fixes are implemented
- [ ] All HIGH priority fixes are implemented
- [ ] Unit tests pass (existing + new)
- [ ] Integration tests pass
- [ ] Security review completed
- [ ] Token storage guidance provided to consumers
- [ ] Release notes updated with security fixes
- [ ] Existing tokens invalidated (if deployed before)
- [ ] Users notified to re-authenticate

---

## References

- [RFC 7636: PKCE](https://tools.ietf.org/html/rfc7636)
- [RFC 6749: OAuth 2.0](https://tools.ietf.org/html/rfc6749)
- [OWASP OAuth Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OAuth_2_Cheat_Sheet.html)
- [Auth0: OAuth 2.0 Security Best Practices](https://auth0.com/blog/oauth-2-best-practices-for-secure-implementation/)

