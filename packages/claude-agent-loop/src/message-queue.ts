/**
 * Claude Agent Loop - Message Queue (Instance-Based)
 *
 * Provides an async generator that yields `SDKUserMessage` items to the
 * Claude Agent SDK `query()` function.
 *
 * This implementation is instance-based (no module-level global state),
 * enabling multiple concurrent sessions (e.g., orchestrator sub-agents).
 */

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

export interface MessageQueueItem {
  message: SDKUserMessage['message'];
  resolve: () => void;
}

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class MessageQueue {
  private queue: MessageQueueItem[] = [];
  private waiters: Array<(item: MessageQueueItem | null) => void> = [];
  private aborted = false;
  private sessionId: string;

  constructor(initialSessionId?: string | null) {
    this.sessionId =
      typeof initialSessionId === 'string' && initialSessionId.trim().length > 0
        ? initialSessionId
        : generateSessionId();
  }

  getSessionId(): string {
    return this.sessionId;
  }

  setSessionId(nextSessionId?: string | null): void {
    if (typeof nextSessionId === 'string' && nextSessionId.trim().length > 0) {
      this.sessionId = nextSessionId;
    } else {
      this.sessionId = generateSessionId();
    }
  }

  queueMessage(message: SDKUserMessage['message']): Promise<void> {
    if (this.aborted) {
      return Promise.reject(new Error('MessageQueue aborted'));
    }

    return new Promise<void>((resolve) => {
      const item: MessageQueueItem = { message, resolve };
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(item);
      } else {
        this.queue.push(item);
      }
    });
  }

  clear(): void {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      item?.resolve();
    }
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    this.clear();
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.(null);
    }
  }

  private async nextItem(): Promise<MessageQueueItem | null> {
    if (this.aborted) return null;

    const queued = this.queue.shift();
    if (queued) return queued;

    return await new Promise<MessageQueueItem | null>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  async *generator(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      const item = await this.nextItem();
      if (!item) return;

      yield {
        type: 'user',
        message: item.message,
        parent_tool_use_id: null,
        session_id: this.getSessionId()
      };
      item.resolve();
    }
  }
}

