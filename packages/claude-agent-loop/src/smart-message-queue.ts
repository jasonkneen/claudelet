/**
 * Claude Agent Loop - Smart Priority Message Queue
 *
 * This module provides intelligent message queueing for interactive CLI/UI tools.
 * While Claude is responding, users can type messages that are automatically
 * prioritized and injected based on urgency level.
 *
 * ## Priority Levels:
 *
 * - **URGENT**: Messages starting with NO, STOP, WAIT, !!, etc.
 *   - Injected immediately with user alert
 *   - Examples: "NO WAIT use OAuth!", "STOP dont use that!"
 *
 * - **NORMAL**: Regular messages without special prefixes
 *   - Auto-injected every 30 seconds during streaming
 *   - Or can be force-injected by user (0-9 key binding)
 *   - Examples: "Also check performance", "Consider error handling"
 *
 * - **TODO**: Messages starting with "TODO:" prefix
 *   - Logged to .todos.md without interrupting conversation
 *   - Never queued, never injected
 *   - Examples: "TODO: Update docs", "TODO: Add tests"
 *
 * ## Usage:
 *
 * ```typescript
 * import { SmartMessageQueue } from './smart-message-queue';
 *
 * const queue = new SmartMessageQueue();
 *
 * // While Claude responds, capture input
 * const msg = queue.add("Also check performance");
 * console.log(queue.displayPanel()); // Show pending messages
 *
 * // During streaming loop, periodically inject
 * if (queue.shouldAutoInject()) {
 *   const nextMsg = queue.injectNext();
 *   if (nextMsg) {
 *     await session.sendMessage({ role: 'user', content: nextMsg.text });
 *   }
 * }
 *
 * // Check for urgent messages that need immediate attention
 * if (queue.hasUrgentMessages()) {
 *   console.log(queue.displayPanel()); // Show alerts
 * }
 * ```
 */

import * as fsp from 'fs/promises';
import * as path from 'path';

export interface PendingMessage {
  id: string;
  text: string;
  priority: 'urgent' | 'normal' | 'todo';
  timestamp: Date;
  forced?: boolean;
}

/**
 * Urgency detection patterns for automatic priority classification
 */
const URGENT_PATTERNS = [
  /^(NO|STOP|WAIT|DONT|DON'T|NEVER|CANCEL|ABORT)/i,
  /^(!!|CRITICAL|URGENT|ERROR|ALERT|STOP)/i,
  /don't\s+(do|use|forget|apply|change)/i,
  /must\s+(not|never)/i
];

const TODO_PATTERN = /^TODO:/i;

/**
 * Detect the priority level of a message based on patterns
 */
function detectPriority(text: string): 'urgent' | 'normal' | 'todo' {
  if (TODO_PATTERN.test(text)) return 'todo';
  if (URGENT_PATTERNS.some((p) => p.test(text))) return 'urgent';
  return 'normal';
}

/**
 * Smart Priority Queue for handling messages during streaming
 *
 * Automatically classifies messages by urgency and manages:
 * - Urgent message alerts
 * - Todo logging to file
 * - Periodic auto-injection of normal messages
 * - Visual pending messages panel
 */
export class SmartMessageQueue {
  pending: PendingMessage[] = [];
  todos: string[] = [];
  lastInjectionTime: number = 0;
  injectionInterval: number = 30_000; // 30 seconds

  constructor(
    injectionIntervalMs: number = 30_000,
    private todosFile: string = '.todos.md'
  ) {
    this.injectionInterval = injectionIntervalMs;
  }

  /**
   * Add a message to the queue with automatic priority detection
   */
  add(text: string): PendingMessage {
    const priority = detectPriority(text);
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    if (priority === 'todo') {
      this.logTodo(text.slice(5).trim()); // Remove "TODO:" prefix
      return { id, text, priority, timestamp: new Date() };
    }

    const msg: PendingMessage = { id, text, priority, timestamp: new Date() };
    this.pending.push(msg);
    return msg;
  }

  /**
   * Log a todo to the todos file (non-blocking)
   */
  logTodo(text: string, todosDir?: string): void {
    const timestamp = new Date().toISOString();
    const dir = todosDir || process.cwd();
    const todosPath = path.join(dir, this.todosFile);
    const entry = `- [ ] ${text} (${timestamp})\n`;

    // Fire-and-forget: don't block on file write
    fsp.appendFile(todosPath, entry, 'utf-8').catch((err) => {
      console.error(`[Error logging todo: ${err}]`);
    });
  }

  /**
   * Remove a message by ID
   */
  removeById(id: string): void {
    this.pending = this.pending.filter((msg) => msg.id !== id);
  }

  /**
   * Get and remove the next normal message for auto-injection
   */
  injectNext(): PendingMessage | null {
    // Only auto-inject normal messages, not urgent
    const normalIndex = this.pending.findIndex((msg) => msg.priority === 'normal');
    if (normalIndex === -1) return null;

    const msg = this.pending[normalIndex];
    this.removeById(msg.id);
    this.lastInjectionTime = Date.now();
    return msg;
  }

  /**
   * Force-inject a specific message by ID
   */
  forceInject(id: string): PendingMessage | null {
    const msg = this.pending.find((m) => m.id === id);
    if (!msg) return null;

    this.removeById(id);
    msg.forced = true;
    return msg;
  }

  /**
   * Check if it's time to auto-inject the next message
   */
  shouldAutoInject(): boolean {
    return (
      Date.now() - this.lastInjectionTime >= this.injectionInterval &&
      this.hasNormalMessages()
    );
  }

  /**
   * Check if there are any pending normal messages
   */
  hasNormalMessages(): boolean {
    return this.pending.some((msg) => msg.priority === 'normal');
  }

  /**
   * Check if there are any pending urgent messages
   */
  hasUrgentMessages(): boolean {
    return this.pending.some((msg) => msg.priority === 'urgent');
  }

  /**
   * Get the number of pending messages
   */
  getPendingCount(): number {
    return this.pending.length;
  }

  /**
   * Get pending messages of a specific priority
   */
  getMessagesByPriority(priority: 'urgent' | 'normal' | 'todo'): PendingMessage[] {
    return this.pending.filter((msg) => msg.priority === priority);
  }

  /**
   * Render the pending messages UI panel
   */
  displayPanel(): string {
    if (this.pending.length === 0) return '';

    const lines: string[] = [];
    lines.push(
      `\n┌─ PENDING MESSAGES (${this.pending.length}) ──────────────────────────┐`
    );

    this.pending.forEach((msg, index) => {
      const icon = msg.priority === 'urgent' ? '🔴' : '⚪';
      const displayText = msg.text.substring(0, 45).padEnd(45);
      lines.push(`│ ${icon} [${index}] ${displayText} [→]  │`);
    });

    lines.push('│                                               │');
    lines.push('│ Keys: 0-9=Force | SPACE=Edit | C=Clear        │');
    lines.push('└───────────────────────────────────────────────┘');

    return lines.join('\n');
  }

  /**
   * Clear all pending messages
   */
  clear(): void {
    this.pending = [];
  }

  /**
   * Reset the injection timer (useful after manual injection or response completion)
   */
  resetInjectionTimer(): void {
    this.lastInjectionTime = Date.now();
  }

  /**
   * Get current queue state for debugging
   */
  getState(): {
    pending: PendingMessage[];
    pendingCount: number;
    urgentCount: number;
    normalCount: number;
    lastInjectionTime: number;
    nextInjectionIn: number;
  } {
    const now = Date.now();
    const nextInject = Math.max(
      0,
      this.injectionInterval - (now - this.lastInjectionTime)
    );

    return {
      pending: this.pending,
      pendingCount: this.pending.length,
      urgentCount: this.getMessagesByPriority('urgent').length,
      normalCount: this.getMessagesByPriority('normal').length,
      lastInjectionTime: this.lastInjectionTime,
      nextInjectionIn: nextInject
    };
  }
}

// Export singleton instance for convenience
export const globalMessageQueue = new SmartMessageQueue();
