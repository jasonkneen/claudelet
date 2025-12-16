# @anthropic-ai/anthropic-oauth

Framework-agnostic OAuth 2.0 PKCE client for Anthropic Claude API authentication.

## Features

- ✅ **Framework-agnostic**: Works in Node.js, browsers, Electron, CLI tools, etc.
- ✅ **OAuth 2.0 PKCE flow**: Secure authentication without client secrets
- ✅ **Token management**: Automatic token refresh and expiration checking
- ✅ **API key creation**: Convert OAuth tokens to API keys
- ✅ **TypeScript**: Full type safety and IntelliSense support
- ✅ **Zero dependencies**: Only requires `@openauthjs/openauth` for PKCE

## Installation

```bash
npm install @anthropic-ai/anthropic-oauth
# or
bun add @anthropic-ai/anthropic-oauth
```

## Usage

### Basic Example

```typescript
import { AnthropicOAuthClient } from '@anthropic-ai/anthropic-oauth'

const client = new AnthropicOAuthClient()

// 1. Start the OAuth flow
const { authUrl, verifier } = await client.startLogin('console')
console.log('Please visit:', authUrl)

// 2. User opens the URL and authorizes
// 3. User copies the callback URL they receive

// 4. Get the authorization code from the user
const callbackUrl = prompt('Paste the callback URL:')
const code = new URL(callbackUrl).searchParams.get('code')

// 5. Complete the login
const { tokens } = await client.completeLogin(code, verifier)

// 6. Use the tokens
console.log('Access token:', tokens.access)
console.log('Expires at:', new Date(tokens.expires))
```

### With Automatic URL Opening (Browser/Electron)

```typescript
import { AnthropicOAuthClient } from '@anthropic-ai/anthropic-oauth'

const client = new AnthropicOAuthClient({
  openUrl: (url) => window.open(url, '_blank')
})

// URL will be automatically opened in the browser
const { authUrl, verifier } = await client.startLogin('console')
```

### CLI Example

```typescript
import { AnthropicOAuthClient } from '@anthropic-ai/anthropic-oauth'
import readline from 'readline/promises'

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

const client = new AnthropicOAuthClient()

// Start login
const { authUrl, verifier } = await client.startLogin('console')
console.log('\n🔐 Authentication Required')
console.log('\nPlease visit this URL to authorize:\n')
console.log(`  ${authUrl}\n`)

// Get code from user
const callbackUrl = await rl.question('Paste the callback URL here: ')
const code = new URL(callbackUrl).searchParams.get('code')

// Complete login
const { tokens } = await client.completeLogin(code, verifier)
console.log('\n✅ Authentication successful!')

rl.close()
```

### Creating an API Key

```typescript
// Get an API key instead of OAuth tokens
const { apiKey } = await client.completeLogin(code, verifier, true)
console.log('API Key:', apiKey)
```

### Token Refresh

```typescript
// Check if token is expired
if (client.isTokenExpired(tokens)) {
  const newTokens = await client.refreshAccessToken(tokens.refresh)
  // Save new tokens
  saveTokens(newTokens)
}

// Or use automatic refresh
const result = await client.getValidAccessToken(tokens)
if (result.tokens) {
  // Token was refreshed, save new tokens
  saveTokens(result.tokens)
}
// Use the access token
const accessToken = result.accessToken
```

## API Reference

### `AnthropicOAuthClient`

#### Constructor

```typescript
new AnthropicOAuthClient(options?: OAuthClientOptions)
```

**Options:**
- `openUrl?: (url: string) => void | Promise<void>` - Optional callback to open URLs
- `clientId?: string` - Custom OAuth client ID (defaults to Claude Agent Desktop)

#### Methods

##### `startLogin(mode?: AuthMode): Promise<OAuthStartResult>`

Start the OAuth flow and get the authorization URL.

**Parameters:**
- `mode`: `'max'` (Claude.ai) or `'console'` (Anthropic Console) - defaults to `'console'`

**Returns:**
- `authUrl`: URL the user must visit to authorize
- `verifier`: PKCE verifier to be used in `completeLogin`

##### `completeLogin(code: string, verifier: string, createKey?: boolean): Promise<OAuthCompleteResult>`

Complete the OAuth flow by exchanging the authorization code.

**Parameters:**
- `code`: Authorization code from the OAuth callback URL
- `verifier`: PKCE verifier from `startLogin`
- `createKey`: If `true`, creates an API key instead of returning tokens

**Returns:**
- `tokens`: OAuth tokens (access, refresh, expiry)
- `apiKey?`: API key (if `createKey` was `true`)

##### `refreshAccessToken(refreshToken: string): Promise<OAuthTokens>`

Refresh an expired access token.

**Parameters:**
- `refreshToken`: Refresh token from previous authentication

**Returns:** New OAuth tokens

##### `isTokenExpired(tokens: OAuthTokens): boolean`

Check if a token is expired or will expire soon (within 5 minutes).

##### `getValidAccessToken(tokens: OAuthTokens): Promise<{accessToken: string, tokens?: OAuthTokens}>`

Get a valid access token, automatically refreshing if needed.

**Returns:**
- `accessToken`: Valid access token
- `tokens?`: New tokens if refresh occurred

## Types

```typescript
interface OAuthTokens {
  type: 'oauth'
  refresh: string
  access: string
  expires: number // Unix timestamp in milliseconds
}

type AuthMode = 'max' | 'console'

interface OAuthStartResult {
  authUrl: string
  verifier: string
}

interface OAuthCompleteResult {
  tokens: OAuthTokens
  apiKey?: string
}
```

## OAuth Flow

1. **Start**: Call `startLogin()` to generate PKCE challenge and get authorization URL
2. **Authorize**: User visits URL and authorizes the application
3. **Callback**: User receives callback URL with authorization code
4. **Exchange**: Call `completeLogin()` with code and verifier to get tokens
5. **Refresh**: Use `refreshAccessToken()` when tokens expire

## Security

- Uses OAuth 2.0 PKCE (Proof Key for Code Exchange) for secure authentication
- No client secrets required
- Tokens are only returned to your application, never logged
- Automatic token expiration checking

## License

MIT

## Related

- [Claude Agent SDK](https://github.com/anthropics/anthropic-sdk-typescript)
- [Anthropic API Documentation](https://docs.anthropic.com/)
