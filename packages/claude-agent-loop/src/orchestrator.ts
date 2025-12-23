/**
 * Fast Mode Orchestrator
 *
 * The coordinator that triages user requests and delegates to appropriate sub-agents.
 * - Haiku coordinator: Always responsive, never does actual work
 * - Delegates to: Haiku (grunt), Sonnet (main work), Opus (planning/critical)
 * - Invisible in UI - only sub-agents show in task boxes
 */

import { EventEmitter } from 'events';
import type { ModelPreference, AgentSessionHandle, AgentSessionOptions, AgentSessionEvents } from './types.js';
import { analyzeTask, type TaskAnalysis } from './task-analyzer.js';
import { SubAgentPool, type SubAgent } from './sub-agent-pool.js';
import { EventCoordinator, type SubAgentEvent } from './event-coordinator.js';

/**
 * User-submitted task/prompt
 */
export interface UserTask {
  id: string;
  content: string;
  context?: {
    files?: string[];
    previousMessages?: Array<{ role: string; content: string }>;
    constraints?: string[];
  };
  priority: 'URGENT' | 'NORMAL' | 'TODO';
}

/**
 * Orchestration context for a single user request
 */
export interface OrchestrationContext {
  id: string;
  initialTask: UserTask;
  status: 'idle' | 'triaging' | 'planning' | 'delegating' | 'running' | 'complete' | 'failed' | 'canceled';
  analysis?: TaskAnalysis;
  plan?: OrchestrationPlan;
  taskIds: string[];
  subAgentIds: string[];
  results: Map<string, OrchestrationResult>;
  createdAt: Date;
  completedAt?: Date;
}

export interface OrchestrationResult {
  taskId: string;
  agentId: string;
  model: ModelPreference;
  status: 'completed' | 'failed';
  output?: string;
  error?: string;
}

/**
 * Plan created by Opus for complex tasks
 */
export interface OrchestrationPlan {
  decomposition: Array<{
    taskId: string;
    description: string;
    suggestedModel: ModelPreference;
    dependsOn: string[];
    estimatedComplexity: number;
  }>;
  summary: string;
  questions?: string[];
  refinements?: string[];
}

/**
 * Options for the FastModeCoordinator
 */
export interface CoordinatorOptions {
  /** Base session options for spawning sub-agents */
  sessionOptions: Omit<AgentSessionOptions, 'modelPreference'>;
  /** Event handlers for sub-agent events */
  events?: AgentSessionEvents;
  /** Callback for orchestration status changes */
  onStatusChange?: (context: OrchestrationContext) => void;
  /** Callback for sub-agent events */
  onSubAgentEvent?: (event: SubAgentEvent) => void;
}

/**
 * FastModeCoordinator - The invisible triage layer
 *
 * This coordinator:
 * 1. Receives user tasks
 * 2. Analyzes complexity to determine routing
 * 3. For complex tasks, delegates to Opus for planning
 * 4. Reviews Opus plan and can ask clarifying questions
 * 5. Allocates sub-agents based on the plan
 * 6. Collects results and aggregates responses
 */
export class FastModeCoordinator extends EventEmitter {
  private subAgentPool: SubAgentPool;
  private eventCoordinator: EventCoordinator;
  private options: CoordinatorOptions;
  private activeContexts: Map<string, OrchestrationContext> = new Map();
  private contextCounter = 0;

  constructor(options: CoordinatorOptions) {
    super();
    this.options = options;
    this.subAgentPool = new SubAgentPool(options.sessionOptions, options.events);
    this.eventCoordinator = new EventCoordinator();

    // Forward sub-agent events to the orchestrator's listeners
    this.eventCoordinator.on('event', (event: SubAgentEvent) => {
      this.emit('subAgentEvent', event);
      options.onSubAgentEvent?.(event);

      // Update context based on event
      this.handleSubAgentEvent(event);
    });
  }

  /**
   * Generate a unique context ID
   */
  private generateContextId(): string {
    return `orch-${Date.now()}-${++this.contextCounter}`;
  }

  /**
   * Generate a unique task ID
   */
  private generateTaskId(): string {
    return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Create a new orchestration context
   */
  private createContext(task: UserTask): OrchestrationContext {
    const context: OrchestrationContext = {
      id: this.generateContextId(),
      initialTask: task,
      status: 'idle',
      taskIds: [],
      subAgentIds: [],
      results: new Map(),
      createdAt: new Date()
    };
    this.activeContexts.set(context.id, context);
    return context;
  }

  /**
   * Update context status and notify listeners
   */
  private updateContext(contextId: string, updates: Partial<OrchestrationContext>): void {
    const context = this.activeContexts.get(contextId);
    if (context) {
      Object.assign(context, updates);
      this.emit('contextUpdate', context);
      this.options.onStatusChange?.(context);
    }
  }

  /**
   * Handle events from sub-agents
   */
  private handleSubAgentEvent(event: SubAgentEvent): void {
    // Find context by agent ID
    for (const [contextId, context] of Array.from(this.activeContexts.entries())) {
      if (context.subAgentIds.includes(event.agentId)) {
        if (event.type === 'completed') {
          const taskId = event.taskId || event.agentId;
          context.results.set(taskId, {
            taskId,
            agentId: event.agentId,
            model: this.subAgentPool.getAgent(event.agentId)?.model ?? 'fast',
            status: 'completed',
            output: typeof event.result === 'string' ? event.result : JSON.stringify(event.result)
          });

          // Check if all sub-agents completed
          const allComplete =
            context.taskIds.length > 0
              ? context.taskIds.every((id) => context.results.has(id))
              : context.subAgentIds.every((id) => {
                  const agent = this.subAgentPool.getAgent(id);
                  return agent?.status === 'done' || agent?.status === 'error';
                });

          if (allComplete) {
            this.updateContext(contextId, {
              status: Array.from(context.results.values()).some((r) => r.status === 'failed')
                ? 'failed'
                : 'complete',
              completedAt: new Date()
            });
          }
        } else if (event.type === 'failed') {
          const taskId = event.taskId || event.agentId;
          context.results.set(taskId, {
            taskId,
            agentId: event.agentId,
            model: this.subAgentPool.getAgent(event.agentId)?.model ?? 'fast',
            status: 'failed',
            error: event.error
          });
        }
        break;
      }
    }
  }

  /**
   * Triage a user task - analyze and determine routing
   *
   * This is the entry point for processing user requests.
   * The coordinator NEVER does work itself - it only triages.
   */
  async triage(task: Omit<UserTask, 'id'>): Promise<{ contextId: string; analysis: TaskAnalysis }> {
    const userTask: UserTask = {
      ...task,
      id: this.generateTaskId()
    };

    const context = this.createContext(userTask);
    this.updateContext(context.id, { status: 'triaging' });

    // Analyze the task to determine complexity and routing
    const analysis = analyzeTask(task.content, task.context);
    this.updateContext(context.id, { analysis });

    // If complex task (needs planning), delegate to Opus first
    if (analysis.complexity >= 8 || analysis.needsPlanning) {
      this.updateContext(context.id, { status: 'planning' });

      // Spawn Opus for planning
      const opusAgent = await this.subAgentPool.spawn('smart-opus');
      context.subAgentIds.push(opusAgent.id);
      this.eventCoordinator.subscribe(opusAgent.id, opusAgent);

      // Execute planning task
      const planningPrompt = this.buildPlanningPrompt(userTask, analysis);
      const planResult = await this.subAgentPool.execute(opusAgent.id, {
        id: `${userTask.id}-plan`,
        content: planningPrompt,
        priority: userTask.priority
      });

      // Parse Opus response into plan
      const plan = this.parsePlanFromResult(planResult);
      this.updateContext(context.id, { plan });

      // Return analysis with plan embedded
      return {
        contextId: context.id,
        analysis: { ...analysis, plan }
      };
    }

    return { contextId: context.id, analysis };
  }

  /**
   * Build the prompt for Opus planning
   */
  private buildPlanningPrompt(task: UserTask, analysis: TaskAnalysis): string {
    return `You are a planning assistant. Analyze this task and create a detailed execution plan.

TASK: ${task.content}

ANALYSIS:
- Complexity: ${analysis.complexity}/10
- Intent: ${analysis.intent}
- Required tools: ${analysis.requiredTools.join(', ') || 'none specified'}

Please provide:
1. A decomposition into sub-tasks
2. For each sub-task:
   - A clear description
   - Suggested model (haiku for simple/tooling, sonnet for main work)
   - Dependencies on other sub-tasks
   - Estimated complexity (1-10)
3. Any questions that need clarification before execution
4. A brief summary of the approach

Format your response as JSON:
{
  "decomposition": [
    { "taskId": "t1", "description": "...", "suggestedModel": "fast|smart-sonnet", "dependsOn": [], "estimatedComplexity": 3 }
  ],
  "summary": "...",
  "questions": ["...", "..."]
}`;
  }

  /**
   * Parse Opus response into an orchestration plan
   */
  private parsePlanFromResult(result: unknown): OrchestrationPlan {
    const tryParse = (text: string): OrchestrationPlan | null => {
      const trimmed = text.trim();
      if (trimmed.startsWith('{')) {
        try {
          return JSON.parse(trimmed) as OrchestrationPlan;
        } catch {
          // continue
        }
      }

      // Prefer fenced JSON blocks
      const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
      if (fenced?.[1]) {
        try {
          return JSON.parse(fenced[1]) as OrchestrationPlan;
        } catch {
          // continue
        }
      }

      // Extract first JSON object using brace matching (string-aware)
      const first = extractFirstJsonObject(trimmed);
      if (first) {
        try {
          return JSON.parse(first) as OrchestrationPlan;
        } catch {
          // continue
        }
      }
      return null;
    };

    if (typeof result === 'string') {
      const parsed = tryParse(result);
      if (parsed) return parsed;
    }

    // Default minimal plan
    return {
      decomposition: [{
        taskId: 'main',
        description: 'Execute the main task',
        suggestedModel: 'smart-sonnet',
        dependsOn: [],
        estimatedComplexity: 5
      }],
      summary: 'Single-task execution'
    };
  }

  /**
   * Run an entire orchestration end-to-end and return a final response.
   */
  async run(task: Omit<UserTask, 'id'>, opts?: { timeoutMs?: number }): Promise<{ contextId: string; response: string }> {
    const { contextId, done } = await this.start(task, opts);
    return { contextId, response: await done };
  }

  /**
   * Start orchestration and return contextId immediately plus a completion promise.
   */
  async start(
    task: Omit<UserTask, 'id'>,
    opts?: { timeoutMs?: number }
  ): Promise<{ contextId: string; done: Promise<string> }> {
    const { contextId } = await this.triage(task);
    await this.delegate(contextId);

    const done = (async () => {
      const context = await this.waitForContext(contextId, opts?.timeoutMs ?? 10 * 60_000);
      if (context.status === 'canceled') return 'Canceled.';

      // 🚀 EPIC OPTIMIZATION: Skip summarizer for simple single-agent tasks
      // Only use summarizer when:
      // - Multiple sub-tasks that need aggregation
      // - OR complex single task (complexity >= 6) that needs cleanup
      const needsSummarizer = context.taskIds.length > 1 || (context.analysis?.complexity ?? 0) >= 6;

      if (!needsSummarizer) {
        // Simple task - return direct output, no need for expensive summarization agent
        return this.fallbackAggregate(context);
      }

      return await this.summarizeContext(contextId, context).catch(() => this.fallbackAggregate(context));
    })();

    return { contextId, done };
  }

  /**
   * Ask Opus a clarifying question about the plan
   */
  async askOpus(contextId: string, question: string): Promise<string> {
    const context = this.activeContexts.get(contextId);
    if (!context) throw new Error(`Context ${contextId} not found`);

    // Find or spawn Opus agent
    let opusAgentId = context.subAgentIds.find(
      id => this.subAgentPool.getAgent(id)?.model === 'smart-opus'
    );

    if (!opusAgentId) {
      const opusAgent = await this.subAgentPool.spawn('smart-opus');
      context.subAgentIds.push(opusAgent.id);
      this.eventCoordinator.subscribe(opusAgent.id, opusAgent);
      opusAgentId = opusAgent.id;
    }

    // Send question and get response
    const result = await this.subAgentPool.execute(opusAgentId, {
      id: this.generateTaskId(),
      content: `Regarding the previous plan:\n\n${question}`,
      priority: 'NORMAL'
    });

    // Update plan with refinements
    if (context.plan && typeof result === 'string') {
      context.plan.refinements = context.plan.refinements || [];
      context.plan.refinements.push(result);
    }

    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  /**
   * Delegate tasks to sub-agents based on analysis/plan
   */
  async delegate(contextId: string): Promise<string[]> {
    const context = this.activeContexts.get(contextId);
    if (!context) throw new Error(`Context ${contextId} not found`);
    if (!context.analysis) throw new Error(`Context ${contextId} has no analysis`);

    this.updateContext(contextId, { status: 'delegating' });

    const agentIds: string[] = [];
    const plan = context.plan || context.analysis.plan;

    if (plan && plan.decomposition.length > 0) {
      context.taskIds = plan.decomposition.map((t) => t.taskId);
      this.updateContext(contextId, { taskIds: context.taskIds });

      const taskPromises = new Map<string, Promise<OrchestrationResult>>();
      const taskDeferred = new Map<
        string,
        { promise: Promise<OrchestrationResult>; resolve: (r: OrchestrationResult) => void }
      >();

      for (const planned of plan.decomposition) {
        let resolve!: (r: OrchestrationResult) => void;
        const promise = new Promise<OrchestrationResult>((r) => {
          resolve = r;
        });
        taskDeferred.set(planned.taskId, { promise, resolve });
      }

      for (const planned of plan.decomposition) {
        const taskPromise = (async (): Promise<OrchestrationResult> => {
          const deps = planned.dependsOn
            .map((depId) => taskDeferred.get(depId)?.promise)
            .filter(Boolean) as Array<Promise<OrchestrationResult>>;
          await Promise.all(deps);

          const model: ModelPreference =
            planned.suggestedModel === 'fast'
              ? 'fast'
              : planned.suggestedModel === 'smart-opus'
                ? 'smart-opus'
                : 'smart-sonnet';

          const agent = await this.subAgentPool.spawn(model);
          context.subAgentIds.push(agent.id);
          agentIds.push(agent.id);
          this.eventCoordinator.subscribe(agent.id, agent);

          try {
            const output = await this.subAgentPool.execute(agent.id, {
              id: planned.taskId,
              content: planned.description,
              priority: context.initialTask.priority
            });
            const result: OrchestrationResult = {
              taskId: planned.taskId,
              agentId: agent.id,
              model,
              status: 'completed',
              output: typeof output === 'string' ? output : JSON.stringify(output)
            };
            context.results.set(planned.taskId, result);
            this.updateContext(contextId, { results: context.results });
            taskDeferred.get(planned.taskId)?.resolve(result);
            return result;
          } catch (err) {
            const result: OrchestrationResult = {
              taskId: planned.taskId,
              agentId: agent.id,
              model,
              status: 'failed',
              error: err instanceof Error ? err.message : String(err)
            };
            context.results.set(planned.taskId, result);
            this.updateContext(contextId, { results: context.results });
            taskDeferred.get(planned.taskId)?.resolve(result);
            return result;
          }
        })();

        taskPromises.set(planned.taskId, taskPromise);
      }

      void Promise.allSettled(taskPromises.values()).then((settled) => {
        const anyFailed = settled.some((r) => r.status === 'fulfilled' && r.value.status === 'failed');
        this.updateContext(contextId, {
          status: anyFailed ? 'failed' : 'complete',
          completedAt: new Date()
        });
      });
    } else {
      context.taskIds = [context.initialTask.id];
      this.updateContext(contextId, { taskIds: context.taskIds });

      const model = context.analysis.suggestedModel;
      const agent = await this.subAgentPool.spawn(model);
      context.subAgentIds.push(agent.id);
      agentIds.push(agent.id);
      this.eventCoordinator.subscribe(agent.id, agent);

      void this.subAgentPool.execute(agent.id, context.initialTask)
        .then((output) => {
          context.results.set(context.initialTask.id, {
            taskId: context.initialTask.id,
            agentId: agent.id,
            model,
            status: 'completed',
            output: typeof output === 'string' ? output : JSON.stringify(output)
          });
          this.updateContext(contextId, {
            status: 'complete',
            completedAt: new Date(),
            results: context.results
          });
        })
        .catch((err: Error) => {
          context.results.set(context.initialTask.id, {
            taskId: context.initialTask.id,
            agentId: agent.id,
            model,
            status: 'failed',
            error: err.message
          });
          this.updateContext(contextId, {
            status: 'failed',
            completedAt: new Date(),
            results: context.results
          });
          this.emit('error', { agentId: agent.id, error: err });
        });
    }

    this.updateContext(contextId, { status: 'running' });
    return agentIds;
  }

  /**
   * Wait for a context to reach a terminal state.
   */
  async waitForContext(contextId: string, timeoutMs: number): Promise<OrchestrationContext> {
    const existing = this.activeContexts.get(contextId);
    if (!existing) throw new Error(`Context ${contextId} not found`);

    const isTerminal = (status: OrchestrationContext['status']) =>
      status === 'complete' || status === 'failed' || status === 'canceled';

    if (isTerminal(existing.status)) return existing;

    return await new Promise<OrchestrationContext>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Orchestration timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const handler = (updated: OrchestrationContext) => {
        if (updated.id !== contextId) return;
        if (isTerminal(updated.status)) {
          cleanup();
          resolve(updated);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.off('contextUpdate', handler);
      };

      this.on('contextUpdate', handler);
    });
  }

  /**
   * Interrupt all running agents in a context and mark as canceled.
   */
  async interruptContext(contextId: string, reason?: string): Promise<void> {
    const context = this.activeContexts.get(contextId);
    if (!context) return;

    await Promise.all(
      context.subAgentIds.map((id) => this.subAgentPool.interrupt(id))
    );

    this.updateContext(contextId, {
      status: 'canceled',
      completedAt: new Date()
    });

    if (reason) {
      this.emit('warning', { contextId, reason });
    }
  }

  private fallbackAggregate(context: OrchestrationContext): string {
    const lines: string[] = [];
    lines.push(context.plan?.summary ? `Summary: ${context.plan.summary}` : 'Summary: Completed');
    for (const taskId of context.taskIds) {
      const r = context.results.get(taskId);
      if (!r) continue;
      lines.push('');
      lines.push(`=== ${taskId} (${r.model}, ${r.status}) ===`);
      if (r.status === 'failed') {
        lines.push(`Error: ${r.error ?? 'unknown error'}`);
      } else if (r.output) {
        lines.push(r.output);
      }
    }
    return lines.join('\n');
  }

  private async summarizeContext(contextId: string, context: OrchestrationContext): Promise<string> {
    const summarizer = await this.subAgentPool.spawn('smart-sonnet');
    context.subAgentIds.push(summarizer.id);
    this.eventCoordinator.subscribe(summarizer.id, summarizer);

    const results = context.taskIds
      .map((taskId) => context.results.get(taskId))
      .filter(Boolean) as OrchestrationResult[];

    const payload = results
      .map((r) => ({
        taskId: r.taskId,
        model: r.model,
        status: r.status,
        output: r.output,
        error: r.error
      }));

    const prompt = [
      'You are the synthesizer for an orchestrated team of sub-agents.',
      'Produce ONE final response to the user.',
      '',
      `USER TASK: ${context.initialTask.content}`,
      '',
      context.plan?.summary ? `PLAN SUMMARY: ${context.plan.summary}` : '',
      '',
      'SUB-AGENT RESULTS (JSON):',
      JSON.stringify(payload, null, 2),
      '',
      'Requirements:',
      '- Be concise but complete.',
      '- If any sub-task failed, call it out and propose a workaround or next step.',
      '- Prefer actionable steps, commands, and file paths when relevant.',
      '- Do not mention internal orchestration mechanics.'
    ].filter(Boolean).join('\n');

    const output = await this.subAgentPool.execute(summarizer.id, {
      id: `${contextId}-synth`,
      content: prompt,
      priority: context.initialTask.priority
    });

    return typeof output === 'string' ? output : JSON.stringify(output);
  }

  /**
   * Get all active sub-agents across all contexts
   */
  getSubAgents(): SubAgent[] {
    return this.subAgentPool.getAllAgents();
  }

  /**
   * Get a specific context
   */
  getContext(contextId: string): OrchestrationContext | undefined {
    return this.activeContexts.get(contextId);
  }

  /**
   * Get the event coordinator for subscribing to events
   */
  getEventCoordinator(): EventCoordinator {
    return this.eventCoordinator;
  }

  /**
   * Cleanup and dispose resources
   */
  async dispose(): Promise<void> {
    await this.subAgentPool.terminateAll();
    this.eventCoordinator.removeAllListeners();
    this.activeContexts.clear();
  }
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') depth++;
    if (ch === '}') depth--;

    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }

  return null;
}
