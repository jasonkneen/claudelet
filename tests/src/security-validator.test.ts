/**
 * Tests for security-validator module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SecurityValidator } from '../../src/security-validator'

// Mock fs/promises
vi.mock('fs/promises', async () => {
  return {
    lstat: vi.fn(),
    access: vi.fn()
  }
})

import * as fsp from 'fs/promises'

describe('SecurityValidator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('sanitizeClipboard', () => {
    it('should strip ANSI color codes', () => {
      const input = '\x1b[31mred text\x1b[0m'
      const result = SecurityValidator.sanitizeClipboard(input)
      expect(result).toBe('red text')
    })

    it('should strip terminal title sequences', () => {
      const input = '\x1b]0;window title\x07normal text'
      const result = SecurityValidator.sanitizeClipboard(input)
      expect(result).toBe('normal text')
    })

    it('should strip control characters except tab/newline', () => {
      const input = 'hello\x00world\x07bell'
      const result = SecurityValidator.sanitizeClipboard(input)
      expect(result).not.toContain('\x00')
      expect(result).not.toContain('\x07')
    })

    it('should preserve tabs and newlines', () => {
      const input = 'line1\nline2\tindented'
      const result = SecurityValidator.sanitizeClipboard(input)
      expect(result).toContain('\n')
      expect(result).toContain('\t')
    })

    it('should limit length to MAX_CLIPBOARD_LENGTH', () => {
      const input = 'x'.repeat(20000)
      const result = SecurityValidator.sanitizeClipboard(input)
      expect(result.length).toBeLessThanOrEqual(10000)
    })

    it('should handle empty input', () => {
      expect(SecurityValidator.sanitizeClipboard('')).toBe('')
      expect(SecurityValidator.sanitizeClipboard(null as unknown as string)).toBe('')
      expect(SecurityValidator.sanitizeClipboard(undefined as unknown as string)).toBe('')
    })

    it('should trim whitespace', () => {
      const input = '  content  '
      expect(SecurityValidator.sanitizeClipboard(input)).toBe('content')
    })
  })

  describe('validateSearchQuery', () => {
    it('should accept normal search queries', () => {
      expect(() => SecurityValidator.validateSearchQuery('function myFunc')).not.toThrow()
      expect(() => SecurityValidator.validateSearchQuery('class User')).not.toThrow()
      expect(() => SecurityValidator.validateSearchQuery('import { x } from')).not.toThrow()
    })

    it('should reject empty queries', () => {
      expect(() => SecurityValidator.validateSearchQuery('')).toThrow('non-empty string')
      expect(() => SecurityValidator.validateSearchQuery(null as unknown as string)).toThrow()
    })

    it('should reject queries exceeding max length', () => {
      const longQuery = 'x'.repeat(250)
      expect(() => SecurityValidator.validateSearchQuery(longQuery)).toThrow('too long')
    })

    it('should reject nested quantifiers (catastrophic backtracking)', () => {
      expect(() => SecurityValidator.validateSearchQuery('(a+)+')).toThrow('catastrophic backtracking')
      expect(() => SecurityValidator.validateSearchQuery('(.*)*')).toThrow('catastrophic backtracking')
    })

    it('should reject multiple .* patterns', () => {
      expect(() => SecurityValidator.validateSearchQuery('.*foo.*')).toThrow()
    })

    it('should reject excessive quantifier sequences', () => {
      expect(() => SecurityValidator.validateSearchQuery('a+++')).toThrow('excessive quantifier')
      expect(() => SecurityValidator.validateSearchQuery('x***')).toThrow('excessive quantifier')
    })

    it('should reject large quantifier ranges', () => {
      expect(() => SecurityValidator.validateSearchQuery('a{1000,1000000}')).toThrow()
    })
  })

  describe('validateFilePath', () => {
    beforeEach(() => {
      // Default: file exists and is not a symlink
      vi.mocked(fsp.lstat).mockResolvedValue({
        isSymbolicLink: () => false,
        isFile: () => true,
        isDirectory: () => false
      } as unknown as Awaited<ReturnType<typeof fsp.lstat>>)
    })

    it('should accept valid paths within base directory', async () => {
      const result = await SecurityValidator.validateFilePath(
        '/project/src/index.ts',
        '/project'
      )
      expect(result).toBe('/project/src/index.ts')
    })

    it('should reject empty paths', async () => {
      await expect(SecurityValidator.validateFilePath('', '/project')).rejects.toThrow('non-empty string')
    })

    it('should reject paths outside base directory', async () => {
      await expect(
        SecurityValidator.validateFilePath('/etc/passwd', '/project')
      ).rejects.toThrow('outside base directory')
    })

    it('should reject directory traversal attempts', async () => {
      await expect(
        SecurityValidator.validateFilePath('/project/../etc/passwd', '/project')
      ).rejects.toThrow('outside base directory')
    })

    it('should reject symlinks', async () => {
      vi.mocked(fsp.lstat).mockResolvedValue({
        isSymbolicLink: () => true,
        isFile: () => false,
        isDirectory: () => false
      } as unknown as Awaited<ReturnType<typeof fsp.lstat>>)

      await expect(
        SecurityValidator.validateFilePath('/project/symlink', '/project')
      ).rejects.toThrow('Symlink operations not allowed')
    })

    it('should allow non-existent files for write operations', async () => {
      vi.mocked(fsp.lstat).mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      )

      const result = await SecurityValidator.validateFilePath(
        '/project/new-file.ts',
        '/project'
      )
      expect(result).toBe('/project/new-file.ts')
    })

    it('should reject symlinks in parent directories', async () => {
      // First call for the file fails (doesn't exist)
      // Second call for parent dir shows it's a symlink
      vi.mocked(fsp.lstat)
        .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
        .mockResolvedValueOnce({
          isSymbolicLink: () => true,
          isFile: () => false,
          isDirectory: () => true
        } as unknown as Awaited<ReturnType<typeof fsp.lstat>>)

      await expect(
        SecurityValidator.validateFilePath('/project/subdir/file.ts', '/project')
      ).rejects.toThrow('symlink')
    })
  })

  describe('validateFilePathForRead', () => {
    beforeEach(() => {
      vi.mocked(fsp.lstat).mockResolvedValue({
        isSymbolicLink: () => false,
        isFile: () => true,
        isDirectory: () => false
      } as unknown as Awaited<ReturnType<typeof fsp.lstat>>)
      vi.mocked(fsp.access).mockResolvedValue(undefined)
    })

    it('should validate read permission', async () => {
      const result = await SecurityValidator.validateFilePathForRead(
        '/project/file.ts',
        '/project'
      )
      expect(result).toBe('/project/file.ts')
      expect(fsp.access).toHaveBeenCalledWith('/project/file.ts', 4)
    })

    it('should reject unreadable files', async () => {
      vi.mocked(fsp.access).mockRejectedValue(new Error('EACCES'))

      await expect(
        SecurityValidator.validateFilePathForRead('/project/file.ts', '/project')
      ).rejects.toThrow('not readable')
    })
  })

  describe('validateFilePathForWrite', () => {
    beforeEach(() => {
      vi.mocked(fsp.lstat).mockResolvedValue({
        isSymbolicLink: () => false,
        isFile: () => true,
        isDirectory: () => false
      } as unknown as Awaited<ReturnType<typeof fsp.lstat>>)
      vi.mocked(fsp.access).mockResolvedValue(undefined)
    })

    it('should validate write permission on parent directory', async () => {
      const result = await SecurityValidator.validateFilePathForWrite(
        '/project/file.ts',
        '/project'
      )
      expect(result).toBe('/project/file.ts')
      expect(fsp.access).toHaveBeenCalledWith('/project', 2)
    })

    it('should reject when parent is not writable', async () => {
      vi.mocked(fsp.access).mockRejectedValue(new Error('EACCES'))

      await expect(
        SecurityValidator.validateFilePathForWrite('/project/file.ts', '/project')
      ).rejects.toThrow('not writable')
    })
  })

  describe('getValidationErrorMessage', () => {
    it('should redact file paths in error messages', () => {
      const error = new Error('Failed to read /home/user/secret/file.txt')
      const message = SecurityValidator.getValidationErrorMessage(error)
      expect(message).not.toContain('/home/user/secret/file.txt')
      expect(message).toContain('/[path]')
    })

    it('should handle non-Error input', () => {
      expect(SecurityValidator.getValidationErrorMessage('string error')).toBe('Validation error')
      expect(SecurityValidator.getValidationErrorMessage(null)).toBe('Validation error')
    })
  })
})
