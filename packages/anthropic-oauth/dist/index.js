/**
 * @anthropic-ai/anthropic-oauth
 *
 * Framework-agnostic OAuth 2.0 PKCE client for Anthropic Claude API authentication
 *
 * @example
 * ```ts
 * import { AnthropicOAuthClient } from '@anthropic-ai/anthropic-oauth'
 *
 * const client = new AnthropicOAuthClient()
 *
 * // Start login
 * const { authUrl, verifier } = await client.startLogin('console')
 * console.log('Visit:', authUrl)
 *
 * // Complete login
 * const code = await getUserInput() // Get auth code from user
 * const { tokens } = await client.completeLogin(code, verifier)
 *
 * // Use tokens
 * console.log('Access token:', tokens.access)
 * ```
 */
export { AnthropicOAuthClient } from './oauth-client.js';
//# sourceMappingURL=index.js.map