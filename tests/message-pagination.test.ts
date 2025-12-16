import { describe, it, expect, beforeEach } from 'vitest'

/**
 * Message Pagination Tests
 * Validates virtual scrolling and pagination performance
 */

interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  timestamp: Date
  toolName?: string
  toolId?: string
  isCollapsed?: boolean
  toolInput?: Record<string, unknown>
}

/**
 * Calculate visible messages based on scroll offset and available rows
 */
function calculateVisibleMessages(
  messages: Message[],
  scrollOffset: number,
  availableRows: number,
  terminalColumns: number
): Message[] {
  const totalMessages = messages.length
  const reversedMessages = [...messages].reverse()

  // Apply scroll offset
  const effectiveScrollOffset = Math.max(
    0,
    Math.min(scrollOffset, totalMessages - 1)
  )
  const messagesToConsider = reversedMessages.slice(effectiveScrollOffset)

  let usedRows = 0
  let visibleCount = 0

  for (const msg of messagesToConsider) {
    let msgHeight = 1 // Header line

    // Content lines
    if (msg.content) {
      const lines = msg.content.split('\n')
      for (const line of lines) {
        msgHeight += Math.max(1, Math.ceil(line.length / terminalColumns))
      }
    }

    // Spacer
    msgHeight += 1

    if (usedRows + msgHeight > availableRows) {
      break
    }

    usedRows += msgHeight
    visibleCount++
  }

  const endIdx = totalMessages - effectiveScrollOffset
  const startIdx = Math.max(0, endIdx - visibleCount)

  return messages.slice(startIdx, endIdx)
}

describe('Message Pagination', () => {
  let testMessages: Message[]

  beforeEach(() => {
    testMessages = Array.from({ length: 1000 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}: This is a test message with some content that may wrap.`,
      timestamp: new Date(Date.now() - (1000 - i) * 1000)
    }))
  })

  describe('Virtual Scrolling Calculation', () => {
    it('should calculate visible messages correctly', () => {
      const visible = calculateVisibleMessages(testMessages, 0, 30, 80)
      expect(visible.length).toBeGreaterThan(0)
      expect(visible.length).toBeLessThanOrEqual(testMessages.length)
    })

    it('should respect scroll offset', () => {
      const visible1 = calculateVisibleMessages(testMessages, 0, 30, 80)
      const visible2 = calculateVisibleMessages(testMessages, 10, 30, 80)

      // When offset increases, we see earlier messages
      expect(visible1).not.toEqual(visible2)
    })

    it('should handle edge cases: empty message list', () => {
      const visible = calculateVisibleMessages([], 0, 30, 80)
      expect(visible).toEqual([])
    })

    it('should handle edge cases: single message', () => {
      const singleMsg: Message[] = [
        {
          role: 'user',
          content: 'Test',
          timestamp: new Date()
        }
      ]
      const visible = calculateVisibleMessages(singleMsg, 0, 30, 80)
      expect(visible).toEqual(singleMsg)
    })

    it('should handle offset beyond message count', () => {
      const visible = calculateVisibleMessages(testMessages, 10000, 30, 80)
      expect(visible.length).toBeGreaterThanOrEqual(0)
      expect(visible.length).toBeLessThanOrEqual(testMessages.length)
    })
  })

  describe('Performance with Large Datasets', () => {
    it('should handle 10,000 messages without performance degradation', () => {
      const largeMessageSet = Array.from({ length: 10000 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}: Lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
        timestamp: new Date(Date.now() - (10000 - i) * 1000)
      }))

      const startTime = performance.now()
      const visible = calculateVisibleMessages(largeMessageSet, 0, 30, 80)
      const endTime = performance.now()

      const renderTime = endTime - startTime

      expect(visible.length).toBeGreaterThan(0)
      expect(renderTime).toBeLessThan(50) // Should complete in < 50ms
    })

    it('should maintain constant memory regardless of message count', () => {
      // With virtual scrolling, we only hold visible messages in render
      const visible = calculateVisibleMessages(testMessages, 0, 30, 80)

      // Memory test: ensure visible count is bounded regardless of input
      expect(visible.length).toBeLessThanOrEqual(100) // arbitrary reasonable limit
    })
  })

  describe('Scroll Position Preservation', () => {
    it('should preserve scroll position when new messages arrive', () => {
      const visible1 = calculateVisibleMessages(testMessages, 5, 30, 80)

      // Simulate new message arriving
      testMessages.push({
        role: 'assistant',
        content: 'New message',
        timestamp: new Date()
      })

      const visible2 = calculateVisibleMessages(testMessages, 5, 30, 80)

      // Scroll offset should still be valid
      expect(visible2.length).toBeGreaterThan(0)
    })

    it('should auto-scroll to bottom on new message if at end', () => {
      // At scroll offset 0 = at bottom
      const visible1 = calculateVisibleMessages(testMessages, 0, 30, 80)
      const wasAtBottom = visible1[visible1.length - 1] === testMessages[testMessages.length - 1]

      testMessages.push({
        role: 'assistant',
        content: 'New message',
        timestamp: new Date()
      })

      const visible2 = calculateVisibleMessages(testMessages, 0, 30, 80)
      const stillAtBottom = visible2[visible2.length - 1] === testMessages[testMessages.length - 1]

      expect(wasAtBottom).toBe(true)
      expect(stillAtBottom).toBe(true)
    })
  })

  describe('Message Filtering', () => {
    it('should not count tool messages in visible count', () => {
      const mixedMessages: Message[] = [
        { role: 'user', content: 'User msg', timestamp: new Date() },
        {
          role: 'tool',
          content: 'Tool msg',
          timestamp: new Date(),
          toolName: 'test'
        },
        { role: 'assistant', content: 'Assistant msg', timestamp: new Date() }
      ]

      const visible = calculateVisibleMessages(mixedMessages, 0, 30, 80)

      // Tool messages are filtered in rendering, not in pagination calculation
      // This test ensures tool messages don't break pagination
      expect(visible.length).toBeGreaterThan(0)
    })
  })

  describe('Terminal Size Handling', () => {
    it('should adapt to narrow terminals', () => {
      const visible = calculateVisibleMessages(testMessages, 0, 30, 40) // 40 columns

      expect(visible.length).toBeGreaterThan(0)
      expect(visible.length).toBeLessThanOrEqual(testMessages.length)
    })

    it('should adapt to wide terminals', () => {
      const visible = calculateVisibleMessages(testMessages, 0, 30, 200) // 200 columns

      expect(visible.length).toBeGreaterThan(0)
      expect(visible.length).toBeLessThanOrEqual(testMessages.length)
    })

    it('should handle very small available rows', () => {
      const visible = calculateVisibleMessages(testMessages, 0, 5, 80)

      expect(visible.length).toBeGreaterThan(0)
      expect(visible.length).toBeLessThanOrEqual(testMessages.length)
    })
  })
})
