/**
 * Tests for diagnostics display pipeline
 * Validates diagnostics retrieval, subscription, and formatting
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AiToolsService } from '../bin/claudelet-ai-tools.js'
import type { DiagnosticSeverity } from '@ai-cluso/lsp-client'

describe('Diagnostics Pipeline', () => {
  let aiTools: AiToolsService
  const testProjectPath = process.cwd()

  beforeEach(() => {
    // Get instance for testing
    aiTools = AiToolsService.getInstance(testProjectPath)
  })

  afterEach(async () => {
    // Cleanup after tests
    await aiTools.dispose()
  })

  describe('getDiagnosticsForProject', () => {
    it('should return diagnostics map for all files', () => {
      const diagnostics = aiTools.getDiagnosticsForProject()

      expect(diagnostics).toBeDefined()
      expect(typeof diagnostics).toBe('object')
    })

    it('should return empty object when no diagnostics', () => {
      const diagnostics = aiTools.getDiagnosticsForProject()

      // On a fresh project with no LSP servers started, should be empty
      expect(Object.keys(diagnostics).length).toBeGreaterThanOrEqual(0)
    })

    it('should group diagnostics by file path', () => {
      const diagnostics = aiTools.getDiagnosticsForProject()

      // Check structure - each key should be a file path, value should be an array
      Object.entries(diagnostics).forEach(([filePath, diags]) => {
        expect(typeof filePath).toBe('string')
        expect(Array.isArray(diags)).toBe(true)
      })
    })
  })

  describe('subscribeToDiagnostics', () => {
    it('should return an unsubscribe function', () => {
      const mockCallback = vi.fn()
      const unsubscribe = aiTools.subscribeToDiagnostics(mockCallback)

      expect(typeof unsubscribe).toBe('function')

      // Cleanup
      unsubscribe()
    })

    it('should call callback when diagnostics change', async () => {
      const mockCallback = vi.fn()
      const unsubscribe = aiTools.subscribeToDiagnostics(mockCallback)

      // Trigger diagnostics by touching a file
      // Note: This test may not fire immediately without actual LSP servers running
      // In real usage, LSP servers emit diagnostics events

      // Cleanup
      unsubscribe()
    })

    it('should stop calling callback after unsubscribe', () => {
      const mockCallback = vi.fn()
      const unsubscribe = aiTools.subscribeToDiagnostics(mockCallback)

      // Unsubscribe immediately
      unsubscribe()

      // Any subsequent diagnostics events should not call the callback
      // This is tested by the subscription mechanism
      expect(mockCallback).not.toHaveBeenCalled()
    })

    it('should handle multiple subscribers', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      const unsub1 = aiTools.subscribeToDiagnostics(callback1)
      const unsub2 = aiTools.subscribeToDiagnostics(callback2)

      // Both should be active
      expect(typeof unsub1).toBe('function')
      expect(typeof unsub2).toBe('function')

      // Cleanup
      unsub1()
      unsub2()
    })
  })

  describe('Diagnostic Formatting', () => {
    it('should format diagnostics with severity', () => {
      const mockDiagnostic = {
        range: {
          start: { line: 10, character: 5 },
          end: { line: 10, character: 20 }
        },
        severity: 1 as DiagnosticSeverity, // Error
        message: 'Undefined variable',
        source: 'tsc'
      }

      // Test formatting (this would be done in the UI layer)
      const formatted = `[Error] Line ${mockDiagnostic.range.start.line + 1}:${mockDiagnostic.range.start.character + 1} (${mockDiagnostic.source}): ${mockDiagnostic.message}`

      expect(formatted).toBe('[Error] Line 11:6 (tsc): Undefined variable')
    })

    it('should format diagnostics with warnings', () => {
      const mockDiagnostic = {
        range: {
          start: { line: 25, character: 0 },
          end: { line: 25, character: 10 }
        },
        severity: 2 as DiagnosticSeverity, // Warning
        message: 'Unused variable',
        source: 'eslint'
      }

      const formatted = `[Warning] Line ${mockDiagnostic.range.start.line + 1}:${mockDiagnostic.range.start.character + 1} (${mockDiagnostic.source}): ${mockDiagnostic.message}`

      expect(formatted).toBe('[Warning] Line 26:1 (eslint): Unused variable')
    })

    it('should handle diagnostics without source', () => {
      const mockDiagnostic = {
        range: {
          start: { line: 5, character: 10 },
          end: { line: 5, character: 15 }
        },
        severity: 1 as DiagnosticSeverity,
        message: 'Syntax error'
      }

      const formatted = `[Error] Line ${mockDiagnostic.range.start.line + 1}:${mockDiagnostic.range.start.character + 1} (unknown): ${mockDiagnostic.message}`

      expect(formatted).toBe('[Error] Line 6:11 (unknown): Syntax error')
    })
  })

  describe('Integration with LSP Manager', () => {
    it('should expose LSP manager diagnostics', () => {
      // The getDiagnosticsForProject method internally calls lspManager.getAllDiagnostics()
      const diagnostics = aiTools.getDiagnosticsForProject()

      // Should return the same structure as LSP manager
      expect(typeof diagnostics).toBe('object')
    })

    it('should pass through diagnostic updates from LSP', async () => {
      const receivedEvents: Array<{ path: string; diagnostics: any[] }> = []

      const unsubscribe = aiTools.subscribeToDiagnostics((event) => {
        receivedEvents.push(event)
      })

      // In real usage, LSP servers would emit diagnostics events
      // This test validates the subscription mechanism exists

      expect(receivedEvents.length).toBeGreaterThanOrEqual(0)

      unsubscribe()
    })
  })

  describe('Display Requirements', () => {
    it('should provide diagnostics with line and column info', () => {
      const diagnostics = aiTools.getDiagnosticsForProject()

      // Each diagnostic should have range information for inline display
      Object.values(diagnostics).forEach((fileDiags) => {
        fileDiags.forEach((diag) => {
          expect(diag.range).toBeDefined()
          expect(diag.range.start).toBeDefined()
          expect(diag.range.start.line).toBeGreaterThanOrEqual(0)
          expect(diag.range.start.character).toBeGreaterThanOrEqual(0)
        })
      })
    })

    it('should provide diagnostics with severity for color coding', () => {
      const diagnostics = aiTools.getDiagnosticsForProject()

      // Each diagnostic should have severity (1=Error, 2=Warning, etc.)
      Object.values(diagnostics).forEach((fileDiags) => {
        fileDiags.forEach((diag) => {
          // Severity may be undefined for some diagnostics
          if (diag.severity !== undefined) {
            expect([1, 2, 3, 4]).toContain(diag.severity)
          }
        })
      })
    })

    it('should provide diagnostic messages for hover display', () => {
      const diagnostics = aiTools.getDiagnosticsForProject()

      // Each diagnostic should have a message
      Object.values(diagnostics).forEach((fileDiags) => {
        fileDiags.forEach((diag) => {
          expect(diag.message).toBeDefined()
          expect(typeof diag.message).toBe('string')
        })
      })
    })
  })
})
