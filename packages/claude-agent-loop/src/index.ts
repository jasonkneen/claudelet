/**
 * Claude Agent Loop
 *
 * A standalone package that provides the core agentic conversation loops
 * for the Claude Agent SDK. This package extracts the message queue and
 * streaming session management from Claude Agent Desktop.
 *
 * ## Core Concepts
 *
 * ### 1. Message Queue (Input Loop)
 * The message queue provides an async generator that:
 * - Runs in an infinite `while(true)` loop
 * - Waits for messages to be queued via `queueMessage()`
 * - Yields `SDKUserMessage` objects to the SDK's `query()` function
 * - Can be aborted gracefully for clean shutdown
 *
 * ### 2. Agent Session (Output Loop)
 * The agent session provides a streaming response processor that:
 * - Uses `for await` to iterate over SDK streaming responses
 * - Parses different message types (text, thinking, tool use, results)
 * - Emits events for each type of content
 * - Handles session lifecycle (start, interrupt, stop)
 *
 * ## Quick Start
 *
 * ```typescript
 * import { startAgentSession } from 'claude-agent-loop';
 *
 * const session = await startAgentSession(
 *   {
 *     apiKey: process.env.ANTHROPIC_API_KEY!,
 *     workingDirectory: process.cwd(),
 *     modelPreference: 'smart-sonnet'
 *   },
 *   {
 *     onTextChunk: (text) => process.stdout.write(text),
 *     onToolUseStart: (tool) => console.log(`\n[Using ${tool.name}]`),
 *     onMessageComplete: () => console.log('\n---')
 *   }
 * );
 *
 * // Send messages
 * await session.sendMessage({ role: 'user', content: 'Hello!' });
 *
 * // Later, stop the session
 * await session.stop();
 * ```
 *
 * @packageDocumentation
 */

// Export types
export type {
  AgentSessionEvents,
  AgentSessionHandle,
  AgentSessionOptions,
  ModelPreference
} from './types.js';

// Export message queue (instance-based)
export { MessageQueue } from './message-queue.js';
export type { MessageQueueItem } from './message-queue.js';

// Export agent session
export { startAgentSession } from './agent-session.js';

// Export model router
export {
  getModelDisplayFromPreference,
  modelChoiceFromPreference,
  MODEL_DISPLAY,
  MODEL_IDS,
  parseModelOverride,
  pickModel
} from './model-router.js';
export type { ModelChoice } from './model-router.js';

// Export smart message queue (priority-based with auto-injection)
export { SmartMessageQueue, globalMessageQueue } from './smart-message-queue.js';
export type { PendingMessage } from './smart-message-queue.js';

// Export authentication manager
export { AuthenticationManager, createAuthManager } from './auth.js'
export type { AuthConfig, OAuthFlowResult } from './auth.js'

// Export OAuth code validator (OAuth 2.0 PKCE security)
export { OAuthCodeValidator, createOAuthCodeValidator } from './oauth-code-validator.js'

// Export orchestration system (Fast Mode)
export { FastModeCoordinator } from './orchestrator.js';
export type {
  CoordinatorOptions,
  OrchestrationContext,
  OrchestrationPlan,
  UserTask
} from './orchestrator.js';

// Export task analyzer
export { analyzeTask, isQuickTask, needsOpusPlanning } from './task-analyzer.js';
export type { TaskAnalysis, TaskContext } from './task-analyzer.js';

// Export sub-agent pool
export { SubAgentPool } from './sub-agent-pool.js';
export type { SubAgent, SubAgentStatus } from './sub-agent-pool.js';

// Export event coordinator
export { EventCoordinator } from './event-coordinator.js';
export type { SubAgentEvent, CoordinatorCommand } from './event-coordinator.js';

// Export config loader
export {
  loadConfig,
  findConfigFolder,
  ensureConfigFolder,
  getMcpServers,
  getSkills
} from './config-loader.js';
export type {
  ClaudeletConfig,
  McpServerConfig,
  ToolConfig,
  SkillConfig
} from './config-loader.js';
