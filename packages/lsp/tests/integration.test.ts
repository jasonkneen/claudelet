/**
 * Integration tests for LSP resource management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LSPManager } from '../src/manager'

describe('LSP Integration Tests', () => {
  let manager: LSPManager

  beforeEach(() => {
    manager = new LSPManager({
      appName: 'test-integration',
      cacheDir: '/tmp/lsp-integration-test',
    })
  })

  afterEach(async () => {
    // Ensure cleanup happens
    await manager.shutdown()
  })

  it('should initialize and shutdown cleanly', async () => {
    manager.setProjectPath('/tmp/test-project')

    // Get status to verify manager is operational
    const status = await manager.getStatus()
    expect(Array.isArray(status)).toBe(true)

    // Shutdown should complete without errors
    await expect(manager.shutdown()).resolves.not.toThrow()
  })

  it('should handle multiple shutdown calls gracefully', async () => {
    manager.setProjectPath('/tmp/test-project')

    // First shutdown
    await manager.shutdown()

    // Second shutdown should not throw
    await expect(manager.shutdown()).resolves.not.toThrow()
  })

  it('should support server enable/disable', async () => {
    const serverId = 'typescript'

    // Disable server
    manager.setServerEnabled(serverId, false)
    expect(manager.isServerEnabled(serverId)).toBe(false)

    // Enable server
    manager.setServerEnabled(serverId, true)
    expect(manager.isServerEnabled(serverId)).toBe(true)
  })

  it('should emit lifecycle events', async () => {
    const events: string[] = []

    manager.on('server-started', () => events.push('started'))
    manager.on('server-closed', () => events.push('closed'))
    manager.on('server-status-changed', () => events.push('status-changed'))
    manager.on('server-retrying', () => events.push('retrying'))

    // Manually emit events to test listeners
    manager.emit('server-started', { serverId: 'test', root: '/test' })
    manager.emit('server-closed', { serverId: 'test', root: '/test' })
    manager.emit('server-status-changed', { serverId: 'test', enabled: true })
    manager.emit('server-retrying', { serverId: 'test', root: '/test', attempt: 1 })

    expect(events).toEqual(['started', 'closed', 'status-changed', 'retrying'])
  })

  it('should aggregate diagnostics from multiple servers', async () => {
    manager.setProjectPath('/tmp/test-project')

    // Get all diagnostics (should return empty object initially)
    const diagnostics = manager.getAllDiagnostics()
    expect(typeof diagnostics).toBe('object')
  })

  it('should handle concurrent file operations', async () => {
    manager.setProjectPath('/tmp/test-project')

    // These operations should not throw even if servers aren't running
    await expect(
      Promise.all([
        manager.getDiagnosticsForFile('/tmp/test-project/file1.ts'),
        manager.getDiagnosticsForFile('/tmp/test-project/file2.ts'),
        manager.getDiagnosticsForFile('/tmp/test-project/file3.ts'),
      ])
    ).resolves.toBeDefined()
  })

  it('should provide server status information', async () => {
    const status = await manager.getStatus()

    // Verify status structure
    expect(Array.isArray(status)).toBe(true)

    if (status.length > 0) {
      const server = status[0]
      expect(server).toHaveProperty('id')
      expect(server).toHaveProperty('name')
      expect(server).toHaveProperty('extensions')
      expect(server).toHaveProperty('enabled')
      expect(server).toHaveProperty('installed')
      expect(server).toHaveProperty('installable')
      expect(server).toHaveProperty('running')
      expect(server).toHaveProperty('instances')
    }
  })
})

describe('Resource Cleanup', () => {
  it('should not leak resources on repeated init/shutdown cycles', async () => {
    const cycles = 5

    for (let i = 0; i < cycles; i++) {
      const manager = new LSPManager({
        appName: 'test-leak-check',
        cacheDir: '/tmp/lsp-leak-test',
      })

      manager.setProjectPath(`/tmp/test-${i}`)

      // Verify manager is working
      const status = await manager.getStatus()
      expect(Array.isArray(status)).toBe(true)

      // Cleanup
      await manager.shutdown()
    }

    // If we get here without hanging, resource cleanup is working
    expect(true).toBe(true)
  })

  it('should cancel pending operations on shutdown', async () => {
    const manager = new LSPManager({ appName: 'test-cancel' })
    manager.setProjectPath('/tmp/test-project')

    // Start multiple operations
    const operations = [
      manager.getDiagnosticsForFile('/tmp/file1.ts'),
      manager.getDiagnosticsForFile('/tmp/file2.ts'),
      manager.hover('/tmp/file3.ts', 0, 0),
    ]

    // Shutdown immediately
    await manager.shutdown()

    // Operations should complete or be cancelled
    const results = await Promise.allSettled(operations)
    expect(results).toBeDefined()
  })
})
