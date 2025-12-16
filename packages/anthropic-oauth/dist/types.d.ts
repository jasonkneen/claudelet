/**
 * OAuth token response from Anthropic
 */
export interface OAuthTokens {
    type: 'oauth';
    refresh: string;
    access: string;
    expires: number;
}
/**
 * PKCE challenge and verifier pair
 */
export interface PKCEChallenge {
    challenge: string;
    verifier: string;
}
/**
 * Authentication mode - either Claude.ai (max) or Console
 */
export type AuthMode = 'max' | 'console';
/**
 * Result from starting the OAuth flow
 */
export interface OAuthStartResult {
    authUrl: string;
    verifier: string;
    /** State parameter for CSRF protection - must be validated in completeLogin */
    state: string;
}
/**
 * Result from completing the OAuth flow
 */
export interface OAuthCompleteResult {
    tokens: OAuthTokens;
    apiKey?: string;
}
/**
 * Options for the OAuth client
 */
export interface OAuthClientOptions {
    /**
     * Optional callback to open a URL (e.g., in a browser)
     * If not provided, the authUrl must be opened manually
     */
    openUrl?: (url: string) => Promise<void> | void;
    /**
     * Client ID for OAuth authentication
     * Defaults to Claude Agent Desktop client ID
     */
    clientId?: string;
    /**
     * Request timeout in milliseconds
     * @default 30000 (30 seconds)
     */
    timeoutMs?: number;
    /**
     * Token expiration buffer in milliseconds
     * Tokens are considered expired this many ms before actual expiry
     * @default 300000 (5 minutes)
     */
    tokenExpirationBufferMs?: number;
}
//# sourceMappingURL=types.d.ts.map