/**
 * Claudelet - Interactive CLI Chat with Claude Agent SDK
 *
 * This package provides a feature-rich CLI chat interface with:
 * - Smart priority-based message queue (urgent/normal/todo)
 * - Auto-injection and manual force-inject of messages
 * - File context with @ references and autocomplete
 * - Session saving/loading
 * - Debug logging
 *
 * Main entry point for library usage. For CLI usage, run:
 *   bun run claudelet
 */

// Re-export for library usage
export { SmartMessageQueue, globalMessageQueue } from 'claude-agent-loop';
export type { PendingMessage } from 'claude-agent-loop';

export { createAuthManager } from 'claude-agent-loop';
export { startAgentSession } from 'claude-agent-loop';
export type { AgentSessionHandle, AgentSessionOptions } from 'claude-agent-loop';

export { clearAuth, loadAuth, saveAuth } from './auth-storage';

export {
  isSensitiveKey,
  sanitizeEnv,
  sanitizeText,
  sanitizedEnv,
  installConsoleSanitization,
  createSanitizingLogger
} from './env-sanitizer';

export { SecurityValidator } from './security-validator';

export { useBatchedState } from './hooks/useBatchedState';
