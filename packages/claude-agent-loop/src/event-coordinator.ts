/**
 * Event Coordinator
 *
 * Aggregates events from all sub-agents into a unified event stream.
 * Provides real-time communication between sub-agents and the coordinator.
 */

import { EventEmitter } from 'events';
import type { SubAgent } from './sub-agent-pool.js';
import type { ModelPreference } from './types.js';

/**
 * Events emitted by sub-agents to the coordinator
 */
export type SubAgentEvent =
  // Lifecycle events
  | { type: 'started'; agentId: string; taskId: string; model: ModelPreference }
  | { type: 'completed'; agentId: string; taskId: string; result: unknown }
  | { type: 'failed'; agentId: string; taskId: string; error: string }
  | { type: 'delegated'; agentId: string; taskId: string; delegatedTo: ModelPreference; reason: string }

  // Progress events
  | { type: 'thinking'; agentId: string; delta: string }
  | { type: 'streaming'; agentId: string; text: string }
  | { type: 'progress'; agentId: string; percent: number; message: string }

  // Tool events
  | { type: 'toolStart'; agentId: string; toolName: string; toolInput?: unknown }
  | { type: 'toolComplete'; agentId: string; toolName: string; result?: unknown; isError?: boolean }

  // Coordination events
  | { type: 'needsHelp'; agentId: string; issue: string; suggestedModel: ModelPreference }
  | { type: 'blocking'; agentId: string; waitingFor: string }
  | { type: 'canDelegate'; agentId: string; task: string; suggestedModel: ModelPreference };

/**
 * Commands sent from coordinator to sub-agents
 */
export type CoordinatorCommand =
  | { type: 'execute'; taskId: string; prompt: string; mode?: 'fast' | 'default' }
  | { type: 'interrupt'; taskId: string; reason?: string }
  | { type: 'delegate'; taskId: string; to: ModelPreference }
  | { type: 'abort'; taskId: string }
  | { type: 'provide'; dataId: string; data: unknown };

/**
 * Subscription info for an agent
 */
interface AgentSubscription {
  agentId: string;
  agent: SubAgent;
  unsubscribe: () => void;
}

/**
 * EventCoordinator - Aggregates and coordinates events between agents
 */
export class EventCoordinator extends EventEmitter {
  private subscriptions: Map<string, AgentSubscription> = new Map();
  private eventBuffer: SubAgentEvent[] = [];
  private maxBufferSize = 1000;
  private toolNameByUseId: Map<string, string> = new Map();

  constructor() {
    super();
    this.setMaxListeners(100); // Allow many listeners for multiple agents
  }

  /**
   * Subscribe to events from a sub-agent
   */
  subscribe(agentId: string, agent: SubAgent): void {
    // Don't subscribe twice
    if (this.subscriptions.has(agentId)) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers: Array<{ event: string; handler: (...args: any[]) => void }> = [];

    // Text streaming
    const onText = (data: { agentId: string; text: string }) => {
      this.emitEvent({ type: 'streaming', ...data });
    };
    agent.events.on('text', onText);
    handlers.push({ event: 'text', handler: onText });

    // Started (task assigned)
    const onStarted = (data: { agentId: string; taskId: string; model: ModelPreference }) => {
      this.emitEvent({ type: 'started', ...data });
    };
    agent.events.on('started', onStarted);
    handlers.push({ event: 'started', handler: onStarted });

    // Thinking
    const onThinking = (data: { agentId: string; delta: string }) => {
      this.emitEvent({ type: 'thinking', ...data });
    };
    agent.events.on('thinkingChunk', onThinking);
    handlers.push({ event: 'thinkingChunk', handler: onThinking });

    // Tool start
    const onToolStart = (data: { agentId: string; toolName: string; id?: string; name?: string; input?: unknown }) => {
      const toolUseId = typeof data.id === 'string' ? data.id : undefined;
      const name = typeof data.name === 'string' && data.name.length > 0 ? data.name : data.toolName;
      if (toolUseId) {
        this.toolNameByUseId.set(toolUseId, name);
      }
      this.emitEvent({
        type: 'toolStart',
        agentId: data.agentId,
        toolName: name,
        toolInput: data.input
      });
    };
    agent.events.on('toolStart', onToolStart);
    handlers.push({ event: 'toolStart', handler: onToolStart });

    // Tool complete
    const onToolComplete = (data: { agentId: string; toolUseId: string; content: string; isError?: boolean }) => {
      const toolName = this.toolNameByUseId.get(data.toolUseId) ?? data.toolUseId;
      this.emitEvent({
        type: 'toolComplete',
        agentId: data.agentId,
        toolName,
        result: data.content,
        isError: data.isError
      });
    };
    agent.events.on('toolComplete', onToolComplete);
    handlers.push({ event: 'toolComplete', handler: onToolComplete });

    // Complete
    const onComplete = (data: { agentId: string }) => {
      this.emitEvent({
        type: 'completed',
        agentId: data.agentId,
        taskId: agent.currentTaskId || '',
        result: agent.liveOutput
      });
    };
    agent.events.on('complete', onComplete);
    handlers.push({ event: 'complete', handler: onComplete });

    // Error
    const onError = (data: { agentId: string; error: string }) => {
      this.emitEvent({
        type: 'failed',
        agentId: data.agentId,
        taskId: agent.currentTaskId || '',
        error: data.error
      });
    };
    agent.events.on('error', onError);
    handlers.push({ event: 'error', handler: onError });

    // Stopped (treat as completed)
    const onStopped = (data: { agentId: string }) => {
      this.emitEvent({
        type: 'completed',
        agentId: data.agentId,
        taskId: agent.currentTaskId || '',
        result: agent.liveOutput
      });
    };
    agent.events.on('stopped', onStopped);
    handlers.push({ event: 'stopped', handler: onStopped });

    // Create unsubscribe function
    const unsubscribe = () => {
      for (const { event, handler } of handlers) {
        agent.events.off(event, handler);
      }
    };

    this.subscriptions.set(agentId, { agentId, agent, unsubscribe });

  }

  /**
   * Unsubscribe from an agent's events
   */
  unsubscribe(agentId: string): void {
    const subscription = this.subscriptions.get(agentId);
    if (subscription) {
      subscription.unsubscribe();
      this.subscriptions.delete(agentId);
    }
  }

  /**
   * Emit an event and buffer it
   */
  private emitEvent(event: SubAgentEvent): void {
    // Add to buffer
    this.eventBuffer.push(event);

    // Trim buffer if too large
    if (this.eventBuffer.length > this.maxBufferSize) {
      this.eventBuffer = this.eventBuffer.slice(-this.maxBufferSize / 2);
    }

    // Emit to listeners
    this.emit('event', event);
  }

  /**
   * Get recent events (for late subscribers)
   */
  getRecentEvents(count = 100): SubAgentEvent[] {
    return this.eventBuffer.slice(-count);
  }

  /**
   * Get events for a specific agent
   */
  getAgentEvents(agentId: string, count = 100): SubAgentEvent[] {
    return this.eventBuffer
      .filter(e => e.agentId === agentId)
      .slice(-count);
  }

  /**
   * Create an async iterator for events
   */
  async *aggregate(): AsyncIterable<SubAgentEvent> {
    const queue: SubAgentEvent[] = [];
    let resolve: ((value: SubAgentEvent) => void) | null = null;

    const handler = (event: SubAgentEvent) => {
      if (resolve) {
        resolve(event);
        resolve = null;
      } else {
        queue.push(event);
      }
    };

    this.on('event', handler);

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          yield await new Promise<SubAgentEvent>(r => {
            resolve = r;
          });
        }
      }
    } finally {
      this.off('event', handler);
    }
  }

  /**
   * Send a command to a specific agent (not implemented - agents receive via task execution)
   */
  sendCommand(_agentId: string, _command: CoordinatorCommand): void {
    // Commands are handled through the SubAgentPool's execute method
    // This is a placeholder for future direct communication if needed
    throw new Error('Direct commands not implemented - use SubAgentPool.execute()');
  }

  /**
   * Get all subscribed agent IDs
   */
  getSubscribedAgents(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Check if an agent is subscribed
   */
  isSubscribed(agentId: string): boolean {
    return this.subscriptions.has(agentId);
  }

  /**
   * Clear all subscriptions and buffer
   */
  clear(): void {
    for (const subscription of Array.from(this.subscriptions.values())) {
      subscription.unsubscribe();
    }
    this.subscriptions.clear();
    this.eventBuffer = [];
    this.toolNameByUseId.clear();
    this.removeAllListeners();
  }
}
