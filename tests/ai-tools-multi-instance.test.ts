/**
 * AiToolsService Multi-Instance Tests
 *
 * Tests that multiple AiToolsService instances can run concurrently
 * for different projects without interfering with each other.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { AiToolsService } from '../bin/claudelet-ai-tools'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, writeFileSync } from 'fs'

describe('AiToolsService Multi-Instance Support', () => {
  let projectA: string
  let projectB: string
  let serviceA: AiToolsService
  let serviceB: AiToolsService

  beforeAll(() => {
    // Create temporary project directories
    const base = join(tmpdir(), 'aitools-test-' + Date.now())
    projectA = join(base, 'project-a')
    projectB = join(base, 'project-b')

    mkdirSync(projectA, { recursive: true })
    mkdirSync(projectB, { recursive: true })

    // Create .opencode directories for vector stores
    mkdirSync(join(projectA, '.opencode'), { recursive: true })
    mkdirSync(join(projectB, '.opencode'), { recursive: true })

    // Create package.json files to mark as project roots
    writeFileSync(join(projectA, 'package.json'), '{}')
    writeFileSync(join(projectB, 'package.json'), '{}')

    // Get instances for each project
    serviceA = AiToolsService.getInstance(projectA)
    serviceB = AiToolsService.getInstance(projectB)
  })

  afterAll(async () => {
    // Dispose all instances
    await AiToolsService.disposeAll()

    // Clean up temp directories
    try {
      rmSync(join(projectA, '..'), { recursive: true, force: true })
    } catch (err) {
      // Ignore cleanup errors
    }
  })

  it('should create separate instances for different projects', () => {
    expect(serviceA).toBeDefined()
    expect(serviceB).toBeDefined()
    expect(serviceA).not.toBe(serviceB)
  })

  it('should return same instance for same project path', () => {
    const serviceA2 = AiToolsService.getInstance(projectA)
    expect(serviceA2).toBe(serviceA)
  })

  it('should track correct project paths', () => {
    expect(serviceA.getProjectPath()).toBe(projectA)
    expect(serviceB.getProjectPath()).toBe(projectB)
  })

  it('should have isolated LSP managers', () => {
    expect(serviceA.lspManager).toBeDefined()
    expect(serviceB.lspManager).toBeDefined()
    expect(serviceA.lspManager).not.toBe(serviceB.lspManager)

    // Each manager should have its own instance ID
    const idA = serviceA.lspManager.getInstanceId()
    const idB = serviceB.lspManager.getInstanceId()
    expect(idA).not.toBe(idB)
  })

  it('should have isolated vector stores', () => {
    expect(serviceA.vectorStore).toBeDefined()
    expect(serviceB.vectorStore).toBeDefined()
    expect(serviceA.vectorStore).not.toBe(serviceB.vectorStore)
  })

  it('should share FastApply instance (global cache)', () => {
    // FastApply uses a global cache, so instances should share the same storage
    // but each service should have its own FastApply instance
    expect(serviceA.fastApply).toBeDefined()
    expect(serviceB.fastApply).toBeDefined()
  })

  it('should emit events independently', (done) => {
    let eventsA = 0
    let eventsB = 0

    serviceA.on('status:change', () => {
      eventsA++
    })

    serviceB.on('status:change', () => {
      eventsB++
    })

    // Trigger event on service A only
    serviceA.emit('status:change', serviceA.getStats())

    // Give events time to fire
    setTimeout(() => {
      expect(eventsA).toBeGreaterThan(0)
      expect(eventsB).toBe(0)
      done()
    }, 100)
  })

  it('should have independent stats', () => {
    const statsA = serviceA.getStats()
    const statsB = serviceB.getStats()

    expect(statsA).toBeDefined()
    expect(statsB).toBeDefined()

    // Stats should have expected structure
    expect(statsA.lsp).toBeDefined()
    expect(statsA.indexer).toBeDefined()
    expect(statsA.patchModel).toBeDefined()

    expect(statsB.lsp).toBeDefined()
    expect(statsB.indexer).toBeDefined()
    expect(statsB.patchModel).toBeDefined()
  })

  it('should dispose specific instance', async () => {
    // Create a new project and instance
    const projectC = join(tmpdir(), 'aitools-test-project-c-' + Date.now())
    mkdirSync(projectC, { recursive: true })
    mkdirSync(join(projectC, '.opencode'), { recursive: true })

    const serviceC = AiToolsService.getInstance(projectC)
    expect(serviceC).toBeDefined()

    // Dispose it
    await AiToolsService.disposeInstance(projectC)

    // Getting instance again should create a new one
    const serviceC2 = AiToolsService.getInstance(projectC)
    expect(serviceC2).toBeDefined()
    expect(serviceC2).not.toBe(serviceC) // New instance

    // Clean up
    await AiToolsService.disposeInstance(projectC)
    rmSync(projectC, { recursive: true, force: true })
  })

  it('should handle concurrent operations on different instances', async () => {
    // Create test files
    const fileA = join(projectA, 'test.ts')
    const fileB = join(projectB, 'test.ts')

    writeFileSync(fileA, 'const x: number = 1;')
    writeFileSync(fileB, 'const y: string = "hello";')

    // Perform operations concurrently
    const [diagsA, diagsB] = await Promise.all([
      serviceA.getDiagnostics(fileA),
      serviceB.getDiagnostics(fileB),
    ])

    // Both should complete without interference
    expect(diagsA).toBeDefined()
    expect(diagsB).toBeDefined()
    expect(Array.isArray(diagsA)).toBe(true)
    expect(Array.isArray(diagsB)).toBe(true)
  })
})

describe('AiToolsService Diagnostics API', () => {
  let projectPath: string
  let service: AiToolsService

  beforeAll(() => {
    projectPath = join(tmpdir(), 'aitools-diag-test-' + Date.now())
    mkdirSync(projectPath, { recursive: true })
    mkdirSync(join(projectPath, '.opencode'), { recursive: true })
    writeFileSync(join(projectPath, 'package.json'), '{}')

    service = AiToolsService.getInstance(projectPath)
  })

  afterAll(async () => {
    await AiToolsService.disposeInstance(projectPath)
    rmSync(projectPath, { recursive: true, force: true })
  })

  it('should expose getDiagnosticsForProject method', () => {
    const diags = service.getDiagnosticsForProject()
    expect(diags).toBeDefined()
    expect(typeof diags).toBe('object')
  })

  it('should support subscribeToDiagnostics', (done) => {
    const unsubscribe = service.subscribeToDiagnostics((event) => {
      expect(event).toBeDefined()
      expect(event.path).toBeDefined()
      expect(event.diagnostics).toBeDefined()
      unsubscribe()
      done()
    })

    // Trigger a diagnostics event
    service.lspManager.emit('diagnostics', {
      path: join(projectPath, 'test.ts'),
      diagnostics: [],
    })
  })
})
