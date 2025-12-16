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
  status: 'idle' | 'triaging' | 'planning' | 'delegating' | 'running' | 'complete' | 'failed';
  analysis?: TaskAnalysis;
  plan?: OrchestrationPlan;
  subAgentIds: string[];
  results: Map<string, unknown>;
  createdAt: Date;
  completedAt?: Date;
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
          context.results.set(event.agentId, event.result);

          // Check if all sub-agents completed
          const allComplete = context.subAgentIds.every(
            id => context.results.has(id) || this.subAgentPool.getAgent(id)?.status === 'error'
          );

          if (allComplete) {
            this.updateContext(contextId, {
              status: 'complete',
              completedAt: new Date()
            });
          }
        } else if (event.type === 'failed') {
          // Mark the result as error
          context.results.set(event.agentId, { error: event.error });
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
    // Try to extract JSON from result
    if (typeof result === 'string') {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]) as OrchestrationPlan;
        } catch {
          // Fall through to default
        }
      }
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
      // Execute plan decomposition
      for (const task of plan.decomposition) {
        // Wait for dependencies
        if (task.dependsOn.length > 0) {
          await Promise.all(
            task.dependsOn.map((depId: string) => this.waitForTask(contextId, depId))
          );
        }

        // Spawn appropriate agent
        const model = task.suggestedModel === 'fast' ? 'fast' :
                      task.suggestedModel === 'smart-opus' ? 'smart-opus' : 'smart-sonnet';
        const agent = await this.subAgentPool.spawn(model);
        context.subAgentIds.push(agent.id);
        agentIds.push(agent.id);
        this.eventCoordinator.subscribe(agent.id, agent);

        // Execute task (fire and forget - events will track progress)
        this.subAgentPool.execute(agent.id, {
          id: task.taskId,
          content: task.description,
          priority: context.initialTask.priority
        }).catch((err: Error) => {
          this.emit('error', { agentId: agent.id, error: err });
        });
      }
    } else {
      // Simple delegation based on analysis
      const model = context.analysis.suggestedModel;
      const agent = await this.subAgentPool.spawn(model);
      context.subAgentIds.push(agent.id);
      agentIds.push(agent.id);
      this.eventCoordinator.subscribe(agent.id, agent);

      // Execute the main task
      this.subAgentPool.execute(agent.id, context.initialTask).catch((err: Error) => {
        this.emit('error', { agentId: agent.id, error: err });
      });
    }

    this.updateContext(contextId, { status: 'running' });
    return agentIds;
  }

  /**
   * Wait for a specific task to complete
   */
  private waitForTask(contextId: string, taskId: string): Promise<void> {
    return new Promise((resolve) => {
      const checkComplete = () => {
        const context = this.activeContexts.get(contextId);
        if (!context) {
          resolve();
          return;
        }

        // Find agent handling this task
        for (const agentId of context.subAgentIds) {
          const agent = this.subAgentPool.getAgent(agentId);
          if (agent?.currentTaskId === taskId && agent.status === 'done') {
            resolve();
            return;
          }
        }

        // Check again in 100ms
        setTimeout(checkComplete, 100);
      };
      checkComplete();
    });
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
