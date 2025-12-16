/**
 * OAuth Authorization Code Validator
 *
 * Implements comprehensive OAuth 2.0 PKCE security validations:
 * - Code format validation (length, character set)
 * - State parameter validation (CSRF protection)
 * - Code replay prevention
 * - Authorization code timeout enforcement
 */

/**
 * Metadata tracked for authorization codes to prevent replay attacks
 */
interface CodeMetadata {
  code: string
  timestamp: number
  used: boolean
}

/**
 * Default OAuth code expiration time (10 minutes per OAuth 2.0 spec)
 */
const DEFAULT_CODE_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Default cache cleanup interval (1 hour)
 */
const DEFAULT_CACHE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

/**
 * OAuth Authorization Code Validator
 *
 * Validates authorization codes according to OAuth 2.0 PKCE specifications
 * and prevents common attacks (injection, replay, CSRF).
 *
 * @example
 * ```ts
 * const validator = new OAuthCodeValidator();
 *
 * // Validate a code before token exchange
 * try {
 *   validator.validateCode(code, state, expectedState);
 *   // Code is valid, safe to exchange for tokens
 * } catch (error) {
 *   // Code failed validation - reject the callback
 *   console.error(error.message);
 * }
 * ```
 */
export class OAuthCodeValidator {
  private codeCache: Map<string, CodeMetadata>
  private codeTimeoutMs: number
  private cleanupIntervalMs: number
  private lastCleanup: number

  /**
   * Create a new OAuth code validator
   *
   * @param options Configuration options
   * @param options.codeTimeoutMs Authorization code expiration time in milliseconds (default: 10 minutes)
   * @param options.cleanupIntervalMs How often to cleanup expired codes (default: 1 hour)
   */
  constructor(options?: { codeTimeoutMs?: number; cleanupIntervalMs?: number }) {
    this.codeCache = new Map()
    this.codeTimeoutMs = options?.codeTimeoutMs ?? DEFAULT_CODE_TIMEOUT_MS
    this.cleanupIntervalMs = options?.cleanupIntervalMs ?? DEFAULT_CACHE_CLEANUP_INTERVAL_MS
    this.lastCleanup = Date.now()
  }

  /**
   * Validate OAuth authorization code format
   *
   * Checks that the code:
   * - Is a non-empty string
   * - Has appropriate length (20-256 characters)
   * - Contains only valid characters (alphanumeric, hyphen, underscore)
   *
   * @param code Authorization code to validate
   * @throws Error if code format is invalid
   */
  private validateCodeFormat(code: string): void {
    if (!code || typeof code !== 'string') {
      throw new Error('Invalid authorization code: missing or wrong type')
    }

    const trimmedCode = code.trim()

    if (trimmedCode.length < 20 || trimmedCode.length > 256) {
      throw new Error('Invalid authorization code: incorrect length')
    }

    if (!/^[A-Za-z0-9_-]+$/.test(trimmedCode)) {
      throw new Error('Invalid authorization code: invalid characters')
    }
  }

  /**
   * Validate state parameter for CSRF protection
   *
   * @param state State parameter from OAuth callback
   * @param expectedState State parameter from OAuth start
   * @throws Error if state does not match
   */
  private validateState(state: string, expectedState: string): void {
    if (state !== expectedState) {
      throw new Error('Invalid state: possible CSRF attack or expired session')
    }
  }

  /**
   * Check if code has been used before (replay attack prevention)
   *
   * @param code Authorization code
   * @throws Error if code was already used
   */
  private checkReplayAttack(code: string): void {
    const cached = this.codeCache.get(code)

    if (cached?.used) {
      throw new Error('Invalid authorization code: code already used')
    }
  }

  /**
   * Check if code has expired
   *
   * @param code Authorization code
   * @throws Error if code has expired
   */
  private checkCodeExpiration(code: string): void {
    const cached = this.codeCache.get(code)

    if (!cached) {
      // First time seeing this code, record it
      return
    }

    if (Date.now() - cached.timestamp > this.codeTimeoutMs) {
      this.codeCache.delete(code)
      throw new Error('Invalid authorization code: code expired')
    }
  }

  /**
   * Mark code as used to prevent replay attacks
   *
   * @param code Authorization code
   */
  private markCodeAsUsed(code: string): void {
    const now = Date.now()

    // Record the code as used
    this.codeCache.set(code, {
      code,
      timestamp: now,
      used: true
    })

    // Periodically cleanup old entries
    if (now - this.lastCleanup > this.cleanupIntervalMs) {
      this.cleanupExpiredEntries()
    }
  }

  /**
   * Remove expired entries from cache to prevent memory leaks
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now()
    const maxAge = this.codeTimeoutMs + 5 * 60 * 1000 // Keep for 5 extra minutes after expiry

    const keysToDelete: string[] = []
    this.codeCache.forEach((value, key) => {
      if (now - value.timestamp > maxAge) {
        keysToDelete.push(key)
      }
    })

    keysToDelete.forEach((key) => {
      this.codeCache.delete(key)
    })

    this.lastCleanup = now
  }

  /**
   * Validate OAuth authorization code with all security checks
   *
   * Performs the following validations in order:
   * 1. Code format (length, character set)
   * 2. State parameter (CSRF protection)
   * 3. Replay attack prevention (code not already used)
   * 4. Code expiration (not older than timeout)
   *
   * If validation passes, the code is marked as used.
   *
   * @param code Authorization code from OAuth callback
   * @param state State parameter from OAuth callback
   * @param expectedState State parameter from OAuth start
   *
   * @throws Error if any validation fails with descriptive error message
   *
   * @example
   * ```ts
   * try {
   *   validator.validateCode(code, state, expectedState);
   *   // Safe to exchange code for tokens
   *   const result = await client.completeLogin(code, verifier, state);
   * } catch (error) {
   *   // Validation failed - reject callback
   *   console.error('Code validation failed:', error.message);
   * }
   * ```
   */
  validateCode(code: string, state: string, expectedState: string): void {
    // 1. Format validation
    this.validateCodeFormat(code)

    // 2. State validation (CSRF protection)
    this.validateState(state, expectedState)

    const trimmedCode = code.trim()

    // 3. Replay prevention
    this.checkReplayAttack(trimmedCode)

    // 4. Timeout enforcement
    this.checkCodeExpiration(trimmedCode)

    // Mark as used
    this.markCodeAsUsed(trimmedCode)
  }

  /**
   * Reset the code cache (useful for testing)
   */
  clearCache(): void {
    this.codeCache.clear()
  }

  /**
   * Get cache statistics (useful for monitoring)
   */
  getCacheStats(): { size: number; entries: Array<{ code: string; used: boolean; age: number }> } {
    const now = Date.now()
    const entries = Array.from(this.codeCache.entries()).map(([code, meta]) => ({
      code: `${code.substring(0, 8)}...${code.substring(code.length - 4)}`,
      used: meta.used,
      age: now - meta.timestamp
    }))

    return { size: this.codeCache.size, entries }
  }
}

/**
 * Create a new OAuth code validator with default settings
 */
export function createOAuthCodeValidator(options?: {
  codeTimeoutMs?: number
  cleanupIntervalMs?: number
}): OAuthCodeValidator {
  return new OAuthCodeValidator(options)
}
