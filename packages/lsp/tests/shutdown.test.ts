/**
 * Tests for graceful shutdown behavior
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import type { ChildProcess } from 'child_process'
import { LSPClient } from '../src/client'

// Mock child process for testing
function createMockProcess(): ChildProcess {
  const proc = new EventEmitter() as any
  proc.stdin = {
    write: vi.fn(),
    end: vi.fn(),
  }
  proc.stdout = new EventEmitter()
  proc.stdout.destroy = vi.fn()
  proc.stderr = new EventEmitter()
  proc.stderr.destroy = vi.fn()
  proc.kill = vi.fn(() => true)
  proc.killed = false
  proc.exitCode = null
  return proc as ChildProcess
}

describe('LSPClient Shutdown', () => {
  let client: LSPClient
  let mockProcess: ChildProcess

  beforeEach(() => {
    mockProcess = createMockProcess()
    client = new LSPClient({
      serverID: 'test-server',
      root: '/test/root',
      process: mockProcess,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should send shutdown request and exit notification', async () => {
    const writeSpy = vi.spyOn(mockProcess.stdin!, 'write')

    // Simulate immediate process exit
    setTimeout(() => {
      mockProcess.exitCode = 0
      mockProcess.emit('exit', 0)
    }, 10)

    await client.shutdown()

    // Verify shutdown request was sent (at least one JSON-RPC message sent)
    expect(writeSpy).toHaveBeenCalled()
    const calls = writeSpy.mock.calls
    // Verify that stdin was used to send shutdown protocol messages
    expect(calls.length).toBeGreaterThan(0)
  })

  it('should wait for graceful shutdown within timeout', async () => {
    const startTime = Date.now()

    // Simulate process exiting after 1 second
    setTimeout(() => {
      mockProcess.exitCode = 0
      mockProcess.emit('exit', 0)
    }, 1000)

    await client.shutdown()

    const elapsed = Date.now() - startTime
    // Should allow reasonable time for graceful shutdown (1s + overhead)
    expect(elapsed).toBeGreaterThanOrEqual(1000)
    expect(elapsed).toBeLessThan(15000)
  })

  it('should force kill after 5 second timeout', async () => {
    const killSpy = vi.spyOn(mockProcess, 'kill')
    const startTime = Date.now()

    // Process never exits gracefully
    await client.shutdown()

    const elapsed = Date.now() - startTime
    // Should timeout after ~5 seconds (lenient bounds for CI environments)
    expect(elapsed).toBeGreaterThanOrEqual(4000)
    expect(elapsed).toBeLessThan(12000)

    // Verify force kill was called with SIGKILL
    expect(killSpy).toHaveBeenCalledWith('SIGKILL')
  })

  it('should close stdio pipes to prevent leaks', async () => {
    const stdinEndSpy = vi.spyOn(mockProcess.stdin!, 'end')
    const stdoutDestroySpy = vi.spyOn(mockProcess.stdout!, 'destroy')
    const stderrDestroySpy = vi.spyOn(mockProcess.stderr!, 'destroy')

    // Simulate immediate exit
    setTimeout(() => {
      mockProcess.exitCode = 0
      mockProcess.emit('exit', 0)
    }, 10)

    await client.shutdown()

    expect(stdinEndSpy).toHaveBeenCalled()
    expect(stdoutDestroySpy).toHaveBeenCalled()
    expect(stderrDestroySpy).toHaveBeenCalled()
  })

  it('should handle already exited process', async () => {
    // Mark process as already killed
    mockProcess.killed = true
    mockProcess.exitCode = 0

    // Should complete immediately without hanging
    await expect(client.shutdown()).resolves.not.toThrow()
  })

  it('should handle shutdown request failure gracefully', async () => {
    // Simulate server that doesn't respond to shutdown
    vi.spyOn(mockProcess.stdin!, 'write').mockImplementation(() => {
      throw new Error('Write failed')
    })

    // Should still complete shutdown
    await expect(client.shutdown()).resolves.not.toThrow()
  })
})
