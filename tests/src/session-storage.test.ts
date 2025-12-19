/**
 * Tests for session-storage module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSessionData } from '../helpers/fixtures'

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  unlink: vi.fn()
}))

// Mock security-validator
vi.mock('../../src/security-validator', () => ({
  SecurityValidator: {
    validateFilePathForRead: vi.fn((path: string) => Promise.resolve(path)),
    validateFilePathForWrite: vi.fn((path: string) => Promise.resolve(path)),
    validateFilePath: vi.fn((path: string) => Promise.resolve(path))
  }
}))

import * as fsp from 'fs/promises'
import {
  getSessionsDir,
  ensureSessionsDir,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  createSessionData as createSessionDataFn,
  getActiveSessions,
  completeSession,
  type SessionData
} from '../../src/session-storage'

describe('session-storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fsp.mkdir).mockResolvedValue(undefined)
    vi.mocked(fsp.writeFile).mockResolvedValue(undefined)
    vi.mocked(fsp.readdir).mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getSessionsDir', () => {
    it('should return path in home directory', () => {
      const dir = getSessionsDir()
      expect(dir).toContain('.claudelet')
      expect(dir).toContain('sessions')
    })
  })

  describe('ensureSessionsDir', () => {
    it('should create sessions directory', async () => {
      await ensureSessionsDir()
      expect(fsp.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('sessions'),
        { recursive: true }
      )
    })
  })

  describe('saveSession', () => {
    it('should save session to file', async () => {
      const session = createSessionData()

      await saveSession(session)

      expect(fsp.mkdir).toHaveBeenCalled()
      expect(fsp.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.json'),
        expect.stringContaining(session.sessionId)
      )
    })

    it('should update updatedAt timestamp', async () => {
      const session = createSessionData()
      const originalUpdatedAt = session.updatedAt

      // Wait a tiny bit to ensure time difference
      await new Promise(r => setTimeout(r, 10))
      await saveSession(session)

      expect(session.updatedAt).not.toBe(originalUpdatedAt)
    })

    it('should return file path', async () => {
      const session = createSessionData()

      const result = await saveSession(session)

      expect(result).toContain('.json')
    })
  })

  describe('loadSession', () => {
    it('should load session from file', async () => {
      const session = createSessionData()
      vi.mocked(fsp.readFile).mockResolvedValue(JSON.stringify(session))

      const result = await loadSession('/path/to/session.json')

      expect(result).toEqual(session)
    })

    it('should return null for non-existent file', async () => {
      vi.mocked(fsp.readFile).mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      )

      const result = await loadSession('/path/to/missing.json')

      expect(result).toBeNull()
    })

    it('should return null for invalid JSON', async () => {
      vi.mocked(fsp.readFile).mockResolvedValue('not valid json')

      const result = await loadSession('/path/to/session.json')

      expect(result).toBeNull()
    })
  })

  describe('listSessions', () => {
    it('should return empty array when no sessions', async () => {
      vi.mocked(fsp.readdir).mockResolvedValue([])

      const result = await listSessions()

      expect(result).toEqual([])
    })

    it('should list session summaries', async () => {
      const session = createSessionData({
        messages: [{ role: 'user', content: 'Hello world', timestamp: new Date().toISOString() }]
      })

      vi.mocked(fsp.readdir).mockResolvedValue(['session.json'] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)
      vi.mocked(fsp.readFile).mockResolvedValue(JSON.stringify(session))

      const result = await listSessions()

      expect(result.length).toBe(1)
      expect(result[0].sessionId).toBe(session.sessionId)
      expect(result[0].preview).toContain('Hello')
    })

    it('should sort by updatedAt descending', async () => {
      const session1 = createSessionData({ updatedAt: '2024-01-01T00:00:00Z' })
      const session2 = createSessionData({ updatedAt: '2024-01-02T00:00:00Z' })

      vi.mocked(fsp.readdir).mockResolvedValue(['s1.json', 's2.json'] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)
      vi.mocked(fsp.readFile)
        .mockResolvedValueOnce(JSON.stringify(session1))
        .mockResolvedValueOnce(JSON.stringify(session2))

      const result = await listSessions()

      expect(result[0].updatedAt).toBe('2024-01-02T00:00:00Z')
    })

    it('should skip non-JSON files', async () => {
      vi.mocked(fsp.readdir).mockResolvedValue(['readme.txt', 'session.json'] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)
      vi.mocked(fsp.readFile).mockResolvedValue(JSON.stringify(createSessionData()))

      const result = await listSessions()

      expect(result.length).toBe(1)
    })

    it('should skip invalid session files', async () => {
      vi.mocked(fsp.readdir).mockResolvedValue(['invalid.json', 'valid.json'] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)
      vi.mocked(fsp.readFile)
        .mockResolvedValueOnce('not json')
        .mockResolvedValueOnce(JSON.stringify(createSessionData()))

      const result = await listSessions()

      expect(result.length).toBe(1)
    })
  })

  describe('deleteSession', () => {
    it('should delete session file', async () => {
      vi.mocked(fsp.unlink).mockResolvedValue(undefined)

      const result = await deleteSession('/path/to/session.json')

      expect(result).toBe(true)
      expect(fsp.unlink).toHaveBeenCalled()
    })

    it('should return false on delete error', async () => {
      vi.mocked(fsp.unlink).mockRejectedValue(new Error('Permission denied'))

      const result = await deleteSession('/path/to/session.json')

      expect(result).toBe(false)
    })
  })

  describe('createSessionData', () => {
    it('should create session with required fields', () => {
      const session = createSessionDataFn('test-id', 'claude-sonnet-4-20250514')

      expect(session.sessionId).toBe('test-id')
      expect(session.model).toBe('claude-sonnet-4-20250514')
      expect(session.messages).toEqual([])
      expect(session.inputTokens).toBe(0)
      expect(session.outputTokens).toBe(0)
      expect(session.status).toBe('active')
    })

    it('should set timestamps to now', () => {
      const before = new Date().toISOString()
      const session = createSessionDataFn('test-id', 'claude-sonnet-4-20250514')
      const after = new Date().toISOString()

      expect(session.createdAt >= before).toBe(true)
      expect(session.createdAt <= after).toBe(true)
      expect(session.updatedAt).toBe(session.createdAt)
    })
  })

  describe('getActiveSessions', () => {
    it('should filter to active sessions only', async () => {
      const active = createSessionData({ status: 'active' })
      const completed = createSessionData({ status: 'completed' })

      vi.mocked(fsp.readdir).mockResolvedValue(['a.json', 'c.json'] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)
      vi.mocked(fsp.readFile)
        .mockResolvedValueOnce(JSON.stringify(active))
        .mockResolvedValueOnce(JSON.stringify(completed))

      const result = await getActiveSessions()

      expect(result.length).toBe(1)
      expect(result[0].status).toBe('active')
    })

    it('should filter by working directory when provided', async () => {
      const session1 = createSessionData({ status: 'active', workingDirectory: '/project-a' })
      const session2 = createSessionData({ status: 'active', workingDirectory: '/project-b' })

      vi.mocked(fsp.readdir).mockResolvedValue(['s1.json', 's2.json'] as unknown as Awaited<ReturnType<typeof fsp.readdir>>)
      vi.mocked(fsp.readFile)
        .mockResolvedValueOnce(JSON.stringify(session1))
        .mockResolvedValueOnce(JSON.stringify(session2))

      const result = await getActiveSessions('/project-a')

      expect(result.length).toBe(1)
      expect(result[0].workingDirectory).toBe('/project-a')
    })
  })

  describe('completeSession', () => {
    it('should mark session as completed and save', async () => {
      const session = createSessionData({ status: 'active' })

      await completeSession(session)

      expect(session.status).toBe('completed')
      expect(fsp.writeFile).toHaveBeenCalled()
    })
  })
})
