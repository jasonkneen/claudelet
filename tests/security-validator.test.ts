/**
 * Tests for Security Validator Module
 *
 * Verifies protection against:
 * - Clipboard injection attacks
 * - Search query DoS attacks
 * - Symlink following attacks
 * - Directory traversal attacks
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fsp from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { SecurityValidator } from '../src/security-validator'

describe('SecurityValidator', () => {
  describe('sanitizeClipboard', () => {
    it('removes ANSI color codes', () => {
      const malicious = '\x1b[31mRED TEXT\x1b[0m'
      const sanitized = SecurityValidator.sanitizeClipboard(malicious)

      expect(sanitized).toBe('RED TEXT')
      expect(sanitized).not.toContain('\x1b')
    })

    it('removes terminal title escape sequences', () => {
      const malicious = '\x1b]0;Evil Title\x07Some Content'
      const sanitized = SecurityValidator.sanitizeClipboard(malicious)

      expect(sanitized).not.toContain('\x1b')
      expect(sanitized).toContain('Some Content')
    })

    it('removes control characters', () => {
      const malicious = 'Hello\x00World\x08\x0BTest'
      const sanitized = SecurityValidator.sanitizeClipboard(malicious)

      expect(sanitized).not.toContain('\x00')
      expect(sanitized).not.toContain('\x08')
      expect(sanitized).not.toContain('\x0B')
      expect(sanitized).toMatch(/HelloWorld/)
    })

    it('removes delete character (DEL)', () => {
      const malicious = 'Normal\x7FContent'
      const sanitized = SecurityValidator.sanitizeClipboard(malicious)

      expect(sanitized).not.toContain('\x7F')
    })

    it('limits content length to prevent resource exhaustion', () => {
      const longContent = 'A'.repeat(20000)
      const sanitized = SecurityValidator.sanitizeClipboard(longContent)

      expect(sanitized.length).toBeLessThanOrEqual(10000)
    })

    it('preserves normal whitespace (tabs, newlines, etc)', () => {
      const content = 'Line 1\nLine 2\tTabbed'
      const sanitized = SecurityValidator.sanitizeClipboard(content)

      expect(sanitized).toContain('\n')
      expect(sanitized).toContain('\t')
    })

    it('handles empty and null input gracefully', () => {
      expect(SecurityValidator.sanitizeClipboard('')).toBe('')
      expect(SecurityValidator.sanitizeClipboard(null as any)).toBe('')
      expect(SecurityValidator.sanitizeClipboard(undefined as any)).toBe('')
    })

    it('sanitizes complex injection attempt', () => {
      const attack =
        '\x1b]0;Evil\x07\x1b[31m\x00INJECT\x1b[0m\x1b[?1049h'
      const sanitized = SecurityValidator.sanitizeClipboard(attack)

      expect(sanitized).not.toContain('\x1b')
      expect(sanitized).not.toContain('\x00')
      expect(sanitized.toLowerCase()).toBe('inject')
    })

    it('trims whitespace from result', () => {
      const content = '  Some content  '
      const sanitized = SecurityValidator.sanitizeClipboard(content)

      expect(sanitized).toBe('Some content')
      expect(sanitized).not.toMatch(/^\s/)
      expect(sanitized).not.toMatch(/\s$/)
    })
  })

  describe('validateSearchQuery', () => {
    it('accepts valid search queries', () => {
      expect(() => SecurityValidator.validateSearchQuery('function myFunc')).not.toThrow()
      expect(() => SecurityValidator.validateSearchQuery('const x = 5')).not.toThrow()
      expect(() => SecurityValidator.validateSearchQuery('import.*from')).not.toThrow()
    })

    it('rejects queries that are too long', () => {
      const longQuery = 'a'.repeat(201)

      expect(() => SecurityValidator.validateSearchQuery(longQuery)).toThrow('Query too long')
    })

    it('rejects nested quantifiers (catastrophic backtracking)', () => {
      const attacks = [
        '(a+)+b',      // Nested +
        '(x*)*y',      // Nested *
        '(.*)+end',    // .* with +
      ]

      for (const attack of attacks) {
        expect(() => SecurityValidator.validateSearchQuery(attack)).toThrow(
          /catastrophic backtracking|not allowed/i
        )
      }
    })

    it('rejects multiple sequential quantifiers', () => {
      const attacks = [
        '.*.*.*',      // Multiple .* - caught by isDangerousPattern
        '(a+)+(b+)+',  // Nested quantifiers - caught by isDangerousPattern
      ]

      for (const attack of attacks) {
        expect(() => SecurityValidator.validateSearchQuery(attack)).toThrow()
      }

      // These patterns with multiple quantifiers can legitimately appear in some searches
      // but we'll accept them since they don't match the nested quantifier patterns
      // The key is to prevent catastrophic backtracking, not all quantifiers
      expect(() => SecurityValidator.validateSearchQuery('a*b*c*')).not.toThrow()
      expect(() => SecurityValidator.validateSearchQuery('x+y+z+')).not.toThrow()
    })

    it('rejects repeated character class quantifiers', () => {
      const attack = '[a-z]*[0-9]*[a-z]*[0-9]*'

      expect(() => SecurityValidator.validateSearchQuery(attack)).toThrow()
    })

    it('rejects excessive quantifier sequences', () => {
      const attack = 'a+++++'  // 5+ quantifiers in sequence

      expect(() => SecurityValidator.validateSearchQuery(attack)).toThrow(
        /quantifier/i
      )
    })

    it('rejects empty queries', () => {
      expect(() => SecurityValidator.validateSearchQuery('')).toThrow('non-empty string')
      expect(() => SecurityValidator.validateSearchQuery(null as any)).toThrow('non-empty string')
    })

    it('accepts legitimate regex patterns', () => {
      const legitimate = [
        'function\\s+\\w+',
        '^import',
        'class\\s+[A-Z]\\w+',
        'const|let|var',
        '\\d{3}-\\d{4}',
      ]

      for (const pattern of legitimate) {
        expect(() => SecurityValidator.validateSearchQuery(pattern)).not.toThrow()
      }
    })
  })

  describe('validateFilePath', () => {
    let testDir: string

    beforeEach(async () => {
      testDir = path.join(os.tmpdir(), `security-test-${Date.now()}`)
      await fsp.mkdir(testDir, { recursive: true })
    })

    afterEach(async () => {
      try {
        await fsp.rm(testDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('accepts valid file paths within base directory', async () => {
      const filePath = path.join(testDir, 'test.txt')
      const validated = await SecurityValidator.validateFilePath(filePath, testDir)

      expect(validated).toBe(path.normalize(filePath))
    })

    it('resolves relative paths correctly', async () => {
      const validated = await SecurityValidator.validateFilePath(
        './test.txt',
        testDir
      )

      expect(validated).toContain('test.txt')
      expect(path.isAbsolute(validated)).toBe(true)
    })

    it('rejects paths outside base directory (directory traversal)', async () => {
      const parentDir = path.dirname(testDir)
      const outsidePath = path.join(parentDir, 'outside.txt')

      await expect(
        SecurityValidator.validateFilePath(outsidePath, testDir)
      ).rejects.toThrow('outside base directory')
    })

    it('rejects symlinks to prevent symlink attacks', async () => {
      const realFile = path.join(testDir, 'real.txt')
      const symlink = path.join(testDir, 'link.txt')

      // Create real file
      await fsp.writeFile(realFile, 'content')

      // Create symlink (if supported)
      try {
        await fsp.symlink(realFile, symlink)

        // Should reject the symlink
        await expect(
          SecurityValidator.validateFilePath(symlink, testDir)
        ).rejects.toThrow('Symlink operations not allowed')
      } catch (err) {
        // Skip on systems that don't support symlinks (Windows)
        if ((err as NodeJS.ErrnoException).code !== 'EPERM') {
          throw err
        }
      }
    })

    it('rejects symlinks in parent directory', async () => {
      const realDir = path.join(testDir, 'realdir')
      const symlink = path.join(testDir, 'linkdir')
      const targetFile = path.join(symlink, 'file.txt')

      await fsp.mkdir(realDir)

      try {
        await fsp.symlink(realDir, symlink)

        await expect(
          SecurityValidator.validateFilePath(targetFile, testDir)
        ).rejects.toThrow(/Symlink|operations not allowed|symlink/)
      } catch (err) {
        // Skip on systems that don't support symlinks
        if ((err as NodeJS.ErrnoException).code !== 'EPERM') {
          throw err
        }
      }
    })

    it('handles non-existent files gracefully', async () => {
      const nonExistent = path.join(testDir, 'nonexistent.txt')

      // Should not throw for non-existent files (write operations need this)
      const validated = await SecurityValidator.validateFilePath(nonExistent, testDir)
      expect(validated).toBe(path.normalize(nonExistent))
    })

    it('rejects empty file paths', async () => {
      await expect(
        SecurityValidator.validateFilePath('', testDir)
      ).rejects.toThrow('non-empty string')
    })

    it('rejects empty base directory', async () => {
      await expect(
        SecurityValidator.validateFilePath('/some/path', '')
      ).rejects.toThrow('Base directory must be')
    })
  })

  describe('validateFilePathForRead', () => {
    let testDir: string
    let testFile: string

    beforeEach(async () => {
      testDir = path.join(os.tmpdir(), `security-read-test-${Date.now()}`)
      await fsp.mkdir(testDir, { recursive: true })
      testFile = path.join(testDir, 'test.txt')
      await fsp.writeFile(testFile, 'test content')
    })

    afterEach(async () => {
      try {
        await fsp.rm(testDir, { recursive: true, force: true })
      } catch {
        // Ignore
      }
    })

    it('accepts readable files within base directory', async () => {
      const validated = await SecurityValidator.validateFilePathForRead(testFile, testDir)
      expect(validated).toBe(path.normalize(testFile))
    })

    it('rejects non-existent files', async () => {
      const nonExistent = path.join(testDir, 'missing.txt')

      await expect(
        SecurityValidator.validateFilePathForRead(nonExistent, testDir)
      ).rejects.toThrow('not readable')
    })

    it('rejects files outside base directory', async () => {
      const parentDir = path.dirname(testDir)
      const outsideFile = path.join(parentDir, 'outside.txt')

      await expect(
        SecurityValidator.validateFilePathForRead(outsideFile, testDir)
      ).rejects.toThrow('outside base directory')
    })
  })

  describe('validateFilePathForWrite', () => {
    let testDir: string

    beforeEach(async () => {
      testDir = path.join(os.tmpdir(), `security-write-test-${Date.now()}`)
      await fsp.mkdir(testDir, { recursive: true })
    })

    afterEach(async () => {
      try {
        await fsp.rm(testDir, { recursive: true, force: true })
      } catch {
        // Ignore
      }
    })

    it('accepts non-existent files in writable directory', async () => {
      const newFile = path.join(testDir, 'new.txt')
      const validated = await SecurityValidator.validateFilePathForWrite(newFile, testDir)
      expect(validated).toBe(path.normalize(newFile))
    })

    it('accepts existing files in writable directory', async () => {
      const existingFile = path.join(testDir, 'existing.txt')
      await fsp.writeFile(existingFile, 'content')

      const validated = await SecurityValidator.validateFilePathForWrite(existingFile, testDir)
      expect(validated).toBe(path.normalize(existingFile))
    })

    it('rejects paths outside base directory', async () => {
      const parentDir = path.dirname(testDir)
      const outsideFile = path.join(parentDir, 'outside.txt')

      await expect(
        SecurityValidator.validateFilePathForWrite(outsideFile, testDir)
      ).rejects.toThrow('outside base directory')
    })
  })

  describe('getValidationErrorMessage', () => {
    it('returns user-friendly error messages', () => {
      const error = new Error('Failed at /home/user/secret/file.txt')
      const msg = SecurityValidator.getValidationErrorMessage(error)

      expect(msg).toContain('Failed at')
      expect(msg).not.toContain('/home/user/secret/file.txt')
      expect(msg).toContain('[path]')
    })

    it('handles non-Error objects', () => {
      const msg = SecurityValidator.getValidationErrorMessage('string error')
      expect(msg).toBe('Validation error')

      const msg2 = SecurityValidator.getValidationErrorMessage(null)
      expect(msg2).toBe('Validation error')
    })

    it('redacts Windows paths', () => {
      const error = new Error('Failed at C:\\Users\\Admin\\secrets.json')
      const msg = SecurityValidator.getValidationErrorMessage(error)

      expect(msg).not.toContain('C:\\Users\\Admin\\secrets.json')
      expect(msg).toContain('[path]')
    })
  })

  describe('integration tests - Attack Scenarios', () => {
    let testDir: string

    beforeEach(async () => {
      testDir = path.join(os.tmpdir(), `security-integration-${Date.now()}`)
      await fsp.mkdir(testDir, { recursive: true })
    })

    afterEach(async () => {
      try {
        await fsp.rm(testDir, { recursive: true, force: true })
      } catch {
        // Ignore
      }
    })

    it('prevents clipboard injection via ANSI sequences', () => {
      const malicious = '\x1b]0;evil\x07\x1b[31m\x00MALICIOUS\x1b[0m'
      const sanitized = SecurityValidator.sanitizeClipboard(malicious)

      // Should be safe to insert
      expect(sanitized).not.toContain('\x1b')
      expect(sanitized).not.toContain('\x00')
    })

    it('prevents DoS via catastrophic backtracking', () => {
      const attacks = [
        '(a+)+b',
        '(.*)+end',
        '(x*)*y',
        'a+++++'
      ]

      for (const attack of attacks) {
        expect(() => SecurityValidator.validateSearchQuery(attack)).toThrow()
      }
    })

    it('prevents DoS via excessive query length', () => {
      const longQuery = 'a'.repeat(300)

      expect(() => SecurityValidator.validateSearchQuery(longQuery)).toThrow(
        'Query too long'
      )
    })

    it('prevents directory traversal attacks', async () => {
      const attacks = [
        '../../../etc/passwd',
        '/etc/passwd',
      ]

      // On non-Unix systems, also test Windows-style attacks
      if (process.platform === 'win32') {
        attacks.push('..\\..\\..\\windows\\system32')
      }

      for (const attack of attacks) {
        await expect(
          SecurityValidator.validateFilePath(attack, testDir)
        ).rejects.toThrow(/outside base directory|not in/)
      }
    })

    it('prevents unauthorized file access via symlinks', async () => {
      // Create two separate directories
      const publicDir = path.join(testDir, 'public')
      const secretDir = path.join(testDir, 'secret')

      await fsp.mkdir(publicDir)
      await fsp.mkdir(secretDir)

      const secretFile = path.join(secretDir, 'secret.txt')
      await fsp.writeFile(secretFile, 'SECRET DATA')

      // Try to create symlink in public dir pointing to secret
      const symlink = path.join(publicDir, 'link.txt')

      try {
        await fsp.symlink(secretFile, symlink)

        // Should reject accessing via symlink
        await expect(
          SecurityValidator.validateFilePath(symlink, publicDir)
        ).rejects.toThrow('Symlink operations not allowed')
      } catch (err) {
        // Skip on systems without symlink support
        if ((err as NodeJS.ErrnoException).code !== 'EPERM') {
          throw err
        }
      }
    })
  })
})
