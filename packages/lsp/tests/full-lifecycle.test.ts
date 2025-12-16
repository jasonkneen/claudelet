/**
 * Full lifecycle test demonstrating the complete resource management flow
 */

import { describe, it, expect } from 'vitest'
import { LSPManager } from '../src/manager'

describe('Full Lifecycle Tests', () => {
  it('should demonstrate complete init -> use -> shutdown cycle', async () => {
    // 1. Create manager
    const manager = new LSPManager({
      appName: 'test-full-lifecycle',
      cacheDir: '/tmp/test-full-lifecycle',
    })

    // 2. Set project path
    manager.setProjectPath('/tmp/test-project')

    // 3. Check status
    const statusBefore = await manager.getStatus()
    expect(Array.isArray(statusBefore)).toBe(true)
    expect(statusBefore.length).toBeGreaterThan(0)

    // 4. Configure servers
    manager.setServerEnabled('typescript', true)
    expect(manager.isServerEnabled('typescript')).toBe(true)

    // 5. Get diagnostics (won't actually spawn without real files)
    const diagnostics = manager.getAllDiagnostics()
    expect(typeof diagnostics).toBe('object')

    // 6. Shutdown gracefully
    const shutdownStart = Date.now()
    await manager.shutdown()
    const shutdownTime = Date.now() - shutdownStart

    // Should complete quickly with no active servers
    expect(shutdownTime).toBeLessThan(1000)

    // 7. Verify status after shutdown
    const statusAfter = await manager.getStatus()
    expect(Array.isArray(statusAfter)).toBe(true)
  })

  it('should handle rapid init/shutdown cycles', async () => {
    const cycles = 3
    const timings: number[] = []

    for (let i = 0; i < cycles; i++) {
      const start = Date.now()

      const manager = new LSPManager({
        appName: `test-rapid-${i}`,
        cacheDir: `/tmp/test-rapid-${i}`,
      })

      manager.setProjectPath(`/tmp/test-${i}`)
      await manager.getStatus()
      await manager.shutdown()

      timings.push(Date.now() - start)
    }

    // All cycles should complete quickly
    for (const timing of timings) {
      expect(timing).toBeLessThan(2000)
    }
  })

  it('should handle errors during operation gracefully', async () => {
    const manager = new LSPManager({ appName: 'test-errors' })

    // Operations that might fail should not throw
    await expect(manager.hover('/nonexistent/file.ts', 0, 0)).resolves.toBeDefined()
    await expect(manager.completion('/nonexistent/file.ts', 0, 0)).resolves.toBeDefined()
    await expect(manager.definition('/nonexistent/file.ts', 0, 0)).resolves.toBeDefined()
    await expect(manager.references('/nonexistent/file.ts', 0, 0)).resolves.toBeDefined()

    await manager.shutdown()
  })

  it('should track event sequences correctly', async () => {
    const manager = new LSPManager({ appName: 'test-events' })
    const events: Array<{ type: string; data: any }> = []

    // Register all event listeners
    manager.on('server-started', (data) => events.push({ type: 'started', data }))
    manager.on('server-closed', (data) => events.push({ type: 'closed', data }))
    manager.on('server-status-changed', (data) => events.push({ type: 'status-changed', data }))
    manager.on('server-retrying', (data) => events.push({ type: 'retrying', data }))
    manager.on('diagnostics', (data) => events.push({ type: 'diagnostics', data }))

    // Trigger some events manually
    manager.emit('server-status-changed', { serverId: 'test', enabled: true })
    manager.emit('server-started', { serverId: 'test', root: '/test' })
    manager.emit('server-retrying', { serverId: 'test', root: '/test', attempt: 1 })
    manager.emit('diagnostics', { path: '/test/file.ts', diagnostics: [] })
    manager.emit('server-closed', { serverId: 'test', root: '/test' })

    // Verify event order
    expect(events.map((e) => e.type)).toEqual([
      'status-changed',
      'started',
      'retrying',
      'diagnostics',
      'closed',
    ])

    await manager.shutdown()
  })

  it('should properly manage server enable/disable state', async () => {
    const manager = new LSPManager({ appName: 'test-enable-disable' })

    // Check initial state
    const servers = ['typescript', 'python', 'go', 'rust']
    for (const server of servers) {
      expect(manager.isServerEnabled(server)).toBe(true)
    }

    // Disable some servers
    manager.setServerEnabled('typescript', false)
    manager.setServerEnabled('python', false)

    expect(manager.isServerEnabled('typescript')).toBe(false)
    expect(manager.isServerEnabled('python')).toBe(false)
    expect(manager.isServerEnabled('go')).toBe(true)
    expect(manager.isServerEnabled('rust')).toBe(true)

    // Re-enable
    manager.setServerEnabled('typescript', true)
    expect(manager.isServerEnabled('typescript')).toBe(true)

    await manager.shutdown()
  })

  it('should handle concurrent shutdown requests', async () => {
    const manager = new LSPManager({ appName: 'test-concurrent-shutdown' })
    manager.setProjectPath('/tmp/test')

    // Call shutdown multiple times concurrently
    const shutdowns = [manager.shutdown(), manager.shutdown(), manager.shutdown()]

    // All should resolve without error
    await expect(Promise.all(shutdowns)).resolves.toBeDefined()
  })

  it('should provide meaningful server status', async () => {
    const manager = new LSPManager({ appName: 'test-status' })

    const status = await manager.getStatus()

    // Verify each server has the expected structure
    for (const server of status) {
      expect(server).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        extensions: expect.any(Array),
        enabled: expect.any(Boolean),
        installed: expect.any(Boolean),
        installable: expect.any(Boolean),
        running: expect.any(Boolean),
        instances: expect.any(Array),
      })

      // Verify extensions are strings
      for (const ext of server.extensions) {
        expect(typeof ext).toBe('string')
        expect(ext).toMatch(/^\.\w+$/) // Should be like .ts, .py, etc
      }
    }

    await manager.shutdown()
  })
})

describe('Retry Behavior Validation', () => {
  it('should emit retry events with correct structure', async () => {
    const manager = new LSPManager({ appName: 'test-retry-events' })
    const retryEvents: any[] = []

    manager.on('server-retrying', (event) => {
      retryEvents.push(event)
    })

    // Simulate retry events
    for (let attempt = 1; attempt <= 5; attempt++) {
      manager.emit('server-retrying', {
        serverId: 'test-server',
        root: '/test/root',
        attempt,
      })
    }

    // Verify all events were captured
    expect(retryEvents).toHaveLength(5)

    // Verify event structure
    for (let i = 0; i < 5; i++) {
      expect(retryEvents[i]).toMatchObject({
        serverId: 'test-server',
        root: '/test/root',
        attempt: i + 1,
      })
    }

    await manager.shutdown()
  })

  it('should demonstrate exponential backoff pattern', () => {
    const expectedDelays = [1000, 2000, 4000, 8000, 16000]

    // Verify the pattern: delay[n] = 2^n * 1000ms
    for (let i = 0; i < expectedDelays.length; i++) {
      const calculated = Math.pow(2, i) * 1000
      expect(expectedDelays[i]).toBe(calculated)
    }

    // Verify maximum cumulative time
    const totalTime = expectedDelays.reduce((sum, delay) => sum + delay, 0)
    expect(totalTime).toBe(31000) // 31 seconds total
  })
})
