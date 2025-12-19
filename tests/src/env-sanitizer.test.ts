/**
 * Tests for env-sanitizer module
 */

import { describe, it, expect } from 'vitest'
import {
  isSensitiveKey,
  sanitizeEnv,
  sanitizeText
} from '../../src/env-sanitizer'
import { sampleEnvVars, sensitiveTextSamples } from '../helpers/fixtures'

describe('env-sanitizer', () => {
  describe('isSensitiveKey', () => {
    it('should detect exact sensitive key names', () => {
      expect(isSensitiveKey('ANTHROPIC_API_KEY')).toBe(true)
      expect(isSensitiveKey('CLAUDELET_AUTH_TOKEN')).toBe(true)
    })

    it('should detect keys matching sensitive patterns', () => {
      expect(isSensitiveKey('MY_API_KEY')).toBe(true)
      expect(isSensitiveKey('DATABASE_PASSWORD')).toBe(true)
      expect(isSensitiveKey('PRIVATE_KEY_PATH')).toBe(true)
      expect(isSensitiveKey('AUTH_SECRET')).toBe(true)
      expect(isSensitiveKey('ACCESS_TOKEN')).toBe(true)
      expect(isSensitiveKey('AWS_CREDENTIAL')).toBe(true)
    })

    it('should allow safe variable names', () => {
      expect(isSensitiveKey('NODE_ENV')).toBe(false)
      expect(isSensitiveKey('PATH')).toBe(false)
      expect(isSensitiveKey('HOME')).toBe(false)
      expect(isSensitiveKey('USER')).toBe(false)
      expect(isSensitiveKey('SHELL')).toBe(false)
    })

    it('should be case-insensitive for patterns', () => {
      expect(isSensitiveKey('api_key')).toBe(true)
      expect(isSensitiveKey('Api_Key')).toBe(true)
      expect(isSensitiveKey('API_KEY')).toBe(true)
    })
  })

  describe('sanitizeEnv', () => {
    it('should redact sensitive environment variables', () => {
      const result = sanitizeEnv(sampleEnvVars as unknown as NodeJS.ProcessEnv)

      expect(result.ANTHROPIC_API_KEY).toBe('[REDACTED]')
      expect(result.AUTH_TOKEN).toBe('[REDACTED]')
    })

    it('should preserve safe environment variables', () => {
      const result = sanitizeEnv(sampleEnvVars as unknown as NodeJS.ProcessEnv)

      expect(result.NODE_ENV).toBe('test')
      expect(result.PATH).toBe('/usr/bin')
      expect(result.SAFE_VAR).toBe('safe-value')
    })

    it('should handle empty env object', () => {
      const result = sanitizeEnv({} as NodeJS.ProcessEnv)
      expect(result).toEqual({})
    })

    it('should handle undefined values', () => {
      const envWithUndefined = {
        DEFINED_VAR: 'value',
        UNDEFINED_VAR: undefined
      } as unknown as NodeJS.ProcessEnv

      const result = sanitizeEnv(envWithUndefined)
      expect(result.DEFINED_VAR).toBe('value')
      expect(result.UNDEFINED_VAR).toBe('')
    })
  })

  describe('sanitizeText', () => {
    it('should redact API keys with sk- prefix', () => {
      const result = sanitizeText(sensitiveTextSamples.apiKey)
      expect(result).not.toContain('sk-ant-abc123def456')
      expect(result).toContain('[REDACTED]')
    })

    it('should redact Bearer tokens', () => {
      const result = sanitizeText(sensitiveTextSamples.bearer)
      expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9')
      expect(result).toContain('Bearer [REDACTED]')
    })

    it('should redact JSON token fields', () => {
      const result = sanitizeText(sensitiveTextSamples.jsonToken)
      expect(result).not.toContain('secret-token-value')
      expect(result).toContain('"access_token":"[REDACTED]"')
    })

    it('should redact environment variable assignments', () => {
      const result = sanitizeText(sensitiveTextSamples.envVar)
      expect(result).not.toContain('sk-ant-secret-key')
      expect(result).toContain('ANTHROPIC_API_KEY=[REDACTED]')
    })

    it('should handle null/undefined input', () => {
      expect(sanitizeText(null as unknown as string)).toBe('null')
      expect(sanitizeText(undefined as unknown as string)).toBe('undefined')
    })

    it('should handle non-string input', () => {
      expect(sanitizeText(123 as unknown as string)).toBe('123')
      expect(sanitizeText({} as unknown as string)).toBe('[object Object]')
    })

    it('should preserve safe text', () => {
      const safeText = 'This is a normal log message with no secrets.'
      expect(sanitizeText(safeText)).toBe(safeText)
    })

    it('should handle multiple sensitive patterns in one string', () => {
      const multiSecretText = 'API key sk-ant-abc123 and Bearer token123 found'
      const result = sanitizeText(multiSecretText)
      expect(result).not.toContain('sk-ant-abc123')
      expect(result).toContain('[REDACTED]')
    })
  })
})
