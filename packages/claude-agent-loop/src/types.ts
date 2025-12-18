/**
 * Claude Agent Loop - Type Definitions
 *
 * These types define the interfaces for the agentic conversation loops.
 */

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Model preference options for the Claude agent
 */
export type ModelPreference = 'fast' | 'smart-sonnet' | 'smart-opus' | 'auto';

/**
 * Configuration options for starting an agent session
 */
export interface AgentSessionOptions {
  /** Anthropic API key (required if oauthToken not provided) */
  apiKey?: string;

  /** OAuth access token (required if apiKey not provided) */
  oauthToken?: string;

  /** Working directory for the agent (where commands will run) */
  workingDirectory: string;

  /** Model preference: 'fast' (Haiku), 'smart-sonnet', or 'smart-opus' */
  modelPreference?: ModelPreference;

  /** Maximum thinking tokens for extended thinking mode */
  maxThinkingTokens?: number;

  /** Permission mode for tool execution */
  permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'default';

  /** Tools to allow (defaults to Bash, WebFetch, WebSearch, Skill) */
  allowedTools?: string[];

  /** System prompt configuration */
  systemPrompt?: {
    type: 'preset' | 'custom';
    preset?: 'claude_code';
    append?: string;
    content?: string;
  };

  /** Path to the Claude Code CLI executable (optional) */
  claudeCodeCliPath?: string;

  /** Executable to use for running scripts (e.g., 'bun', 'node') */
  executable?: string;

  /** Environment variables to pass to the agent */
  env?: Record<string, string>;

  /** Session ID to resume (optional, for continuing a previous conversation) */
  resumeSessionId?: string;

  /**
   * Setting sources to load MCP servers and other config from
   * - 'user': Global user config (~/.claude/)
   * - 'project': Project-level config (.claudelet/ or .claude/)
   * - 'local': Local settings
   * Default: ['user', 'project'] to enable MCP tools
   */
  settingSources?: ('user' | 'project' | 'local')[];

  /**
   * Config folder priority for loading settings
   * Default: ['.claudelet', '.claude']
   */
  configFolders?: string[];
}

/**
 * Events emitted during an agent session
 */
export interface AgentSessionEvents {
  /** Text chunk from the assistant's response */
  onTextChunk?: (text: string) => void;

  /** Start of a thinking block */
  onThinkingStart?: (data: { index: number }) => void;

  /** Thinking text chunk */
  onThinkingChunk?: (data: { index: number; delta: string }) => void;

  /** Start of a tool use */
  onToolUseStart?: (data: {
    id: string;
    name: string;
    input: Record<string, unknown>;
    streamIndex: number;
  }) => void;

  /** Tool input JSON delta (streaming tool input) */
  onToolInputDelta?: (data: { index: number; toolId: string; delta: string }) => void;

  /** End of a content block */
  onContentBlockStop?: (data: { index: number; toolId?: string }) => void;

  /** Start of a tool result */
  onToolResultStart?: (data: { toolUseId: string; content: string; isError: boolean }) => void;

  /** Tool result complete */
  onToolResultComplete?: (data: { toolUseId: string; content: string; isError?: boolean }) => void;

  /** Debug message from stderr */
  onDebugMessage?: (message: string) => void;

  /** Session initialized with session ID and model info */
  onSessionInit?: (data: {
    sessionId: string;
    resumed: boolean;
    model: string;
    modelDisplay: string;
  }) => void;

  /** Message completed (agent finished responding) */
  onMessageComplete?: () => void;

  /** Message was stopped/interrupted */
  onMessageStopped?: () => void;

  /** Error occurred during the session */
  onError?: (error: string) => void;
}

/**
 * Handle returned by startAgentSession for controlling the session
 */
export interface AgentSessionHandle {
  /** Check if the session is currently active */
  isActive: () => boolean;

  /** Send a message to the agent */
  sendMessage: (message: SDKUserMessage['message']) => Promise<void>;

  /** Interrupt the current response */
  interrupt: () => Promise<boolean>;

  /** Stop/reset the session */
  stop: () => Promise<void>;

  /** Change the model during an active session */
  setModel: (preference: ModelPreference) => Promise<void>;

  /** Get the current session ID */
  getSessionId: () => string;
}
