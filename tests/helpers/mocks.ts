/**
 * Test Mocks
 *
 * Mock implementations for testing
 */

import { vi } from 'vitest'

/**
 * Create a mock file system for testing
 */
export interface MockFileSystem {
  files: Map<string, string>
  directories: Set<string>
  symlinks: Map<string, string>
  permissions: Map<string, { read: boolean; write: boolean }>
}

export function createMockFileSystem(): MockFileSystem {
  return {
    files: new Map(),
    directories: new Set(['/home/test', '/home/test/.claudelet', '/home/test/.claudelet/sessions']),
    symlinks: new Map(),
    permissions: new Map()
  }
}

/**
 * Mock fs/promises module
 */
export function createFsMock(mockFs: MockFileSystem) {
  return {
    readFile: vi.fn(async (path: string) => {
      if (mockFs.symlinks.has(path)) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
      const content = mockFs.files.get(path)
      if (content === undefined) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' })
      }
      return content
    }),

    writeFile: vi.fn(async (path: string, content: string) => {
      mockFs.files.set(path, content)
    }),

    unlink: vi.fn(async (path: string) => {
      if (!mockFs.files.has(path)) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, unlink '${path}'`), { code: 'ENOENT' })
      }
      mockFs.files.delete(path)
    }),

    mkdir: vi.fn(async (path: string, options?: { recursive?: boolean }) => {
      mockFs.directories.add(path)
    }),

    readdir: vi.fn(async (path: string) => {
      const entries: string[] = []
      for (const filePath of mockFs.files.keys()) {
        if (filePath.startsWith(path + '/')) {
          const relativePath = filePath.slice(path.length + 1)
          const firstSegment = relativePath.split('/')[0]
          if (!entries.includes(firstSegment)) {
            entries.push(firstSegment)
          }
        }
      }
      return entries
    }),

    chmod: vi.fn(async () => {}),

    access: vi.fn(async (path: string, mode?: number) => {
      const perm = mockFs.permissions.get(path)
      if (perm) {
        if (mode === 4 && !perm.read) throw new Error('EACCES')
        if (mode === 2 && !perm.write) throw new Error('EACCES')
      }
      if (!mockFs.files.has(path) && !mockFs.directories.has(path)) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
    }),

    lstat: vi.fn(async (path: string) => {
      if (mockFs.symlinks.has(path)) {
        return {
          isSymbolicLink: () => true,
          isFile: () => false,
          isDirectory: () => false
        }
      }
      if (mockFs.directories.has(path)) {
        return {
          isSymbolicLink: () => false,
          isFile: () => false,
          isDirectory: () => true
        }
      }
      if (mockFs.files.has(path)) {
        return {
          isSymbolicLink: () => false,
          isFile: () => true,
          isDirectory: () => false
        }
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }),

    stat: vi.fn(async (path: string) => {
      // stat follows symlinks
      let targetPath = path
      if (mockFs.symlinks.has(path)) {
        targetPath = mockFs.symlinks.get(path)!
      }
      if (mockFs.files.has(targetPath)) {
        return {
          isSymbolicLink: () => false,
          isFile: () => true,
          isDirectory: () => false
        }
      }
      if (mockFs.directories.has(targetPath)) {
        return {
          isSymbolicLink: () => false,
          isFile: () => false,
          isDirectory: () => true
        }
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
  }
}

/**
 * Mock console for testing sanitization
 */
export function createConsoleMock() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn()
  }
}

/**
 * Mock os module
 */
export function createOsMock(homedir: string = '/home/test') {
  return {
    homedir: vi.fn(() => homedir)
  }
}
