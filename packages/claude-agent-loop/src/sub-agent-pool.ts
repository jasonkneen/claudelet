/**
 * Sub-Agent Pool
 *
 * Manages the lifecycle of sub-agents for the orchestrator:
 * - Spawning agents with specific model preferences
 * - Executing tasks on agents
 * - Tracking agent status and progress
 * - Terminating agents when done
 */

import { EventEmitter } from 'events';
import { startAgentSession } from './agent-session.js';
import type { ModelPreference, AgentSessionOptions, AgentSessionEvents, AgentSessionHandle } from './types.js';
import type { UserTask } from './orchestrator.js';

/**
 * Status of a sub-agent
 */
export type SubAgentStatus = 'idle' | 'running' | 'waiting' | 'done' | 'error';

/**
 * Represents a sub-agent instance
 */
export interface SubAgent {
  /** Unique agent identifier */
  id: string;
  /** Model this agent is using */
  model: ModelPreference;
  /** Current status */
  status: SubAgentStatus;
  /** ID of current task being executed */
  currentTaskId?: string;
  /** Current task description */
  currentTask?: string;
  /** Progress indicator */
  progress?: {
    percent: number;
    message: string;
  };
  /** Live streaming output buffer */
  liveOutput?: string;
  /** Session handle for the agent */
  sessionHandle?: AgentSessionHandle;
  /** Event emitter for this agent's events */
  events: EventEmitter;
  /** When this agent was spawned */
  spawnedAt: Date;
  /** When this agent completed (if done) */
  completedAt?: Date;
  /** Error message if status is 'error' */
  error?: string;
  /** Accumulated result from the agent */
  result?: unknown;
}

/**
 * Pool of sub-agents managed by the orchestrator
 */
export class SubAgentPool extends EventEmitter {
  private agents: Map<string, SubAgent> = new Map();
  private sessionOptions: Omit<AgentSessionOptions, 'modelPreference'>;
  private baseEvents: AgentSessionEvents;
  private agentCounter = 0;

  constructor(
    sessionOptions: Omit<AgentSessionOptions, 'modelPreference'>,
    baseEvents: AgentSessionEvents = {}
  ) {
    super();
    this.sessionOptions = sessionOptions;
    this.baseEvents = baseEvents;
  }

  /**
   * Generate a unique agent ID
   */
  private generateAgentId(model: ModelPreference): string {
    const prefix = model === 'fast' ? 'haiku' :
                   model === 'smart-sonnet' ? 'sonnet' : 'opus';
    return `${prefix}-${++this.agentCounter}`;
  }

  /**
   * Spawn a new sub-agent with the specified model
   */
  async spawn(model: ModelPreference): Promise<SubAgent> {
    const id = this.generateAgentId(model);
    const events = new EventEmitter();

    const agent: SubAgent = {
      id,
      model,
      status: 'idle',
      events,
      spawnedAt: new Date()
    };

    // Create event handlers that forward to the agent's event emitter
    const agentEvents: AgentSessionEvents = {
      onTextChunk: (text: string) => {
        // Append to live output buffer
        agent.liveOutput = (agent.liveOutput || '') + text;
        // Cap buffer size to prevent memory issues
        if (agent.liveOutput.length > 10000) {
          agent.liveOutput = agent.liveOutput.slice(-8000);
        }
        events.emit('text', { agentId: id, text });
        this.baseEvents.onTextChunk?.(text);
      },
      onThinkingStart: (data: { index: number }) => {
        events.emit('thinkingStart', { agentId: id, ...data });
        this.baseEvents.onThinkingStart?.(data);
      },
      onThinkingChunk: (data: { index: number; delta: string }) => {
        events.emit('thinkingChunk', { agentId: id, ...data });
        this.baseEvents.onThinkingChunk?.(data);
      },
      onToolUseStart: (data: { id: string; name: string; input: Record<string, unknown>; streamIndex: number }) => {
        agent.progress = {
          percent: agent.progress?.percent || 0,
          message: `Using ${data.name}...`
        };
        events.emit('toolStart', { agentId: id, toolName: data.name, ...data });
        this.baseEvents.onToolUseStart?.(data);
      },
      onToolResultComplete: (data: { toolUseId: string; content: string; isError?: boolean }) => {
        events.emit('toolComplete', { agentId: id, ...data });
        this.baseEvents.onToolResultComplete?.(data);
      },
      onMessageComplete: () => {
        agent.status = 'done';
        agent.completedAt = new Date();
        agent.progress = { percent: 100, message: 'Complete' };
        events.emit('complete', { agentId: id });
        this.emit('agentComplete', agent);
        this.baseEvents.onMessageComplete?.();
      },
      onMessageStopped: () => {
        agent.status = 'idle';
        events.emit('stopped', { agentId: id });
        this.baseEvents.onMessageStopped?.();
      },
      onError: (error: string) => {
        agent.status = 'error';
        agent.error = error;
        agent.completedAt = new Date();
        events.emit('error', { agentId: id, error });
        this.emit('agentError', agent);
        this.baseEvents.onError?.(error);
      },
      onSessionInit: (data: { sessionId: string; resumed: boolean; model: string; modelDisplay: string }) => {
        events.emit('init', { agentId: id, ...data });
        this.baseEvents.onSessionInit?.(data);
      },
      onDebugMessage: (message: string) => {
        events.emit('debug', { agentId: id, message });
        this.baseEvents.onDebugMessage?.(message);
      }
    };

    // Start the agent session
    try {
      const sessionHandle = await startAgentSession(
        {
          ...this.sessionOptions,
          modelPreference: model
        },
        agentEvents
      );

      agent.sessionHandle = sessionHandle;
      this.agents.set(id, agent);

      this.emit('agentSpawned', agent);
      return agent;
    } catch (err) {
      agent.status = 'error';
      agent.error = err instanceof Error ? err.message : String(err);
      this.agents.set(id, agent);
      throw err;
    }
  }

  /**
   * Execute a task on a specific agent
   */
  async execute(agentId: string, task: UserTask): Promise<unknown> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }
    if (!agent.sessionHandle) {
      throw new Error(`Agent ${agentId} has no session handle`);
    }

    // Update agent state
    agent.status = 'running';
    agent.currentTaskId = task.id;
    agent.currentTask = task.content;
    agent.liveOutput = '';
    agent.progress = { percent: 0, message: 'Starting...' };

    this.emit('agentStarted', agent);
    agent.events.emit('started', { agentId, taskId: task.id, model: agent.model });

    return new Promise((resolve, reject) => {
      // Set up completion handlers
      const onComplete = () => {
        cleanup();
        agent.result = agent.liveOutput;
        resolve(agent.result);
      };

      const onError = (data: { error: string }) => {
        cleanup();
        reject(new Error(data.error));
      };

      const onStopped = () => {
        cleanup();
        agent.status = 'done';
        agent.completedAt = new Date();
        resolve(agent.liveOutput);
      };

      const cleanup = () => {
        agent.events.off('complete', onComplete);
        agent.events.off('error', onError);
        agent.events.off('stopped', onStopped);
      };

      agent.events.once('complete', onComplete);
      agent.events.once('error', onError);
      agent.events.once('stopped', onStopped);

      // Send the message
      agent.sessionHandle!.sendMessage({
        role: 'user',
        content: task.content
      }).catch(reject);
    });
  }

  /**
   * Get an agent by ID
   */
  getAgent(agentId: string): SubAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents
   */
  getAllAgents(): SubAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents by status
   */
  getAgentsByStatus(status: SubAgentStatus): SubAgent[] {
    return this.getAllAgents().filter(a => a.status === status);
  }

  /**
   * Get agents by model
   */
  getAgentsByModel(model: ModelPreference): SubAgent[] {
    return this.getAllAgents().filter(a => a.model === model);
  }

  /**
   * Terminate a specific agent
   */
  async terminate(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    if (agent.sessionHandle) {
      try {
        await agent.sessionHandle.stop();
      } catch {
        // Ignore errors during termination
      }
    }

    agent.status = 'done';
    agent.completedAt = new Date();
    agent.events.removeAllListeners();

    this.emit('agentTerminated', agent);
    this.agents.delete(agentId);
  }

  /**
   * Terminate all agents
   */
  async terminateAll(): Promise<void> {
    const terminatePromises = Array.from(this.agents.keys()).map(id =>
      this.terminate(id)
    );
    await Promise.all(terminatePromises);
  }

  /**
   * Interrupt a running agent
   */
  async interrupt(agentId: string): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent?.sessionHandle || agent.status !== 'running') {
      return false;
    }

    try {
      return await agent.sessionHandle.interrupt();
    } catch {
      return false;
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    total: number;
    idle: number;
    running: number;
    done: number;
    error: number;
    byModel: Record<ModelPreference, number>;
  } {
    const agents = this.getAllAgents();
    return {
      total: agents.length,
      idle: agents.filter(a => a.status === 'idle').length,
      running: agents.filter(a => a.status === 'running').length,
      done: agents.filter(a => a.status === 'done').length,
      error: agents.filter(a => a.status === 'error').length,
      byModel: {
        fast: agents.filter(a => a.model === 'fast').length,
        'smart-sonnet': agents.filter(a => a.model === 'smart-sonnet').length,
        'smart-opus': agents.filter(a => a.model === 'smart-opus').length,
        auto: agents.filter(a => a.model === 'auto').length
      }
    };
  }
}
