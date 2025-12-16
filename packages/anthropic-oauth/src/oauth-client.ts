import { generatePKCE } from '@openauthjs/openauth/pkce'

import type {
  AuthMode,
  OAuthClientOptions,
  OAuthCompleteResult,
  OAuthStartResult,
  OAuthTokens,
  PKCEChallenge
} from './types.js'

const DEFAULT_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const AUTHORIZATION_ENDPOINT_MAX = 'https://claude.ai/oauth/authorize'
const AUTHORIZATION_ENDPOINT_CONSOLE = 'https://console.anthropic.com/oauth/authorize'
const TOKEN_ENDPOINT = 'https://console.anthropic.com/v1/oauth/token'
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback'
const CREATE_API_KEY_ENDPOINT = 'https://api.anthropic.com/api/oauth/claude_cli/create_api_key'
const SCOPES = 'org:create_api_key user:profile user:inference'

const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_EXPIRATION_BUFFER_MS = 5 * 60 * 1000

/** Token response shape from OAuth server */
interface TokenResponse {
  refresh_token: string
  access_token: string
  expires_in: number
}

/** API key response shape */
interface ApiKeyResponse {
  raw_key: string
}

/**
 * Generate a cryptographically secure random state string for CSRF protection
 */
function generateState(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Validate that a token response has all required fields with correct types
 */
function validateTokenResponse(json: unknown): TokenResponse {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Invalid OAuth response: expected object')
  }

  const obj = json as Record<string, unknown>

  if (typeof obj.access_token !== 'string' || !obj.access_token) {
    throw new Error('Invalid OAuth response: missing or invalid access_token')
  }

  if (typeof obj.refresh_token !== 'string' || !obj.refresh_token) {
    throw new Error('Invalid OAuth response: missing or invalid refresh_token')
  }

  if (typeof obj.expires_in !== 'number' || obj.expires_in <= 0) {
    throw new Error('Invalid OAuth response: missing or invalid expires_in')
  }

  return {
    access_token: obj.access_token,
    refresh_token: obj.refresh_token,
    expires_in: obj.expires_in
  }
}

/**
 * Validate API key response
 */
function validateApiKeyResponse(json: unknown): ApiKeyResponse {
  if (typeof json !== 'object' || json === null) {
    throw new Error('Invalid API key response: expected object')
  }

  const obj = json as Record<string, unknown>

  if (typeof obj.raw_key !== 'string' || !obj.raw_key) {
    throw new Error('Invalid API key response: missing or invalid raw_key')
  }

  return { raw_key: obj.raw_key }
}

/**
 * Framework-agnostic OAuth 2.0 PKCE client for Anthropic Claude API
 *
 * @example
 * ```ts
 * const client = new AnthropicOAuthClient({
 *   openUrl: (url) => window.open(url, '_blank')
 * })
 *
 * // Start the OAuth flow
 * const { authUrl, verifier, state } = await client.startLogin('console')
 * console.log('Visit:', authUrl)
 *
 * // After user authorizes and you receive the callback code
 * const code = getUserInputCode() // Get from user
 * const result = await client.completeLogin(code, verifier, state)
 *
 * // Save tokens or API key
 * if (result.apiKey) {
 *   console.log('API Key:', result.apiKey)
 * } else {
 *   console.log('Tokens:', result.tokens)
 * }
 * ```
 */
export class AnthropicOAuthClient {
  private readonly clientId: string
  private readonly openUrl?: (url: string) => Promise<void> | void
  private readonly timeoutMs: number
  private readonly tokenExpirationBufferMs: number

  constructor(options: OAuthClientOptions = {}) {
    this.clientId = options.clientId?.trim() || DEFAULT_CLIENT_ID
    this.openUrl = options.openUrl
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.tokenExpirationBufferMs = options.tokenExpirationBufferMs ?? DEFAULT_EXPIRATION_BUFFER_MS

    if (!this.clientId) {
      throw new Error('Client ID must not be empty')
    }
  }

  /**
   * Generate PKCE challenge and verifier for secure OAuth flow
   */
  private async generatePKCEChallenge(): Promise<PKCEChallenge> {
    const pkce = await generatePKCE()
    return {
      challenge: pkce.challenge,
      verifier: pkce.verifier
    }
  }

  /**
   * Generate the OAuth authorization URL
   */
  private getAuthorizationUrl(mode: AuthMode, pkce: PKCEChallenge, state: string): string {
    const baseUrl = mode === 'max' ? AUTHORIZATION_ENDPOINT_MAX : AUTHORIZATION_ENDPOINT_CONSOLE
    const params = new URLSearchParams({
      code: 'true',
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      state: state
    })

    return `${baseUrl}?${params.toString()}`
  }

  /**
   * Make a fetch request with timeout and proper error handling
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    operation: string
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      })
      return response
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`${operation} timed out after ${this.timeoutMs}ms`)
        }
        if (error.message.includes('Failed to fetch') || error.message.includes('fetch')) {
          throw new Error(
            `${operation} failed: Unable to connect. Check your internet connection.`
          )
        }
        throw new Error(`${operation} failed: ${error.message}`)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Handle HTTP error responses with sanitized messages
   */
  private async handleHttpError(response: Response, operation: string): Promise<never> {
    let errorDetails = ''
    try {
      errorDetails = await response.text()
      // Truncate long error messages to avoid leaking too much info
      if (errorDetails.length > 200) {
        errorDetails = errorDetails.substring(0, 200) + '...'
      }
    } catch {
      errorDetails = '(unable to read error response)'
    }

    // Provide user-friendly messages for common status codes
    const statusMessages: Record<number, string> = {
      400: 'Invalid request parameters',
      401: 'Authentication failed',
      403: 'Access denied',
      404: 'OAuth endpoint not found',
      429: 'Too many requests - please try again later',
      500: 'OAuth server error',
      502: 'OAuth server temporarily unavailable',
      503: 'OAuth server temporarily unavailable'
    }

    const friendlyMessage = statusMessages[response.status] || response.statusText
    throw new Error(`${operation} failed (${response.status}): ${friendlyMessage}`)
  }

  /**
   * Parse and validate JSON response
   */
  private async parseJsonResponse<T>(
    response: Response,
    validator: (json: unknown) => T,
    operation: string
  ): Promise<T> {
    let json: unknown
    try {
      json = await response.json()
    } catch {
      throw new Error(`${operation} failed: Invalid JSON response from server`)
    }

    try {
      return validator(json)
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`${operation} failed: ${error.message}`)
      }
      throw error
    }
  }

  /**
   * Start the OAuth login flow
   *
   * @param mode - Authentication mode ('max' for Claude.ai, 'console' for Console)
   * @returns Authorization URL, verifier, and state to be used in completeLogin
   *
   * @example
   * ```ts
   * const { authUrl, verifier, state } = await client.startLogin('console')
   * console.log('Visit:', authUrl)
   * // Store verifier and state for later use in completeLogin
   * ```
   */
  async startLogin(mode: AuthMode = 'console'): Promise<OAuthStartResult> {
    const pkce = await this.generatePKCEChallenge()
    const state = generateState()
    const authUrl = this.getAuthorizationUrl(mode, pkce, state)

    // Optionally open the URL if callback is provided
    if (this.openUrl) {
      try {
        await this.openUrl(authUrl)
      } catch {
        // Silently continue - URL opening is optional
        // The authUrl is still returned for manual handling
      }
    }

    return {
      authUrl,
      verifier: pkce.verifier,
      state
    }
  }

  /**
   * Exchange authorization code for access and refresh tokens
   *
   * @param code - Authorization code from OAuth callback (may include state fragment)
   * @param verifier - PKCE verifier from startLogin
   * @param expectedState - State value from startLogin for CSRF validation
   * @returns OAuth tokens
   */
  private async exchangeCodeForTokens(
    code: string,
    verifier: string,
    expectedState: string
  ): Promise<OAuthTokens> {
    // The code might contain the state appended with #
    const [authCode, callbackState] = code.split('#')

    // Validate state for CSRF protection
    if (callbackState && callbackState !== expectedState) {
      throw new Error(
        'State mismatch: The callback state does not match the expected state. ' +
          'This may indicate a CSRF attack or an expired session.'
      )
    }

    if (!authCode?.trim()) {
      throw new Error('Invalid authorization code: code is empty')
    }

    const body: Record<string, string> = {
      code: authCode,
      grant_type: 'authorization_code',
      client_id: this.clientId,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier
    }

    // Only include state if present
    if (callbackState) {
      body.state = callbackState
    }

    const response = await this.fetchWithTimeout(
      TOKEN_ENDPOINT,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      },
      'Token exchange'
    )

    if (!response.ok) {
      await this.handleHttpError(response, 'Token exchange')
    }

    const tokenResponse = await this.parseJsonResponse(
      response,
      validateTokenResponse,
      'Token exchange'
    )

    return {
      type: 'oauth',
      refresh: tokenResponse.refresh_token,
      access: tokenResponse.access_token,
      expires: Date.now() + tokenResponse.expires_in * 1000
    }
  }

  /**
   * Create an API key using OAuth access token
   *
   * @param accessToken - Valid OAuth access token
   * @returns API key string
   */
  private async createApiKey(accessToken: string): Promise<string> {
    if (!accessToken?.trim()) {
      throw new Error('Access token is required to create API key')
    }

    const response = await this.fetchWithTimeout(
      CREATE_API_KEY_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${accessToken}`
        }
      },
      'API key creation'
    )

    if (!response.ok) {
      await this.handleHttpError(response, 'API key creation')
    }

    const apiKeyResponse = await this.parseJsonResponse(
      response,
      validateApiKeyResponse,
      'API key creation'
    )

    return apiKeyResponse.raw_key
  }

  /**
   * Complete the OAuth login flow by exchanging the authorization code
   *
   * @param code - Authorization code from OAuth callback URL
   * @param verifier - PKCE verifier from startLogin
   * @param state - State parameter from startLogin (for CSRF validation)
   * @param createKey - If true, create an API key instead of returning OAuth tokens
   * @returns Tokens and optionally an API key
   *
   * @example
   * ```ts
   * // Get OAuth tokens
   * const result = await client.completeLogin(code, verifier, state)
   * console.log('Access token:', result.tokens.access)
   *
   * // Or get an API key
   * const result = await client.completeLogin(code, verifier, state, true)
   * console.log('API key:', result.apiKey)
   * ```
   */
  async completeLogin(
    code: string,
    verifier: string,
    state: string,
    createKey = false
  ): Promise<OAuthCompleteResult> {
    // Input validation
    if (!code || typeof code !== 'string') {
      throw new Error('Authorization code is required')
    }

    if (!verifier || typeof verifier !== 'string') {
      throw new Error('PKCE verifier is required')
    }

    if (!state || typeof state !== 'string') {
      throw new Error('State parameter is required for CSRF protection')
    }

    const tokens = await this.exchangeCodeForTokens(code.trim(), verifier.trim(), state.trim())

    if (createKey) {
      const apiKey = await this.createApiKey(tokens.access)
      return { tokens, apiKey }
    }

    return { tokens }
  }

  /**
   * Refresh the access token using a refresh token
   *
   * @param refreshToken - Refresh token from previous authentication
   * @returns New OAuth tokens
   *
   * @example
   * ```ts
   * const newTokens = await client.refreshAccessToken(oldTokens.refresh)
   * console.log('New access token:', newTokens.access)
   * ```
   */
  async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new Error('Refresh token is required')
    }

    const response = await this.fetchWithTimeout(
      TOKEN_ENDPOINT,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken.trim(),
          client_id: this.clientId
        })
      },
      'Token refresh'
    )

    if (!response.ok) {
      await this.handleHttpError(response, 'Token refresh')
    }

    const tokenResponse = await this.parseJsonResponse(
      response,
      validateTokenResponse,
      'Token refresh'
    )

    return {
      type: 'oauth',
      refresh: tokenResponse.refresh_token,
      access: tokenResponse.access_token,
      expires: Date.now() + tokenResponse.expires_in * 1000
    }
  }

  /**
   * Check if access token is expired or about to expire
   *
   * @param tokens - OAuth tokens to check
   * @returns true if token is expired or will expire within the buffer period
   */
  isTokenExpired(tokens: OAuthTokens): boolean {
    return tokens.expires < Date.now() + this.tokenExpirationBufferMs
  }

  /**
   * Get a valid access token, automatically refreshing if necessary
   *
   * @param tokens - Current OAuth tokens
   * @returns Valid access token string, or new tokens if refreshed
   *
   * @example
   * ```ts
   * const result = await client.getValidAccessToken(currentTokens)
   * if (result.tokens) {
   *   // Token was refreshed, save new tokens
   *   saveTokens(result.tokens)
   * }
   * return result.accessToken
   * ```
   */
  async getValidAccessToken(
    tokens: OAuthTokens
  ): Promise<{ accessToken: string; tokens?: OAuthTokens }> {
    if (this.isTokenExpired(tokens)) {
      const newTokens = await this.refreshAccessToken(tokens.refresh)
      return {
        accessToken: newTokens.access,
        tokens: newTokens
      }
    }

    return { accessToken: tokens.access }
  }
}
