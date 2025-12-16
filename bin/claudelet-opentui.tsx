#!/usr/bin/env bun

/**
 * Claudelet OpenTUI - Terminal User Interface Chat using OpenTUI + Claude Agent Loop
 *
 * Features:
 * - Fixed input bar with clean design
 * - Real-time thinking and tool indicators
 * - Smart message queue visualization
 * - @ file references with autocomplete
 * - All /commands supported
 *
 * Run with:
 *   bun run tui:opentui
 *   claudelet-opentui (if installed globally)
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createCliRenderer, type KeyEvent } from '@opentui/core';
import { createRoot, useKeyboard, useRenderer } from '@opentui/react';
import {
  createAuthManager,
  SmartMessageQueue,
  startAgentSession,
  FastModeCoordinator,
  MODEL_DISPLAY,
  getModelDisplayFromPreference,
  parseModelOverride,
  type AgentSessionHandle,
  type SubAgent,
  type SubAgentEvent,
  type OrchestrationContext
} from 'claude-agent-loop';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { clearAuth, loadAuth, saveAuth } from '../src/auth-storage.js';
import { isMarkdown, renderMarkdown } from '../src/markdown-renderer.js';
import {
  completeSession,
  createSessionData,
  getActiveSessions,
  getSessionsDir,
  listSessions,
  loadSession,
  saveSession,
  type SessionData,
  type SessionSummary,
  type StoredMessage
} from '../src/session-storage.js';
import { sanitizeText } from '../src/env-sanitizer.js';
import { AiToolsService } from './claudelet-ai-tools.js';
import { useBatchedState } from '../src/hooks/useBatchedState.js';

const MAX_THINKING_TOKENS = 16_000;
const TODOS_FILE = '.todos.md';
const MAX_FILE_SIZE = 500_000; // 500KB

// Claudelet logo
const LOGO = `
     ,gggg,
   ,88"""Y8b,,dPYb,                                 8I           ,dPYb,           I8
  d8"     \`Y8IP'\`Yb                                 8I           IP'\`Yb           I8
 d8'   8b  d8I8  8I                                 8I           I8  8I        88888888
,8I    "Y88P'I8  8'                                 8I           I8  8'           I8
I8'          I8 dP    ,gggg,gg  gg      gg    ,gggg,8I   ,ggg,   I8 dP   ,ggg,    I8
d8           I8dP    dP"  "Y8I  I8      8I   dP"  "Y8I  i8" "8i  I8dP   i8" "8i   I8
Y8,          I8P    i8'    ,8I  I8,    ,8I  i8'    ,8I  I8, ,8I  I8P    I8, ,8I  ,I8,
\`Yba,,_____,,d8b,_ ,d8,   ,d8b,,d8b,  ,d8b,,d8,   ,d8b, \`YbadP' ,d8b,_  \`YbadP' ,d88b,
  \`"Y88888888P'"Y88P"Y8888P"\`Y88P'"Y88P"\`Y8P"Y8888P"\`Y8888P"Y8888P'"Y88888P"Y8888P""Y8
`;

// Debug logging configuration
const DEBUG = process.env.CLAUDELET_DEBUG === 'true';
const DEBUG_DIR = path.join(os.homedir(), '.claudelet');
const DEBUG_LOG = path.join(DEBUG_DIR, 'debug.log');

/**
 * Ensure debug directory exists (call once during init)
 */
const ensureDebugDir = async (): Promise<void> => {
  try {
    await fsp.mkdir(DEBUG_DIR, { recursive: true, mode: 0o700 });
  } catch (error) {
    // Fail silently to avoid disrupting the app
  }
};

/**
 * Debug logger that writes to file with proper permissions and sanitization (non-blocking)
 */
const debugLog = (msg: string): void => {
  if (!DEBUG) return;

  try {
    // Sanitize the message before writing to prevent leaking secrets
    const sanitized = sanitizeText(msg);
    const timestamp = new Date().toISOString();

    // Fire-and-forget: don't block on file writes
    fsp.appendFile(DEBUG_LOG, `[${timestamp}] ${sanitized}\n`)
      .then(() => fsp.chmod(DEBUG_LOG, 0o600))
      .catch(() => {
        // Fail silently to avoid disrupting the app
      });
  } catch (error) {
    // Fail silently to avoid disrupting the app
  }
};

/**
 * Display authentication menu and get user choice
 */
async function promptAuthMethod(): Promise<'1' | '2' | '3'> {
  const readline = await import('readline/promises');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n🤖 Claude Agent Chat (Enhanced)');
  console.log('\nHow would you like to authenticate?\n');
  console.log('  1. Anthropic Account (OAuth)');
  console.log('  2. Claude Max Subscription (OAuth - Recommended)');
  console.log('  3. API Key (Direct)\n');

  const choice = await rl.question('Select authentication method (1/2/3): ');
  const trimmed = choice.trim();
  rl.close();

  if (trimmed === '1' || trimmed === '2' || trimmed === '3') {
    return trimmed;
  }

  console.log('Invalid choice. Please select 1, 2, or 3.\n');
  return promptAuthMethod();
}

/**
 * Handle OAuth authentication flow
 */
async function handleOAuthFlow(
  mode: 'console' | 'max',
  authManager: ReturnType<typeof createAuthManager>
): Promise<string | null> {
  const readline = await import('readline/promises');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log(`\n🔐 Starting OAuth flow (${mode === 'max' ? 'Claude Max' : 'Anthropic Account'})...\n`);

  try {
    // Start OAuth flow
    const { authUrl, verifier, state } = await authManager.startOAuthFlow(mode);

    console.log('Please visit this URL to authorize:\n');
    console.log(`  ${authUrl}\n`);
    console.log('After authorizing, you will see an authorization code.');
    console.log('Copy and paste the authorization code here.\n');

    // Get authorization code from user
    const code = await rl.question('Paste the authorization code: ');
    const trimmedCode = code.trim();

    if (!trimmedCode) {
      console.error('\n❌ Error: Authorization code cannot be empty');
      rl.close();
      return null;
    }

    console.log('\n⏳ Getting OAuth access token...');

    // Complete OAuth flow to get tokens
    const result = await authManager.completeOAuthFlow(trimmedCode, verifier, state, false);

    if (result.tokens) {
      console.log('✅ OAuth authentication successful!');
      // Get the access token - it can be used like an API key
      const accessToken = await authManager.getOAuthAccessToken();
      rl.close();
      if (accessToken) {
        return accessToken;
      }
    }

    rl.close();
    return null;
  } catch (error) {
    console.error('\n❌ OAuth flow failed:', error instanceof Error ? error.message : String(error));
    rl.close();
    return null;
  }
}

/**
 * Handle API key authentication
 */
async function handleApiKeyAuth(): Promise<string | null> {
  const readline = await import('readline/promises');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n🔑 API Key Authentication\n');

  // Check if ANTHROPIC_API_KEY is set
  if (process.env.ANTHROPIC_API_KEY) {
    const useEnv = await rl.question(
      `Found ANTHROPIC_API_KEY in environment. Use it? (Y/n): `
    );
    if (!useEnv.trim() || useEnv.trim().toLowerCase() === 'y') {
      rl.close();
      return process.env.ANTHROPIC_API_KEY;
    }
  }

  const apiKey = await rl.question('Enter your Anthropic API key: ');
  const trimmed = apiKey.trim();

  if (!trimmed) {
    console.error('\n❌ API key cannot be empty');
    rl.close();
    return null;
  }

  if (!trimmed.startsWith('sk-ant-')) {
    console.warn('\n⚠️  Warning: API key should start with "sk-ant-"');
    const proceed = await rl.question('Continue anyway? (y/N): ');
    if (proceed.trim().toLowerCase() !== 'y') {
      rl.close();
      return null;
    }
  }

  rl.close();
  return trimmed;
}

const SHIFTED_CHAR_MAP: Record<string, string> = {
  '1': '!',
  '2': '@',
  '3': '#',
  '4': '$',
  '5': '%',
  '6': '^',
  '7': '&',
  '8': '*',
  '9': '(',
  '0': ')',
  '-': '_',
  '=': '+',
  '[': '{',
  ']': '}',
  '\\': '|',
  ';': ':',
  "'": '"',
  ',': '<',
  '.': '>',
  '/': '?',
  '`': '~'
};

function isModifyOtherKeysSequence(sequence: string): boolean {
  // CSI 27 ; modifier ; code ~
  return sequence.startsWith('\x1b[27;') && sequence.endsWith('~');
}

function getPrintableCharFromKeyEvent(key: KeyEvent): string | null {
  if (key.name === 'space') return ' ';

  const isModifyOtherKeys = isModifyOtherKeysSequence(key.sequence);
  const shouldApplyShiftMap = key.source === 'kitty' || isModifyOtherKeys;

  if (key.name && key.name.length === 1) {
    const base = key.name;

    if (key.shift) {
      if (base >= 'a' && base <= 'z') return base.toUpperCase();
      if (shouldApplyShiftMap && base in SHIFTED_CHAR_MAP) return SHIFTED_CHAR_MAP[base]!;
    }

    return base;
  }

  // Fallback: if `sequence` is a single printable ASCII char, treat it as input.
  if (key.sequence.length === 1) {
    const code = key.sequence.charCodeAt(0);
    if (code >= 32 && code <= 126) return key.sequence;
  }

  return null;
}

interface Message {
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
}

// Represents a file chip in the input
interface FileChip {
  id: string;
  label: string; // Display name like "readme.md"
  filePath: string; // Full path like "path/to/readme.md"
}

// Represents a context chip in the input (+include / -exclude)
interface ContextChip {
  id: string;
  label: string; // Display name like "aisdk" or "customcode"
  isInclude: boolean; // true for +include (white), false for -exclude (red)
}

// Input segment - text, file chip, or context chip
type InputSegment =
  | { type: 'text'; text: string }
  | { type: 'chip'; chip: FileChip }
  | { type: 'context'; context: ContextChip };

// Thinking session - tracks a single thinking block
interface ThinkingSession {
  id: string;
  startTime: Date;
  endTime?: Date; // undefined while active
  content: string;
}

interface AppState {
  messages: Message[];
  isResponding: boolean;
  currentModel: string;
  sessionId?: string;
  thinkingSessions: ThinkingSession[]; // Array of thinking sessions
  currentTool?: string;
  usedToolsInCurrentResponse: Set<string>; // Track all tools used in current response
  queuedMessages: number;
  showTaskList: boolean;
  expandedToolIds: Set<string>;
  currentToolId?: string; // Track the currently active tool for capturing output
  messageScrollOffset: number; // For scrolling through messages
  inputTokens: number;
  outputTokens: number;
  aiTools?: AiToolsService;
  agentMode: 'coding' | 'planning'; // Current agent mode
  chipDisplayStyle: 'inline' | 'boxes'; // How to display tool chips
  contextChips: ContextChip[]; // Active context chips that apply to all messages
  // Orchestration state
  orchestration?: OrchestrationContext;
  subAgents: SubAgent[];
  subAgentsSectionExpanded: boolean;
  expandedAgentIds: Set<string>;
}

/**
 * Tool activity for grouped chip display
 * Shows one chip per tool type with count and active state
 */
interface ToolActivity {
  name: string;
  count: number;
  isActive: boolean; // true if any instance is currently executing (no result yet)
  order: number; // for maintaining first-appearance order
}

/**
 * Extract tool activity from messages, grouped by tool name
 * Returns one entry per tool type with count and active state
 */
function extractToolActivity(messages: Message[]): ToolActivity[] {
  // Filter for tool messages
  const toolMessages = messages.filter((m) => m.role === 'tool' && m.toolName);

  if (toolMessages.length === 0) {
    return [];
  }

  // Group by tool name, tracking count and active state
  const toolMap = new Map<string, { count: number; isActive: boolean; order: number }>();

  toolMessages.forEach((msg, index) => {
    const toolName = msg.toolName!;
    const existing = toolMap.get(toolName);

    // Tool is active if it has no result yet
    const isToolActive = msg.toolResult === undefined;

    if (existing) {
      existing.count += 1;
      // Tool is active if ANY instance is active
      existing.isActive = existing.isActive || isToolActive;
    } else {
      toolMap.set(toolName, {
        count: 1,
        isActive: isToolActive,
        order: index
      });
    }
  });

  // Convert to array and sort by first appearance order
  return Array.from(toolMap.entries())
    .map(([name, data]) => ({
      name,
      count: data.count,
      isActive: data.isActive,
      order: data.order
    }))
    .sort((a, b) => a.order - b.order);
}

/**
 * Format thinking session into chip text with elapsed time
 * Returns: "⠙ thinking" for active, "Thought 8s" for completed
 */
function formatThinkingChip(session: ThinkingSession, animate: boolean, animFrame: number): string {
  const brailleFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const now = new Date();
  const elapsed = session.endTime
    ? (session.endTime.getTime() - session.startTime.getTime()) / 1000
    : (now.getTime() - session.startTime.getTime()) / 1000;

  if (!session.endTime) {
    // Active: show animation + elapsed time
    const frame = brailleFrames[animFrame % brailleFrames.length];
    return elapsed < 1 ? `${frame} thinking` : `${frame} ${elapsed.toFixed(0)}s`;
  } else {
    // Completed: show duration
    return `Thought ${elapsed.toFixed(0)}s`;
  }
}

/**
 * Read and parse the .todos.md file to extract current tasks
 */
async function readTaskList(): Promise<string> {
  try {
    const todoPath = path.resolve(process.cwd(), TODOS_FILE);
    const content = await fsp.readFile(todoPath, 'utf-8');

    if (!content.trim()) {
      return '[i] No tasks found in session';
    }

    return content;
  } catch (error) {
    return "[i] No task list found (Claude hasn't created tasks yet)";
  }
}

/**
 * Resolve a file reference and get its content
 */
async function resolveFileReference(filePath: string): Promise<string | null> {
  try {
    const resolved = path.resolve(process.cwd(), filePath);

    // Security: ensure file is within cwd
    const cwd = process.cwd();
    const normalized = path.normalize(resolved);
    if (!normalized.startsWith(path.normalize(cwd))) {
      return null;
    }

    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) {
      return null;
    }

    if (stat.size > MAX_FILE_SIZE) {
      return null;
    }

    const content = await fsp.readFile(resolved, 'utf-8');
    return content;
  } catch {
    return null;
  }
}

/**
 * Convert input segments to display string
 */
function segmentsToDisplayString(segments: InputSegment[]): string {
  return segments
    .map((seg) => {
      if (seg.type === 'text') {
        return seg.text;
      } else if (seg.type === 'chip') {
        return `[${seg.chip.label}]`;
      } else {
        return `[${seg.context.isInclude ? '+' : '-'}${seg.context.label}]`;
      }
    })
    .join('');
}

/**
 * Convert input segments to message content (with file content embedded)
 */
async function segmentsToMessageContent(segments: InputSegment[]): Promise<string> {
  const parts = await Promise.all(
    segments.map(async (seg) => {
      if (seg.type === 'text') {
        return seg.text;
      } else if (seg.type === 'chip') {
        const content = await resolveFileReference(seg.chip.filePath);
        if (content) {
          return '\`\`\`' + seg.chip.label + '\\n' + content + '\\n\`\`\`';
        } else {
          return `[File not found: ${seg.chip.label}]`;
        }
      } else {
        // Context chips: include as metadata in message
        return `[Context: ${seg.context.isInclude ? 'INCLUDE' : 'EXCLUDE'} ${seg.context.label}]`;
      }
    })
  );
  return parts.join('');
}

/**
 * Estimate token count from text
 * Uses rough approximation: ~4 characters per token
 */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Get completions for / commands
 */
function getCommandCompletions(prefix: string): string[] {
  const commands = [
    '/help',
    '/init',
    '/clear',
    '/save',
    '/load',
    '/debug',
    '/quit',
    '/exit',
    '/logout',
    '/stop',
    '/model',
    '/search',
    '/diagnose',
    '/apply',
    '/patch-model'
  ];

  return commands.filter((cmd) => cmd.startsWith(prefix));
}

/**
 * Get completions for @ file references
 */
async function getFileCompletions(prefix: string): Promise<string[]> {
  try {
    // Extract the path after @
    const match = prefix.match(/@(.*)$/);
    if (!match) {
      return [];
    }

    const filePath = match[1];
    let dirPath = '';
    let filter = '';

    // Determine directory and filter
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash === -1) {
      // No slash, suggest files in current dir matching prefix
      dirPath = '.';
      filter = filePath;
    } else {
      // Has slash, suggest files in that directory
      dirPath = filePath.slice(0, lastSlash);
      filter = filePath.slice(lastSlash + 1);
    }

    const resolvedDir = path.resolve(process.cwd(), dirPath);

    // Security: ensure we don't escape cwd
    const normalized = path.normalize(resolvedDir);
    const cwd = path.normalize(process.cwd());

    if (!normalized.startsWith(cwd)) {
      return [];
    }

    // Read directory contents
    try {
      const entries = await fsp.readdir(resolvedDir, { withFileTypes: true });

      const filtered = entries.filter((entry) => entry.name.startsWith(filter));

      return filtered.map((entry) => {
        const name = entry.name;
        const suffix = entry.isDirectory() ? '/' : '';
        const fullPath =
          filePath.includes('/') ? filePath.slice(0, lastSlash + 1) + name + suffix : name + suffix;
        return '@' + fullPath;
      });
    } catch {
      return [];
    }
  } catch {
    return [];
  }
}

/**
 * Find completions for current input segments
 */
async function getCompletions(segments: InputSegment[]): Promise<string[]> {
  // Get the last text segment
  const lastSegment = segments[segments.length - 1];
  if (!lastSegment || lastSegment.type !== 'text') {
    return [];
  }

  const input = lastSegment.text;

  // Check if we're completing a command
  if (input.startsWith('/') && segments.length === 1) {
    return getCommandCompletions(input);
  }

  // Check if we're completing a file reference
  if (input.includes('@')) {
    const lastAtIndex = input.lastIndexOf('@');
    // Check if this @ is after a space (new token) or at start
    if (lastAtIndex === 0 || input[lastAtIndex - 1] === ' ') {
      const afterAt = input.slice(lastAtIndex);
      return await getFileCompletions(afterAt);
    }
  }

  return [];
}

/**
 * Helper to switch model and update state/session
 */
async function switchModel(
  model: 'fast' | 'smart-sonnet' | 'smart-opus',
  session: AgentSessionHandle | null,
  updateState: (updates: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void
): Promise<void> {
  try {
    if (session) {
      await session.setModel(model);
    }
    updateState((prev: AppState) => ({
      currentModel: model,
      messages: [
        ...prev.messages,
        { role: 'system', content: `[+] Switched to ${model}`, timestamp: new Date() }
      ]
    }));
  } catch (e) {
    updateState((prev: AppState) => ({
      messages: [
        ...prev.messages,
        {
          role: 'system',
          content: `[!] Failed to switch model: ${String(e)}`,
          timestamp: new Date()
        }
      ]
    }));
  }
}

// Render counter for debugging
let renderCount = 0;

/**
 * ToolActivityBoxes - Horizontal bordered boxes showing active tools
 * Each tool appears as a bordered box with 1 char spacing, wraps to fit
 * Similar styling to thinking/task indicators
 */
const ToolActivityBoxes: React.FC<{
  activities: Array<{ name: string; count: number; isActive: boolean }>;
}> = ({ activities }) => {
  if (activities.length === 0) return null;

  return (
    <box style={{ marginTop: 1, flexDirection: 'row' }}>
      {activities.map((activity) => {
        const countSuffix = activity.count > 1 ? ` x${activity.count}` : '';
        const bgColor = activity.isActive ? 'cyan' : 'gray';
        const fgColor = activity.isActive ? 'black' : 'black';
        const label = activity.name.toLowerCase();

        return (
          <box
            key={`tool-box-${activity.name}`}
            border={true}
            borderStyle="rounded"
            borderColor={activity.isActive ? 'cyan' : 'gray'}
            style={{
              paddingLeft: 1,
              paddingRight: 1,
              marginRight: 1
            }}
          >
            <text
              content={`${label}${countSuffix}`}
              fg={fgColor}
              bg={bgColor}
              bold={activity.isActive}
            />
          </box>
        );
      })}
    </box>
  );
};

/**
 * SubAgentTaskBox - Purple bordered task box showing agent status
 * Expandable to show live progress via Ctrl+O or mouse click
 */
const SubAgentTaskBox: React.FC<{
  agent: SubAgent;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ agent, isExpanded, onToggle }) => (
  <box
    style={{
      border: 'single',
      borderColor: 'magenta',
      marginLeft: 2,
      marginBottom: 1
    }}
    onClick={onToggle}
  >
    {/* Header - always visible */}
    <box style={{ flexDirection: 'row', paddingLeft: 1, paddingRight: 1 }}>
      <text content={isExpanded ? '[-]' : '[+]'} fg="magenta" />
      <text content={` ${agent.id} `} fg="white" bold />
      <text content={`(${agent.model})`} fg="gray" />
      <text content=" | " fg="gray" />
      <text
        content={agent.status}
        fg={
          agent.status === 'running' ? 'cyan' :
          agent.status === 'done' ? 'green' :
          agent.status === 'error' ? 'red' :
          agent.status === 'waiting' ? 'yellow' : 'gray'
        }
      />
      {agent.progress && (
        <text content={` ${agent.progress.percent}%`} fg="yellow" />
      )}
    </box>

    {/* Expanded content - live progress */}
    {isExpanded && (
      <box style={{ paddingLeft: 3, paddingTop: 1 }}>
        <text content={agent.currentTask || 'Waiting...'} fg="white" />
        {agent.progress && (
          <text content={agent.progress.message} fg="gray" />
        )}
        {/* Live streaming output */}
        {agent.liveOutput && (
          <box style={{ maxHeight: 8 }}>
            <text
              content={agent.liveOutput.slice(-500)}
              fg="gray"
            />
          </box>
        )}
      </box>
    )}
  </box>
);

/**
 * CollapsibleSubAgentsSection - Shows all sub-agents in a collapsible section
 */
const CollapsibleSubAgentsSection: React.FC<{
  agents: SubAgent[];
  isExpanded: boolean;
  expandedAgents: Set<string>;
  onToggleSection: () => void;
  onToggleAgent: (agentId: string) => void;
}> = ({ agents, isExpanded, expandedAgents, onToggleSection, onToggleAgent }) => {
  return (
    <box style={{ marginTop: 1, marginBottom: 1 }}>
      {/* Section header - always visible */}
      <box
        style={{ flexDirection: 'row', paddingLeft: 1 }}
        onClick={onToggleSection}
      >
        <text content={isExpanded ? '[-]' : '[+]'} fg="magenta" bold />
        <text content=" Background Agents " fg="magenta" bold />
        {agents.length > 0 && (
          <>
            <text content={`(${agents.length})`} fg="gray" />
            {agents.some(a => a.status === 'running') && (
              <text content=" ..." fg="cyan" />
            )}
          </>
        )}
        {agents.length === 0 && isExpanded && (
          <text content=" (none running) " fg="gray" italic />
        )}
      </box>

      {/* Agent list - only when section expanded */}
      {isExpanded && agents.length > 0 && agents.map(agent => (
        <SubAgentTaskBox
          key={agent.id}
          agent={agent}
          isExpanded={expandedAgents.has(agent.id)}
          onToggle={() => onToggleAgent(agent.id)}
        />
      ))}

      {/* Empty state message */}
      {isExpanded && agents.length === 0 && (
        <box style={{ paddingLeft: 2, paddingTop: 0 }}>
          <text content="No background agents running" fg="gray" />
          <text content="When agents spawn in the background, they will appear here." fg="gray" />
          <text content="Press Ctrl+O to close this panel." fg="gray" />
        </box>
      )}
    </box>
  );
};

const ChatApp: React.FC<{
  apiKey?: string;
  oauthToken?: string;
  resumeSession?: SessionData;
}> = ({ apiKey, oauthToken, resumeSession }) => {
  // Track render timing
  renderCount++;
  if (renderCount <= 10 || renderCount % 10 === 0) {
    debugLog(`ChatApp render #${renderCount}`);
  }

  // Convert stored messages to Message format if resuming
  const initialMessages: Message[] =
    resumeSession?.messages ?
      [
        {
          role: 'system' as const,
          content: LOGO,
          timestamp: new Date()
        },
        {
          role: 'system' as const,
          content: `[*] Claudelet OpenTUI - Claude Agent Chat\n\nCommands: /help /init /quit /done /stop /model /sessions /logout\nFile refs: @path/to/file.ts → Tab to add as chip\n\n[↻] Resuming session ${resumeSession.sessionId.slice(0, 8)}...`,
          timestamp: new Date()
        },
        ...resumeSession.messages.map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: new Date(m.timestamp),
          toolName: m.toolName,
          toolInput: m.toolInput,
          toolResult: m.toolResult,
          isCollapsed: m.role === 'tool'
        }))
      ]
    : [
        {
          role: 'system' as const,
          content: LOGO,
          timestamp: new Date()
        },
        {
          role: 'system' as const,
          content:
            '[*] Claudelet OpenTUI - Claude Agent Chat\n\nCommands: /help /init /quit /done /stop /model /sessions /logout\nFile refs: @path/to/file.ts → Tab to add as chip\n\nTab: autocomplete | ↑↓: history | Shift+Enter: newline | Ctrl+E: expand tool | Ctrl+M: models | Ctrl+Shift+P: providers | Ctrl+P/N: scroll | Ctrl+S: status | Ctrl+T: tasks | Shift+Tab: toggle mode',
          timestamp: new Date()
        }
      ];

  const [state, updateState] = useBatchedState<AppState>({
    messages: initialMessages,
    isResponding: false,
    currentModel: resumeSession?.model || 'fast',
    sessionId: resumeSession?.sessionId,
    thinkingSessions: [],
    usedToolsInCurrentResponse: new Set(),
    queuedMessages: 0,
    showTaskList: false,
    expandedToolIds: new Set(),
    currentToolId: undefined,
    messageScrollOffset: 0,
    inputTokens: resumeSession?.inputTokens || 0,
    outputTokens: resumeSession?.outputTokens || 0,
    agentMode: 'coding',
    chipDisplayStyle: (process.env.CHIP_DISPLAY_STYLE === 'boxes' ? 'boxes' : 'inline') as 'inline' | 'boxes',
    contextChips: [], // Active context chips (transient, not persisted)
    // Orchestration state
    orchestration: undefined,
    subAgents: [],
    subAgentsSectionExpanded: false,
    expandedAgentIds: new Set()
  });

  // Initialize session data ref if resuming
  const sessionDataRef = useRef<SessionData | null>(resumeSession || null);

  const [session, setSession] = useState<AgentSessionHandle | null>(null);
  const sessionRef = useRef<AgentSessionHandle | null>(null);
  const [inputSegments, setInputSegments] = useState<InputSegment[]>([{ type: 'text', text: '' }]);

  // Fast Mode Orchestrator - triages and delegates to sub-agents
  const orchestratorRef = useRef<FastModeCoordinator | null>(null);

  // Smart message queue
  const messageQueueRef = useRef<SmartMessageQueue>(new SmartMessageQueue(30_000, TODOS_FILE));

  // Auto-save helper function
  const autoSaveSession = useCallback(async () => {
    if (!sessionDataRef.current) return;

    // Convert messages to storable format
    sessionDataRef.current.messages = state.messages
      .filter((m) => m.role !== 'system') // Don't save system UI messages
      .map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp.toISOString(),
        toolName: m.toolName,
        toolInput: m.toolInput,
        toolResult: m.toolResult
      }));
    sessionDataRef.current.inputTokens = state.inputTokens;
    sessionDataRef.current.outputTokens = state.outputTokens;
    sessionDataRef.current.model = state.currentModel;

    try {
      await saveSession(sessionDataRef.current);
      debugLog(`Session auto-saved: ${sessionDataRef.current.sessionId}`);
    } catch (err) {
      debugLog(`Failed to auto-save session: ${err}`);
    }
  }, [state.messages, state.inputTokens, state.outputTokens, state.currentModel]);

  // Add download progress state
  const [downloadProgress, setDownloadProgress] = useState<{
    percent: number;
    speed: number;
    eta: number;
    variant: string;
  } | null>(null);

  // AI Tools Status
  const [aiStats, setAiStats] = useState<{
    lsp: { activeServers: number; filesWithDiagnostics: number };
    indexer: {
      isIndexing: boolean;
      current: number;
      total: number;
      totalFiles: number;
      totalChunks: number;
      phase: string;
    };
    patchModel: string;
  } | null>(null);

  // Diagnostics state
  const [projectDiagnostics, setProjectDiagnostics] = useState<Record<string, any[]>>({});
  const [showDiagnosticsPanel, setShowDiagnosticsPanel] = useState(false);

  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [showModelDialog, setShowModelDialog] = useState(false);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [showProviderDialog, setShowProviderDialog] = useState(false);
  const [selectedProviderIndex, setSelectedProviderIndex] = useState(0);
  const hasSeenReturnRef = useRef(false);

  // Available models and providers
  const models = [
    { id: 'fast', name: 'Haiku (Default)', display: 'fast' },
    { id: 'smart-sonnet', name: 'Sonnet (Smart)', display: 'smart-sonnet' },
    { id: 'smart-opus', name: 'Opus (Advanced)', display: 'smart-opus' }
  ];

  const providers = [
    { id: 'anthropic', name: 'Anthropic', description: 'Claude API' },
    { id: 'openai', name: 'OpenAI', description: 'GPT Models' },
    { id: 'local', name: 'Local', description: 'Ollama / Local Models' }
  ];

  // Track when component first mounts - critical for debugging input delay
  useEffect(() => {
    debugLog('ChatApp: Component mounted');
    return () => debugLog('ChatApp: Component unmounting');
  }, []);

  // Initialize AI Tools Service and listeners (non-blocking background init)
  // Set SKIP_AI_TOOLS=1 to bypass AI Tools for input delay debugging
  useEffect(() => {
    if (process.env.SKIP_AI_TOOLS) {
      debugLog('AI Tools: SKIPPED (SKIP_AI_TOOLS=1)');
      return;
    }

    const initAiTools = async () => {
      const aiToolsStart = Date.now();
      try {
        debugLog('AI Tools: Getting instance...');
        const tools = AiToolsService.getInstance(process.cwd());
        debugLog(`AI Tools: Instance created in ${Date.now() - aiToolsStart}ms`);

        // Attach listeners
        tools.on('download:progress', (p) => {
          setDownloadProgress(p);
        });
        tools.on('download:complete', () => {
          setDownloadProgress(null);
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: '[+] Model download complete', timestamp: new Date() }
            ]
          }));
        });

        tools.on('status:change', (stats) => {
          setAiStats(stats);
        });

        // Subscribe to diagnostics updates
        const unsubscribeDiagnostics = tools.subscribeToDiagnostics((event) => {
          debugLog(`Diagnostics update for ${event.path}: ${event.diagnostics.length} diagnostics`);
          setProjectDiagnostics((prev) => ({
            ...prev,
            [event.path]: event.diagnostics
          }));
        });

        debugLog('AI Tools: Initializing (embedder + vector store)...');
        const initStart = Date.now();
        await tools.initialize();
        debugLog(`AI Tools: Initialized in ${Date.now() - initStart}ms`);

        updateState({ aiTools: tools });

        // Initial stats
        setAiStats(tools.getStats());
        debugLog(`AI Tools: Total setup time ${Date.now() - aiToolsStart}ms`);

        // Schedule a check to see when event loop is free after AI Tools
        setTimeout(() => debugLog('AI Tools: setTimeout(0) after init fired'), 0);
        setImmediate(() => debugLog('AI Tools: setImmediate after init fired'));

        // Return cleanup function for diagnostics subscription
        return unsubscribeDiagnostics;
      } catch (err) {
        debugLog(`Failed to init AI Tools: ${err}`);
      }
    };
    // Defer AI Tools init to allow render loop to establish first
    // This prevents blocking during the critical first few render cycles
    debugLog('AI Tools: Deferring init by 500ms...');
    const deferTimeout = setTimeout(() => {
      debugLog('AI Tools: Starting deferred init now');
      initAiTools();
    }, 500);
    return () => clearTimeout(deferTimeout);
  }, []);

  // History navigation
  const [history, setHistory] = useState<InputSegment[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [tempInput, setTempInput] = useState<InputSegment[]>([{ type: 'text', text: '' }]);

  // Autocomplete
  const [completions, setCompletions] = useState<string[]>([]);
  const [selectedCompletion, setSelectedCompletion] = useState(0);
  const [showCompletions, setShowCompletions] = useState(false);

  // Ctrl+X confirmation for stopping
  const [ctrlXPressedOnce, setCtrlXPressedOnce] = useState(false);
  const [ctrlCPressedOnce, setCtrlCPressedOnce] = useState(false);
  const [showQuitWarning, setShowQuitWarning] = useState(false);
  const [showStopWarning, setShowStopWarning] = useState(false);

  // Flashing cursor
  const [cursorVisible, setCursorVisible] = useState(true);
  const [cursorPosition, setCursorPosition] = useState(0);

  // Braille spinner animation for thinking/tool indicators
  const brailleFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const [brailleFrame, setBrailleFrame] = useState(0);

  // Debounce for completions to prevent blocking I/O on every keystroke
  const completionsDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Track first keyboard event for debugging input delay
  const firstKeyboardEventRef = useRef(false);

  // Reset Ctrl+X warning after 2 seconds
  useEffect(() => {
    if (ctrlXPressedOnce) {
      const timeout = setTimeout(() => {
        setCtrlXPressedOnce(false);
        setShowStopWarning(false);
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [ctrlXPressedOnce]);

  // Reset Ctrl+C warning after 2 seconds
  useEffect(() => {
    if (ctrlCPressedOnce) {
      const timeout = setTimeout(() => {
        setCtrlCPressedOnce(false);
        setShowQuitWarning(false);
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [ctrlCPressedOnce]);

  // Flashing cursor effect
  // SKIP_ANIMATIONS=1 disables for debugging
  useEffect(() => {
    if (process.env.SKIP_ANIMATIONS) return;
    const interval = setInterval(() => {
      setCursorVisible((prev) => !prev);
    }, 530); // Blink every 530ms
    return () => clearInterval(interval);
  }, []);

  // Braille spinner animation effect
  // SKIP_ANIMATIONS=1 disables for debugging
  useEffect(() => {
    if (process.env.SKIP_ANIMATIONS) return;
    const interval = setInterval(() => {
      setBrailleFrame((prev) => (prev + 1) % brailleFrames.length);
    }, 80); // Cycle every 80ms for smooth animation
    return () => clearInterval(interval);
  }, []);

  // Update completions when input changes (debounced to prevent blocking I/O on every keystroke)
  useEffect(() => {
    // Clear previous timeout
    if (completionsDebounceRef.current) {
      clearTimeout(completionsDebounceRef.current);
    }

    if (inputSegments.length > 0) {
      // Debounce: wait 200ms after user stops typing before calculating completions
      completionsDebounceRef.current = setTimeout(async () => {
        const comps = await getCompletions(inputSegments);
        setCompletions(comps);
        setShowCompletions(comps.length > 0);
        setSelectedCompletion(0);
      }, 200);
    } else {
      setShowCompletions(false);
    }

    return () => {
      if (completionsDebounceRef.current) {
        clearTimeout(completionsDebounceRef.current);
      }
    };
  }, [inputSegments]);

  // Initialize session
  // Set SKIP_SESSION=1 to bypass session for input delay debugging
  useEffect(() => {
    if (process.env.SKIP_SESSION) {
      debugLog('Session: SKIPPED (SKIP_SESSION=1)');
      return;
    }

    const initSession = async (): Promise<void> => {
      try {
        debugLog('Starting session initialization...');

        const newSession = await startAgentSession(
          {
            ...(oauthToken ? { oauthToken } : { apiKey: apiKey! }),
            workingDirectory: process.cwd(),
            modelPreference:
              (resumeSession?.model as 'fast' | 'smart-sonnet' | 'smart-opus') || 'fast',
            maxThinkingTokens: MAX_THINKING_TOKENS,
            resumeSessionId: resumeSession?.sessionId, // Pass session ID to resume conversation context
            systemPrompt: {
              type: 'custom',
              content: `You are Claudelet, an advanced AI agent running in a Terminal User Interface (TUI).
              
You have access to standard tools (Bash, WebSearch, etc.), but this environment also provides specialized Slash Commands that the USER can run to assist you.

Available User Commands:
- \`/search <query>\`: Semantic Code Search (MGrep). Use this to find code by meaning rather than just exact matches.
- \`/diagnose <file>\`: LSP Diagnostics. Use this to check for errors or warnings in a specific file.
- \`/apply <patch>\`: Fast Apply. Use this to apply code patches efficiently.
- \`/patch-model <model>\`: Switch the underlying model used for applying patches.

When you need to perform these actions, ASK THE USER to run the command. For example:
"I need to find where authentication is handled. Could you run \`/search authentication logic\` for me?"
"I see some potential issues. Please run \`/diagnose src/auth.ts\` so I can see the errors."

You cannot invoke these slash commands yourself directly via tool calls; they must be entered by the user in the input prompt. However, you can use your Bash tool for standard file operations.`
            }
          },
          {
            onTextChunk: (text: string) => {
              debugLog(`onTextChunk: ${text.slice(0, 50)}`);
              updateState((prev) => {
                // End any active thinking session when text starts
                const endedSessions = prev.thinkingSessions.map((session) =>
                  !session.endTime ? { ...session, endTime: new Date() } : session
                );
                const lastMsg = prev.messages[prev.messages.length - 1];
                // Append to last message if it's assistant, otherwise create new
                if (lastMsg?.role === 'assistant') {
                  return {
                    thinkingSessions: endedSessions,
                    outputTokens: prev.outputTokens + estimateTokenCount(text),
                    messages: [
                      ...prev.messages.slice(0, -1),
                      { ...lastMsg, content: lastMsg.content + text }
                    ]
                  };
                } else {
                  return {
                    thinkingSessions: endedSessions,
                    outputTokens: prev.outputTokens + estimateTokenCount(text),
                    messages: [
                      ...prev.messages,
                      { role: 'assistant', content: text, timestamp: new Date(), model: prev.currentModel }
                    ]
                  };
                }
              });
            },

            onThinkingStart: () => {
              debugLog('onThinkingStart');
              updateState((prev) => ({
                thinkingSessions: [
                  ...prev.thinkingSessions,
                  {
                    id: `thinking-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                    startTime: new Date(),
                    content: ''
                  }
                ]
              }));
            },
            onThinkingChunk: (data: { delta: string }) => {
              debugLog(`onThinkingChunk: ${data.delta.slice(0, 30)}`);
              updateState((prev) => {
                // Find and update the last active thinking session
                const lastActiveIdx = prev.thinkingSessions.findIndex((s) => !s.endTime);
                if (lastActiveIdx === -1) return { outputTokens: prev.outputTokens + estimateTokenCount(data.delta) };

                const updated = [...prev.thinkingSessions];
                updated[lastActiveIdx] = {
                  ...updated[lastActiveIdx],
                  content: updated[lastActiveIdx].content + data.delta
                };

                return {
                  thinkingSessions: updated,
                  outputTokens: prev.outputTokens + estimateTokenCount(data.delta)
                };
              });
            },

            onToolUseStart: (tool: {
              id: string;
              name: string;
              input: Record<string, unknown>;
            }) => {
              debugLog(`onToolUseStart: ${tool.name} ${tool.id}`);
              updateState((prev) => {
                // Create a collapsed tool message
                const toolMessage: Message = {
                  role: 'tool',
                  content: '', // Will be filled with result later
                  timestamp: new Date(),
                  toolId: tool.id,
                  toolName: tool.name,
                  toolInput: tool.input,
                  isCollapsed: true,
                  toolMessages: []
                };

                return {
                  currentTool: tool.name,
                  currentToolId: tool.id,
                  usedToolsInCurrentResponse: new Set([...prev.usedToolsInCurrentResponse, tool.name]),
                  messages: [...prev.messages, toolMessage]
                };
              });
            },
            onToolResultStart: (result: {
              toolUseId: string;
              content: string;
              isError: boolean;
            }) => {
              debugLog(`onToolResultStart: ${result.toolUseId} ${result.content?.slice(0, 50)}`);
              updateState((prev) => {
                // Find and update the tool message with the result
                const updatedMessages = prev.messages.map((msg) => {
                  if (msg.toolId === result.toolUseId) {
                    return {
                      ...msg,
                      content: result.content || '',
                      toolResult: result.content
                    };
                  }
                  return msg;
                });

                return {
                  messages: updatedMessages
                };
              });
            },
            onToolResultComplete: (result: {
              toolUseId: string;
              content: string;
              isError?: boolean;
            }) => {
              debugLog(`onToolResultComplete: ${result.toolUseId} ${result.content?.slice(0, 50)}`);
              updateState((prev) => {
                // Find and update the tool message with the result
                const updatedMessages = prev.messages.map((msg) => {
                  if (msg.toolId === result.toolUseId) {
                    return {
                      ...msg,
                      content: result.content || '',
                      toolResult: result.content
                    };
                  }
                  return msg;
                });

                return {
                  currentTool: undefined,
                  currentToolId: undefined,
                  messages: updatedMessages
                };
              });
            },

            onSessionInit: (data: { sessionId: string; resumed?: boolean }) => {
              debugLog(`onSessionInit: ${data.sessionId} resumed=${data.resumed}`);

              // Initialize session persistence
              if (!sessionDataRef.current) {
                sessionDataRef.current = createSessionData(data.sessionId, 'fast');
                debugLog(`Created new session data: ${data.sessionId}`);
              }

              updateState((prev) => ({
                sessionId: data.sessionId,
                messages: [
                  ...prev.messages,
                  {
                    role: 'system',
                    content: `[${data.sessionId.slice(0, 8)}]${data.resumed ? ' resumed' : ''} ${getSessionsDir()}`,
                    timestamp: new Date()
                  }
                ]
              }));
            },
            onMessageComplete: () => {
              debugLog('onMessageComplete');
              updateState((prev) => ({
                isResponding: false,
                thinkingSessions: prev.thinkingSessions.map((s) =>
                  !s.endTime ? { ...s, endTime: new Date() } : s
                ),
                currentTool: undefined
              }));
            },
            onMessageStopped: () => {
              debugLog('onMessageStopped');
              updateState((prev) => ({
                isResponding: false,
                thinkingSessions: prev.thinkingSessions.map((s) =>
                  !s.endTime ? { ...s, endTime: new Date() } : s
                ),
                messages: [
                  ...prev.messages,
                  { role: 'system', content: '[!] Response stopped', timestamp: new Date() }
                ]
              }));
            },
            onError: (error: string) => {
              debugLog(`onError: ${error}`);
              console.error(`[SESSION ERROR] ${error}`);
              updateState((prev) => ({
                isResponding: false,
                thinkingSessions: prev.thinkingSessions.map((s) =>
                  !s.endTime ? { ...s, endTime: new Date() } : s
                ),
                messages: [
                  ...prev.messages,
                  { role: 'system', content: `[x] Session Error: ${error}`, timestamp: new Date() }
                ]
              }));
            },
            onDebugMessage: (message: string) => {
              // Show debug messages for troubleshooting
              if (process.env.CLAUDELET_DEBUG) {
                console.error(`[SDK DEBUG] ${message}`);
              }
            }
          }
        );
        setSession(newSession);
        sessionRef.current = newSession;
        debugLog('Session initialized successfully');

        // Add visible confirmation that session is ready
        updateState((prev) => ({
          messages: [
            ...prev.messages,
            { role: 'system', content: '[✓] Session connected - ready to chat', timestamp: new Date() }
          ]
        }));

        // Initialize Fast Mode Orchestrator for sub-agent management
        const orchestrator = new FastModeCoordinator({
          sessionOptions: {
            ...(oauthToken ? { oauthToken } : { apiKey: apiKey! }),
            workingDirectory: process.cwd(),
            maxThinkingTokens: MAX_THINKING_TOKENS,
            systemPrompt: {
              type: 'custom',
              content: `You are a sub-agent working as part of an orchestrated team. Complete your assigned task efficiently.`
            }
          },
          onStatusChange: (context) => {
            debugLog(`Orchestration status: ${context.status}`);
            updateState({ orchestration: context });
          },
          onSubAgentEvent: (event) => {
            debugLog(`SubAgent event: ${event.type} from ${event.agentId}`);

            // Handle different event types
            if (event.type === 'streaming') {
              // Forward streaming text to main chat
              updateState((prev) => {
                const lastMsg = prev.messages[prev.messages.length - 1];
                if (lastMsg?.role === 'assistant') {
                  return {
                    subAgents: orchestrator.getSubAgents(),
                    messages: [
                      ...prev.messages.slice(0, -1),
                      { ...lastMsg, content: lastMsg.content + event.text }
                    ]
                  };
                } else {
                  return {
                    subAgents: orchestrator.getSubAgents(),
                    messages: [
                      ...prev.messages,
                      { role: 'assistant', content: event.text, timestamp: new Date(), model: prev.currentModel }
                    ]
                  };
                }
              });
            } else if (event.type === 'toolStart') {
              updateState({
                subAgents: orchestrator.getSubAgents(),
                currentTool: event.toolName
              });
            } else if (event.type === 'toolComplete') {
              updateState({
                subAgents: orchestrator.getSubAgents(),
                currentTool: undefined
              });
            } else if (event.type === 'completed') {
              updateState({
                subAgents: orchestrator.getSubAgents(),
                isResponding: false,
                currentTool: undefined,
                usedToolsInCurrentResponse: new Set()
              });
            } else if (event.type === 'failed') {
              updateState((prev) => ({
                subAgents: orchestrator.getSubAgents(),
                isResponding: false,
                usedToolsInCurrentResponse: new Set(),
                messages: [
                  ...prev.messages,
                  { role: 'system', content: `[x] Agent error: ${event.error}`, timestamp: new Date() }
                ]
              }));
            } else {
              // Other events - just update subAgents
              updateState({ subAgents: orchestrator.getSubAgents() });
            }
          }
        });
        orchestratorRef.current = orchestrator;
        debugLog('Orchestrator initialized');
      } catch (error) {
        debugLog(`Session init error: ${error}`);
        updateState((prev) => ({
          messages: [
            ...prev.messages,
            {
              role: 'system',
              content: `[x] Failed to start session: ${error}`,
              timestamp: new Date()
            }
          ]
        }));
      }
    };

    // Defer session init to allow render loop to establish first
    // This prevents blocking during the critical first few render cycles
    debugLog('Session: Deferring init by 1000ms...');
    const deferTimeout = setTimeout(() => {
      debugLog('Session: Starting deferred init now');
      initSession();
    }, 1000);

    return () => {
      clearTimeout(deferTimeout);
      debugLog('Cleaning up session and orchestrator');
      sessionRef.current?.stop();
      orchestratorRef.current?.dispose();
    };
  }, [apiKey, oauthToken]);

  // Auto-save session when response completes
  const prevIsRespondingRef = useRef(state.isResponding);
  useEffect(() => {
    // Detect transition from responding to not responding
    if (prevIsRespondingRef.current && !state.isResponding) {
      debugLog('Response complete, auto-saving session...');
      autoSaveSession();
    }
    prevIsRespondingRef.current = state.isResponding;
  }, [state.isResponding, autoSaveSession]);

  // Auto-injection loop for queued messages
  useEffect(() => {
    if (!state.isResponding) {
      // Reset queue counter when response completes
      updateState({ queuedMessages: 0 });
      messageQueueRef.current.clear();
      return;
    }

    // Check every 1 second for messages to inject
    const interval = setInterval(async () => {
      if (messageQueueRef.current.shouldAutoInject()) {
        const nextMsg = messageQueueRef.current.injectNext();
        if (nextMsg && sessionRef.current) {
          debugLog(`Auto-injecting message: ${nextMsg.text}`);
          updateState((prev) => ({
            queuedMessages: messageQueueRef.current.getPendingCount(),
            messages: [
              ...prev.messages,
              {
                role: 'system',
                content: `[→ AUTO-INJECT]: ${nextMsg.text}`,
                timestamp: new Date()
              }
            ]
          }));
          await sessionRef.current.sendMessage({ role: 'user', content: nextMsg.text });
        }
      }

      // Show alerts for urgent messages
      if (messageQueueRef.current.hasUrgentMessages()) {
        debugLog('Urgent messages detected in queue');
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [state.isResponding]);

  const handleSubmit = useCallback(
    async (segments: InputSegment[]) => {
      const displayText = segmentsToDisplayString(segments).trim();
      if (!displayText) return;

      // If Claude is responding, queue the message instead of sending
      if (state.isResponding && !displayText.startsWith('/')) {
        const msg = messageQueueRef.current.add(displayText);
        updateState((prev) => ({
          queuedMessages: messageQueueRef.current.getPendingCount(),
          messages: [
            ...prev.messages,
            {
              role: 'system',
              content: `[Q] Message queued: "${displayText.substring(0, 40)}${displayText.length > 40 ? '...' : ''}" (${msg.priority})`,
              timestamp: new Date()
            }
          ]
        }));

        // Show alert for urgent messages
        if (msg.priority === 'urgent') {
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              {
                role: 'system',
                content: '🔴 URGENT MESSAGE - Will inject when ready',
                timestamp: new Date()
              }
            ]
          }));
        }

        setInputSegments([{ type: 'text', text: '' }]);
        setCursorPosition(0);
        return;
      }

      // Add to history
      setHistory((prev) => [...prev, segments]);
      setHistoryIndex(-1);
      setTempInput([{ type: 'text', text: '' }]);

      // Add user message and update input tokens
      updateState((prev) => ({
        inputTokens: prev.inputTokens + estimateTokenCount(displayText),
        messages: [...prev.messages, { role: 'user', content: displayText, timestamp: new Date() }]
      }));
      setInputSegments([{ type: 'text', text: '' }]);
      setCursorPosition(0);
      setShowCompletions(false);

      // Handle /help command
      if (displayText === '/help') {
        updateState((prev) => ({
          messages: [
            ...prev.messages,
            {
              role: 'system',
              content: `[?] Commands:
/help           - Show this help
/init           - Generate AGENTS.md for this project
/clear          - Clear conversation
/quit, /exit    - Exit chat
/done           - Mark session as complete and exit
/stop           - Interrupt response
/model <name>   - Switch model (fast/haiku/sonnet/opus)
/sessions       - List saved sessions
/logout         - Clear authentication

[AI Tools]:
/search <query> - Semantic code search (MGrep)
/diagnose <file>- Get LSP diagnostics for file
/apply <patch>  - Apply code patch (FastApply)

[@] Model Override:
@opus <msg>     - Use Opus for this message
@sonnet <msg>   - Use Sonnet for this message
@haiku <msg>    - Use Haiku for this message

[@] File References:
@path/to/file   - Tab to add as chip (file content embedded)
@./             - Reference from cwd

[⌨] Keyboard Shortcuts:
Tab             - Autocomplete files/commands
Shift+Tab       - Toggle coding/planning mode
↑/↓             - History navigation / Completions
Enter           - Submit message
Shift+Enter     - Add newline (multi-line input)
Ctrl+J          - Add newline (multi-line input)
Ctrl+T          - Toggle task list
Ctrl+E          - Toggle tool expansion
Ctrl+M          - Model dialog
Ctrl+S          - AI status dialog
Ctrl+P          - Scroll messages up (previous)
Ctrl+N          - Scroll messages down (next)
Ctrl+X (×2)     - Stop response (press twice)
Ctrl+C×2        - Quit (press twice)
Ctrl+V          - Paste from clipboard

[Q] Smart Queue:
Type while Claude responds to queue messages
Urgent keywords inject immediately

[Session]: Auto-saves to ~/.claudelet/sessions/`,
              timestamp: new Date()
            }
          ]
        }));
        return;
      }

      // Handle /done - mark session as complete and exit
      if (displayText === '/done') {
        if (sessionDataRef.current) {
          await autoSaveSession(); // Save final state
          await completeSession(sessionDataRef.current);
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              {
                role: 'system',
                content: '[✓] Session marked as complete. Goodbye!',
                timestamp: new Date()
              }
            ]
          }));
        }
        setTimeout(() => {
          debugLog('/done command received, exiting gracefully');
          process.kill(process.pid, 'SIGTERM');
        }, 300);
        return;
      }

      // Handle /sessions - list saved sessions
      if (displayText === '/sessions') {
        const sessions = await listSessions();
        const activeCount = sessions.filter((s) => s.status === 'active').length;
        const completedCount = sessions.filter((s) => s.status === 'completed').length;

        let sessionList = `[📂] Sessions (${sessions.length} total, ${activeCount} active, ${completedCount} completed)\n`;
        sessionList += `    Location: ${getSessionsDir()}\n\n`;

        if (sessions.length === 0) {
          sessionList += '    No saved sessions yet.';
        } else {
          const recentSessions = sessions.slice(0, 10);
          for (const s of recentSessions) {
            const status = s.status === 'active' ? '●' : '○';
            const date = new Date(s.updatedAt).toLocaleDateString();
            const time = new Date(s.updatedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            });
            sessionList += `    ${status} [${s.sessionId.slice(0, 8)}] ${date} ${time} - ${s.messageCount} msgs\n`;
            sessionList += `      ${s.preview}\n`;
          }
          if (sessions.length > 10) {
            sessionList += `\n    ... and ${sessions.length - 10} more`;
          }
        }

        updateState((prev) => ({
          messages: [
            ...prev.messages,
            { role: 'system', content: sessionList, timestamp: new Date() }
          ]
        }));
        return;
      }

      // Handle /search (Hybrid: Semantic + Grep fallback with on-demand indexing)
      if (displayText.startsWith('/search ')) {
        const query = displayText.slice(8).trim();
        if (!state.aiTools) {
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: '[x] AI Tools not initialized', timestamp: new Date() }
            ]
          }));
          return;
        }

        updateState((prev) => ({
          messages: [
            ...prev.messages,
            { role: 'system', content: `[🔍] Searching for: "${query}"...`, timestamp: new Date() }
          ]
        }));

        try {
          const { results, source } = await state.aiTools.hybridSearch(query, 5); // Limit to 5 results

          const sourceLabel =
            source === 'semantic' ? '🧠 semantic'
            : source === 'hybrid' ? '🔀 hybrid (indexed on-demand)'
            : '📝 grep';

          const resultText =
            results.length > 0 ?
              `[${sourceLabel}] ${results.length} result${results.length > 1 ? 's' : ''}\n\n` +
              results
                .map(
                  (r) =>
                    `${r.filePath}:${r.metadata.startLine} (${(r.similarity * 100).toFixed(0)}%)\n${r.content.trim().slice(0, 120)}${r.content.length > 120 ? '...' : ''}`
                )
                .join('\n\n')
            : 'No results found.';

          updateState((prev) => ({
            messages: [
              ...prev.messages,
              {
                role: 'system',
                content: resultText,
                timestamp: new Date()
              }
            ]
          }));
        } catch (err) {
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: `[x] Search error: ${err}`, timestamp: new Date() }
            ]
          }));
        }
        return;
      }

      // Handle /diagnose (LSP)
      if (displayText.startsWith('/diagnose ') || displayText.startsWith('/diag ')) {
        const fileArg = displayText.split(' ')[1];
        if (!state.aiTools) {
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: '[x] AI Tools not initialized', timestamp: new Date() }
            ]
          }));
          return;
        }

        if (!fileArg) {
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: '[i] Usage: /diagnose <file>', timestamp: new Date() }
            ]
          }));
          return;
        }

        updateState((prev) => ({
          messages: [
            ...prev.messages,
            { role: 'system', content: `[🩺] Diagnosing ${fileArg}...`, timestamp: new Date() }
          ]
        }));

        try {
          const diagnostics = await state.aiTools.getDiagnostics(fileArg);
          const diagText = diagnostics
            .map(
              (d) =>
                `[${d.severity === 1 ? 'Error' : 'Warning'}] Line ${d.range.start.line + 1}: ${d.message}`
            )
            .join('\n');

          updateState((prev) => ({
            messages: [
              ...prev.messages,
              {
                role: 'tool',
                toolName: 'diagnose',
                toolInput: { file: fileArg },
                content: diagText || 'No issues found.',
                timestamp: new Date()
              }
            ]
          }));
        } catch (err) {
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: `[x] Diagnosis error: ${err}`, timestamp: new Date() }
            ]
          }));
        }
        return;
      }

      // Handle /patch-model
      if (displayText.startsWith('/patch-model')) {
        const arg = displayText.split(' ')[1];
        if (!state.aiTools) {
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: '[x] AI Tools not initialized', timestamp: new Date() }
            ]
          }));
          return;
        }

        if (!arg || arg === 'list') {
          const current = state.aiTools.getPatchingModel();
          const available = state.aiTools.getAvailablePatchingModels();
          const list = available.map((m) => (m === current ? `* ${m}` : `  ${m}`)).join('\n');

          updateState((prev) => ({
            messages: [
              ...prev.messages,
              {
                role: 'system',
                content: `[🤖] Patching Models:\n${list}\n\nUse /patch-model <name> to switch.`,
                timestamp: new Date()
              }
            ]
          }));
          return;
        }

        const available = state.aiTools.getAvailablePatchingModels();
        if (!available.includes(arg)) {
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              {
                role: 'system',
                content: `[x] Invalid model. Available: ${available.join(', ')}`,
                timestamp: new Date()
              }
            ]
          }));
          return;
        }

        updateState((prev) => ({
          messages: [
            ...prev.messages,
            {
              role: 'system',
              content: `[⬇] Switching to ${arg}... (may download)`,
              timestamp: new Date()
            }
          ]
        }));

        try {
          await state.aiTools.setPatchingModel(arg);
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: `[+] Switched to ${arg}`, timestamp: new Date() }
            ]
          }));
        } catch (err) {
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              {
                role: 'system',
                content: `[x] Error switching model: ${err}`,
                timestamp: new Date()
              }
            ]
          }));
        }
        return;
      }

      // Handle /init command
      if (displayText === '/init') {
        updateState((prev) => ({
          messages: [
            ...prev.messages,
            {
              role: 'system',
              content: '[*] Analyzing project and generating AGENTS.md...',
              timestamp: new Date()
            }
          ],
          isResponding: true,
          thinkingSessions: []
        }));

        try {
          const initPrompt = `Please analyze this project and create an AGENTS.md file with context for AI agents working in this codebase.

The AGENTS.md file should include:
- Project structure and technology stack
- Build commands (build, test, lint, format, etc.)
- Code style conventions and patterns
- Framework/library usage patterns
- Common file locations and naming conventions
- Development workflow and best practices
- Any special considerations for AI agents working on this project

Please explore the codebase thoroughly and create a comprehensive AGENTS.md file in the current directory.`;

          await session?.sendMessage({ role: 'user', content: initPrompt });
        } catch (error) {
          updateState((prev) => ({
            isResponding: false,
            messages: [
              ...prev.messages,
              { role: 'system', content: `[x] Error: ${error}`, timestamp: new Date() }
            ]
          }));
        }
        return;
      }

      // Handle /quit
      if (displayText === '/quit' || displayText === '/exit') {
        updateState((prev) => ({
          messages: [
            ...prev.messages,
            { role: 'system', content: '[-] Goodbye!', timestamp: new Date() }
          ]
        }));
        // Give time for message to render, then exit cleanly
        setTimeout(() => {
          debugLog('Quit command received, exiting gracefully');
          process.kill(process.pid, 'SIGTERM');
        }, 300);
        return;
      }

      // Handle /logout
      if (displayText === '/logout') {
        // Clear auth asynchronously (fire-and-forget)
        clearAuth().catch(() => {
          // Ignore errors
        });
        updateState((prev) => ({
          messages: [
            ...prev.messages,
            {
              role: 'system',
              content: '[+] Logged out. Restart to login again.',
              timestamp: new Date()
            }
          ]
        }));
        setTimeout(() => {
          debugLog('Logout command received, exiting gracefully');
          process.kill(process.pid, 'SIGTERM');
        }, 300);
        return;
      }

      // Handle /stop
      if (displayText === '/stop') {
        if (state.isResponding) {
          await session?.interrupt();
        } else {
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: '[i] No response in progress', timestamp: new Date() }
            ]
          }));
        }
        return;
      }

      // Handle /clear
      if (displayText === '/clear') {
        updateState((prev) => ({
          inputTokens: 0,
          outputTokens: 0,
          messages: [
            {
              role: 'system',
              content:
                '[*] Claudelet OpenTUI - Claude Agent Chat\n\nCommands: /help /init /quit /stop /model /logout',
              timestamp: new Date()
            },
            {
              role: 'system',
              content: '[+] Conversation cleared',
              timestamp: new Date()
            }
          ]
        }));
        return;
      }

      // Handle /model
      if (displayText.startsWith('/model ')) {
        const modelArg = displayText.slice(7).trim();
        const modelMap: Record<string, 'fast' | 'smart-sonnet' | 'smart-opus'> = {
          fast: 'fast',
          haiku: 'fast',
          sonnet: 'smart-sonnet',
          opus: 'smart-opus'
        };
        const model = modelMap[modelArg.toLowerCase()];
        if (model) {
          try {
            await session?.setModel(model);
            updateState((prev) => ({
              currentModel: model,
              messages: [
                ...prev.messages,
                { role: 'system', content: `[+] Switched to ${model}`, timestamp: new Date() }
              ]
            }));
          } catch (e) {
            updateState((prev) => ({
              messages: [
                ...prev.messages,
                {
                  role: 'system',
                  content: `[x] Failed to switch model: ${e}`,
                  timestamp: new Date()
                }
              ]
            }));
          }
        } else {
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              {
                role: 'system',
                content: '[i] Unknown model. Use: fast, haiku, sonnet, or opus',
                timestamp: new Date()
              }
            ]
          }));
        }
        return;
      }

      // Send message to Claude via Fast Mode Orchestrator
      try {
        debugLog('Sending message via orchestrator...');
        updateState((prev) => ({ isResponding: true, usedToolsInCurrentResponse: new Set(), thinkingSessions: [] }));
        // DON'T block input - allow queuing messages while responding

        // Convert segments to message content (with file content embedded)
        let messageContent = await segmentsToMessageContent(segments);

        // Prepend context chips as context instructions if any are active
        if (state.contextChips.length > 0) {
          const includeChips = state.contextChips.filter((c) => c.isInclude).map((c) => c.label);
          const excludeChips = state.contextChips.filter((c) => !c.isInclude).map((c) => c.label);

          let contextPreamble = '<context_chips>\n';
          if (includeChips.length > 0) {
            contextPreamble += `INCLUDE context: ${includeChips.join(', ')}\n`;
          }
          if (excludeChips.length > 0) {
            contextPreamble += `EXCLUDE context: ${excludeChips.join(', ')}\n`;
          }
          contextPreamble += '</context_chips>\n\n';

          messageContent = contextPreamble + messageContent;
        }

        // Check for model override (@opus, @sonnet, @haiku prefix)
        const { model: modelOverride, task: messageWithoutModelPrefix } = parseModelOverride(messageContent);
        if (modelOverride) {
          const modelPreference = modelOverride === 'opus' ? 'smart-opus' : modelOverride === 'sonnet' ? 'smart-sonnet' : 'fast';
          await session?.setModel(modelPreference);
          updateState((prev) => ({
            currentModel: modelPreference,
            messages: [
              ...prev.messages,
              { role: 'system', content: `[+] Using ${getModelDisplayFromPreference(modelPreference)} for this message`, timestamp: new Date() }
            ]
          }));
          messageContent = messageWithoutModelPrefix;
        }

        // Use direct session for now (orchestrator disabled for testing)
        // TODO: Re-enable orchestrator once sub-agent sessions are working
        if (session) {
          debugLog('Using direct session...');
          console.error(`[SEND] Sending message: "${messageContent.slice(0, 50)}..."`);
          console.error(`[SEND] Session active: ${session.isActive()}`);
          await session.sendMessage({ role: 'user', content: messageContent });
          console.error(`[SEND] Message queued to SDK`);
        } else {
          throw new Error('No session available');
        }

        debugLog('Message sent successfully');
      } catch (error) {
        debugLog(`Error sending message: ${error}`);
        updateState((prev) => ({
          isResponding: false,
          messages: [
            ...prev.messages,
            { role: 'system', content: `[x] Error: ${error}`, timestamp: new Date() }
          ]
        }));
      }
    },
    [session, state.isResponding, state.aiTools, state.contextChips]
  );
  // Handle special keyboard shortcuts
  useKeyboard((key: KeyEvent) => {
    // Track first keyboard event to diagnose input delay
    if (!firstKeyboardEventRef.current) {
      firstKeyboardEventRef.current = true;
      debugLog('!!! FIRST KEYBOARD EVENT RECEIVED !!!');
    }

    const effectiveChar = getPrintableCharFromKeyEvent(key);
    const charCode = effectiveChar ? effectiveChar.charCodeAt(0) : null;
    debugLog(
      `useKeyboard: ${JSON.stringify({
        name: key.name,
        sequence: key.sequence,
        ctrl: key.ctrl,
        meta: key.meta,
        shift: key.shift,
        option: key.option,
        effectiveChar,
        charCode
      })}`
    );

    // Handle mouse wheel events - scroll messages list
    // SGR format: \x1b[<64;x;yM (scroll up) or \x1b[<65;x;yM (scroll down)
    // Also check for 68/69 (with modifiers like shift)
    if (key.sequence) {
      const seq = key.sequence;
      // Scroll up (wheel up): button codes 64, 68
      if (seq.includes('<64;') || seq.includes('<68;')) {
        updateState((prev) => {
          const maxOffset = Math.max(0, prev.messages.length - 5);
          return {
            ...prev,
            messageScrollOffset: Math.min(maxOffset, prev.messageScrollOffset + 3)
          };
        });
        return;
      }
      // Scroll down (wheel down): button codes 65, 69
      if (seq.includes('<65;') || seq.includes('<69;')) {
        updateState((prev) => ({
          ...prev,
          messageScrollOffset: Math.max(0, prev.messageScrollOffset - 3)
        }));
        return;
      }
    }

    // Ctrl+C to quit - first press clears input, second press quits
    if (key.ctrl && key.name === 'c') {
      const hasInput = inputSegments.length > 1 ||
                      (inputSegments.length === 1 && inputSegments[0].type === 'text' && inputSegments[0].text !== '');

      if (hasInput && !ctrlCPressedOnce) {
        // First press with input - clear the input line
        debugLog('Ctrl+C pressed, clearing input');
        setInputSegments([{ type: 'text', text: '' }]);
        setCtrlCPressedOnce(true);
        setShowQuitWarning(true);
      } else if (ctrlCPressedOnce) {
        // Second press - actually quit
        debugLog('Ctrl+C pressed twice, exiting');
        process.kill(process.pid, 'SIGINT');
      } else {
        // First press without input - show warning
        debugLog('Ctrl+C pressed once, showing warning');
        setCtrlCPressedOnce(true);
        setShowQuitWarning(true);
      }
      return;
    }

    // Allow input even while responding (for smart queue)

    // Ctrl+V to paste from clipboard
    if ((key.ctrl || key.meta) && key.name === 'v') {
      try {
        // Use pbpaste on macOS, xclip on Linux
        const clipboardText =
          process.platform === 'darwin' ?
            execSync('pbpaste', { encoding: 'utf-8' })
          : execSync('xclip -selection clipboard -o', { encoding: 'utf-8' });

        if (clipboardText) {
          setInputSegments((prev) => {
            const lastSegment = prev[prev.length - 1];
            if (lastSegment && lastSegment.type === 'text') {
              return [
                ...prev.slice(0, -1),
                { type: 'text', text: lastSegment.text + clipboardText }
              ];
            }
            return [...prev, { type: 'text', text: clipboardText }];
          });
        }
      } catch (e) {
        debugLog(`Paste failed: ${e}`);
      }
      return;
    }

    // Ctrl+X to stop/cancel - requires two presses
    if (key.ctrl && key.name === 'x') {
      if (state.isResponding) {
        if (ctrlXPressedOnce) {
          // Second press - actually stop
          session?.interrupt();
          setCtrlXPressedOnce(false);
          setShowStopWarning(false);
        } else {
          // First press - show warning
          setCtrlXPressedOnce(true);
          setShowStopWarning(true);
        }
      }
      return;
    }

    // Shift+Tab to toggle coding/planning mode
    if (key.shift && key.name === 'tab') {
      updateState((prev) => {
        const newMode = prev.agentMode === 'coding' ? 'planning' : 'coding';
        return {
          ...prev,
          agentMode: newMode,
          messages: [
            ...prev.messages,
            {
              role: 'system',
              content: `[M] Switched to ${newMode.toUpperCase()} mode`,
              timestamp: new Date()
            }
          ]
        };
      });
      return;
    }

    // Ctrl+T to show task list
    if (key.ctrl && key.name === 't') {
      const toggleTaskList = async () => {
        if (!state.showTaskList) {
          // Show task list
          const taskContent = await readTaskList();
          updateState((prev) => ({
            showTaskList: true,
            messages: [
              ...prev.messages,
              {
                role: 'system',
                content: `[T] Claude's Task List:\n\n${taskContent}`,
                timestamp: new Date()
              }
            ]
          }));
        } else {
          // Hide task list
          updateState((prev) => ({ showTaskList: false }));
        }
      };
      toggleTaskList();
      return;
    }

    // Ctrl+S to toggle AI Status Dialog
    if (key.ctrl && key.name === 's') {
      setShowStatusDialog((prev) => !prev);
      return;
    }

    // Ctrl+M to toggle Model Dialog
    if (key.ctrl && key.name === 'm') {
      if (!showModelDialog) {
        setSelectedModelIndex(models.findIndex((m) => m.display === state.currentModel));
      }
      setShowModelDialog((prev) => !prev);
      return;
    }

    // Ctrl+Shift+P to toggle Provider Dialog (Ctrl+P is used for scroll)
    if (key.ctrl && key.shift && key.name === 'p') {
      setShowProviderDialog((prev) => !prev);
      return;
    }

    // Handle Model Dialog navigation
    if (showModelDialog && (key.name === 'up' || key.name === 'down')) {
      if (key.name === 'up') {
        setSelectedModelIndex((prev) => (prev - 1 + models.length) % models.length);
      } else {
        setSelectedModelIndex((prev) => (prev + 1) % models.length);
      }
      return;
    }

    // Handle Model Dialog selection
    if (showModelDialog && (key.name === 'return' || key.name === 'space')) {
      const selected = models[selectedModelIndex];
      switchModel(selected.display as 'fast' | 'smart-sonnet' | 'smart-opus', session, updateState);
      setShowModelDialog(false);
      return;
    }

    // Handle Provider Dialog navigation
    if (showProviderDialog && (key.name === 'up' || key.name === 'down')) {
      if (key.name === 'up') {
        setSelectedProviderIndex((prev) => (prev - 1 + providers.length) % providers.length);
      } else {
        setSelectedProviderIndex((prev) => (prev + 1) % providers.length);
      }
      return;
    }

    // Handle Provider Dialog selection
    if (showProviderDialog && (key.name === 'return' || key.name === 'space')) {
      updateState((prev) => ({
        messages: [
          ...prev.messages,
          {
            role: 'system',
            content: `[→] Switched to provider: ${providers[selectedProviderIndex].name}`,
            timestamp: new Date()
          }
        ]
      }));
      setShowProviderDialog(false);
      return;
    }

    // Close dialogs with Escape key
    if (key.name === 'escape') {
      setShowModelDialog(false);
      setShowProviderDialog(false);
      return;
    }

    // Ctrl+E to toggle last tool expansion
    if (key.ctrl && key.name === 'e') {
      updateState((prev) => {
        // Find the last tool message
        const lastToolIndex = [...prev.messages].reverse().findIndex((m) => m.role === 'tool');

        if (lastToolIndex === -1) return prev; // No tools to toggle

        const actualIndex = prev.messages.length - 1 - lastToolIndex;
        const toolMsg = prev.messages[actualIndex];

        // Toggle expanded state
        const isExpanded = !toolMsg.isCollapsed;
        const newExpandedIds = new Set(prev.expandedToolIds);

        if (isExpanded && toolMsg.toolId) {
          newExpandedIds.add(toolMsg.toolId);
        } else if (toolMsg.toolId) {
          newExpandedIds.delete(toolMsg.toolId);
        }

        return {
          ...prev,
          expandedToolIds: newExpandedIds,
          messages: prev.messages.map((msg, idx) =>
            idx === actualIndex ? { ...msg, isCollapsed: isExpanded } : msg
          )
        };
      });
      return;
    }

    // Ctrl+N to scroll messages down (next page)
    if (key.ctrl && key.name === 'n') {
      updateState((prev) => ({
        messageScrollOffset: Math.max(0, prev.messageScrollOffset - 5)
      }));
      return;
    }

    // Ctrl+O to toggle sub-agents section expansion
    if (key.ctrl && key.name === 'o') {
      updateState((prev) => ({
        subAgentsSectionExpanded: !prev.subAgentsSectionExpanded
      }));
      return;
    }

    // Ctrl+P to scroll messages up (previous page)
    if (key.ctrl && key.name === 'p') {
      updateState((prev) => {
        const maxOffset = Math.max(0, prev.messages.length - 15);
        return {
          ...prev,
          messageScrollOffset: Math.min(maxOffset, prev.messageScrollOffset + 5)
        };
      });
      return;
    }

    // Tab to complete
    if (key.name === 'tab' && showCompletions && completions.length > 0) {
      const completion = completions[selectedCompletion];

      setInputSegments((prev) => {
        const lastSegment = prev[prev.length - 1];
        if (!lastSegment || lastSegment.type !== 'text') return prev;

        const text = lastSegment.text;

        // Command completion
        if (text.startsWith('/') && prev.length === 1) {
          return [{ type: 'text', text: completion }];
        }

        // File completion - create a chip
        if (text.includes('@')) {
          const lastAtIndex = text.lastIndexOf('@');
          const beforeAt = text.slice(0, lastAtIndex);

          // Extract the file path from completion (remove @)
          const filePath = completion.startsWith('@') ? completion.slice(1) : completion;
          // Get just the filename for display
          const fileName = filePath.split('/').pop() || filePath;

          // Create new segments
          const newSegments = [...prev.slice(0, -1)];
          if (beforeAt) {
            newSegments.push({ type: 'text', text: beforeAt });
          }
          newSegments.push({
            type: 'chip',
            chip: {
              id: `chip-${Date.now()}`,
              label: fileName,
              filePath: filePath
            }
          });
          newSegments.push({ type: 'text', text: ' ' });
          return newSegments;
        }

        return prev;
      });
      setShowCompletions(false);
      return;
    }

    // Up/Down navigation
    if (key.name === 'up') {
      if (showCompletions && completions.length > 0) {
        // Navigate completions
        setSelectedCompletion((prev) => (prev > 0 ? prev - 1 : completions.length - 1));
      } else {
        // Navigate history
        if (historyIndex === -1 && history.length > 0) {
          setTempInput(inputSegments);
          setHistoryIndex(history.length - 1);
          setInputSegments(history[history.length - 1]);
        } else if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          setInputSegments(history[newIndex]);
        }
      }
      return;
    }

    if (key.name === 'down') {
      if (showCompletions && completions.length > 0) {
        // Navigate completions
        setSelectedCompletion((prev) => (prev < completions.length - 1 ? prev + 1 : 0));
      } else {
        // Navigate history
        if (historyIndex !== -1) {
          if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            setInputSegments(history[newIndex]);
          } else {
            setHistoryIndex(-1);
            setInputSegments(tempInput);
          }
        }
      }
      return;
    }

    // Shift+Enter or Ctrl+J to add newline (multi-line input)
    if (
      (key.shift && (key.name === 'return' || key.name === 'linefeed' || key.name === 'enter')) ||
      (key.ctrl && key.name === 'j')
    ) {
      setInputSegments((prev) => {
        const lastSegment = prev[prev.length - 1];
        if (!lastSegment || lastSegment.type !== 'text') {
          return [...prev, { type: 'text', text: '\n' }];
        }
        return [...prev.slice(0, -1), { type: 'text', text: lastSegment.text + '\n' }];
      });
      return;
    }

    // Track whether this terminal uses CR ("return") for Enter.
    if (key.name === 'return') {
      hasSeenReturnRef.current = true;
    }

    // If the terminal sends LF ("linefeed") via a keybind (e.g. Ghostty `text:\n`),
    // treat LF as newline once we've observed that normal Enter arrives as CR.
    if (key.name === 'linefeed' && !key.shift && hasSeenReturnRef.current) {
      setInputSegments((prev) => {
        const lastSegment = prev[prev.length - 1];
        if (!lastSegment || lastSegment.type !== 'text') {
          return [...prev, { type: 'text', text: '\n' }];
        }
        return [...prev.slice(0, -1), { type: 'text', text: lastSegment.text + '\n' }];
      });
      return;
    }

    // Return/Enter to submit (but not Shift+Enter)
    if ((key.name === 'return' || key.name === 'linefeed' || key.name === 'enter') && !key.shift) {
      handleSubmit(inputSegments);
      return;
    }

    // Space: check for context chip patterns (+term or -term)
    if (key.name === 'space' && !key.ctrl && !key.meta && !key.shift) {
      const lastSegment = inputSegments[inputSegments.length - 1];
      if (lastSegment && lastSegment.type === 'text') {
        const match = lastSegment.text.match(/([+-])([a-zA-Z0-9_-]+)$/);
        if (match) {
          const [fullMatch, prefix, term] = match;
          const isInclude = prefix === '+';
          const newChip: ContextChip = {
            id: `ctx-${Date.now()}-${Math.random()}`,
            label: term,
            isInclude
          };

          // Remove the pattern from text and add context chip + space
          const textWithoutPattern = lastSegment.text.slice(0, -fullMatch.length);
          setInputSegments((prev) => {
            const segments = [...prev.slice(0, -1)];
            if (textWithoutPattern) {
              segments.push({ type: 'text', text: textWithoutPattern });
            }
            segments.push({ type: 'context', context: newChip });
            segments.push({ type: 'text', text: ' ' });
            return segments;
          });

          // Add to active context chips
          updateState((prev) => ({ contextChips: [...prev.contextChips, newChip] }));
          return;
        }
      }

      // Fall through to regular space handling if no pattern matched
    }

    // Backspace
    if (key.name === 'backspace' || key.name === 'delete') {
      setInputSegments((prev) => {
        if (prev.length === 0) return [{ type: 'text', text: '' }];

        const lastSegment = prev[prev.length - 1];

        // If last segment is a chip, remove it entirely
        if (lastSegment.type === 'chip') {
          const remaining = prev.slice(0, -1);
          return remaining.length === 0 ? [{ type: 'text', text: '' }] : remaining;
        }

        // If last segment is a context chip, remove it and update active chips
        if (lastSegment.type === 'context') {
          updateState((prevState) => ({
            ...prevState,
            contextChips: prevState.contextChips.filter((c) => c.id !== lastSegment.context.id)
          }));
          const remaining = prev.slice(0, -1);
          return remaining.length === 0 ? [{ type: 'text', text: '' }] : remaining;
        }

        // If last segment is text, remove last character
        if (lastSegment.type === 'text') {
          const newText = lastSegment.text.slice(0, -1);
          if (newText === '' && prev.length > 1) {
            // Remove empty text segment
            const remaining = prev.slice(0, -1);
            return remaining;
          }
          setCursorPosition((prev) => Math.max(0, prev - 1));
          return [...prev.slice(0, -1), { type: 'text', text: newText }];
        }

        return prev;
      });
      return;
    }

    // Regular character input
    // Ensure we have a valid char and it's not a control key being pressed (except handled above)
    if (effectiveChar && !key.ctrl && !key.meta && effectiveChar.length === 1) {
      // Filter out escape sequences and non-printable characters
      const charCode = effectiveChar.charCodeAt(0);
      const isPrintable = charCode >= 32 && charCode <= 126; // Standard ASCII printable range
      const isEscape = charCode === 27; // ESC character

      if (!isPrintable || isEscape) {
        debugLog(`Filtered non-printable char: code=${charCode} char="${effectiveChar}"`);
        return; // Don't process non-printable characters
      }

      setInputSegments((prev) => {
        const lastSegment = prev[prev.length - 1];

        // Reset history navigation
        if (historyIndex !== -1) {
          setHistoryIndex(-1);
        }

        // If last segment is text, append to it
        if (lastSegment && lastSegment.type === 'text') {
          setCursorPosition((prev) => prev + 1);
          return [...prev.slice(0, -1), { type: 'text', text: lastSegment.text + effectiveChar }];
        }

        // If last segment is chip, create new text segment
        setCursorPosition((prev) => prev + 1);
        return [...prev, { type: 'text', text: effectiveChar }];
      });
    }
  });

  // Handle paste events from terminal (Cmd+V on Mac)
  const renderer = useRenderer();
  useEffect(() => {
    const handlePaste = (event: { text: string }) => {
      debugLog(`Paste event: ${event.text.slice(0, 50)}`);
      if (event.text) {
        setInputSegments((prev) => {
          const lastSegment = prev[prev.length - 1];
          if (lastSegment && lastSegment.type === 'text') {
            return [...prev.slice(0, -1), { type: 'text', text: lastSegment.text + event.text }];
          }
          return [...prev, { type: 'text', text: event.text }];
        });
      }
    };

    renderer.keyInput.on('paste', handlePaste);
    return () => {
      renderer.keyInput.off('paste', handlePaste);
    };
  }, [renderer]);

  // Terminal size state
  const [terminalSize, setTerminalSize] = useState({
    rows: process.stdout.rows || 24,
    columns: process.stdout.columns || 80
  });

  // Handle resize
  useEffect(() => {
    const onResize = () => {
      setTerminalSize({
        rows: process.stdout.rows || 24,
        columns: process.stdout.columns || 80
      });
    };
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);

  // Calculate visible messages (with scroll offset) dynamically based on available lines
  const { visibleMessages, scrollOffset } = useMemo(() => {
    const INPUT_HEIGHT = 3; // Bordered input box
    const STATUS_HEIGHT = 1;
    const PADDING_HEIGHT = 2; // Top/bottom padding

    // Check if tools are visible to reserve space
    const hasTools = state.messages.some((m) => m.role === 'tool');
    const TOOL_CHIPS_HEIGHT = hasTools ? 1 : 0; // Tool chips row (conditional)
    const CONTEXT_CHIPS_HEIGHT = state.contextChips.length > 0 ? 1 : 0; // Context chips row (conditional)

    const AVAILABLE_ROWS = Math.max(
      5,
      terminalSize.rows - INPUT_HEIGHT - STATUS_HEIGHT - PADDING_HEIGHT - TOOL_CHIPS_HEIGHT - CONTEXT_CHIPS_HEIGHT
    );

    const totalMessages = state.messages.length;
    const reversedMessages = [...state.messages].reverse();

    // Calculate how many messages fit in the available rows
    let usedRows = 0;
    let visibleCount = 0;

    // Apply scroll offset (skip N messages from the bottom/end)
    const effectiveScrollOffset = Math.max(
      0,
      Math.min(state.messageScrollOffset, totalMessages - 1)
    );
    const messagesToConsider = reversedMessages.slice(effectiveScrollOffset);

    for (const msg of messagesToConsider) {
      let msgHeight = 0;

      // Basic height estimation
      if (msg.role === 'tool' && msg.isCollapsed) {
        msgHeight = 1; // Collapsed tool is 1 line
      } else {
        // Estimate lines based on wrapping
        // Header line (You: / Claude:)
        msgHeight += 1;

        // Content lines
        if (msg.content) {
          const lines = msg.content.split('\n');
          for (const line of lines) {
            msgHeight += Math.max(1, Math.ceil(line.length / terminalSize.columns));
          }
        }

        // Tool specific extras
        if (msg.role === 'tool') {
          if (!msg.isCollapsed) {
            // Input preview lines
            if (msg.toolInput)
              msgHeight += JSON.stringify(msg.toolInput, null, 2).split('\n').length + 1;
          }
        }
      }

      // Spacer between messages
      msgHeight += 1;

      if (usedRows + msgHeight > AVAILABLE_ROWS) {
        break;
      }

      usedRows += msgHeight;
      visibleCount++;
    }

    // Determine slice indices
    // We found 'visibleCount' messages starting from 'effectiveScrollOffset' from the end
    // Total messages: 100
    // Scroll offset: 0
    // Visible count: 5 (last 5 messages fit)
    // Start index = 100 - 0 - 5 = 95
    // End index = 100 - 0 = 100

    const endIdx = totalMessages - effectiveScrollOffset;
    const startIdx = Math.max(0, endIdx - visibleCount);

    return {
      visibleMessages: state.messages.slice(startIdx, endIdx),
      scrollOffset: effectiveScrollOffset
    };
  }, [state.messages, state.messageScrollOffset, terminalSize]);

  // Compute grouped tool activity for chips display
  const toolActivity = useMemo(() => extractToolActivity(state.messages), [state.messages]);

  return (
    <box style={{ flexDirection: 'column', height: '100%' }}>
      {/* Messages area */}
      <box
        style={{
          flexDirection: 'column',
          flexGrow: 1,
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 1
        }}
      >
        {visibleMessages
          .filter((msg) => msg.role !== 'tool') // Exclude tool messages - shown in chips instead
          .map((msg, i) => {
            const key = `${msg.timestamp.getTime()}-${msg.role}-${i}`;

            if (msg.role === 'user') {
              const hasMarkdown = isMarkdown(msg.content);
              return (
                <box key={key} style={{ flexDirection: 'column', marginBottom: 1 }}>
                  <box
                    border={true}
                    borderStyle="rounded"
                    borderColor="gray"
                    style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 0, paddingBottom: 0 }}
                    bg="blackBright"
                  >
                    {hasMarkdown ?
                      renderMarkdown(msg.content)
                    : <text content={msg.content} fg="white" />}
                  </box>
                </box>
              );
            }

            if (msg.role === 'assistant') {
              const hasMarkdown = isMarkdown(msg.content);
              const modelDisplay = msg.model ? getModelDisplayFromPreference(msg.model) : null;
              return (
                <box key={key} style={{ flexDirection: 'column', marginBottom: 1 }}>
                  <box
                    border={true}
                    borderStyle="rounded"
                    borderColor="gray"
                    style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 0, paddingBottom: 0 }}
                    bg="blackBright"
                  >
                    {hasMarkdown ?
                      renderMarkdown(msg.content)
                    : <text content={msg.content} fg="white" />}
                  </box>
                  {modelDisplay && (
                    <text content={` [${modelDisplay}]`} fg="gray" />
                  )}
                </box>
              );
            }

            if (msg.role === 'system') {
              // Special styling for logo
              const isLogo = msg.content.includes(',gggg,');
              if (isLogo) {
                return (
                  <box key={key} style={{ marginBottom: 1 }}>
                    <text content={msg.content} fg="yellow" />
                  </box>
                );
              }
              // Special styling for welcome message
              const isWelcome = msg.content.includes('Claudelet OpenTUI - Claude Agent Chat');
              if (isWelcome) {
                return (
                  <box
                    key={key}
                    border={true}
                    borderStyle="rounded"
                    borderColor="gray"
                    style={{ marginBottom: 1, paddingLeft: 1, paddingRight: 1, paddingTop: 0, paddingBottom: 0 }}
                    bg="blackBright"
                  >
                    <text content={msg.content} fg="white" />
                  </box>
                );
              }
              return (
                <box key={key} style={{ marginBottom: 0 }}>
                  <text content={msg.content} fg="gray" />
                </box>
              );
            }

            return null;
          })}

        {/* Scroll indicators */}
        {scrollOffset > 0 && (
          <box style={{ marginTop: 0 }}>
            <text
              content={`↑ Scroll up to see ${scrollOffset} earlier message${scrollOffset > 1 ? 's' : ''}`}
              fg="gray"
            />
          </box>
        )}

        {/* INLINE MODE: Bordered boxes inline with messages */}
        {state.chipDisplayStyle === 'inline' && (state.thinkingSessions.length > 0 || state.currentTool || toolActivity.length > 0 || state.contextChips.length > 0) && (
          <box style={{ marginTop: 1, flexDirection: 'row', flexWrap: 'wrap', paddingLeft: 1 }}>
            {/* Thinking sessions */}
            {state.thinkingSessions.map((session) => (
              <box
                key={session.id}
                border={true}
                borderStyle="rounded"
                borderColor="yellow"
                style={{ paddingLeft: 1, paddingRight: 1, marginRight: 1 }}
              >
                <text content={formatThinkingChip(session, true, brailleFrame)} fg="yellow" />
              </box>
            ))}

            {/* Running tool box */}
            {state.currentTool && (
              <box
                border={true}
                borderStyle="rounded"
                borderColor="magenta"
                style={{ paddingLeft: 1, paddingRight: 1, marginRight: 1 }}
              >
                <text content={`${brailleFrames[brailleFrame]} ${state.currentTool}`} fg="magenta" />
              </box>
            )}

            {/* Tool boxes inline */}
            {toolActivity.map((activity) => (
              <box
                key={`inline-tool-${activity.name}`}
                border={true}
                borderStyle="rounded"
                borderColor={activity.isActive ? 'cyan' : 'gray'}
                style={{ paddingLeft: 1, paddingRight: 1, marginRight: 1 }}
              >
                <text
                  content={`${activity.name.toLowerCase()}${activity.count > 1 ? ` x${activity.count}` : ''}`}
                  fg={activity.isActive ? 'cyan' : 'gray'}
                  bold={activity.isActive}
                />
              </box>
            ))}

            {/* Context chips as bordered boxes */}
            {state.contextChips.map((chip) => {
              const prefix = chip.isInclude ? '+' : '-';
              return (
                <box
                  key={`inline-context-${chip.id}`}
                  border={true}
                  borderStyle="rounded"
                  borderColor="gray"
                  style={{ paddingLeft: 1, paddingRight: 1, marginRight: 1 }}
                  onClick={() => {
                    // Remove chip when clicked
                    updateState((prev) => ({
                      contextChips: prev.contextChips.filter((c) => c.id !== chip.id)
                    }));
                    setInputSegments((prev) => prev.filter((seg) => seg.type !== 'context' || seg.context.id !== chip.id));
                  }}
                >
                  <text content={`${prefix}${chip.label}`} fg="gray" bold />
                </box>
              );
            })}
          </box>
        )}

        {/* Stop warning */}
        {showStopWarning && (
          <box
            border={true}
            borderStyle="rounded"
            borderColor="red"
            style={{ marginTop: 0, paddingLeft: 1, paddingRight: 1 }}
          >
            <text content="[!] Press Ctrl+X again to stop" fg="red" bold />
          </box>
        )}
        {showQuitWarning && (
          <box
            border={true}
            borderStyle="rounded"
            borderColor="yellow"
            style={{ marginTop: 0, paddingLeft: 1, paddingRight: 1 }}
          >
            <text content="[!] Press Ctrl+C again to quit" fg="yellow" bold />
          </box>
        )}
      </box>

      {/* Download progress indicator */}
      {downloadProgress && (
        <box
          border={true}
          borderStyle="rounded"
          borderColor="blue"
          style={{ marginTop: 0, paddingLeft: 1, paddingRight: 1 }}
        >
          <text
            content={`[⬇] Downloading ${downloadProgress.variant}: ${downloadProgress.percent.toFixed(1)}% (${(downloadProgress.speed / 1024 / 1024).toFixed(1)} MB/s) ETA: ${downloadProgress.eta}s`}
            fg="blue"
          />
        </box>
      )}

      {/* Chip display - mode-based rendering (BOXES MODE: fixed above input) */}
      {state.chipDisplayStyle === 'boxes' && (state.thinkingSessions.length > 0 || state.currentTool || toolActivity.length > 0 || state.contextChips.length > 0) && (
        <box style={{ marginTop: 0, flexDirection: 'row', paddingLeft: 1, flexWrap: 'wrap' }}>
          {/* Thinking sessions */}
          {state.thinkingSessions.map((session) => (
            <box
              key={session.id}
              border={true}
              borderStyle="rounded"
              borderColor="yellow"
              style={{ paddingLeft: 1, paddingRight: 1, marginRight: 1 }}
            >
              <text content={formatThinkingChip(session, true, brailleFrame)} fg="yellow" />
            </box>
          ))}

          {/* Running tool box */}
          {state.currentTool && (
            <box
              border={true}
              borderStyle="rounded"
              borderColor="magenta"
              style={{ paddingLeft: 1, paddingRight: 1, marginRight: 1 }}
            >
              <text
                content={`${brailleFrames[brailleFrame]} ${state.currentTool}`}
                fg="magenta"
              />
            </box>
          )}

          {/* Tool activity boxes */}
          {toolActivity.map((activity) => (
            <box
              key={`boxes-tool-${activity.name}`}
              border={true}
              borderStyle="rounded"
              borderColor={activity.isActive ? 'cyan' : 'gray'}
              style={{ paddingLeft: 1, paddingRight: 1, marginRight: 1 }}
            >
              <text
                content={`${activity.name.toLowerCase()}${activity.count > 1 ? ` x${activity.count}` : ''}`}
                fg={activity.isActive ? 'cyan' : 'gray'}
                bold={activity.isActive}
              />
            </box>
          ))}

          {/* Context chips - shown as bordered boxes */}
          {state.contextChips.map((chip) => {
            const prefix = chip.isInclude ? '+' : '-';

            return (
              <box
                key={`context-chip-${chip.id}`}
                border={true}
                borderStyle="rounded"
                borderColor="gray"
                style={{ paddingLeft: 1, paddingRight: 1, marginRight: 1 }}
                onClick={() => {
                  // Remove chip when clicked
                  updateState((prev) => ({
                    contextChips: prev.contextChips.filter((c) => c.id !== chip.id)
                  }));
                  setInputSegments((prev) => prev.filter((seg) => seg.type !== 'context' || seg.context.id !== chip.id));
                }}
              >
                <text
                  content={`${prefix}${chip.label}`}
                  fg="gray"
                  bold
                />
              </box>
            );
          })}
        </box>
      )}


      {/* Completions dropdown */}
      {showCompletions &&
        completions.length > 0 &&
        (() => {
          const MAX_VISIBLE = 5;
          const total = completions.length;
          let startIdx = 0;
          let endIdx = Math.min(MAX_VISIBLE, total);

          if (selectedCompletion >= MAX_VISIBLE) {
            startIdx = Math.min(
              selectedCompletion - Math.floor(MAX_VISIBLE / 2),
              total - MAX_VISIBLE
            );
            endIdx = startIdx + MAX_VISIBLE;
          }

          const visibleCompletions = completions.slice(startIdx, endIdx);

          return (
            <box
              style={{ flexDirection: 'column', paddingLeft: 1, paddingRight: 1, marginBottom: 0, maxHeight: 10, flexShrink: 0 }}
              border={true}
              borderStyle="rounded"
              borderColor="gray"
            >
              <text content="Completions (Tab to select, ↑↓ to navigate):" fg="white" bold />
              {startIdx > 0 && <text content={`↑ ${startIdx} more above`} fg="gray" />}
              {visibleCompletions.map((comp, i) => {
                const actualIdx = startIdx + i;
                return (
                  <text
                    key={`completion-${actualIdx}`}
                    content={`${actualIdx === selectedCompletion ? '→ ' : '  '}${comp}`}
                    fg={actualIdx === selectedCompletion ? 'white' : 'gray'}
                    bold={actualIdx === selectedCompletion}
                  />
                );
              })}
              {endIdx < total && <text content={`↓ ${total - endIdx} more below`} fg="gray" />}
            </box>
          );
        })()}

      {/* Sub-agents section - expands above input when toggled */}
      {state.subAgentsSectionExpanded && (
        <CollapsibleSubAgentsSection
          agents={state.subAgents}
          isExpanded={true}
          expandedAgents={state.expandedAgentIds}
          onToggleSection={() => {
            updateState((prev) => ({
              subAgentsSectionExpanded: !prev.subAgentsSectionExpanded
            }));
          }}
          onToggleAgent={(agentId) => {
            updateState((prev) => {
              const newSet = new Set(prev.expandedAgentIds);
              if (newSet.has(agentId)) {
                newSet.delete(agentId);
              } else {
                newSet.add(agentId);
              }
              return { expandedAgentIds: newSet };
            });
          }}
        />
      )}

      {/* Input bar */}
      <box border={true} borderStyle="rounded" borderColor="gray" style={{ paddingLeft: 1, flexShrink: 0, minHeight: 3 }}>
        {true ?
          <box style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <text content="> " fg="gray" />
            {(() => {
              // Check if empty
              const isEmpty = inputSegments.length === 1 &&
                             inputSegments[0].type === 'text' &&
                             inputSegments[0].text === '';

              if (isEmpty) {
                return (
                  <>
                    <text content={cursorVisible ? '█' : ' '} fg="gray" />
                    <text
                      content=" Type your message... (Tab: complete, ↑↓: history, Ctrl+X×2: stop, Ctrl+C: quit)"
                      fg="gray"
                    />
                  </>
                );
              }

              // Render segments with styling
              return (
                <>
                  {inputSegments.map((segment, idx) => {
                    if (segment.type === 'text') {
                      return <text key={`text-${idx}`} content={segment.text} fg="white" />;
                    } else if (segment.type === 'chip') {
                      return (
                        <text
                          key={`chip-${segment.chip.id}`}
                          content={`[${segment.chip.label}×]`}
                          bg="blue"
                          fg="black"
                          bold={true}
                          onClick={() => {
                            // Remove chip when clicked
                            setInputSegments((prev) => prev.filter((_, i) => i !== idx));
                          }}
                        />
                      );
                    } else {
                      // Context chip
                      const chipBg = segment.context.isInclude ? 'white' : 'red';
                      const chipFg = segment.context.isInclude ? 'black' : 'white';
                      const prefix = segment.context.isInclude ? '+' : '-';
                      return (
                        <text
                          key={`context-${segment.context.id}`}
                          content={`[${prefix}${segment.context.label}×]`}
                          bg={chipBg}
                          fg={chipFg}
                          bold={true}
                          onClick={() => {
                            // Remove chip when clicked
                            setInputSegments((prev) => prev.filter((_, i) => i !== idx));
                          }}
                        />
                      );
                    }
                  })}
                  <text content={cursorVisible ? '█' : ' '} fg="gray" />
                </>
              );
            })()}
          </box>
        : <box style={{ flexDirection: 'row' }}>
            <text content="* " fg="red" bold />
            <text content="Waiting for response..." fg="gray" />
          </box>
        }
      </box>

      {/* Status bar */}
      <box style={{ paddingLeft: 1, paddingRight: 1, marginTop: 0, flexDirection: 'row' }}>
        <text content={getModelDisplayFromPreference(state.currentModel)} fg="gray" />
        <text content=" | Mode: " fg="gray" />
        <text
          content={state.agentMode.toUpperCase()}
          fg="white"
          bold
        />
        <text content=" | " fg="gray" />
        <text
          content={`${state.subAgentsSectionExpanded ? '[-]' : '[+]'} Agents: ${state.subAgents.length}`}
          fg="magenta"
          bold
          onClick={() => {
            updateState((prev) => ({
              subAgentsSectionExpanded: !prev.subAgentsSectionExpanded
            }));
          }}
        />
        {state.queuedMessages > 0 && <text content=" | " fg="gray" />}
        {state.queuedMessages > 0 && (
          <box
            border={true}
            borderStyle="rounded"
            borderColor="blue"
            style={{ paddingLeft: 1, paddingRight: 1, marginRight: 1 }}
          >
            <text
              content={`${state.queuedMessages} queued`}
              fg="blue"
              bold
            />
          </box>
        )}
        <text content=" | " fg="gray" />
        {(() => {
          const MAX_CONTEXT = 200000;
          const total = state.inputTokens + state.outputTokens;
          const percentLeft = Math.max(0, Math.round(((MAX_CONTEXT - total) / MAX_CONTEXT) * 100));
          return <text content={`${percentLeft}%`} fg="white" bold />;
        })()}
        <text content=" (" fg="gray" />
        <text content={`↑ ${state.inputTokens.toLocaleString()}`} fg="white" />
        <text content=" " fg="gray" />
        <text content={`↓ ${state.outputTokens.toLocaleString()}`} fg="white" />
        <text content=")" fg="gray" />
        {historyIndex !== -1 && (
          <text content={` | H${historyIndex + 1}/${history.length}`} fg="gray" />
        )}
        {aiStats && (
          <box style={{ flexDirection: 'row' }}>
            <text content=" | " fg="gray" />
            {/* Watcher status indicator - colored bullet */}
            <text
              content="●"
              fg={
                aiStats.watcher === 'off' ? 'gray' :
                aiStats.watcher === 'starting' ? 'yellow' :
                aiStats.watcher === 'ready' ? 'green' :
                aiStats.watcher === 'watching' ? 'cyan' :
                aiStats.watcher === 'error' ? 'red' : 'gray'
              }
            />
            <text content=" " fg="gray" />
            <text content="LSP: " fg="gray" />
            <text content={`${aiStats.lsp.activeServers}`} fg="white" />
            <text content=" | " fg="gray" />
            <text content="IDX: " fg="gray" />
            <text
              content={
                aiStats.indexer.isIndexing ?
                  `${Math.round((aiStats.indexer.current / aiStats.indexer.total) * 100)}%`
                : 'ready'
              }
              fg="white"
            />
            <text content=" | " fg="gray" />
            <text content={aiStats.patchModel} fg="gray" />
          </box>
        )}
      </box>

      {/* Status Dialog Overlay (Ctrl+S to toggle) */}
      {showStatusDialog && aiStats && (
        <box
          style={{
            position: 'absolute',
            left: 5,
            top: 5,
            width: 60,
            height: 18,
            flexDirection: 'column',
            zIndex: 999,
            backgroundColor: 'black'
          }}
          border={true}
          borderStyle="rounded"
          borderColor="gray"
          title=" AI Tools Status "
        >
          <text content="LSP (Language Server Protocol)" bold fg="white" />
          <text content={`  Active Servers: ${aiStats.lsp.activeServers}`} />
          <text content={`  Files w/ Diag:  ${aiStats.lsp.filesWithDiagnostics}`} />
          <text content="" />

          <text content="Indexer (MGrep Semantic Search)" bold fg="white" />
          <text
            content={`  Status:       ${aiStats.indexer.isIndexing ? 'Indexing...' : 'Idle'}`}
          />
          <text content={`  Total Files:  ${aiStats.indexer.totalFiles}`} />
          <text content={`  Total Chunks: ${aiStats.indexer.totalChunks}`} />
          {aiStats.indexer.isIndexing && (
            <text
              content={`  Progress:     ${aiStats.indexer.current} / ${aiStats.indexer.total} (${aiStats.indexer.phase})`}
              fg="white"
            />
          )}
          <text content="" />

          <text content="FastApply (Patching)" bold fg="white" />
          <text content={`  Active Model: ${aiStats.patchModel}`} />
          <text content="" />

          <text content="File Watcher (Worker Thread)" bold fg="white" />
          <text content={`  Status:       ${aiStats.watcher}`} fg={
            aiStats.watcher === 'off' ? 'gray' :
            aiStats.watcher === 'starting' ? 'yellow' :
            aiStats.watcher === 'ready' ? 'green' :
            aiStats.watcher === 'watching' ? 'cyan' :
            aiStats.watcher === 'error' ? 'red' : 'white'
          } />

          <box style={{ marginTop: 1 }}>
            <text content="Press Ctrl+S to close" fg="gray" italic />
          </box>
        </box>
      )}

      {/* Model Dialog (Ctrl+M to toggle) */}
      {showModelDialog && (
        <box
          style={{
            position: 'absolute',
            left: 5,
            top: 3,
            width: 50,
            height: 10,
            flexDirection: 'column',
            zIndex: 1000,
            backgroundColor: 'black'
          }}
          border={true}
          borderStyle="rounded"
          borderColor="gray"
          title=" Select Model "
        >
          {models.map((model, idx) => (
            <box
              key={model.id}
              style={{
                paddingLeft: selectedModelIndex === idx ? 1 : 2,
                paddingRight: 1
              }}
            >
              <text
                content={selectedModelIndex === idx ? '▶ ' : '  '}
                fg={selectedModelIndex === idx ? 'white' : 'gray'}
              />
              <text
                content={model.name}
                fg={selectedModelIndex === idx ? 'white' : 'gray'}
                bold={selectedModelIndex === idx}
              />
              <text content={state.currentModel === model.display ? ' [active]' : ''} fg="gray" />
            </box>
          ))}
          <box style={{ marginTop: 1 }}>
            <text content="↑↓: Select | Enter/Space: Switch | Esc: Close" fg="gray" italic />
          </box>
        </box>
      )}

      {/* Provider Dialog (Ctrl+Shift+P to toggle) */}
      {showProviderDialog && (
        <box
          style={{
            position: 'absolute',
            left: 5,
            top: 14,
            width: 50,
            height: 10,
            flexDirection: 'column',
            zIndex: 1000,
            backgroundColor: 'black'
          }}
          border={true}
          borderStyle="rounded"
          borderColor="gray"
          title=" Select Provider "
        >
          {providers.map((provider, idx) => (
            <box
              key={provider.id}
              style={{
                paddingLeft: selectedProviderIndex === idx ? 1 : 2,
                paddingRight: 1,
                flexDirection: 'column'
              }}
            >
              <box>
                <text
                  content={selectedProviderIndex === idx ? '▶ ' : '  '}
                  fg={selectedProviderIndex === idx ? 'white' : 'gray'}
                />
                <text
                  content={provider.name}
                  fg={selectedProviderIndex === idx ? 'white' : 'gray'}
                  bold={selectedProviderIndex === idx}
                />
              </box>
              <text content={`  ${provider.description}`} fg="gray" />
            </box>
          ))}
          <box style={{ marginTop: 1 }}>
            <text content="↑↓: Select | Enter/Space: Switch | Esc: Close" fg="gray" italic />
          </box>
        </box>
      )}
    </box>
  );
};

// Main entry point
async function main(): Promise<void> {
  // Initialize debug log at startup for fresh session
  if (DEBUG) {
    try {
      // Ensure debug directory exists with proper permissions
      await ensureDebugDir();
      await fsp.writeFile(DEBUG_LOG, `=== New Session: ${new Date().toISOString()} ===\n`);
      // Set restrictive permissions (user read/write only)
      await fsp.chmod(DEBUG_LOG, 0o600);
    } catch {
      // Ignore if can't write debug log
    }
  }

  debugLog('Main function starting...');
  let apiKey: string | null = null;
  let oauthToken: string | null = null;
  const authManager = createAuthManager();

  // Try to load existing auth
  debugLog('Loading stored auth...');
  const storedAuth = await loadAuth();

  if (storedAuth) {
    debugLog(`Stored auth found: ${storedAuth.type}`);
    if (storedAuth.type === 'api-key' && storedAuth.apiKey) {
      apiKey = storedAuth.apiKey;
      debugLog('Using API key from storage');
    } else if (storedAuth.type === 'oauth' && storedAuth.oauthTokens) {
      debugLog('Loading OAuth tokens...');
      authManager.loadAuthConfig({ oauthTokens: storedAuth.oauthTokens });
      const accessToken = await authManager.getOAuthAccessToken();
      if (accessToken) {
        oauthToken = accessToken;
        debugLog('OAuth token obtained');
        const newConfig = authManager.getAuthConfig();
        if (newConfig.oauthTokens) {
          await saveAuth({ type: 'oauth', oauthTokens: newConfig.oauthTokens });
        }
      } else {
        console.log('⚠️  Saved tokens expired. Please run claudelet to re-authenticate.');
        process.exit(1);
      }
    }
  } else {
    debugLog('No stored auth found');
  }

  // If no valid stored auth, prompt for authentication
  if (!apiKey && !oauthToken) {
    debugLog('No auth found, prompting user...');

    const authMethod = await promptAuthMethod();

    if (authMethod === '1') {
      // Anthropic Account (OAuth - console mode)
      const token = await handleOAuthFlow('console', authManager);
      if (token) {
        oauthToken = token;
        const config = authManager.getAuthConfig();
        if (config.oauthTokens) {
          await saveAuth({ type: 'oauth', oauthTokens: config.oauthTokens });
        }
      }
    } else if (authMethod === '2') {
      // Claude Max Subscription (OAuth - max mode)
      const token = await handleOAuthFlow('max', authManager);
      if (token) {
        oauthToken = token;
        const config = authManager.getAuthConfig();
        if (config.oauthTokens) {
          await saveAuth({ type: 'oauth', oauthTokens: config.oauthTokens });
        }
      }
    } else {
      // API Key (direct)
      apiKey = await handleApiKeyAuth();
      if (apiKey) {
        await saveAuth({ type: 'api-key', apiKey });
      }
    }

    if (!apiKey && !oauthToken) {
      console.error('\n❌ Authentication failed. Exiting.');
      process.exit(1);
    }

    console.log('\n✅ Authentication successful!');
  }

  // Check for active sessions to resume
  let resumeSession: SessionData | undefined;
  const startupTimings: Record<string, number> = {};
  const startTime = Date.now();
  debugLog('Checking for active sessions...');

  try {
    const activeSessions = await getActiveSessions(process.cwd());
    debugLog(`Found ${activeSessions.length} active session(s) in cwd`);

    if (activeSessions.length > 0) {
      // Show active sessions and prompt for resume
      console.log('\n📂 Active sessions found:\n');
      activeSessions.slice(0, 5).forEach((s, i) => {
        const date = new Date(s.updatedAt).toLocaleDateString();
        const time = new Date(s.updatedAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        });
        console.log(
          `  ${i + 1}. [${s.sessionId.slice(0, 8)}] ${date} ${time} - ${s.messageCount} msgs`
        );
        console.log(`     ${s.preview}`);
      });
      console.log('\n  N. Start new session\n');

      // Simple stdin prompt (before TUI takes over)
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question('Resume session (1-5) or N for new: ', (ans) => {
          debugLog('readline: Closing interface...');
          rl.close();
          debugLog(`stdin state after rl.close(): paused=${process.stdin.isPaused()}, destroyed=${process.stdin.destroyed}, readable=${process.stdin.readable}`);

          // Give readline a moment to fully release stdin
          // Then let the OpenTUI renderer handle stdin setup
          setImmediate(() => {
            debugLog(`stdin state after setImmediate: paused=${process.stdin.isPaused()}, destroyed=${process.stdin.destroyed}, readable=${process.stdin.readable}`);
            resolve(ans.trim().toLowerCase());
          });
        });
      });

      if (answer !== 'n' && answer !== '') {
        const idx = parseInt(answer) - 1;
        if (idx >= 0 && idx < activeSessions.length) {
          const sessionToResume = activeSessions[idx];
          resumeSession = (await loadSession(sessionToResume.filePath)) || undefined;
          if (resumeSession) {
            console.log(`\n↻ Resuming session ${resumeSession.sessionId.slice(0, 8)}...`);
            debugLog(`Resuming session: ${resumeSession.sessionId}`);
          }
        }
      }

      if (!resumeSession) {
        console.log('\n✨ Starting new session...');
      }
    }
  } catch (err) {
    debugLog(`Error checking active sessions: ${err}`);
    // Continue with new session
  }

  // Log stdin state before creating the renderer
  // The renderer will handle setting up stdin (raw mode, listeners, etc.)
  debugLog(`stdin state before renderer: paused=${process.stdin.isPaused()}, isTTY=${process.stdin.isTTY}, isRaw=${(process.stdin as any).isRaw}`);

  // Create OpenTUI renderer - it handles stdin setup internally
  startupTimings.sessionSelection = Date.now() - startTime;
  debugLog(`Creating OpenTUI renderer... (${startupTimings.sessionSelection}ms since start)`);
  const rendererStart = Date.now();
  const renderer = await createCliRenderer({
    exitOnCtrlC: false, // We handle Ctrl+C manually
    useMouse: true, // Enable mouse tracking so scroll wheel doesn't trigger arrow keys
    useKittyKeyboard: null, // Disabled - was causing issues
    useAlternateScreen: false, // Try without alternate screen
    useThread: false, // Disable native threading - might cause event loop blocking
    targetFps: 30,
    debounceDelay: 50
  });
  startupTimings.renderer = Date.now() - rendererStart;
  debugLog(`Renderer created in ${startupTimings.renderer}ms`);
  debugLog(`stdin state after renderer: paused=${process.stdin.isPaused()}, isTTY=${process.stdin.isTTY}, isRaw=${(process.stdin as any).isRaw}`);

  // Debug: Monitor render loop timing to find blocking
  let loopCount = 0;
  let lastLoopTime = Date.now();
  const originalLoop = (renderer as any).loop.bind(renderer);
  (renderer as any).loop = async function () {
    loopCount++;
    const now = Date.now();
    const gap = now - lastLoopTime;
    if (gap > 100 || loopCount <= 10) { // Log first 10 loops and any gaps > 100ms
      debugLog(`Loop #${loopCount}: gap=${gap}ms`);
    }
    lastLoopTime = now;
    const startTime = performance.now();
    const result = await originalLoop();
    const elapsed = performance.now() - startTime;
    if (elapsed > 50 || loopCount <= 10) { // Log slow loops
      debugLog(`Loop #${loopCount} took ${elapsed.toFixed(1)}ms`);
    }
    return result;
  };

  // Cleanup terminal on exit
  const cleanup = () => {
    debugLog('Cleaning up terminal...');
    try {
      // Restore terminal to normal mode
      process.stdin.setRawMode?.(false);

      // Reset terminal sequences
      process.stdout.write('\x1b[?1000l'); // Disable mouse tracking
      process.stdout.write('\x1b[?1002l');
      process.stdout.write('\x1b[?1003l');
      process.stdout.write('\x1b[?1006l');
      // Disable modifyOtherKeys / kitty keyboard protocol if enabled
      process.stdout.write('\x1b[>4m');
      process.stdout.write('\x1b[>0u');
      process.stdout.write('\x1b[?1049l'); // Exit alternate screen
      process.stdout.write('\x1b[?1l'); // Reset Application Cursor Keys (DECCKM)
      process.stdout.write('\x1b[?25h'); // Show cursor
      process.stdout.write('\x1b[0m'); // Reset colors
      process.stdout.write('\x1bc'); // Full terminal reset

      // Clear screen and position cursor
      process.stdout.write('\x1b[2J\x1b[H');
    } catch (err) {
      debugLog(`Cleanup error: ${err}`);
    }
  };

  let cleanupCalled = false;
  const safeCleanup = async () => {
    if (!cleanupCalled) {
      cleanupCalled = true;

      // Dispose AiToolsService to cleanup LSP servers and other resources
      try {
        const aiTools = state.aiTools;
        if (aiTools) {
          debugLog('Disposing AiToolsService...');
          await aiTools.dispose();
          debugLog('AiToolsService disposed');
        }
      } catch (err) {
        debugLog(`Error disposing AiToolsService: ${err}`);
      }

      cleanup();
    }
  };

  process.on('exit', () => {
    // Note: 'exit' event cannot be async, but we try cleanup anyway
    if (!cleanupCalled) {
      cleanupCalled = true;
      cleanup();
    }
  });

  process.on('SIGINT', async () => {
    debugLog('SIGINT received');
    await safeCleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    debugLog('SIGTERM received');
    await safeCleanup();
    process.exit(0);
  });
  process.on('uncaughtException', async (err) => {
    debugLog(`Uncaught exception: ${err}`);
    await safeCleanup();
    process.exit(1);
  });

  // Render the app
  startupTimings.preRender = Date.now() - startTime;
  debugLog(`Rendering app... (${startupTimings.preRender}ms since start)`);
  debugLog(`stdin state before render: paused=${process.stdin.isPaused()}, destroyed=${process.stdin.destroyed}, readable=${process.stdin.readable}, isTTY=${process.stdin.isTTY}, isRaw=${(process.stdin as any).isRaw}`);
  console.log(`⏱️ Startup: session=${startupTimings.sessionSelection}ms, renderer=${startupTimings.renderer}ms, total=${startupTimings.preRender}ms`);

  const root = createRoot(renderer);
  root.render(
    <ChatApp
      apiKey={apiKey || undefined}
      oauthToken={oauthToken || undefined}
      resumeSession={resumeSession}
    />
  );
  debugLog('App rendered (createRoot + render called)');

  // Start the continuous render loop - CRITICAL for preventing event loop blocking
  // Without this, the native Zig library causes ~19 second blocking during first renders
  renderer.start();
  debugLog('Renderer started');

  debugLog(`stdin state after render: paused=${process.stdin.isPaused()}, destroyed=${process.stdin.destroyed}, readable=${process.stdin.readable}, isTTY=${process.stdin.isTTY}, isRaw=${(process.stdin as any).isRaw}`);

  // Heartbeat to detect event loop blocking - logs every 2 seconds for first 30 seconds
  let heartbeatCount = 0;
  debugLog('Setting up heartbeat interval...');
  const heartbeatInterval = setInterval(() => {
    heartbeatCount++;
    debugLog(`Heartbeat ${heartbeatCount} (event loop alive)`);
    if (heartbeatCount >= 15) {
      clearInterval(heartbeatInterval);
      debugLog('Heartbeat monitoring complete');
    }
  }, 2000);
  debugLog('Heartbeat interval created, main() complete');

  // Test when event loop becomes free
  setImmediate(() => {
    debugLog('setImmediate fired - event loop free');
  });
  setTimeout(() => {
    debugLog('setTimeout(0) fired');
  }, 0);
  setTimeout(() => {
    debugLog('setTimeout(100) fired');
  }, 100);

  // Quick interval test - should fire every 500ms
  let quickCount = 0;
  const quickInterval = setInterval(() => {
    quickCount++;
    debugLog(`Quick interval ${quickCount} (500ms)`);
    if (quickCount >= 5) {
      clearInterval(quickInterval);
    }
  }, 500);
}

main().catch((err) => {
  debugLog(`Fatal error in main: ${err}`);
  console.error('Failed to start OpenTUI:', err);
  process.exit(1);
});
