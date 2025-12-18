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
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[\d+m/g, '')
}

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
      const cleanLine = stripAnsi(line)
      height += Math.max(1, Math.ceil(cleanLine.length / terminalColumns))
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

export interface RenderableMessage extends Message {
  // If present, only render lines in this range [start, end)
  // relative to the rendered message lines
  visibleLines?: { start: number; end: number }
}

/**
 * Calculate which messages should be visible based on scroll offset (LINES)
 *
 * Algorithm:
 * 1. Iterate backwards from last message
 * 2. Skip 'lineScrollOffset' lines from the bottom
 * 3. Collect messages until 'availableRows' is filled
 * 4. Handle partial messages at top/bottom of viewport
 */
export function calculateVisibleMessages(
  messages: Message[],
  lineScrollOffset: number,
  availableRows: number,
  terminalColumns: number,
  collapsedToolIds?: Set<string>
): RenderableMessage[] {
  const totalMessages = messages.length
  if (totalMessages === 0) return []

  const reversedMessages = [...messages].reverse()
  const result: RenderableMessage[] = []

  let linesToSkip = Math.max(0, lineScrollOffset)
  let currentVisibleRows = 0

  for (const msg of reversedMessages) {
    // If we've filled the screen, stop
    if (currentVisibleRows >= availableRows) break

    const isCollapsed = msg.toolId && collapsedToolIds?.has(msg.toolId)
    const msgHeight = calculateMessageHeight(msg, terminalColumns, isCollapsed)

    // CASE 1: Skip this entire message (scrolled past it)
    if (linesToSkip >= msgHeight) {
      linesToSkip -= msgHeight
      continue
    }

    // CASE 2: Partially visible (bottom cropped) OR Fully visible
    // linesToSkip < msgHeight, so at least some part is visible
    // If linesToSkip > 0, we hide the bottom N lines.
    // So visible range starts at 0 (top) and ends at msgHeight - linesToSkip.
    // Wait, "visibleLines" usually implies lines of text.
    // But `msgHeight` includes headers/spacers.
    // We'll pass abstract "render lines" range. The renderer must map this to content.
    // Range is [0, msgHeight) normally.
    // Here we want [0, msgHeight - linesToSkip).

    let visibleStart = 0
    let visibleEnd = msgHeight - linesToSkip
    
    // We consumed the skip debt
    linesToSkip = 0

    // Now check if this message overflows the TOP of the screen
    // We have 'currentVisibleRows' filled so far.
    // We want to add (visibleEnd - visibleStart) lines.
    const linesToAdd = visibleEnd - visibleStart
    
    if (currentVisibleRows + linesToAdd > availableRows) {
      // It overflows the top. We must crop the start (top).
      // Space remaining = availableRows - currentVisibleRows
      const spaceRemaining = availableRows - currentVisibleRows
      // We want the BOTTOM 'spaceRemaining' lines of this message chunk.
      // So new start is: visibleEnd - spaceRemaining
      visibleStart = visibleEnd - spaceRemaining
    }

    // Add to result (prepend because we're iterating backwards)
    // Actually we'll reverse the result at the end
    const renderable: RenderableMessage = { ...msg }
    
    // Only set visibleLines if partial
    if (visibleStart > 0 || visibleEnd < msgHeight) {
      renderable.visibleLines = { start: visibleStart, end: visibleEnd }
    }

    result.push(renderable)
    currentVisibleRows += (visibleEnd - visibleStart)
  }

  return result.reverse()
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
  totalMessages: number // Ignored now, unbounded line scroll? Or we need max lines?
): number {
  // Ideally we clamp to max lines, but calculating total lines is expensive.
  // For now, allow unbounded scroll up, but clamp at 0 for bottom.
  // The UI can limit it if empty.
  return Math.max(0, currentOffset - amount) // Invert logic: Scroll UP increases offset (lines from bottom)
  // Wait, existing logic:
  // "Positive amount: scroll down (decrease offset)"
  // So currentOffset is "lines from bottom".
  // if amount is +1 (scroll down), offset should decrease.
  // if amount is -1 (scroll up), offset should increase.
  
  // Actually, let's keep it simple:
  // Offset = distance from bottom.
  // Scroll Down = view moves down = offset decreases.
  // Scroll Up = view moves up = offset increases.
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
  // Hard to tell without total lines. Approximate with message count?
  // Let's just say "no" for now or use a large number check.
  return false 
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
    scrollOffset,
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
