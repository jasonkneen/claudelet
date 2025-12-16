/**
 * Claude Agent Loop - Message Queue
 *
 * This module provides an async generator that creates a continuous message stream
 * for the Claude Agent SDK. It implements the "input loop" that waits for user
 * messages to be queued and yields them to the SDK for processing.
 *
 * ## How it works:
 *
 * 1. The `messageGenerator()` function is an infinite async generator that:
 *    - Runs in a `while(true)` loop
 *    - Waits for messages to be added to the queue via `queueMessage()`
 *    - Yields SDKUserMessage objects to the SDK's `query()` function
 *    - Can be aborted gracefully using `abortGenerator()`
 *
 * 2. External callers queue messages using `queueMessage()`, which:
 *    - Adds the message to the internal queue
 *    - Returns a Promise that resolves when the message is yielded
 *
 * 3. The generator polls the queue every 100ms and yields messages as they arrive.
 *
 * ## Usage:
 *
 * ```typescript
 * import { query } from '@anthropic-ai/claude-agent-sdk';
 * import { messageGenerator, queueMessage } from './message-queue';
 *
 * // Start the SDK query with the generator
 * const session = query({
 *   prompt: messageGenerator(),
 *   options: { ... }
 * });
 *
 * // Queue messages from user input
 * await queueMessage({ role: 'user', content: 'Hello!' });
 * ```
 */

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import type { MessageQueueItem } from './types.js';

// Internal state
let messageQueue: MessageQueueItem[] = [];
let sessionId = `session-${Date.now()}`;
let shouldAbort = false;

/**
 * Get the current message queue (for internal use/testing)
 */
export function getMessageQueue(): MessageQueueItem[] {
  return messageQueue;
}

/**
 * Queue a message to be sent to the agent.
 * Returns a Promise that resolves when the message is yielded to the generator.
 */
export function queueMessage(message: SDKUserMessage['message']): Promise<void> {
  return new Promise<void>((resolve) => {
    messageQueue.push({ message, resolve });
  });
}

/**
 * Clear the message queue and resolve all pending promises.
 * Use this when resetting or stopping a session.
 */
export function clearMessageQueue(): void {
  while (messageQueue.length > 0) {
    const item = messageQueue.shift();
    if (item) {
      item.resolve();
    }
  }
}

/**
 * Signal the message generator to abort.
 * The generator will stop on its next iteration.
 */
export function abortGenerator(): void {
  shouldAbort = true;
}

/**
 * Reset the abort flag for a new session.
 */
export function resetAbortFlag(): void {
  shouldAbort = false;
}

/**
 * Check if the generator should abort.
 */
export function shouldAbortGenerator(): boolean {
  return shouldAbort;
}

/**
 * Generate a new session ID.
 */
function generateSessionId(): string {
  return `session-${Date.now()}`;
}

/**
 * Set the session ID.
 * @param nextSessionId - Optional specific session ID to use (e.g., for resuming)
 */
export function setSessionId(nextSessionId?: string | null): void {
  if (nextSessionId && nextSessionId.trim().length > 0) {
    sessionId = nextSessionId;
    return;
  }
  sessionId = generateSessionId();
}

/**
 * Regenerate the session ID.
 * @param nextSessionId - Optional specific session ID to use
 */
export function regenerateSessionId(nextSessionId?: string | null): void {
  setSessionId(nextSessionId);
}

/**
 * Get the current session ID.
 */
export function getSessionId(): string {
  return sessionId;
}

/**
 * Reset all message queue state.
 * Call this when completely resetting the loop.
 */
export function resetMessageQueueState(): void {
  clearMessageQueue();
  shouldAbort = false;
  sessionId = generateSessionId();
  messageQueue = [];
}

/**
 * Async generator for streaming input mode.
 *
 * This generator:
 * 1. Runs in an infinite loop waiting for messages
 * 2. Polls the message queue every 100ms
 * 3. Yields SDKUserMessage objects when messages are available
 * 4. Exits gracefully when abortGenerator() is called
 *
 * @example
 * ```typescript
 * const session = query({
 *   prompt: messageGenerator(),
 *   options: { model: 'claude-sonnet-4-5-20250929' }
 * });
 *
 * // The generator will keep the session alive, waiting for messages
 * await queueMessage({ role: 'user', content: 'Hello!' });
 * ```
 */
export async function* messageGenerator(): AsyncGenerator<SDKUserMessage> {
  while (true) {
    // Check if generator should abort
    if (shouldAbort) {
      return;
    }

    // Wait for a message to be queued
    await new Promise<void>((resolve) => {
      const checkQueue = () => {
        // Check abort flag while waiting
        if (shouldAbort) {
          resolve();
          return;
        }

        if (messageQueue.length > 0) {
          resolve();
        } else {
          setTimeout(checkQueue, 100);
        }
      };
      checkQueue();
    });

    // Check abort flag again after waiting
    if (shouldAbort) {
      return;
    }

    // Get the next message from the queue
    const item = messageQueue.shift();
    if (item) {
      yield {
        type: 'user',
        message: item.message,
        parent_tool_use_id: null,
        session_id: getSessionId()
      };
      item.resolve();
    }
  }
}
