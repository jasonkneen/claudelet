/**
 * Claude Agent Loop - Agent Session
 *
 * This module provides the main "streaming session loop" that:
 * 1. Starts a Claude Agent SDK session with the message generator
 * 2. Processes all streaming responses from the agent
 * 3. Emits events for text, thinking, tool use, and tool results
 * 4. Handles session lifecycle (start, interrupt, stop)
 *
 * ## Architecture:
 *
 * ```
 * User Input → queueMessage() → messageGenerator() → SDK query() → streamingLoop → Events
 * ```
 *
 * The streaming loop uses `for await` to iterate over the SDK's response stream,
 * parsing different message types:
 * - `stream_event`: Real-time deltas (text, thinking, tool input)
 * - `assistant`: Complete assistant messages with tool results
 * - `result`: Final completion signal
 * - `system`: Session initialization with session ID
 *
 * ## Usage:
 *
 * ```typescript
 * const session = await startAgentSession({
 *   apiKey: 'sk-...',
 *   workingDirectory: '/path/to/project',
 *   onTextChunk: (text) => console.log(text),
 *   onToolUseStart: (tool) => console.log('Using:', tool.name)
 * });
 *
 * // Send a message
 * await session.sendMessage({ role: 'user', content: 'Hello!' });
 *
 * // Later, stop the session
 * await session.stop();
 * ```
 */

import { query, type Query } from '@anthropic-ai/claude-agent-sdk';


import {
  abortGenerator,
  clearMessageQueue,
  getSessionId,
  messageGenerator,
  queueMessage,
  regenerateSessionId,
  resetAbortFlag,
  setSessionId
} from './message-queue.js';
import { getModelDisplayFromPreference } from './model-router.js';
import type {
  AgentSessionEvents,
  AgentSessionHandle,
  AgentSessionOptions,
  ModelPreference
} from './types.js';

// Model IDs
const FAST_MODEL_ID = 'claude-haiku-4-5-20251001';
const SMART_SONNET_MODEL_ID = 'claude-sonnet-4-5-20250929';
const SMART_OPUS_MODEL_ID = 'claude-opus-4-5-20251101';

const MODEL_BY_PREFERENCE: Record<ModelPreference, string> = {
  fast: FAST_MODEL_ID,
  'smart-sonnet': SMART_SONNET_MODEL_ID,
  'smart-opus': SMART_OPUS_MODEL_ID
};

function getModelId(preference: ModelPreference = 'fast'): string {
  return MODEL_BY_PREFERENCE[preference] ?? FAST_MODEL_ID;
}

// Session state
let querySession: Query | null = null;
let isProcessing = false;
let shouldAbortSession = false;
let sessionTerminationPromise: Promise<void> | null = null;
let isInterruptingResponse = false;
let currentModelPreference: ModelPreference = 'fast';
let pendingResumeSessionId: string | null = null;

// Map stream index to tool ID for current message
const streamIndexToToolId: Map<number, string> = new Map();

/**
 * Check if a session is currently active.
 */
export function isSessionActive(): boolean {
  return isProcessing || querySession !== null;
}

/**
 * Interrupt the current response (stop the agent mid-stream).
 */
export async function interruptCurrentResponse(onStopped?: () => void): Promise<boolean> {
  if (!querySession) {
    return false;
  }

  if (isInterruptingResponse) {
    return true;
  }

  isInterruptingResponse = true;
  try {
    await querySession.interrupt();
    onStopped?.();
    return true;
  } catch (error) {
    console.error('Failed to interrupt current response:', error);
    throw error;
  } finally {
    isInterruptingResponse = false;
  }
}

/**
 * Reset/stop the current session.
 * @param resumeSessionId - Optional session ID to use when starting a new session
 */
export async function resetSession(resumeSessionId?: string | null): Promise<void> {
  // Signal any running session to abort
  shouldAbortSession = true;

  // Signal the message generator to abort
  abortGenerator();

  // Clear the message queue to prevent pending messages from being sent
  clearMessageQueue();

  // Generate or set the appropriate session ID for the next conversation
  regenerateSessionId(resumeSessionId ?? null);
  pendingResumeSessionId = resumeSessionId ?? null;

  // Wait for the current session to fully terminate before proceeding
  if (sessionTerminationPromise) {
    await sessionTerminationPromise;
  }

  // Clear session state
  querySession = null;
  isProcessing = false;
  sessionTerminationPromise = null;
}

/**
 * Change the model during an active session.
 */
export async function setModel(preference: ModelPreference): Promise<void> {
  if (preference === currentModelPreference) {
    return;
  }

  const previousPreference = currentModelPreference;
  currentModelPreference = preference;

  if (querySession) {
    try {
      await querySession.setModel(getModelId(preference));
    } catch (error) {
      currentModelPreference = previousPreference;
      console.error('Failed to update Claude model preference:', error);
      throw error;
    }
  }
}

/**
 * Start an agent session with the given options and event handlers.
 *
 * This is the main entry point for the agentic loop. It:
 * 1. Initializes the message generator
 * 2. Starts the SDK query with streaming
 * 3. Processes all streaming events in a `for await` loop
 * 4. Emits events to the provided callbacks
 *
 * @returns A handle for controlling the session
 */
export async function startAgentSession(
  options: AgentSessionOptions,
  events: AgentSessionEvents = {}
): Promise<AgentSessionHandle> {
  // Wait for any pending session termination to complete first
  if (sessionTerminationPromise) {
    await sessionTerminationPromise;
  }

  if (isProcessing || querySession) {
    throw new Error('A session is already active. Call stop() first.');
  }

  if (!options.apiKey && !options.oauthToken) {
    throw new Error('API key or OAuth token is required');
  }

  // Reset state for new session
  shouldAbortSession = false;
  resetAbortFlag();
  isProcessing = true;
  streamIndexToToolId.clear();

  currentModelPreference = options.modelPreference ?? 'fast';

  // Create a promise that resolves when this session terminates
  let resolveTermination: () => void;
  sessionTerminationPromise = new Promise((resolve) => {
    resolveTermination = resolve;
  });

  const resumeSessionId = pendingResumeSessionId ?? options.resumeSessionId;
  const isResumedSession = typeof resumeSessionId === 'string' && resumeSessionId.length > 0;
  pendingResumeSessionId = null;

  // Build environment
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(options.env || {})
  };

  // Set authentication: API key OR OAuth token (not both)
  if (options.apiKey) {
    env.ANTHROPIC_API_KEY = options.apiKey;
  } else if (options.oauthToken) {
    // Claude Code CLI uses CLAUDE_CODE_OAUTH_TOKEN for OAuth tokens
    env.CLAUDE_CODE_OAUTH_TOKEN = options.oauthToken;
    // Clear API key if set to ensure OAuth token is used
    delete env.ANTHROPIC_API_KEY;
  }

  // Start the streaming session loop (runs in background)
  const sessionPromise = runStreamingLoop(options, events, env, isResumedSession, resumeSessionId);

  // Handle session completion
  sessionPromise
    .catch((error) => {
      console.error('Error in streaming session:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      events.onError?.(errorMessage);
    })
    .finally(() => {
      isProcessing = false;
      querySession = null;
      resolveTermination!();
    });

  // Return the session handle
  return {
    isActive: () => isSessionActive(),
    sendMessage: async (message: Parameters<AgentSessionHandle['sendMessage']>[0]) => {
      if (!isSessionActive()) {
        throw new Error('Session is not active');
      }
      await queueMessage(message);
    },
    interrupt: async () => {
      return interruptCurrentResponse(events.onMessageStopped);
    },
    stop: async () => {
      await resetSession();
    },
    setModel: async (preference: ModelPreference) => {
      await setModel(preference);
    },
    getSessionId: () => getSessionId()
  };
}

/**
 * The main streaming loop that processes SDK responses.
 * This is where the "agentic loop" happens.
 */
async function runStreamingLoop(
  options: AgentSessionOptions,
  events: AgentSessionEvents,
  env: Record<string, string>,
  isResumedSession: boolean,
  resumeSessionId?: string | null
): Promise<void> {
  const modelId = getModelId(currentModelPreference);

  // Configure query options
  // SKIP_MCP env var disables MCP server loading for debugging
  //
  // NOTE: Default is ['project'] only for fast startup (~5s).
  // Using ['user', 'project'] enables MCP tools from ~/.claude/settings.json
  // but causes ~30s startup delay due to eager MCP server initialization.
  //
  // To enable user plugins, pass settingSources: ['user', 'project'] and ensure
  // problematic plugins are disabled (see MCP_PLUGIN_COMPATIBILITY.md):
  // - xcode@tuist-marketplace (requires 'mise' command)
  // - greptile@claude-plugins-official (requires GREPTILE_API_KEY)
  // - vercel@claude-plugins-official (requires multiple MCP servers)
  // - plugin-dev@claude-plugins-official (causes timeout)
  const settingSources = process.env.SKIP_MCP
    ? []
    : (options.settingSources ?? ['project']);
  const queryOptions: Parameters<typeof query>[0]['options'] = {
    model: modelId,
    maxThinkingTokens: options.maxThinkingTokens ?? 32_000,
    settingSources: settingSources as ('user' | 'project' | 'local')[],
    permissionMode: options.permissionMode ?? 'acceptEdits',
    allowedTools: options.allowedTools ?? ['Bash', 'WebFetch', 'WebSearch', 'Skill'],
    env,
    cwd: options.workingDirectory,
    includePartialMessages: true,
    stderr: (message: string) => {
      events.onDebugMessage?.(message);
    }
  };

  // Add optional fields
  if (options.claudeCodeCliPath) {
    queryOptions.pathToClaudeCodeExecutable = options.claudeCodeCliPath;
  }
  if (options.executable) {
    queryOptions.executable = options.executable as 'bun' | 'deno' | 'node' | undefined;
  }
  if (options.systemPrompt) {
    queryOptions.systemPrompt = options.systemPrompt as typeof queryOptions.systemPrompt;
  }
  if (isResumedSession && resumeSessionId) {
    queryOptions.resume = resumeSessionId;
  }

  // Start the SDK query with the message generator
  querySession = query({
    prompt: messageGenerator(),
    options: queryOptions
  });

  // ========================================
  // THE MAIN AGENTIC LOOP
  // ========================================
  // This `for await` loop is the heart of the agent.
  // It continuously processes streaming responses from the SDK.
  // ========================================
  for await (const sdkMessage of querySession) {
    // Check if session should be aborted
    if (shouldAbortSession) {
      break;
    }

    // Handle different message types from the SDK
    if (sdkMessage.type === 'stream_event') {
      handleStreamEvent(sdkMessage.event, events);
    } else if (sdkMessage.type === 'assistant') {
      handleAssistantMessage(sdkMessage.message, events);
    } else if (sdkMessage.type === 'result') {
      // Final result message - agent is done with this turn
      events.onMessageComplete?.();
    } else if (sdkMessage.type === 'system') {
      if (sdkMessage.subtype === 'init') {
        const sessionIdFromSdk = sdkMessage.session_id;
        if (sessionIdFromSdk) {
          setSessionId(sessionIdFromSdk);
          events.onSessionInit?.({
            sessionId: sessionIdFromSdk,
            resumed: isResumedSession,
            model: currentModelPreference,
            modelDisplay: getModelDisplayFromPreference(currentModelPreference)
          });
        }
      }
    }
  }
}

/**
 * Handle streaming events (real-time deltas).
 */
function handleStreamEvent(
  streamEvent: { type: string; index?: number; delta?: unknown; content_block?: unknown },
  events: AgentSessionEvents
): void {
  if (streamEvent.type === 'content_block_delta') {
    const delta = streamEvent.delta as {
      type: string;
      text?: string;
      thinking?: string;
      partial_json?: string;
    };
    const index = streamEvent.index ?? 0;

    if (delta.type === 'text_delta' && delta.text) {
      // Regular text delta
      events.onTextChunk?.(delta.text);
    } else if (delta.type === 'thinking_delta' && delta.thinking) {
      // Thinking text delta
      events.onThinkingChunk?.({ index, delta: delta.thinking });
    } else if (delta.type === 'input_json_delta' && delta.partial_json) {
      // Tool input JSON delta
      const toolId = streamIndexToToolId.get(index) ?? '';
      events.onToolInputDelta?.({ index, toolId, delta: delta.partial_json });
    }
  } else if (streamEvent.type === 'content_block_start') {
    const contentBlock = streamEvent.content_block as {
      type: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      content?: string | unknown;
      is_error?: boolean;
    };
    const index = streamEvent.index ?? 0;

    if (contentBlock.type === 'thinking') {
      events.onThinkingStart?.({ index });
    } else if (contentBlock.type === 'tool_use') {
      // Store mapping of stream index to tool ID
      streamIndexToToolId.set(index, contentBlock.id ?? '');
      events.onToolUseStart?.({
        id: contentBlock.id ?? '',
        name: contentBlock.name ?? '',
        input: contentBlock.input ?? {},
        streamIndex: index
      });
    } else if (
      (contentBlock.type === 'web_search_tool_result' ||
        contentBlock.type === 'web_fetch_tool_result' ||
        contentBlock.type === 'code_execution_tool_result' ||
        contentBlock.type === 'bash_code_execution_tool_result' ||
        contentBlock.type === 'text_editor_code_execution_tool_result' ||
        contentBlock.type === 'mcp_tool_result') &&
      contentBlock.tool_use_id
    ) {
      // Tool result block starting
      let contentStr = '';
      if (typeof contentBlock.content === 'string') {
        contentStr = contentBlock.content;
      } else if (contentBlock.content != null) {
        contentStr = JSON.stringify(contentBlock.content, null, 2);
      }

      if (contentStr) {
        events.onToolResultStart?.({
          toolUseId: contentBlock.tool_use_id,
          content: contentStr,
          isError: contentBlock.is_error ?? false
        });
      }
    }
  } else if (streamEvent.type === 'content_block_stop') {
    const index = streamEvent.index ?? 0;
    const toolId = streamIndexToToolId.get(index);
    events.onContentBlockStop?.({ index, toolId });
  }
}

/**
 * Handle complete assistant messages (with tool results).
 */
function handleAssistantMessage(
  assistantMessage: { content?: Array<unknown> },
  events: AgentSessionEvents
): void {
  if (!assistantMessage.content) return;

  for (const block of assistantMessage.content) {
    // Check for tool result blocks
    if (
      typeof block === 'object' &&
      block !== null &&
      'tool_use_id' in block &&
      'content' in block
    ) {
      const toolResultBlock = block as {
        tool_use_id: string;
        content: string | unknown[] | unknown;
        is_error?: boolean;
      };

      // Convert content to string representation
      let contentStr: string;
      if (typeof toolResultBlock.content === 'string') {
        contentStr = toolResultBlock.content;
      } else if (Array.isArray(toolResultBlock.content)) {
        // Array of content blocks
        contentStr = toolResultBlock.content
          .map((c) => {
            if (typeof c === 'string') return c;
            if (typeof c === 'object' && c !== null) {
              if ('text' in c && typeof c.text === 'string') return c.text;
              return JSON.stringify(c, null, 2);
            }
            return String(c);
          })
          .join('\n');
      } else if (typeof toolResultBlock.content === 'object' && toolResultBlock.content !== null) {
        // Structured ToolOutput object
        contentStr = JSON.stringify(toolResultBlock.content, null, 2);
      } else {
        contentStr = String(toolResultBlock.content);
      }

      events.onToolResultComplete?.({
        toolUseId: toolResultBlock.tool_use_id,
        content: contentStr,
        isError: toolResultBlock.is_error ?? false
      });
    }
  }
}
