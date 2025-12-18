/**
 * Claude Agent Loop - Agent Session (Instance-Based)
 *
 * This module provides a per-session streaming session loop that:
 * - Starts a Claude Agent SDK query() stream
 * - Streams deltas (text, thinking, tool use/input/results)
 * - Exposes a handle to send messages, interrupt, stop, and set model
 *
 * Unlike the previous implementation, this version has NO module-level
 * singleton state, enabling multiple concurrent sessions in one process.
 */

import { query, type Query } from '@anthropic-ai/claude-agent-sdk';

import { MessageQueue } from './message-queue.js';
import { getModelDisplayFromPreference } from './model-router.js';
import type { AgentSessionEvents, AgentSessionHandle, AgentSessionOptions, ModelPreference } from './types.js';

// Model IDs
const FAST_MODEL_ID = 'claude-haiku-4-5-20251001';
const SMART_SONNET_MODEL_ID = 'claude-sonnet-4-5-20250929';
const SMART_OPUS_MODEL_ID = 'claude-opus-4-5-20251101';

const MODEL_BY_PREFERENCE: Record<ModelPreference, string> = {
  fast: FAST_MODEL_ID,
  'smart-sonnet': SMART_SONNET_MODEL_ID,
  'smart-opus': SMART_OPUS_MODEL_ID,
  auto: FAST_MODEL_ID // Coordinator/orchestrator decides; default to fast for plain sessions
};

function getModelId(preference: ModelPreference = 'fast'): string {
  return MODEL_BY_PREFERENCE[preference] ?? FAST_MODEL_ID;
}

class AgentSession {
  private querySession: Query | null = null;
  private readonly messageQueue: MessageQueue;
  private readonly events: AgentSessionEvents;
  private isProcessing = false;
  private isInterruptingResponse = false;
  private shouldAbortSession = false;
  private terminationPromise: Promise<void> | null = null;
  private currentModelPreference: ModelPreference = 'fast';

  // Map stream index to tool ID for the current response
  private streamIndexToToolId: Map<number, string> = new Map();

  constructor(
    private options: AgentSessionOptions,
    events: AgentSessionEvents = {}
  ) {
    this.events = events;
    const initialSessionId = options.resumeSessionId ?? null;
    this.messageQueue = new MessageQueue(initialSessionId);
  }

  isActive(): boolean {
    return this.isProcessing || this.querySession !== null;
  }

  getSessionId(): string {
    return this.messageQueue.getSessionId();
  }

  async start(): Promise<void> {
    if (this.isActive()) {
      throw new Error('Session is already active');
    }

    if (!this.options.apiKey && !this.options.oauthToken) {
      throw new Error('API key or OAuth token is required');
    }

    this.shouldAbortSession = false;
    this.isProcessing = true;
    this.streamIndexToToolId.clear();

    this.currentModelPreference = this.options.modelPreference ?? 'fast';

    // Build environment
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...(this.options.env || {})
    };

    // Set authentication: API key OR OAuth token (not both)
    if (this.options.apiKey) {
      env.ANTHROPIC_API_KEY = this.options.apiKey;
      delete env.CLAUDE_CODE_OAUTH_TOKEN;
    } else if (this.options.oauthToken) {
      env.CLAUDE_CODE_OAUTH_TOKEN = this.options.oauthToken;
      delete env.ANTHROPIC_API_KEY;
    }

    const isResumedSession =
      typeof this.options.resumeSessionId === 'string' && this.options.resumeSessionId.length > 0;

    this.terminationPromise = this.runStreamingLoop(env, isResumedSession);
    this.terminationPromise
      .catch((error) => {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        this.events.onError?.(errorMessage);
      })
      .finally(() => {
        this.isProcessing = false;
        this.querySession = null;
      });
  }

  async sendMessage(message: Parameters<AgentSessionHandle['sendMessage']>[0]): Promise<void> {
    if (!this.isActive()) {
      throw new Error('Session is not active');
    }
    await this.messageQueue.queueMessage(message);
  }

  async interrupt(): Promise<boolean> {
    if (!this.querySession) return false;
    if (this.isInterruptingResponse) return true;

    this.isInterruptingResponse = true;
    try {
      await this.querySession.interrupt();
      this.events.onMessageStopped?.();
      return true;
    } finally {
      this.isInterruptingResponse = false;
    }
  }

  async stop(): Promise<void> {
    if (!this.isActive()) return;

    this.shouldAbortSession = true;
    this.messageQueue.abort();

    if (this.terminationPromise) {
      await this.terminationPromise;
    }
  }

  async setModel(preference: ModelPreference): Promise<void> {
    if (preference === this.currentModelPreference) return;

    this.currentModelPreference = preference;
    if (!this.querySession) return;
    await this.querySession.setModel(getModelId(preference));
  }

  private async runStreamingLoop(
    env: Record<string, string>,
    isResumedSession: boolean
  ): Promise<void> {
    const modelId = getModelId(this.currentModelPreference);

    const settingSources = process.env.SKIP_MCP ? [] : (this.options.settingSources ?? ['project']);
    const queryOptions: Parameters<typeof query>[0]['options'] = {
      model: modelId,
      maxThinkingTokens: this.options.maxThinkingTokens ?? 32_000,
      settingSources: settingSources as ('user' | 'project' | 'local')[],
      permissionMode: this.options.permissionMode ?? 'acceptEdits',
      allowedTools: this.options.allowedTools ?? ['Bash', 'WebFetch', 'WebSearch', 'Skill'],
      env,
      cwd: this.options.workingDirectory,
      includePartialMessages: true,
      stderr: (message: string) => {
        this.events.onDebugMessage?.(message);
      }
    };

    if (this.options.claudeCodeCliPath) {
      queryOptions.pathToClaudeCodeExecutable = this.options.claudeCodeCliPath;
    }
    if (this.options.executable) {
      queryOptions.executable = this.options.executable as 'bun' | 'deno' | 'node' | undefined;
    }
    if (this.options.systemPrompt) {
      queryOptions.systemPrompt = this.options.systemPrompt as typeof queryOptions.systemPrompt;
    }
    if (isResumedSession && this.options.resumeSessionId) {
      queryOptions.resume = this.options.resumeSessionId;
      this.messageQueue.setSessionId(this.options.resumeSessionId);
    }

    this.querySession = query({
      prompt: this.messageQueue.generator(),
      options: queryOptions
    });

    for await (const sdkMessage of this.querySession) {
      if (this.shouldAbortSession) break;

      if (sdkMessage.type === 'stream_event') {
        this.handleStreamEvent(sdkMessage.event);
      } else if (sdkMessage.type === 'assistant') {
        this.handleAssistantMessage(sdkMessage.message);
      } else if (sdkMessage.type === 'result') {
        this.events.onMessageComplete?.();
        this.streamIndexToToolId.clear();
      } else if (sdkMessage.type === 'system') {
        if (sdkMessage.subtype === 'init') {
          const sessionIdFromSdk = sdkMessage.session_id;
          if (sessionIdFromSdk) {
            this.messageQueue.setSessionId(sessionIdFromSdk);
            this.events.onSessionInit?.({
              sessionId: sessionIdFromSdk,
              resumed: isResumedSession,
              model: this.currentModelPreference,
              modelDisplay: getModelDisplayFromPreference(this.currentModelPreference)
            });
          }
        }
      }
    }
  }

  private handleStreamEvent(streamEvent: {
    type: string;
    index?: number;
    delta?: unknown;
    content_block?: unknown;
  }): void {
    if (streamEvent.type === 'content_block_delta') {
      const delta = streamEvent.delta as {
        type: string;
        text?: string;
        thinking?: string;
        partial_json?: string;
      };
      const index = streamEvent.index ?? 0;

      if (delta.type === 'text_delta' && delta.text) {
        this.events.onTextChunk?.(delta.text);
      } else if (delta.type === 'thinking_delta' && delta.thinking) {
        this.events.onThinkingChunk?.({ index, delta: delta.thinking });
      } else if (delta.type === 'input_json_delta' && delta.partial_json) {
        const toolId = this.streamIndexToToolId.get(index) ?? '';
        this.events.onToolInputDelta?.({ index, toolId, delta: delta.partial_json });
      }
      return;
    }

    if (streamEvent.type === 'content_block_start') {
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
        this.events.onThinkingStart?.({ index });
        return;
      }

      if (contentBlock.type === 'tool_use') {
        this.streamIndexToToolId.set(index, contentBlock.id ?? '');
        this.events.onToolUseStart?.({
          id: contentBlock.id ?? '',
          name: contentBlock.name ?? '',
          input: contentBlock.input ?? {},
          streamIndex: index
        });
        return;
      }

      if (
        (contentBlock.type === 'web_search_tool_result' ||
          contentBlock.type === 'web_fetch_tool_result' ||
          contentBlock.type === 'code_execution_tool_result' ||
          contentBlock.type === 'bash_code_execution_tool_result' ||
          contentBlock.type === 'text_editor_code_execution_tool_result' ||
          contentBlock.type === 'mcp_tool_result') &&
        contentBlock.tool_use_id
      ) {
        let contentStr = '';
        if (typeof contentBlock.content === 'string') {
          contentStr = contentBlock.content;
        } else if (contentBlock.content != null) {
          contentStr = JSON.stringify(contentBlock.content, null, 2);
        }

        if (contentStr) {
          this.events.onToolResultStart?.({
            toolUseId: contentBlock.tool_use_id,
            content: contentStr,
            isError: contentBlock.is_error ?? false
          });
        }
        return;
      }
    }

    if (streamEvent.type === 'content_block_stop') {
      const index = streamEvent.index ?? 0;
      const toolId = this.streamIndexToToolId.get(index);
      this.events.onContentBlockStop?.({ index, toolId });
    }
  }

  private handleAssistantMessage(assistantMessage: { content?: Array<unknown> }): void {
    if (!assistantMessage.content) return;

    for (const block of assistantMessage.content) {
      if (typeof block === 'object' && block !== null && 'tool_use_id' in block && 'content' in block) {
        const toolResultBlock = block as {
          tool_use_id: string;
          content: string | unknown[] | unknown;
          is_error?: boolean;
        };

        let contentStr: string;
        if (typeof toolResultBlock.content === 'string') {
          contentStr = toolResultBlock.content;
        } else if (Array.isArray(toolResultBlock.content)) {
          contentStr = toolResultBlock.content
            .map((c) => {
              if (typeof c === 'string') return c;
              if (typeof c === 'object' && c !== null) {
                if ('text' in c && typeof (c as { text?: unknown }).text === 'string') {
                  return (c as { text: string }).text;
                }
                return JSON.stringify(c, null, 2);
              }
              return String(c);
            })
            .join('\n');
        } else if (typeof toolResultBlock.content === 'object' && toolResultBlock.content !== null) {
          contentStr = JSON.stringify(toolResultBlock.content, null, 2);
        } else {
          contentStr = String(toolResultBlock.content);
        }

        this.events.onToolResultComplete?.({
          toolUseId: toolResultBlock.tool_use_id,
          content: contentStr,
          isError: toolResultBlock.is_error ?? false
        });
      }
    }
  }

  getHandle(): AgentSessionHandle {
    return {
      isActive: () => this.isActive(),
      sendMessage: async (message) => this.sendMessage(message),
      interrupt: async () => this.interrupt(),
      stop: async () => this.stop(),
      setModel: async (preference) => this.setModel(preference),
      getSessionId: () => this.getSessionId()
    };
  }
}

export async function startAgentSession(
  options: AgentSessionOptions,
  events: AgentSessionEvents = {}
): Promise<AgentSessionHandle> {
  const session = new AgentSession(options, events);
  await session.start();
  return session.getHandle();
}
