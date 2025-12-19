/**
 * Tests for auth-storage module
 *
 * These tests mock the file system to avoid actual disk operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sampleApiKeyAuth, sampleOAuthAuth } from '../helpers/fixtures'

// Mock fs/promises and security-validator
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  chmod: vi.fn(),
  unlink: vi.fn()
}))

vi.mock('../../src/security-validator', () => ({
  SecurityValidator: {
    validateFilePathForRead: vi.fn((path: string) => Promise.resolve(path)),
    validateFilePathForWrite: vi.fn((path: string) => Promise.resolve(path)),
    validateFilePath: vi.fn((path: string) => Promise.resolve(path))
  }
}))

vi.mock('../../src/env-sanitizer', () => ({
  sanitizeText: vi.fn((text: string) => text)
}))

import * as fsp from 'fs/promises'
import { loadAuth, saveAuth, clearAuth, type StoredAuth } from '../../src/auth-storage'

describe('auth-storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('loadAuth', () => {
    it('should load and parse stored API key auth', async () => {
      vi.mocked(fsp.readFile).mockResolvedValue(JSON.stringify(sampleApiKeyAuth))

      const result = await loadAuth()

      expect(result).toEqual(sampleApiKeyAuth)
      expect(fsp.readFile).toHaveBeenCalled()
    })

    it('should load and parse stored OAuth auth', async () => {
      vi.mocked(fsp.readFile).mockResolvedValue(JSON.stringify(sampleOAuthAuth))

      const result = await loadAuth()

      expect(result).toEqual(sampleOAuthAuth)
    })

    it('should return null when file does not exist', async () => {
      vi.mocked(fsp.readFile).mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      )

      const result = await loadAuth()

      expect(result).toBeNull()
    })

    it('should log error and return null for other errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(fsp.readFile).mockRejectedValue(new Error('Permission denied'))

      const result = await loadAuth()

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('should handle invalid JSON gracefully', async () => {
      vi.mocked(fsp.readFile).mockResolvedValue('not valid json')
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await loadAuth()

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('saveAuth', () => {
    it('should save API key auth to file', async () => {
      vi.mocked(fsp.writeFile).mockResolvedValue(undefined)
      vi.mocked(fsp.chmod).mockResolvedValue(undefined)

      await saveAuth(sampleApiKeyAuth)

      expect(fsp.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type": "api-key"'),
        'utf8'
      )
    })

    it('should save OAuth auth to file', async () => {
      vi.mocked(fsp.writeFile).mockResolvedValue(undefined)
      vi.mocked(fsp.chmod).mockResolvedValue(undefined)

      await saveAuth(sampleOAuthAuth)

      expect(fsp.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"type": "oauth"'),
        'utf8'
      )
    })

    it('should set file permissions to 0600', async () => {
      vi.mocked(fsp.writeFile).mockResolvedValue(undefined)
      vi.mocked(fsp.chmod).mockResolvedValue(undefined)

      await saveAuth(sampleApiKeyAuth)

      expect(fsp.chmod).toHaveBeenCalledWith(expect.any(String), 0o600)
    })

    it('should log error on write failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(fsp.writeFile).mockRejectedValue(new Error('Disk full'))

      await saveAuth(sampleApiKeyAuth)

      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('clearAuth', () => {
    it('should delete the auth file', async () => {
      vi.mocked(fsp.unlink).mockResolvedValue(undefined)

      await clearAuth()

      expect(fsp.unlink).toHaveBeenCalled()
    })

    it('should not log error when file does not exist', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(fsp.unlink).mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      )

      await clearAuth()

      expect(consoleSpy).not.toHaveBeenCalled()
    })

    it('should log error for other unlink errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(fsp.unlink).mockRejectedValue(new Error('Permission denied'))

      await clearAuth()

      expect(consoleSpy).toHaveBeenCalled()
    })
  })
})
