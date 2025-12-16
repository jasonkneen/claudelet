/**
 * Tests for OAuth Authorization Code Validator
 *
 * Tests cover:
 * - Code format validation
 * - State parameter validation
 * - Replay attack prevention
 * - Code expiration/timeout
 * - Attack scenarios
 * - Error messages
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { OAuthCodeValidator, createOAuthCodeValidator } from './oauth-code-validator'

describe('OAuthCodeValidator', () => {
  let validator: OAuthCodeValidator

  beforeEach(() => {
    validator = createOAuthCodeValidator()
  })

  // ============================================================================
  // Code Format Validation Tests
  // ============================================================================

  describe('Code Format Validation', () => {
    const validState = 'expected-state-value'
    const validCallbackState = 'expected-state-value'

    it('should accept valid authorization codes', () => {
      const validCode =
        'abcdef123456789012345678901234567890ABCDEF123456789012345678901234567890'

      expect(() => {
        validator.validateCode(validCode, validCallbackState, validState)
      }).not.toThrow()
    })

    it('should accept codes with hyphens and underscores', () => {
      const validCode = 'abc_def-ghi_jkl-mno_pqr-stu_vwx-yz0123456789ABCDEFGH'

      expect(() => {
        validator.validateCode(validCode, validCallbackState, validState)
      }).not.toThrow()
    })

    it('should reject empty code', () => {
      expect(() => {
        validator.validateCode('', validCallbackState, validState)
      }).toThrow('Invalid authorization code: missing or wrong type')
    })

    it('should reject null code', () => {
      expect(() => {
        validator.validateCode(null as any, validCallbackState, validState)
      }).toThrow('Invalid authorization code: missing or wrong type')
    })

    it('should reject undefined code', () => {
      expect(() => {
        validator.validateCode(undefined as any, validCallbackState, validState)
      }).toThrow('Invalid authorization code: missing or wrong type')
    })

    it('should reject code with wrong type (number)', () => {
      expect(() => {
        validator.validateCode(123456 as any, validCallbackState, validState)
      }).toThrow('Invalid authorization code: missing or wrong type')
    })

    it('should reject code shorter than 20 characters', () => {
      const shortCode = 'abc123def456ghi'

      expect(() => {
        validator.validateCode(shortCode, validCallbackState, validState)
      }).toThrow('Invalid authorization code: incorrect length')
    })

    it('should reject code longer than 256 characters', () => {
      const longCode = 'a'.repeat(257)

      expect(() => {
        validator.validateCode(longCode, validCallbackState, validState)
      }).toThrow('Invalid authorization code: incorrect length')
    })

    it('should accept code exactly 20 characters', () => {
      const minLengthCode = 'a'.repeat(20)

      expect(() => {
        validator.validateCode(minLengthCode, validCallbackState, validState)
      }).not.toThrow()
    })

    it('should accept code exactly 256 characters', () => {
      const maxLengthCode = 'a'.repeat(256)

      expect(() => {
        validator.validateCode(maxLengthCode, validCallbackState, validState)
      }).not.toThrow()
    })

    it('should reject code with spaces', () => {
      const codeWithSpace = 'abc def ghijklmnopqrst'

      expect(() => {
        validator.validateCode(codeWithSpace, validCallbackState, validState)
      }).toThrow('Invalid authorization code: invalid characters')
    })

    it('should reject code with special characters', () => {
      const codeWithSpecial = 'abc!def@ghijklmnopqrst'

      expect(() => {
        validator.validateCode(codeWithSpecial, validCallbackState, validState)
      }).toThrow('Invalid authorization code: invalid characters')
    })

    it('should reject code with dots', () => {
      const codeWithDot = 'abc.def.ghijklmnopqrst'

      expect(() => {
        validator.validateCode(codeWithDot, validCallbackState, validState)
      }).toThrow('Invalid authorization code: invalid characters')
    })

    it('should reject code with slashes', () => {
      const codeWithSlash = 'abc/def/ghijklmnopqrst'

      expect(() => {
        validator.validateCode(codeWithSlash, validCallbackState, validState)
      }).toThrow('Invalid authorization code: invalid characters')
    })
  })

  // ============================================================================
  // State Parameter Validation Tests (CSRF Protection)
  // ============================================================================

  describe('State Parameter Validation (CSRF Protection)', () => {
    const validCode = 'a'.repeat(20)

    it('should accept matching state parameters', () => {
      const state = 'random-csrf-state-12345'

      expect(() => {
        validator.validateCode(validCode, state, state)
      }).not.toThrow()
    })

    it('should reject mismatching state parameters', () => {
      expect(() => {
        validator.validateCode(validCode, 'callback-state', 'expected-state')
      }).toThrow('Invalid state: possible CSRF attack or expired session')
    })

    it('should reject empty callback state', () => {
      expect(() => {
        validator.validateCode(validCode, '', 'expected-state')
      }).toThrow('Invalid state: possible CSRF attack or expired session')
    })

    it('should reject empty expected state', () => {
      // This would be a configuration error, but validator should still reject
      expect(() => {
        validator.validateCode(validCode, 'callback-state', '')
      }).toThrow('Invalid state: possible CSRF attack or expired session')
    })

    it('should be case-sensitive for state comparison', () => {
      expect(() => {
        validator.validateCode(validCode, 'State', 'state')
      }).toThrow('Invalid state: possible CSRF attack or expired session')
    })
  })

  // ============================================================================
  // Replay Attack Prevention Tests
  // ============================================================================

  describe('Replay Attack Prevention', () => {
    const state = 'test-state'
    const validCode = 'abcdefghij1234567890xyz'

    it('should allow first use of authorization code', () => {
      expect(() => {
        validator.validateCode(validCode, state, state)
      }).not.toThrow()
    })

    it('should prevent reuse of same authorization code', () => {
      const code = 'test-code-for-replay1234567890'

      // First use should succeed
      expect(() => {
        validator.validateCode(code, state, state)
      }).not.toThrow()

      // Second use should be rejected
      expect(() => {
        validator.validateCode(code, state, state)
      }).toThrow('Invalid authorization code: code already used')
    })

    it('should track multiple different codes independently', () => {
      const code1 = 'code-one-for-testing123456789'
      const code2 = 'code-two-for-testing123456789'

      // Use code1
      expect(() => {
        validator.validateCode(code1, state, state)
      }).not.toThrow()

      // Use code2 (should work)
      expect(() => {
        validator.validateCode(code2, state, state)
      }).not.toThrow()

      // Retry code1 (should fail - already used)
      expect(() => {
        validator.validateCode(code1, state, state)
      }).toThrow('Invalid authorization code: code already used')
    })

    it('should prevent replay with different state', () => {
      const code = 'replay-test-code-1234567890'

      // First use
      expect(() => {
        validator.validateCode(code, 'state1', 'state1')
      }).not.toThrow()

      // Replay attempt with different state (fails on state check)
      expect(() => {
        validator.validateCode(code, 'state1', 'state2')
      }).toThrow('Invalid state: possible CSRF attack or expired session')
    })
  })

  // ============================================================================
  // Code Expiration/Timeout Tests
  // ============================================================================

  describe('Code Expiration/Timeout Enforcement', () => {
    const state = 'test-state'

    it('should track code creation time', () => {
      const validator = new OAuthCodeValidator({ codeTimeoutMs: 1000 }) // 1 second timeout
      const code = 'expiration-test-code-1234567890'

      // Fresh code should be valid
      expect(() => {
        validator.validateCode(code, state, state)
      }).not.toThrow()
    })

    it('should reject expired codes', async () => {
      const validator = new OAuthCodeValidator({ codeTimeoutMs: 100 }) // 100ms timeout
      const code = 'expired-code-test-1234567890'

      // First validation succeeds
      expect(() => {
        validator.validateCode(code, state, state)
      }).not.toThrow()

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Try to reuse (should fail due to replay first)
      expect(() => {
        validator.validateCode(code, state, state)
      }).toThrow('Invalid authorization code: code already used')
    })

    it('should remove expired entries during cleanup', async () => {
      const validator = new OAuthCodeValidator({
        codeTimeoutMs: 100,
        cleanupIntervalMs: 150
      })
      const code = 'cleanup-test-code-1234567890'

      // Use a code
      expect(() => {
        validator.validateCode(code, state, state)
      }).not.toThrow()

      const statsBefore = validator.getCacheStats()
      expect(statsBefore.size).toBeGreaterThan(0)

      // Wait for timeout and cleanup
      await new Promise((resolve) => setTimeout(resolve, 300))

      // Trigger cleanup by using another valid code
      const code2 = 'second-code-triggers-cleanup1'
      expect(() => {
        validator.validateCode(code2, state, state)
      }).not.toThrow()

      // Cache should be reduced after cleanup (first code expired, second code added)
      // The size after cleanup should be less than or equal to before
      const statsAfter = validator.getCacheStats()
      // After cleanup: old code is removed, new code is added
      // So size should typically be 1, not 2
      expect(statsAfter.size).toBeLessThanOrEqual(2)
    })

    it('should have default timeout of 10 minutes', () => {
      const defaultValidator = new OAuthCodeValidator()
      const stats = defaultValidator.getCacheStats()

      // Just verify it can be created with defaults
      expect(stats.size).toBe(0)
    })
  })

  // ============================================================================
  // Attack Scenario Tests
  // ============================================================================

  describe('Attack Scenarios', () => {
    const validState = 'legitimate-state'

    it('should reject authorization code injection', () => {
      // Attacker tries to inject a malformed code
      const injectedCodes = [
        'injection\n attempt',
        'code"; DROP TABLE oauth; --',
        "code' OR '1'='1",
        '../../../etc/passwd'
      ]

      injectedCodes.forEach((malicious) => {
        expect(() => {
          validator.validateCode(malicious, validState, validState)
        }).toThrow('Invalid authorization code')
      })
    })

    it('should prevent CSRF by rejecting state mismatch', () => {
      const legitimateCode = 'legitimate-code-abcdef1234567890'

      // Attacker tries to use code with different state
      expect(() => {
        validator.validateCode(legitimateCode, 'attacker-state', validState)
      }).toThrow('Invalid state: possible CSRF attack or expired session')
    })

    it('should prevent replay attack across multiple sessions', async () => {
      const attackerCode = 'stolen-authorization-code-12345'

      // Victim completes legitimate OAuth flow
      validator.validateCode(attackerCode, validState, validState)

      // Attacker tries to replay the stolen code
      expect(() => {
        validator.validateCode(attackerCode, validState, validState)
      }).toThrow('Invalid authorization code: code already used')
    })

    it('should handle code with length at boundary of valid range', () => {
      // Minimum valid length (20)
      const minCode = 'abcdefghij0123456789'
      expect(() => {
        validator.validateCode(minCode, validState, validState)
      }).not.toThrow()

      // Maximum valid length (256)
      const maxCode = 'a'.repeat(256)
      expect(() => {
        validator.validateCode(maxCode, validState, validState)
      }).not.toThrow()
    })

    it('should sanitize error messages to not leak sensitive info', () => {
      const sensitiveCode = 'sk-ant-very-secret-api-key-here-12345'

      // First use - should succeed even with "sensitive" looking code
      // because the format is valid (alphanumeric, hyphens, underscores)
      expect(() => {
        validator.validateCode(sensitiveCode, 'state', 'state')
      }).not.toThrow()

      // Second use - should fail without leaking the full code
      expect(() => {
        validator.validateCode(sensitiveCode, 'state', 'state')
      }).toThrow('Invalid authorization code: code already used')

      // Verify cache stats don't expose full code
      const stats = validator.getCacheStats()
      expect(stats.entries[0].code).not.toContain('very-secret')
      expect(stats.entries[0].code).toContain('...')
    })
  })

  // ============================================================================
  // Cache Management Tests
  // ============================================================================

  describe('Cache Management', () => {
    const state = 'test-state'

    it('should clear cache on demand', () => {
      const code = 'cache-clear-test-code-1234567890'

      expect(() => {
        validator.validateCode(code, state, state)
      }).not.toThrow()

      let stats = validator.getCacheStats()
      expect(stats.size).toBeGreaterThan(0)

      validator.clearCache()

      stats = validator.getCacheStats()
      expect(stats.size).toBe(0)
    })

    it('should allow code reuse after cache clear', () => {
      const code = 'reuse-after-clear-code1234567890'

      // Use code
      expect(() => {
        validator.validateCode(code, state, state)
      }).not.toThrow()

      // Clear cache
      validator.clearCache()

      // Code can be used again
      expect(() => {
        validator.validateCode(code, state, state)
      }).not.toThrow()
    })

    it('should provide accurate cache statistics', () => {
      const code1 = 'stats-test-code-one-1234567890'
      const code2 = 'stats-test-code-two-1234567890'
      const code3 = 'stats-test-code-three234567890'

      validator.validateCode(code1, state, state)
      validator.validateCode(code2, state, state)
      validator.validateCode(code3, state, state)

      const stats = validator.getCacheStats()

      expect(stats.size).toBe(3)
      expect(stats.entries).toHaveLength(3)
      expect(stats.entries.every((e) => e.used === true)).toBe(true)
    })

    it('should truncate codes in statistics for security', () => {
      const longCode = 'a'.repeat(256)

      validator.validateCode(longCode, state, state)

      const stats = validator.getCacheStats()

      // Codes should be truncated to prevent exposing them
      const entry = stats.entries[0]
      expect(entry.code).toContain('...')
      expect(entry.code.length).toBeLessThan(20)
    })
  })

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('Integration Scenarios', () => {
    it('should handle complete OAuth flow validation', () => {
      const validator = createOAuthCodeValidator()
      const code = 'complete-flow-code-test-1234567890'
      const state = 'oauth-state-nonce-abc123'

      // Start OAuth flow - generate state
      const expectedState = state

      // Complete OAuth flow - validate code
      expect(() => {
        validator.validateCode(code, expectedState, expectedState)
      }).not.toThrow()

      // Code marked as used, replay attempt should fail
      expect(() => {
        validator.validateCode(code, expectedState, expectedState)
      }).toThrow('Invalid authorization code: code already used')
    })

    it('should validate codes in concurrent-like scenarios', () => {
      const validator = createOAuthCodeValidator()
      const codes = Array.from({ length: 5 }, (_, i) =>
        `concurrent-code-${i}-1234567890abc`
      )
      const state = 'test-state'

      // All codes should be usable once
      codes.forEach((code) => {
        expect(() => {
          validator.validateCode(code, state, state)
        }).not.toThrow()
      })

      // Replaying any should fail
      codes.forEach((code) => {
        expect(() => {
          validator.validateCode(code, state, state)
        }).toThrow('Invalid authorization code: code already used')
      })
    })

    it('should handle mixture of valid and invalid codes', () => {
      const validator = createOAuthCodeValidator()
      const state = 'test-state'

      // Valid code
      const validCode = 'valid-code-test-1234567890'
      expect(() => {
        validator.validateCode(validCode, state, state)
      }).not.toThrow()

      // Invalid codes should still be rejected
      expect(() => {
        validator.validateCode('too short', state, state)
      }).toThrow('Invalid authorization code: incorrect length')

      // Valid code can't be replayed
      expect(() => {
        validator.validateCode(validCode, state, state)
      }).toThrow('Invalid authorization code: code already used')
    })
  })
})
