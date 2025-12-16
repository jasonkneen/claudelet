import type { AuthMode, OAuthClientOptions, OAuthCompleteResult, OAuthStartResult, OAuthTokens } from './types.js';
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
export declare class AnthropicOAuthClient {
    private readonly clientId;
    private readonly openUrl?;
    private readonly timeoutMs;
    private readonly tokenExpirationBufferMs;
    constructor(options?: OAuthClientOptions);
    /**
     * Generate PKCE challenge and verifier for secure OAuth flow
     */
    private generatePKCEChallenge;
    /**
     * Generate the OAuth authorization URL
     */
    private getAuthorizationUrl;
    /**
     * Make a fetch request with timeout and proper error handling
     */
    private fetchWithTimeout;
    /**
     * Handle HTTP error responses with sanitized messages
     */
    private handleHttpError;
    /**
     * Parse and validate JSON response
     */
    private parseJsonResponse;
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
    startLogin(mode?: AuthMode): Promise<OAuthStartResult>;
    /**
     * Exchange authorization code for access and refresh tokens
     *
     * @param code - Authorization code from OAuth callback (may include state fragment)
     * @param verifier - PKCE verifier from startLogin
     * @param expectedState - State value from startLogin for CSRF validation
     * @returns OAuth tokens
     */
    private exchangeCodeForTokens;
    /**
     * Create an API key using OAuth access token
     *
     * @param accessToken - Valid OAuth access token
     * @returns API key string
     */
    private createApiKey;
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
    completeLogin(code: string, verifier: string, state: string, createKey?: boolean): Promise<OAuthCompleteResult>;
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
    refreshAccessToken(refreshToken: string): Promise<OAuthTokens>;
    /**
     * Check if access token is expired or about to expire
     *
     * @param tokens - OAuth tokens to check
     * @returns true if token is expired or will expire within the buffer period
     */
    isTokenExpired(tokens: OAuthTokens): boolean;
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
    getValidAccessToken(tokens: OAuthTokens): Promise<{
        accessToken: string;
        tokens?: OAuthTokens;
    }>;
}
//# sourceMappingURL=oauth-client.d.ts.map