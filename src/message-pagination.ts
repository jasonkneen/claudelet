/**
 * Message Pagination Utilities
 *
 * Provides virtual scrolling and pagination functionality for handling
 * unbounded message history without memory bloat or rendering performance issues.
 */

export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  timestamp: Date
  toolName?: string
  toolId?: string
  isCollapsed?: boolean
  toolInput?: Record<string, unknown>
}

export interface TerminalSize {
  rows: number
  columns: number
}

export interface PaginationState {
  visibleMessages: Message[]
  scrollOffset: number
  totalMessages: number
  visibleCount: number
}

export interface PaginationConfig {
  inputHeight: number
  statusHeight: number
  paddingHeight: number
  toolChipsHeight: number
  contextChipsHeight: number
}

/**
 * Default pagination configuration
 */
export const defaultPaginationConfig: PaginationConfig = {
  inputHeight: 3,
  statusHeight: 2,
  paddingHeight: 2,
  toolChipsHeight: 0,
  contextChipsHeight: 0
}

/**
 * Calculate the height of a single message in terminal lines
 *
 * Accounts for:
 * - Header line (You: / Claude:)
 * - Content lines with wrapping
 * - Tool-specific content (input, output)
 * - Spacer between messages
 */
export function calculateMessageHeight(
  message: Message,
  terminalColumns: number,
  isCollapsed: boolean = false
): number {
  let height = 0

  // Header line (You: / Claude: / Tool:)
  height += 1

  // Content lines (with wrapping consideration)
  if (message.content) {
    const lines = message.content.split('\n')
    for (const line of lines) {
      // Account for line wrapping based on terminal width
      height += Math.max(1, Math.ceil(line.length / terminalColumns))
    }
  }

  // Tool-specific content
  if (message.role === 'tool' && !isCollapsed) {
    if (message.toolInput) {
      const inputJson = JSON.stringify(message.toolInput, null, 2)
      height += inputJson.split('\n').length + 1 // +1 for label
    }
  }

  // Spacer between messages
  height += 1

  return height
}

/**
 * Calculate available rows for message display
 *
 * Subtracts space needed for:
 * - Input area
 * - Status bar
 * - Padding/borders
 * - Tool chips row
 * - Context chips row
 */
export function calculateAvailableRows(
  terminalSize: TerminalSize,
  config: PaginationConfig
): number {
  const totalReserved =
    config.inputHeight +
    config.statusHeight +
    config.paddingHeight +
    config.toolChipsHeight +
    config.contextChipsHeight

  const available = Math.max(5, terminalSize.rows - totalReserved)

  return available
}

/**
 * Calculate which messages should be visible based on scroll offset
 *
 * Algorithm:
 * 1. Reverse message list (newest first)
 * 2. Apply scroll offset
 * 3. Iterate through messages, calculating height
 * 4. Stop when visible area is full
 * 5. Return slice of original message array
 */
export function calculateVisibleMessages(
  messages: Message[],
  scrollOffset: number,
  availableRows: number,
  terminalColumns: number,
  collapsedToolIds?: Set<string>
): Message[] {
  const totalMessages = messages.length

  if (totalMessages === 0) {
    return []
  }

  const reversedMessages = [...messages].reverse()

  // Ensure scroll offset is within bounds
  const effectiveScrollOffset = Math.max(
    0,
    Math.min(scrollOffset, totalMessages - 1)
  )

  // Get messages to consider (from most recent, backwards)
  const messagesToConsider = reversedMessages.slice(effectiveScrollOffset)

  let usedRows = 0
  let visibleCount = 0

  // Calculate how many messages fit in available rows
  for (const msg of messagesToConsider) {
    const isCollapsed = msg.toolId && collapsedToolIds?.has(msg.toolId)
    const msgHeight = calculateMessageHeight(msg, terminalColumns, isCollapsed)

    if (usedRows + msgHeight > availableRows) {
      break
    }

    usedRows += msgHeight
    visibleCount++
  }

  // Calculate slice indices
  // If we have 100 messages and scroll offset is 0, and visible count is 5
  // We want messages 95-100 (the last 5)
  const endIdx = totalMessages - effectiveScrollOffset
  const startIdx = Math.max(0, endIdx - visibleCount)

  return messages.slice(startIdx, endIdx)
}

/**
 * Apply scroll (return new offset after scrolling)
 *
 * Scroll direction:
 * - Positive amount: scroll down (decrease offset, toward newest)
 * - Negative amount: scroll up (increase offset, toward oldest)
 */
export function applyScroll(
  currentOffset: number,
  amount: number,
  totalMessages: number
): number {
  const maxOffset = Math.max(0, totalMessages - 1)
  const newOffset = Math.max(0, Math.min(currentOffset + amount, maxOffset))
  return newOffset
}

/**
 * Check if user is at the bottom of the message list
 */
export function isAtBottom(scrollOffset: number): boolean {
  return scrollOffset === 0
}

/**
 * Check if user is at the top of the message list
 */
export function isAtTop(scrollOffset: number, totalMessages: number): boolean {
  return scrollOffset >= Math.max(0, totalMessages - 1)
}

/**
 * Get pagination state summary
 */
export function getPaginationState(
  messages: Message[],
  scrollOffset: number,
  availableRows: number,
  terminalColumns: number,
  collapsedToolIds?: Set<string>
): PaginationState {
  const visibleMessages = calculateVisibleMessages(
    messages,
    scrollOffset,
    availableRows,
    terminalColumns,
    collapsedToolIds
  )

  return {
    visibleMessages,
    scrollOffset: Math.max(0, Math.min(scrollOffset, messages.length - 1)),
    totalMessages: messages.length,
    visibleCount: visibleMessages.length
  }
}

/**
 * Format pagination info for display
 *
 * Example: "Messages 95-100 of 150" or "Showing 6 of 150 messages"
 */
export function formatPaginationInfo(state: PaginationState): string {
  if (state.totalMessages === 0) {
    return 'No messages'
  }

  if (state.visibleCount === state.totalMessages) {
    return `All ${state.totalMessages} messages visible`
  }

  const startIdx = state.totalMessages - state.scrollOffset - state.visibleCount + 1
  const endIdx = state.totalMessages - state.scrollOffset

  return `Messages ${startIdx}-${endIdx} of ${state.totalMessages} (scroll: Ctrl+P/Ctrl+N)`
}

/**
 * Performance metrics for monitoring
 */
export interface PaginationMetrics {
  totalMessages: number
  visibleMessages: number
  renderTimeMs: number
  memoryEstimateMB: number
}

/**
 * Calculate estimated memory usage
 *
 * Rough estimate: each message ~5KB on average
 */
export function estimateMemoryUsage(messages: Message[]): number {
  const avgBytesPerMessage = 5000 // 5KB
  const totalBytes = messages.length * avgBytesPerMessage
  return totalBytes / (1024 * 1024) // Convert to MB
}

/**
 * Validate pagination configuration
 *
 * Ensures minimum viable space for messages
 */
export function validateConfig(
  config: PaginationConfig,
  terminalSize: TerminalSize
): boolean {
  const totalReserved =
    config.inputHeight +
    config.statusHeight +
    config.paddingHeight +
    config.toolChipsHeight +
    config.contextChipsHeight

  return terminalSize.rows - totalReserved >= 5 // At least 5 rows for messages
}

/**
 * Optimize visible messages for rendering
 *
 * Can be used to:
 * - Filter out certain message types
 * - Sort by criteria
 * - Apply other display logic
 */
export function filterVisibleMessages(
  messages: Message[],
  predicate: (msg: Message) => boolean
): Message[] {
  return messages.filter(predicate)
}

/**
 * Create pagination state for display
 *
 * Main entry point for getting pagination info for UI rendering
 */
export function createPaginationState(
  messages: Message[],
  scrollOffset: number,
  terminalSize: TerminalSize,
  config: PaginationConfig = defaultPaginationConfig,
  collapsedToolIds?: Set<string>
): PaginationState | null {
  if (!validateConfig(config, terminalSize)) {
    return null
  }

  const availableRows = calculateAvailableRows(terminalSize, config)

  return getPaginationState(
    messages,
    scrollOffset,
    availableRows,
    terminalSize.columns,
    collapsedToolIds
  )
}
