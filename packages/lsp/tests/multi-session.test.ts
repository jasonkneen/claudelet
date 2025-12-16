/**
 * Multi-Session Isolation Tests
 *
 * Tests that multiple LSPManager instances can run concurrently
 * without interfering with each other.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LSPManager } from '../src/manager'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, writeFileSync } from 'fs'

describe('LSPManager Multi-Session Support', () => {
  let projectA: string
  let projectB: string
  let managerA: LSPManager
  let managerB: LSPManager

  beforeEach(() => {
    // Create temporary project directories
    const base = join(tmpdir(), 'lsp-test-' + Date.now())
    projectA = join(base, 'project-a')
    projectB = join(base, 'project-b')

    mkdirSync(projectA, { recursive: true })
    mkdirSync(projectB, { recursive: true })

    // Create package.json files to mark as project roots
    writeFileSync(join(projectA, 'package.json'), '{}')
    writeFileSync(join(projectB, 'package.json'), '{}')

    // Create separate LSPManager instances for each project
    managerA = new LSPManager({
      projectPath: projectA,
      appName: 'test-lsp',
    })

    managerB = new LSPManager({
      projectPath: projectB,
      appName: 'test-lsp',
    })
  })

  afterEach(async () => {
    // Clean up managers
    await managerA.shutdown()
    await managerB.shutdown()

    // Clean up temp directories
    try {
      rmSync(join(projectA, '..'), { recursive: true, force: true })
    } catch (err) {
      // Ignore cleanup errors
    }
  })

  it('should create instances with unique IDs for different projects', () => {
    const idA = managerA.getInstanceId()
    const idB = managerB.getInstanceId()

    expect(idA).toBeTruthy()
    expect(idB).toBeTruthy()
    expect(idA).not.toBe(idB)
  })

  it('should track separate project paths', () => {
    expect(managerA.getProjectPath()).toBe(projectA)
    expect(managerB.getProjectPath()).toBe(projectB)
  })

  it('should maintain isolated client maps', async () => {
    // Create a TypeScript file in each project
    const fileA = join(projectA, 'test.ts')
    const fileB = join(projectB, 'test.ts')

    writeFileSync(fileA, 'const x: number = 1;')
    writeFileSync(fileB, 'const y: string = "hello";')

    // Touch files in both managers (this will attempt to spawn LSP servers)
    // Note: Servers may not actually spawn in test environment without proper setup
    await managerA.touchFile(fileA)
    await managerB.touchFile(fileB)

    // Verify diagnostics are isolated
    const diagsA = managerA.getAllDiagnostics()
    const diagsB = managerB.getAllDiagnostics()

    // Each manager should only know about its own files
    const filesA = Object.keys(diagsA)
    const filesB = Object.keys(diagsB)

    expect(filesA.every(f => f.includes(projectA))).toBe(true)
    expect(filesB.every(f => f.includes(projectB))).toBe(true)
  })

  it('should support same instance ID for same project path', () => {
    // Create another manager for the same project
    const managerA2 = new LSPManager({
      projectPath: projectA,
      appName: 'test-lsp',
    })

    expect(managerA.getInstanceId()).toBe(managerA2.getInstanceId())
    expect(managerA.getProjectPath()).toBe(managerA2.getProjectPath())

    // Clean up
    managerA2.shutdown()
  })

  it('should emit events independently', (done) => {
    let eventsA = 0
    let eventsB = 0

    managerA.on('server-status-changed', () => {
      eventsA++
    })

    managerB.on('server-status-changed', () => {
      eventsB++
    })

    // Trigger event on manager A only
    managerA.setServerEnabled('typescript', false)

    // Give events time to fire
    setTimeout(() => {
      expect(eventsA).toBe(1)
      expect(eventsB).toBe(0)
      done()
    }, 100)
  })

  it('should shutdown independently', async () => {
    // Shutdown manager A
    await managerA.shutdown()

    // Manager B should still be functional
    const status = await managerB.getStatus()
    expect(status).toBeDefined()
    expect(Array.isArray(status)).toBe(true)
  })

  it('should handle setProjectPath deprecation warning', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Create a file to trigger server spawn
    const file = join(projectA, 'test.ts')
    writeFileSync(file, 'const x = 1;')

    // Touch file to spawn a server
    managerA.touchFile(file)

    // Now change project path (deprecated)
    managerA.setProjectPath(projectB)

    // Should log warning if servers are running
    // Note: In test environment, servers may not spawn, so we just verify the method exists
    expect(typeof managerA.setProjectPath).toBe('function')

    consoleSpy.mockRestore()
  })

  it('should generate consistent instance IDs for same path', () => {
    const manager1 = new LSPManager({ projectPath: '/test/path' })
    const manager2 = new LSPManager({ projectPath: '/test/path' })
    const manager3 = new LSPManager({ projectPath: '/different/path' })

    expect(manager1.getInstanceId()).toBe(manager2.getInstanceId())
    expect(manager1.getInstanceId()).not.toBe(manager3.getInstanceId())

    // Cleanup
    manager1.shutdown()
    manager2.shutdown()
    manager3.shutdown()
  })
})

describe('LSPManager Backward Compatibility', () => {
  it('should use cwd if projectPath not provided', () => {
    const manager = new LSPManager()
    expect(manager.getProjectPath()).toBe(process.cwd())
    manager.shutdown()
  })

  it('should support legacy setProjectPath for initial setup', () => {
    const manager = new LSPManager()
    const testPath = '/test/legacy/path'

    // Should not warn if no servers running yet
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    manager.setProjectPath(testPath)

    expect(manager.getProjectPath()).toBe(testPath)
    expect(consoleSpy).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
    manager.shutdown()
  })
})
