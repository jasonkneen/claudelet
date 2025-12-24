/**
 * Message types for the chat application
 */

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  // Model attribution (for assistant messages)
  model?: string;
  // Tool-specific metadata
  toolId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  isCollapsed?: boolean;
  toolMessages?: string[]; // Preview messages from subagent
  // Startup banner marker
  isBanner?: boolean;
}
