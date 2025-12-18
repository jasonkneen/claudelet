/**
 * Authentication Manager for Claude Agent Loop
 *
 * Provides OAuth and API key authentication support for CLI applications.
 * Implements comprehensive OAuth 2.0 PKCE security validations.
 */

import { AnthropicOAuthClient, type AuthMode, type OAuthTokens } from '@anthropic-ai/anthropic-oauth'
import { OAuthCodeValidator } from './oauth-code-validator.js'
import { parseOAuthCallbackInput } from './oauth-callback.js'

export interface AuthConfig {
  /**
   * Anthropic API key (direct authentication)
   */
  apiKey?: string;

  /**
   * OAuth tokens for token-based authentication
   */
  oauthTokens?: OAuthTokens;

  /**
   * OAuth access token (will be managed automatically if oauthTokens provided)
   */
  oauthAccessToken?: string;
}

export interface OAuthFlowResult {
  /**
   * OAuth tokens obtained from the flow
   */
  tokens?: OAuthTokens;

  /**
   * API key created from OAuth (if createApiKey was true)
   */
  apiKey?: string;
}

/**
 * Authentication manager for handling OAuth and API key authentication
 */
export class AuthenticationManager {
  private oauthClient: AnthropicOAuthClient
  private config: AuthConfig
  private codeValidator: OAuthCodeValidator

  constructor(config: AuthConfig = {}) {
    this.config = config
    this.oauthClient = new AnthropicOAuthClient()
    this.codeValidator = new OAuthCodeValidator()
  }

  /**
   * Check if authenticated (has API key or OAuth tokens)
   */
  isAuthenticated(): boolean {
    return !!(this.config.apiKey || this.config.oauthTokens || this.config.oauthAccessToken);
  }

  /**
   * Get the current API key (if available)
   */
  getApiKey(): string | undefined {
    return this.config.apiKey;
  }

  /**
   * Get a valid OAuth access token, refreshing if necessary
   */
  async getOAuthAccessToken(): Promise<string | null> {
    if (!this.config.oauthTokens) {
      return null;
    }

    const result = await this.oauthClient.getValidAccessToken(this.config.oauthTokens);

    // If tokens were refreshed, update the config
    if (result.tokens) {
      this.config.oauthTokens = result.tokens;
    }

    return result.accessToken;
  }

  /**
   * Get authentication credentials for the Claude Agent SDK
   * Returns API key if available, otherwise gets/refreshes OAuth token
   */
  async getCredentials(): Promise<{ apiKey?: string; oauthToken?: string }> {
    if (this.config.apiKey) {
      return { apiKey: this.config.apiKey };
    }

    const oauthToken = await this.getOAuthAccessToken();
    if (oauthToken) {
      return { oauthToken };
    }

    throw new Error('No valid authentication credentials available');
  }

  /**
   * Set API key
   */
  setApiKey(apiKey: string): void {
    this.config.apiKey = apiKey;
    // Clear OAuth tokens when using API key
    delete this.config.oauthTokens;
    delete this.config.oauthAccessToken;
  }

  /**
   * Set OAuth tokens
   */
  setOAuthTokens(tokens: OAuthTokens): void {
    this.config.oauthTokens = tokens;
    // Clear API key when using OAuth
    delete this.config.apiKey;
  }

  /**
   * Start OAuth login flow
   *
   * @param mode - 'console' for Anthropic Account, 'max' for Claude Max Subscription
   * @returns Authorization URL, verifier, and state for completing the flow
   */
  async startOAuthFlow(mode: AuthMode): Promise<{ authUrl: string; verifier: string; state: string }> {
    return this.oauthClient.startLogin(mode);
  }

  /**
   * Complete OAuth login flow
   *
   * Validates the authorization code using comprehensive OAuth 2.0 PKCE security checks:
   * - Code format validation (length, character set)
   * - State parameter validation (CSRF protection)
   * - Code replay prevention
   * - Authorization code timeout enforcement
   *
   * @param code - Authorization code from OAuth callback
   * @param verifier - Verifier from startOAuthFlow
   * @param state - State from startOAuthFlow (for CSRF protection)
   * @param createApiKey - If true, creates an API key instead of using OAuth tokens
   * @returns OAuth tokens or API key
   * @throws Error if code validation fails (format, state, replay, or timeout)
   */
  async completeOAuthFlow(
    code: string,
    verifier: string,
    state: string,
    createApiKey = false
  ): Promise<OAuthFlowResult> {
    const parsed = parseOAuthCallbackInput(code)
    const codeForClient = parsed.state ? `${parsed.code}#${parsed.state}` : parsed.code

    // Validate authorization code before token exchange
    // This prevents authorization code injection, replay attacks, and CSRF vulnerabilities
    this.codeValidator.validateCode(parsed.code, parsed.state ?? state, state)

    const result = await this.oauthClient.completeLogin(codeForClient, verifier, state, createApiKey)

    if (createApiKey && result.apiKey) {
      this.setApiKey(result.apiKey)
      return { apiKey: result.apiKey }
    }

    this.setOAuthTokens(result.tokens)
    return { tokens: result.tokens }
  }

  /**
   * Clear all authentication
   */
  clearAuth(): void {
    this.config = {};
  }

  /**
   * Get current auth config (for persistence)
   */
  getAuthConfig(): AuthConfig {
    return { ...this.config };
  }

  /**
   * Load auth config (from persisted state)
   */
  loadAuthConfig(config: AuthConfig): void {
    this.config = { ...config };
  }
}

/**
 * Create a new authentication manager
 */
export function createAuthManager(config?: AuthConfig): AuthenticationManager {
  return new AuthenticationManager(config);
}
