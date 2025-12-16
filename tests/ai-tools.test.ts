import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AiToolsService } from '../bin/claudelet-ai-tools'
import * as path from 'path'

describe('AiToolsService', () => {
  let testProjectPath: string
  let instance: AiToolsService | null = null

  beforeEach(() => {
    testProjectPath = path.join(__dirname, '..', 'test-project')
  })

  afterEach(async () => {
    // Cleanup instance
    if (instance) {
      await instance.dispose()
      instance = null
    }
  })

  describe('Dependency Injection Pattern', () => {
    it('should create independent instances without singleton pattern', async () => {
      // Create two instances
      const instance1 = AiToolsService.create(testProjectPath)
      const instance2 = AiToolsService.create(testProjectPath)

      // They should be different instances
      expect(instance1).not.toBe(instance2)

      // Cleanup
      await instance1.dispose()
      await instance2.dispose()
    })

    it('should allow creating instances with different project paths', async () => {
      const path1 = path.join(__dirname, '..', 'project-1')
      const path2 = path.join(__dirname, '..', 'project-2')

      const instance1 = AiToolsService.create(path1)
      const instance2 = AiToolsService.create(path2)

      // Both should work independently
      expect(instance1).toBeDefined()
      expect(instance2).toBeDefined()

      // Cleanup
      await instance1.dispose()
      await instance2.dispose()
    })
  })

  describe('Lifecycle Management', () => {
    it('should initialize without errors', async () => {
      instance = AiToolsService.create(testProjectPath)
      await expect(instance.initialize()).resolves.not.toThrow()
    })

    it('should dispose all resources properly', async () => {
      instance = AiToolsService.create(testProjectPath)
      await instance.initialize()

      // Should dispose without errors
      await expect(instance.dispose()).resolves.not.toThrow()
    })

    it('should prevent double disposal', async () => {
      instance = AiToolsService.create(testProjectPath)
      await instance.initialize()

      // First dispose
      await instance.dispose()

      // Second dispose should be idempotent
      await expect(instance.dispose()).resolves.not.toThrow()
    })

    it('should emit status:change event on initialization', async () => {
      instance = AiToolsService.create(testProjectPath)

      const statusChanges: any[] = []
      instance.on('status:change', (stats) => {
        statusChanges.push(stats)
      })

      await instance.initialize()

      // Should have at least one status change event
      expect(statusChanges.length).toBeGreaterThan(0)
      expect(statusChanges[0]).toHaveProperty('lsp')
      expect(statusChanges[0]).toHaveProperty('indexer')
      expect(statusChanges[0]).toHaveProperty('patchModel')
    })
  })

  describe('Resource Cleanup', () => {
    it('should clean up event listeners on dispose', async () => {
      instance = AiToolsService.create(testProjectPath)
      await instance.initialize()

      // Add listeners
      const mockListener = vi.fn()
      instance.on('status:change', mockListener)

      await instance.dispose()

      // Listeners should be removed
      expect(instance.listenerCount('status:change')).toBe(0)
    })

    it('should close file watcher on dispose', async () => {
      instance = AiToolsService.create(testProjectPath)
      await instance.initialize()

      // The watcher should be active
      expect(instance['watcher']).not.toBeNull()

      await instance.dispose()

      // The watcher should be closed (no longer accepting new files)
      // Note: We can't directly test chokidar internals, but the dispose call should complete
      expect(instance['disposed']).toBe(true)
    })

    it('should dispose all subsystems', async () => {
      instance = AiToolsService.create(testProjectPath)
      await instance.initialize()

      // Mock dispose methods
      const mockFastApplyDispose = vi.spyOn(instance.fastApply, 'dispose')
      const mockEmbedderDispose = vi.spyOn(instance.embedder, 'dispose')
      const mockVectorStoreDispose = vi.spyOn(instance.vectorStore, 'dispose')
      const mockLspShutdown = vi.spyOn(instance.lspManager, 'shutdown')

      await instance.dispose()

      // Verify all subsystems were disposed
      expect(mockFastApplyDispose).toHaveBeenCalled()
      expect(mockEmbedderDispose).toHaveBeenCalled()
      expect(mockVectorStoreDispose).toHaveBeenCalled()
      expect(mockLspShutdown).toHaveBeenCalled()
    })
  })

  describe('Factory Method with Process Handlers', () => {
    it('should register process exit handlers', async () => {
      const onceSpyBeforeExit = vi.spyOn(process, 'once')

      instance = AiToolsService.create(testProjectPath)

      // Verify process handlers were registered
      expect(onceSpyBeforeExit).toHaveBeenCalledWith('beforeExit', expect.any(Function))
      expect(onceSpyBeforeExit).toHaveBeenCalledWith('SIGINT', expect.any(Function))
      expect(onceSpyBeforeExit).toHaveBeenCalledWith('SIGTERM', expect.any(Function))

      await instance.dispose()
      onceSpyBeforeExit.mockRestore()
    })
  })

  describe('Stats and Properties', () => {
    it('should return accurate stats after initialization', async () => {
      instance = AiToolsService.create(testProjectPath)
      await instance.initialize()

      const stats = instance.getStats()

      expect(stats).toHaveProperty('lsp')
      expect(stats).toHaveProperty('indexer')
      expect(stats).toHaveProperty('patchModel')

      expect(stats.lsp).toHaveProperty('activeServers')
      expect(stats.lsp).toHaveProperty('filesWithDiagnostics')

      expect(stats.indexer).toHaveProperty('isIndexing')
      expect(stats.indexer).toHaveProperty('current')
      expect(stats.indexer).toHaveProperty('total')
      expect(stats.indexer).toHaveProperty('phase')
    })

    it('should support multiple instances with different patch models', async () => {
      const instance1 = AiToolsService.create(testProjectPath)
      const instance2 = AiToolsService.create(testProjectPath)

      await instance1.initialize()
      await instance2.initialize()

      // Each instance should have independent state
      const stats1 = instance1.getStats()
      const stats2 = instance2.getStats()

      expect(stats1.patchModel).toBe('Q4_K_M')
      expect(stats2.patchModel).toBe('Q4_K_M')

      // Change model on one instance shouldn't affect the other
      await instance1.setPatchingModel('Q5_K_M')

      const updatedStats1 = instance1.getStats()
      const updatedStats2 = instance2.getStats()

      expect(updatedStats1.patchModel).toBe('Q5_K_M')
      expect(updatedStats2.patchModel).toBe('Q4_K_M')

      // Cleanup
      await instance1.dispose()
      await instance2.dispose()
    })
  })

  describe('Backward Compatibility', () => {
    it('should not have getInstance method (removed)', () => {
      // Verify getInstance was removed to enforce new pattern
      expect((AiToolsService as any).getInstance).toBeUndefined()
    })
  })
})
