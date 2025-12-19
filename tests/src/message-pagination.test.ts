/**
 * Tests for message-pagination module
 */

import { describe, it, expect } from 'vitest'
import {
  calculateMessageHeight,
  calculateAvailableRows,
  calculateVisibleMessages,
  applyScroll,
  isAtBottom,
  isAtTop,
  getPaginationState,
  formatPaginationInfo,
  estimateMemoryUsage,
  validateConfig,
  defaultPaginationConfig,
  type Message,
  type TerminalSize,
  type PaginationConfig
} from '../../src/message-pagination'
import { createMessage, createMessages } from '../helpers/fixtures'

describe('message-pagination', () => {
  describe('calculateMessageHeight', () => {
    it('should calculate base height for simple message', () => {
      const msg = createMessage({ content: 'Hello' })
      const height = calculateMessageHeight(msg, 80)
      // Base: 3 (borders + margin) + 1 (content line) = 4
      expect(height).toBeGreaterThanOrEqual(4)
    })

    it('should account for multi-line content', () => {
      const msg = createMessage({ content: 'Line 1\nLine 2\nLine 3' })
      const height = calculateMessageHeight(msg, 80)
      // Base: 3 + 3 lines = 6
      expect(height).toBeGreaterThanOrEqual(6)
    })

    it('should account for line wrapping', () => {
      const longLine = 'x'.repeat(100) // Will wrap in 80-column terminal
      const msg = createMessage({ content: longLine })
      const height = calculateMessageHeight(msg, 80)
      // Should wrap to at least 2 lines
      expect(height).toBeGreaterThanOrEqual(5)
    })

    it('should handle empty content', () => {
      const msg = createMessage({ content: '' })
      const height = calculateMessageHeight(msg, 80)
      // Just base height
      expect(height).toBe(3)
    })

    it('should handle tool messages', () => {
      const msg = createMessage({
        role: 'tool',
        content: 'Tool output',
        toolName: 'read',
        toolId: 'tool-1'
      })
      const height = calculateMessageHeight(msg, 80, false)
      expect(height).toBeGreaterThanOrEqual(4)
    })

    it('should handle collapsed tool messages', () => {
      const msg = createMessage({
        role: 'tool',
        content: 'Tool output',
        toolName: 'read',
        toolId: 'tool-1',
        toolInput: { file: 'test.ts' }
      })
      const expandedHeight = calculateMessageHeight(msg, 80, false)
      const collapsedHeight = calculateMessageHeight(msg, 80, true)
      expect(collapsedHeight).toBeLessThanOrEqual(expandedHeight)
    })
  })

  describe('calculateAvailableRows', () => {
    const terminalSize: TerminalSize = { rows: 40, columns: 80 }

    it('should subtract reserved space from terminal rows', () => {
      const available = calculateAvailableRows(terminalSize, defaultPaginationConfig)
      expect(available).toBeLessThan(40)
      expect(available).toBeGreaterThan(0)
    })

    it('should ensure minimum of 5 rows', () => {
      const tinyTerminal: TerminalSize = { rows: 10, columns: 80 }
      const config: PaginationConfig = {
        inputHeight: 3,
        statusHeight: 2,
        paddingHeight: 2,
        toolChipsHeight: 0,
        contextChipsHeight: 0
      }
      const available = calculateAvailableRows(tinyTerminal, config)
      expect(available).toBeGreaterThanOrEqual(5)
    })
  })

  describe('calculateVisibleMessages', () => {
    const terminalColumns = 80

    it('should return empty array for empty messages', () => {
      const result = calculateVisibleMessages([], 0, 20, terminalColumns)
      expect(result).toEqual([])
    })

    it('should return all messages if they fit', () => {
      const messages = createMessages(3)
      const result = calculateVisibleMessages(messages, 0, 100, terminalColumns)
      expect(result.length).toBe(3)
    })

    it('should handle scroll offset', () => {
      const messages = createMessages(10)
      const atBottom = calculateVisibleMessages(messages, 0, 20, terminalColumns)
      const scrolledUp = calculateVisibleMessages(messages, 5, 20, terminalColumns)

      // When scrolled up, we should see different messages
      expect(scrolledUp.length).toBeGreaterThan(0)
    })

    it('should handle collapsed tools', () => {
      const messages: Message[] = [
        createMessage({ role: 'user', content: 'Hello' }),
        createMessage({ role: 'tool', content: 'Output', toolId: 'tool-1', toolInput: { x: 1 } }),
        createMessage({ role: 'assistant', content: 'Response' })
      ]
      const collapsedIds = new Set(['tool-1'])
      const result = calculateVisibleMessages(messages, 0, 50, terminalColumns, collapsedIds)
      expect(result.length).toBe(3)
    })
  })

  describe('applyScroll', () => {
    it('should increase offset when scrolling up (positive amount)', () => {
      const newOffset = applyScroll(0, 5, 100)
      expect(newOffset).toBe(5)
    })

    it('should decrease offset when scrolling down (negative amount)', () => {
      const newOffset = applyScroll(10, -5, 100)
      expect(newOffset).toBe(5)
    })

    it('should not go below 0', () => {
      const newOffset = applyScroll(2, -10, 100)
      expect(newOffset).toBe(0)
    })

    it('should not exceed max offset', () => {
      const newOffset = applyScroll(90, 20, 100)
      expect(newOffset).toBeLessThanOrEqual(99)
    })
  })

  describe('isAtBottom', () => {
    it('should return true when scroll offset is 0', () => {
      expect(isAtBottom(0)).toBe(true)
    })

    it('should return false when scrolled up', () => {
      expect(isAtBottom(5)).toBe(false)
    })
  })

  describe('isAtTop', () => {
    it('should return true when at max scroll', () => {
      expect(isAtTop(99, 100)).toBe(true)
    })

    it('should return false when not at top', () => {
      expect(isAtTop(50, 100)).toBe(false)
    })

    it('should return true for empty messages', () => {
      expect(isAtTop(0, 0)).toBe(true)
    })
  })

  describe('getPaginationState', () => {
    it('should return complete pagination state', () => {
      const messages = createMessages(10)
      const state = getPaginationState(messages, 0, 30, 80)

      expect(state.totalMessages).toBe(10)
      expect(state.scrollOffset).toBe(0)
      expect(state.visibleMessages.length).toBeGreaterThan(0)
      expect(state.visibleCount).toBeGreaterThan(0)
    })
  })

  describe('formatPaginationInfo', () => {
    it('should format "No messages" for empty state', () => {
      const result = formatPaginationInfo({
        visibleMessages: [],
        scrollOffset: 0,
        totalMessages: 0,
        visibleCount: 0
      })
      expect(result).toBe('No messages')
    })

    it('should format "All visible" when everything fits', () => {
      const result = formatPaginationInfo({
        visibleMessages: createMessages(5),
        scrollOffset: 0,
        totalMessages: 5,
        visibleCount: 5
      })
      expect(result).toContain('All')
      expect(result).toContain('5')
    })

    it('should format range when scrolled', () => {
      const result = formatPaginationInfo({
        visibleMessages: createMessages(10),
        scrollOffset: 5,
        totalMessages: 50,
        visibleCount: 10
      })
      expect(result).toContain('of 50')
      expect(result).toContain('scroll')
    })
  })

  describe('estimateMemoryUsage', () => {
    it('should estimate memory for messages', () => {
      const messages = createMessages(100)
      const mb = estimateMemoryUsage(messages)
      expect(mb).toBeGreaterThan(0)
      expect(mb).toBeLessThan(10) // Should be reasonable
    })

    it('should return 0 for empty messages', () => {
      expect(estimateMemoryUsage([])).toBe(0)
    })
  })

  describe('validateConfig', () => {
    it('should return true for valid config', () => {
      const terminalSize: TerminalSize = { rows: 40, columns: 80 }
      expect(validateConfig(defaultPaginationConfig, terminalSize)).toBe(true)
    })

    it('should return false when terminal is too small', () => {
      const tinyTerminal: TerminalSize = { rows: 5, columns: 80 }
      expect(validateConfig(defaultPaginationConfig, tinyTerminal)).toBe(false)
    })
  })
})
