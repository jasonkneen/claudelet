import { describe, it, expect, beforeEach } from 'vitest'
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
  filterVisibleMessages,
  createPaginationState,
  defaultPaginationConfig,
  type Message,
  type TerminalSize,
  type PaginationConfig
} from '../src/message-pagination'

describe('Message Pagination Utils', () => {
  let testMessages: Message[]
  let terminalSize: TerminalSize
  let config: PaginationConfig

  beforeEach(() => {
    testMessages = Array.from({ length: 100 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}: This is a test message with some content.`,
      timestamp: new Date(Date.now() - (100 - i) * 1000),
      toolId: i % 10 === 0 ? `tool-${i}` : undefined
    }))

    terminalSize = {
      rows: 30,
      columns: 80
    }

    config = {
      inputHeight: 3,
      statusHeight: 2,
      paddingHeight: 2,
      toolChipsHeight: 1,
      contextChipsHeight: 0
    }
  })

  describe('calculateMessageHeight', () => {
    it('should calculate height for simple message', () => {
      const msg: Message = {
        role: 'user',
        content: 'Hello',
        timestamp: new Date()
      }
      const height = calculateMessageHeight(msg, 80)
      expect(height).toBeGreaterThan(0)
    })

    it('should account for multiline content', () => {
      const msg: Message = {
        role: 'user',
        content: 'Line 1\nLine 2\nLine 3',
        timestamp: new Date()
      }
      const height = calculateMessageHeight(msg, 80)
      expect(height).toBeGreaterThan(3) // At least 3 for content + header + spacer
    })

    it('should account for line wrapping', () => {
      const longLine = 'a'.repeat(160) // Longer than 80 columns
      const msg: Message = {
        role: 'user',
        content: longLine,
        timestamp: new Date()
      }
      const height = calculateMessageHeight(msg, 80)
      expect(height).toBeGreaterThanOrEqual(3) // Should wrap to multiple lines
    })

    it('should account for tool input', () => {
      const msg: Message = {
        role: 'tool',
        content: 'Tool output',
        timestamp: new Date(),
        toolInput: { key1: 'value1', key2: 'value2' }
      }
      const height = calculateMessageHeight(msg, 80)
      expect(height).toBeGreaterThan(2) // Should include tool input
    })

    it('should not include tool input when collapsed', () => {
      const msg: Message = {
        role: 'tool',
        content: 'Tool output',
        timestamp: new Date(),
        toolInput: { key1: 'value1', key2: 'value2' },
        isCollapsed: true
      }
      const height = calculateMessageHeight(msg, 80, true)
      expect(height).toBeLessThan(5) // Should be much smaller when collapsed
    })
  })

  describe('calculateAvailableRows', () => {
    it('should calculate available rows correctly', () => {
      const available = calculateAvailableRows(terminalSize, config)
      expect(available).toBeLessThan(terminalSize.rows)
      expect(available).toBeGreaterThanOrEqual(5) // Minimum 5 rows
    })

    it('should handle small terminal', () => {
      const small: TerminalSize = { rows: 10, columns: 40 }
      const available = calculateAvailableRows(small, config)
      expect(available).toBeGreaterThanOrEqual(5)
    })

    it('should return minimum 5 rows', () => {
      const tiny: TerminalSize = { rows: 8, columns: 20 }
      const manyComponents: PaginationConfig = {
        inputHeight: 3,
        statusHeight: 2,
        paddingHeight: 1,
        toolChipsHeight: 1,
        contextChipsHeight: 1
      }
      const available = calculateAvailableRows(tiny, manyComponents)
      expect(available).toBeGreaterThanOrEqual(5)
    })
  })

  describe('calculateVisibleMessages', () => {
    it('should return empty array for empty messages', () => {
      const visible = calculateVisibleMessages([], 0, 10, 80)
      expect(visible).toEqual([])
    })

    it('should return visible messages from end', () => {
      const visible = calculateVisibleMessages(testMessages, 0, 20, 80)
      expect(visible.length).toBeGreaterThan(0)
      expect(visible[visible.length - 1]).toBe(
        testMessages[testMessages.length - 1]
      )
    })

    it('should respect scroll offset', () => {
      const visible0 = calculateVisibleMessages(testMessages, 0, 20, 80)
      const visible10 = calculateVisibleMessages(testMessages, 10, 20, 80)
      expect(visible0).not.toEqual(visible10)
    })

    it('should handle offset beyond messages', () => {
      const visible = calculateVisibleMessages(testMessages, 1000, 20, 80)
      expect(visible.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('applyScroll', () => {
    it('should scroll down (decrease offset)', () => {
      const newOffset = applyScroll(10, -5, 100)
      expect(newOffset).toBe(5)
    })

    it('should scroll up (increase offset)', () => {
      const newOffset = applyScroll(5, 5, 100)
      expect(newOffset).toBe(10)
    })

    it('should respect bounds', () => {
      const scrollUp = applyScroll(0, -10, 100)
      expect(scrollUp).toBe(0) // Can't go below 0

      const scrollDown = applyScroll(99, 100, 100)
      expect(scrollDown).toBeLessThanOrEqual(99)
    })
  })

  describe('isAtBottom', () => {
    it('should return true for offset 0', () => {
      expect(isAtBottom(0)).toBe(true)
    })

    it('should return false for non-zero offset', () => {
      expect(isAtBottom(5)).toBe(false)
      expect(isAtBottom(10)).toBe(false)
    })
  })

  describe('isAtTop', () => {
    it('should return true when at top', () => {
      expect(isAtTop(99, 100)).toBe(true)
    })

    it('should return false when not at top', () => {
      expect(isAtTop(50, 100)).toBe(false)
    })
  })

  describe('getPaginationState', () => {
    it('should return valid pagination state', () => {
      const state = getPaginationState(testMessages, 0, 20, 80)
      expect(state.visibleMessages.length).toBeGreaterThan(0)
      expect(state.visibleCount).toBe(state.visibleMessages.length)
      expect(state.totalMessages).toBe(100)
    })
  })

  describe('formatPaginationInfo', () => {
    it('should format pagination info', () => {
      const state = getPaginationState(testMessages, 0, 20, 80)
      const info = formatPaginationInfo(state)
      expect(info).toContain('of 100')
    })

    it('should handle empty messages', () => {
      const state = getPaginationState([], 0, 20, 80)
      const info = formatPaginationInfo(state)
      expect(info).toBe('No messages')
    })

    it('should handle all visible', () => {
      const fewMessages: Message[] = [
        {
          role: 'user',
          content: 'Test',
          timestamp: new Date()
        }
      ]
      const state = getPaginationState(fewMessages, 0, 20, 80)
      const info = formatPaginationInfo(state)
      expect(info).toContain('All')
    })
  })

  describe('estimateMemoryUsage', () => {
    it('should estimate memory based on message count', () => {
      const memory100 = estimateMemoryUsage(testMessages)
      expect(memory100).toBeGreaterThan(0)

      const memory200 = estimateMemoryUsage(Array.from({ length: 200 }, () => testMessages[0]))
      expect(memory200).toBeGreaterThan(memory100)
    })

    it('should return zero for empty messages', () => {
      const memory = estimateMemoryUsage([])
      expect(memory).toBe(0)
    })
  })

  describe('validateConfig', () => {
    it('should validate valid config', () => {
      const valid = validateConfig(config, terminalSize)
      expect(valid).toBe(true)
    })

    it('should reject config that leaves too little space', () => {
      const cramped: PaginationConfig = {
        inputHeight: 5,
        statusHeight: 2,
        paddingHeight: 1,
        toolChipsHeight: 1,
        contextChipsHeight: 1
      }
      const small: TerminalSize = { rows: 10, columns: 80 }
      const valid = validateConfig(cramped, small)
      expect(valid).toBe(false)
    })
  })

  describe('filterVisibleMessages', () => {
    it('should filter messages correctly', () => {
      const visible = filterVisibleMessages(
        testMessages,
        (msg) => msg.role === 'user'
      )
      expect(visible.every((msg) => msg.role === 'user')).toBe(true)
    })

    it('should return empty for no matches', () => {
      const visible = filterVisibleMessages(testMessages, () => false)
      expect(visible).toEqual([])
    })
  })

  describe('createPaginationState', () => {
    it('should create pagination state', () => {
      const state = createPaginationState(testMessages, 0, terminalSize, config)
      expect(state).not.toBeNull()
      expect(state?.visibleMessages.length).toBeGreaterThan(0)
    })

    it('should return null for invalid config', () => {
      const invalid: PaginationConfig = {
        inputHeight: 30,
        statusHeight: 2,
        paddingHeight: 1,
        toolChipsHeight: 1,
        contextChipsHeight: 1
      }
      const state = createPaginationState(testMessages, 0, terminalSize, invalid)
      expect(state).toBeNull()
    })

    it('should use default config if not provided', () => {
      const state = createPaginationState(testMessages, 0, terminalSize)
      expect(state).not.toBeNull()
    })
  })

  describe('Integration Tests', () => {
    it('should handle pagination workflow', () => {
      // Start at bottom
      let state = createPaginationState(testMessages, 0, terminalSize, config)
      expect(state).not.toBeNull()
      expect(isAtBottom(state!.scrollOffset)).toBe(true)

      // Scroll up
      const newOffset = applyScroll(state!.scrollOffset, 20, testMessages.length)
      state = createPaginationState(testMessages, newOffset, terminalSize, config)
      expect(isAtBottom(state!.scrollOffset)).toBe(false)

      // Scroll back down
      const backOffset = applyScroll(newOffset, -20, testMessages.length)
      state = createPaginationState(testMessages, backOffset, terminalSize, config)
      expect(isAtBottom(state!.scrollOffset)).toBe(true)
    })

    it('should handle large message sets efficiently', () => {
      const largeSet = Array.from({ length: 10000 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}: Lorem ipsum dolor sit amet.`,
        timestamp: new Date(Date.now() - (10000 - i) * 1000)
      }))

      const start = performance.now()
      const state = createPaginationState(largeSet, 0, terminalSize, config)
      const end = performance.now()

      expect(state).not.toBeNull()
      expect(end - start).toBeLessThan(50) // Should complete in < 50ms
    })
  })
})
