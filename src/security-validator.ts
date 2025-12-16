/**
 * Security Validator Module
 *
 * Provides centralized security validation and sanitization for:
 * - Clipboard content (ANSI escape sequences, control characters)
 * - Search queries (length limits, catastrophic backtracking detection)
 * - File paths (symlink detection, directory traversal prevention)
 *
 * Implements defense-in-depth approach with multiple validation layers
 * to mitigate clipboard injection, DoS attacks, and symlink attacks.
 */

import * as path from 'path'
import * as fsp from 'fs/promises'

export class SecurityValidator {
  /**
   * Maximum allowed length for clipboard content
   */
  private static readonly MAX_CLIPBOARD_LENGTH = 10000

  /**
   * Maximum allowed length for search queries
   */
  private static readonly MAX_QUERY_LENGTH = 200

  /**
   * Maximum number of results to return from search
   */
  private static readonly MAX_SEARCH_RESULTS = 1000

  /**
   * Timeout for search operations in milliseconds
   */
  private static readonly SEARCH_TIMEOUT_MS = 5000

  /**
   * Check if a pattern contains dangerous regex constructs
   * Returns true if the pattern is likely to cause catastrophic backtracking
   */
  private static isDangerousPattern(query: string): boolean {
    // Nested quantifiers: (a+)+, (.*)+, (a*)*
    if (/\([^)]*[+*][)][+*]/.test(query)) {
      return true
    }

    // Multiple .* patterns (common DoS pattern)
    const dotStarCount = (query.match(/\.\*/g) || []).length
    if (dotStarCount >= 2) {
      return true
    }

    // Pattern with multiple alternating wildcards and quantifiers: a*b*c*d* or x+y+z+
    const quantifierPattern = /[.*+]\*[.*+]|[.*+]\+[.*+]/
    const quantifierMatches = (query.match(quantifierPattern) || []).length
    if (quantifierMatches >= 2) {
      return true
    }

    // Very long quantifier ranges: a{1,1000000}
    if (/\{\s*\d{4,},\s*\d+\s*\}/.test(query)) {
      return true
    }

    return false
  }

  /**
   * Sanitize clipboard content before insertion
   * Strips ANSI escape sequences, control characters, and limits length
   *
   * @param content Raw clipboard content
   * @returns Sanitized content safe for insertion
   * @throws Error if content cannot be sanitized
   *
   * @example
   * const rawContent = '\x1b[31mmalicious\x1b[0m';
   * const safe = SecurityValidator.sanitizeClipboard(rawContent);
   * // Returns: 'malicious'
   */
  static sanitizeClipboard(content: string): string {
    if (!content || typeof content !== 'string') {
      return ''
    }

    let sanitized = content

    // Strip ANSI color codes: \x1b[...m
    sanitized = sanitized.replace(/\x1b\[[0-9;]*m/g, '')

    // Strip terminal title sequences: \x1b]...\x07
    sanitized = sanitized.replace(/\x1b\][^\x07]*\x07/g, '')

    // Strip other terminal escape sequences
    sanitized = sanitized.replace(/\x1b\[.*?[@-Z\\-_`a-z]/g, '')

    // Strip control characters (except tab, newline, carriage return which are common)
    // Range \x00-\x08 (null through backspace)
    // Range \x0B-\x0C (vertical tab, form feed)
    // Range \x0E-\x1F (shift out through unit separator)
    // \x7F (delete)
    sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')

    // Remove null bytes explicitly as they can cause issues
    sanitized = sanitized.replace(/\0/g, '')

    // Limit length to prevent resource exhaustion
    sanitized = sanitized.slice(0, SecurityValidator.MAX_CLIPBOARD_LENGTH)

    return sanitized.trim()
  }

  /**
   * Validate search query for safety
   * Checks length, detects dangerous regex patterns, prevents DoS attacks
   *
   * @param query Search query to validate
   * @throws Error if query fails validation
   *
   * @example
   * SecurityValidator.validateSearchQuery('function myFunc');  // OK
   * SecurityValidator.validateSearchQuery('(a+)+b');  // Throws: catastrophic backtracking
   */
  static validateSearchQuery(query: string): void {
    if (!query || typeof query !== 'string') {
      throw new Error('Query must be a non-empty string')
    }

    // Check length limit
    if (query.length > SecurityValidator.MAX_QUERY_LENGTH) {
      throw new Error(`Query too long (max ${SecurityValidator.MAX_QUERY_LENGTH} chars, got ${query.length})`)
    }

    // Check for dangerous regex patterns using comprehensive pattern detection
    if (SecurityValidator.isDangerousPattern(query)) {
      throw new Error(
        'Query pattern not allowed: detected potential catastrophic backtracking risk'
      )
    }

    // Check for excessive consecutive quantifiers (raw +++++, ****, etc)
    if (/[+*]{2,}/.test(query)) {
      throw new Error('Query pattern not allowed: excessive quantifier sequences')
    }

    // Check for multiple character classes with quantifiers
    if (query.match(/\[.*?\][+*]/g) && (query.match(/\[.*?\][+*]/g) || []).length > 2) {
      throw new Error('Query pattern not allowed: repeated character class quantifiers')
    }
  }

  /**
   * Validate file path for safe operations
   * Prevents symlink attacks and directory traversal
   *
   * @param filePath Path to validate
   * @param baseDir Base directory to restrict operations to
   * @returns Resolved safe path
   * @throws Error if path is unsafe or outside baseDir
   *
   * @example
   * const safe = await SecurityValidator.validateFilePath(
   *   '/project/src/index.ts',
   *   '/project'
   * );
   * // Returns: '/project/src/index.ts'
   *
   * const symlink = await SecurityValidator.validateFilePath(
   *   '/project/.auth -> /etc/passwd',
   *   '/project'
   * );
   * // Throws: Symlink operations not allowed
   */
  static async validateFilePath(filePath: string, baseDir: string): Promise<string> {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('File path must be a non-empty string')
    }

    if (!baseDir || typeof baseDir !== 'string') {
      throw new Error('Base directory must be a non-empty string')
    }

    // Resolve to absolute paths
    const resolvedPath = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(baseDir, filePath)
    const resolvedBaseDir = path.isAbsolute(baseDir) ? path.resolve(baseDir) : path.resolve(baseDir)

    // Verify path is within base directory (prevents directory traversal)
    // Normalize paths to handle . and .. correctly
    const normalizedPath = path.normalize(path.resolve(resolvedPath))
    const normalizedBase = path.normalize(path.resolve(resolvedBaseDir))

    // Ensure base dir ends with separator for accurate prefix checking
    const baseDirWithSeparator = normalizedBase.endsWith(path.sep) ? normalizedBase : normalizedBase + path.sep

    if (!normalizedPath.startsWith(baseDirWithSeparator) && normalizedPath !== normalizedBase) {
      throw new Error(`Path is outside base directory: ${normalizedPath} not in ${normalizedBase}`)
    }

    // Check if file/directory exists before stat check
    try {
      // Use lstat instead of stat to detect symlinks
      // lstat does NOT follow symlinks, while stat does
      const stats = await fsp.lstat(normalizedPath)

      // Reject symlinks to prevent symlink attacks
      if (stats.isSymbolicLink()) {
        throw new Error('Symlink operations not allowed')
      }

      return normalizedPath
    } catch (error) {
      // If file doesn't exist, that's ok for write operations
      // But symlink check failed, or permission denied
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist - check all parent directories are safe
        let checkDir = path.dirname(normalizedPath)

        // Walk up directory tree and check for symlinks
        while (checkDir.length > 1 && checkDir !== path.sep && checkDir !== normalizedBase) {
          try {
            const dirStats = await fsp.lstat(checkDir)
            if (dirStats.isSymbolicLink()) {
              throw new Error('Parent directory contains a symlink - not allowed')
            }
          } catch (err) {
            // If directory doesn't exist, that's ok
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
              if (err instanceof Error && err.message.includes('symlink')) {
                throw err
              }
            }
          }

          checkDir = path.dirname(checkDir)
        }

        return normalizedPath
      }

      // Re-throw other errors (permission denied, etc.)
      if (error instanceof Error && error.message.includes('Symlink operations not allowed')) {
        throw error
      }
      if (error instanceof Error && error.message.includes('outside base directory')) {
        throw error
      }
      if (error instanceof Error && error.message.includes('symlink')) {
        throw error
      }

      throw new Error(`Failed to validate file path: ${(error as Error).message}`)
    }
  }

  /**
   * Validate that a file path is safe for reading
   * Combines validateFilePath with additional read-time checks
   *
   * @param filePath Path to validate for reading
   * @param baseDir Base directory to restrict to
   * @returns Resolved safe path
   * @throws Error if path is unsafe
   */
  static async validateFilePathForRead(filePath: string, baseDir: string): Promise<string> {
    // Standard validation
    const validatedPath = await SecurityValidator.validateFilePath(filePath, baseDir)

    // Additional check: ensure file exists and is readable
    try {
      await fsp.access(validatedPath, 4) // 4 = read permission
      return validatedPath
    } catch {
      throw new Error(`File is not readable: ${validatedPath}`)
    }
  }

  /**
   * Validate that a file path is safe for writing
   * Combines validateFilePath with additional write-time checks
   *
   * @param filePath Path to validate for writing
   * @param baseDir Base directory to restrict to
   * @returns Resolved safe path
   * @throws Error if path is unsafe
   */
  static async validateFilePathForWrite(filePath: string, baseDir: string): Promise<string> {
    // Standard validation (this checks for symlinks and directory traversal)
    const validatedPath = await SecurityValidator.validateFilePath(filePath, baseDir)

    // For write operations, ensure the parent directory is writable
    const parentDir = path.dirname(validatedPath)
    try {
      await fsp.access(parentDir, 2) // 2 = write permission
      return validatedPath
    } catch {
      throw new Error(`Parent directory is not writable: ${parentDir}`)
    }
  }

  /**
   * Get validation error message suitable for user display
   * Redacts sensitive path information
   *
   * @param error Error from validation
   * @returns User-friendly error message
   */
  static getValidationErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      // Don't expose full file paths to users
      const msg = error.message
        .replace(/\/[\w/.-]+/g, '/[path]')
        .replace(/C:[\\][\w\\.-]+/g, 'C:[path]')

      return msg
    }

    return 'Validation error'
  }
}
