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
import { EventEmitter } from 'events';
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
import { SecurityValidator } from '../src/security-validator.js';
import { AiToolsService } from './claudelet-ai-tools.js';
import { useBatchedState } from '../src/hooks/useBatchedState.js';
import {
  calculateAvailableRows,
  calculateVisibleMessages,
  type RenderableMessage
} from '../src/message-pagination.js';

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
    console.log('After authorizing, you will be redirected to a callback URL.');
    console.log('Copy/paste the full callback URL here (or just `code`, or `code#state`).\n');

    // Get authorization code from user
    const code = await rl.question('Paste the callback URL (or code): ');
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
  // Startup banner marker
  isBanner?: boolean;
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

// Theme colors for customization
interface Theme {
  name: string;
  description: string;
  colors: {
    // Primary colors
    primary: string;
    secondary: string;
    accent: string;
    muted: string;
    // Messages
    userMessage: string;
    assistantMessage: string;
    systemMessage: string;
    errorMessage: string;
    // UI elements
    border: string;
    inputBorder: string;
    statusBar: string;
    highlight: string;
    background: string;
    // Chips/badges
    toolChip: string;
    toolChipActive: string;
    thinkingChip: string;
    // KITT animation
    kittColor: string;
    kittBracket: string;
    kittLit: string;
    kittDim: string;
    kittFaint: string;
    kittOff: string;
    // Status indicators
    success: string;
    warning: string;
    error: string;
    info: string;
    // Separators
    separator: string;
  };
}

// Theme persistence path
const THEME_CONFIG_FILE = path.join(os.homedir(), '.claudelet', 'theme.json');

// Load saved theme name
function loadSavedThemeName(): string | null {
  try {
    if (fs.existsSync(THEME_CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(THEME_CONFIG_FILE, 'utf-8'));
      return data.theme || null;
    }
  } catch {
    // Ignore errors
  }
  return null;
}

// Save theme name
function saveThemeName(themeName: string): void {
  try {
    const dir = path.dirname(THEME_CONFIG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(THEME_CONFIG_FILE, JSON.stringify({ theme: themeName }, null, 2), { mode: 0o600 });
  } catch {
    // Ignore errors
  }
}

// Default themes - ALL converted from opencode-stt (58 themes)
const DEFAULT_THEMES: Theme[] = [
  {
    name: 'Claudelet',
    description: 'Default Claudelet theme (based on Nord)',
    colors: {
      primary: '#88C0D0',
      secondary: '#81A1C1',
      accent: '#8FBCBB',
      muted: '#8B95A7',
      userMessage: '#D08770',
      assistantMessage: '#ECEFF4',
      systemMessage: '#88C0D0',
      errorMessage: '#BF616A',
      border: '#434C5E',
      inputBorder: '#4C566A',
      statusBar: '#88C0D0',
      highlight: '#8FBCBB',
      background: '#000000',
      toolChip: '#434C5E',
      toolChipActive: '#88C0D0',
      thinkingChip: '#81A1C1',
      kittColor: '#88C0D0',
      kittBracket: '#81A1C1',
      kittLit: '▰',
      kittDim: '▱',
      kittFaint: '▱',
      kittOff: '·',
      success: '#A3BE8C',
      warning: '#D08770',
      error: '#BF616A',
      info: '#88C0D0',
      separator: '#434C5E',
    },
  },
  {
    name: 'Amber Glow',
    description: 'Amber Glow',
    colors: {
      primary: '#ffb86c',
      secondary: '#d4a5d4',
      accent: '#f9cb8f',
      muted: '#b8a28e',
      userMessage: '#ffe066',
      assistantMessage: '#f5e6d3',
      systemMessage: '#ffb86c',
      errorMessage: '#ff8a65',
      border: '#3d352d',
      inputBorder: '#f9cb8f',
      statusBar: '#ffb86c',
      highlight: '#f9cb8f',
      background: '#000000',
      toolChip: '#2f2a24',
      toolChipActive: '#ffb86c',
      thinkingChip: '#ffe066',
      kittColor: '#ffb86c',
      kittBracket: '#d4a5d4',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#a7c080',
      warning: '#ffe066',
      error: '#ff8a65',
      info: '#d4a574',
      separator: '#3d352d',
    },
  },
  {
    name: 'Arctic Night',
    description: 'Arctic Night',
    colors: {
      primary: '#5eb3d6',
      secondary: '#a891d6',
      accent: '#4ecdc4',
      muted: '#7a9fb5',
      userMessage: '#e8c488',
      assistantMessage: '#d0e7f2',
      systemMessage: '#5eb3d6',
      errorMessage: '#d891a6',
      border: '#1f3847',
      inputBorder: '#88d4e8',
      statusBar: '#5eb3d6',
      highlight: '#4ecdc4',
      background: '#000000',
      toolChip: '#152838',
      toolChipActive: '#5eb3d6',
      thinkingChip: '#e8c488',
      kittColor: '#5eb3d6',
      kittBracket: '#a891d6',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#6bc4a6',
      warning: '#e8c488',
      error: '#d891a6',
      info: '#88d4e8',
      separator: '#1f3847',
    },
  },
  {
    name: 'Ash',
    description: 'Ash',
    colors: {
      primary: '#b8b8c2',
      secondary: '#9292a0',
      accent: '#eaeaed',
      muted: '#98989f',
      userMessage: '#b8b8c2',
      assistantMessage: '#d8d8dc',
      systemMessage: '#b8b8c2',
      errorMessage: '#dbdbe0',
      border: '#474750',
      inputBorder: '#b8b8c2',
      statusBar: '#b8b8c2',
      highlight: '#eaeaed',
      background: '#000000',
      toolChip: '#27272f',
      toolChipActive: '#b8b8c2',
      thinkingChip: '#b8b8c2',
      kittColor: '#b8b8c2',
      kittBracket: '#9292a0',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#9292a0',
      warning: '#b8b8c2',
      error: '#dbdbe0',
      info: '#b8b8c2',
      separator: '#474750',
    },
  },
  {
    name: 'Aura',
    description: 'Aura',
    colors: {
      primary: '#a277ff',
      secondary: '#f694ff',
      accent: '#a277ff',
      muted: '#6d6d6d',
      userMessage: '#ffca85',
      assistantMessage: '#edecee',
      systemMessage: '#a277ff',
      errorMessage: '#ff6767',
      border: '#2d2d2d',
      inputBorder: '#6d6d6d',
      statusBar: '#a277ff',
      highlight: '#a277ff',
      background: '#000000',
      toolChip: '#15141b',
      toolChipActive: '#a277ff',
      thinkingChip: '#ffca85',
      kittColor: '#a277ff',
      kittBracket: '#f694ff',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#61ffca',
      warning: '#ffca85',
      error: '#ff6767',
      info: '#a277ff',
      separator: '#2d2d2d',
    },
  },
  {
    name: 'Ayu',
    description: 'Ayu',
    colors: {
      primary: '#59C2FF',
      secondary: '#D2A6FF',
      accent: '#E6B450',
      muted: '#565B66',
      userMessage: '#E6B673',
      assistantMessage: '#BFBDB6',
      systemMessage: '#59C2FF',
      errorMessage: '#D95757',
      border: '#6C7380',
      inputBorder: '#6C7380',
      statusBar: '#59C2FF',
      highlight: '#E6B450',
      background: '#000000',
      toolChip: '#0D1017',
      toolChipActive: '#59C2FF',
      thinkingChip: '#E6B673',
      kittColor: '#59C2FF',
      kittBracket: '#D2A6FF',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#7FD962',
      warning: '#E6B673',
      error: '#D95757',
      info: '#39BAE6',
      separator: '#6C7380',
    },
  },
  {
    name: 'Carbon Steel',
    description: 'Carbon Steel',
    colors: {
      primary: '#5fb4e4',
      secondary: '#a4b3c2',
      accent: '#5fd7ff',
      muted: '#8892a0',
      userMessage: '#ff9e64',
      assistantMessage: '#d8dee9',
      systemMessage: '#5fb4e4',
      errorMessage: '#f28b82',
      border: '#2a3340',
      inputBorder: '#5fd7ff',
      statusBar: '#5fb4e4',
      highlight: '#5fd7ff',
      background: '#000000',
      toolChip: '#1d252e',
      toolChipActive: '#5fb4e4',
      thinkingChip: '#ff9e64',
      kittColor: '#5fb4e4',
      kittBracket: '#a4b3c2',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#5fc98e',
      warning: '#ff9e64',
      error: '#f28b82',
      info: '#4eb4b4',
      separator: '#2a3340',
    },
  },
  {
    name: 'Catppuccin',
    description: 'Catppuccin',
    colors: {
      primary: '#89b4fa',
      secondary: '#cba6f7',
      accent: '#f5c2e7',
      muted: '#bac2de',
      userMessage: '#f9e2af',
      assistantMessage: '#cdd6f4',
      systemMessage: '#89b4fa',
      errorMessage: '#f38ba8',
      border: '#313244',
      inputBorder: '#45475a',
      statusBar: '#89b4fa',
      highlight: '#f5c2e7',
      background: '#000000',
      toolChip: '#11111b',
      toolChipActive: '#89b4fa',
      thinkingChip: '#f9e2af',
      kittColor: '#89b4fa',
      kittBracket: '#cba6f7',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#a6e3a1',
      warning: '#f9e2af',
      error: '#f38ba8',
      info: '#94e2d5',
      separator: '#313244',
    },
  },
  {
    name: 'Catppuccin Macchiato',
    description: 'Catppuccin Macchiato',
    colors: {
      primary: '#8aadf4',
      secondary: '#c6a0f6',
      accent: '#f5bde6',
      muted: '#b8c0e0',
      userMessage: '#eed49f',
      assistantMessage: '#cad3f5',
      systemMessage: '#8aadf4',
      errorMessage: '#ed8796',
      border: '#363a4f',
      inputBorder: '#494d64',
      statusBar: '#8aadf4',
      highlight: '#f5bde6',
      background: '#000000',
      toolChip: '#181926',
      toolChipActive: '#8aadf4',
      thinkingChip: '#eed49f',
      kittColor: '#8aadf4',
      kittBracket: '#c6a0f6',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#a6da95',
      warning: '#eed49f',
      error: '#ed8796',
      info: '#8bd5ca',
      separator: '#363a4f',
    },
  },
  {
    name: 'Charcoal',
    description: 'Charcoal',
    colors: {
      primary: '#b3b3bd',
      secondary: '#8a8a98',
      accent: '#ededf0',
      muted: '#94949e',
      userMessage: '#b3b3bd',
      assistantMessage: '#dcdce0',
      systemMessage: '#b3b3bd',
      errorMessage: '#d6d6dc',
      border: '#42424e',
      inputBorder: '#b3b3bd',
      statusBar: '#b3b3bd',
      highlight: '#ededf0',
      background: '#000000',
      toolChip: '#23232b',
      toolChipActive: '#b3b3bd',
      thinkingChip: '#b3b3bd',
      kittColor: '#b3b3bd',
      kittBracket: '#8a8a98',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#8a8a98',
      warning: '#b3b3bd',
      error: '#d6d6dc',
      info: '#b3b3bd',
      separator: '#42424e',
    },
  },
  {
    name: 'Cobalt2',
    description: 'Cobalt2',
    colors: {
      primary: '#0088ff',
      secondary: '#9a5feb',
      accent: '#2affdf',
      muted: '#adb7c9',
      userMessage: '#ffc600',
      assistantMessage: '#ffffff',
      systemMessage: '#0088ff',
      errorMessage: '#ff0088',
      border: '#1f4662',
      inputBorder: '#0088ff',
      statusBar: '#0088ff',
      highlight: '#2affdf',
      background: '#000000',
      toolChip: '#1f4662',
      toolChipActive: '#0088ff',
      thinkingChip: '#ffc600',
      kittColor: '#0088ff',
      kittBracket: '#9a5feb',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#9eff80',
      warning: '#ffc600',
      error: '#ff0088',
      info: '#ff9d00',
      separator: '#1f4662',
    },
  },
  {
    name: 'Codesurf',
    description: 'Codesurf',
    colors: {
      primary: '#caced1',
      secondary: '#90959c',
      accent: '#caced1',
      muted: '#7b828c',
      userMessage: '#9a9a9a',
      assistantMessage: '#e6e8ea',
      systemMessage: '#caced1',
      errorMessage: '#8f8f8f',
      border: '#3b424d',
      inputBorder: '#454d58',
      statusBar: '#caced1',
      highlight: '#caced1',
      background: '#000000',
      toolChip: '#262a30',
      toolChipActive: '#caced1',
      thinkingChip: '#9a9a9a',
      kittColor: '#caced1',
      kittBracket: '#90959c',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#838383',
      warning: '#9a9a9a',
      error: '#8f8f8f',
      info: '#9ea2a8',
      separator: '#3b424d',
    },
  },
  {
    name: 'Codesurf Blue',
    description: 'Codesurf Blue',
    colors: {
      primary: '#a8c0ff',
      secondary: '#8c93a6',
      accent: '#a8c0ff',
      muted: '#7b828c',
      userMessage: '#d7c6a0',
      assistantMessage: '#e6e8ea',
      systemMessage: '#a8c0ff',
      errorMessage: '#d9a7af',
      border: '#3b424d',
      inputBorder: '#454d58',
      statusBar: '#a8c0ff',
      highlight: '#a8c0ff',
      background: '#000000',
      toolChip: '#262a30',
      toolChipActive: '#a8c0ff',
      thinkingChip: '#d7c6a0',
      kittColor: '#a8c0ff',
      kittBracket: '#8c93a6',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#9fc4c0',
      warning: '#d7c6a0',
      error: '#d9a7af',
      info: '#9fbefc',
      separator: '#3b424d',
    },
  },
  {
    name: 'Codesurf Green',
    description: 'Codesurf Green',
    colors: {
      primary: '#b6d1b7',
      secondary: '#889489',
      accent: '#b6d1b7',
      muted: '#7b828c',
      userMessage: '#d6c7a1',
      assistantMessage: '#e6e8ea',
      systemMessage: '#b6d1b7',
      errorMessage: '#cba1a5',
      border: '#3b424d',
      inputBorder: '#454d58',
      statusBar: '#b6d1b7',
      highlight: '#b6d1b7',
      background: '#000000',
      toolChip: '#262a30',
      toolChipActive: '#b6d1b7',
      thinkingChip: '#d6c7a1',
      kittColor: '#b6d1b7',
      kittBracket: '#889489',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#a6d1ad',
      warning: '#d6c7a1',
      error: '#cba1a5',
      info: '#a5c7b3',
      separator: '#3b424d',
    },
  },
  {
    name: 'Codesurf Red',
    description: 'Codesurf Red',
    colors: {
      primary: '#f0b5c0',
      secondary: '#95848a',
      accent: '#f0b5c0',
      muted: '#7b828c',
      userMessage: '#d9b8a1',
      assistantMessage: '#e6e8ea',
      systemMessage: '#f0b5c0',
      errorMessage: '#f2a0ac',
      border: '#3b424d',
      inputBorder: '#454d58',
      statusBar: '#f0b5c0',
      highlight: '#f0b5c0',
      background: '#000000',
      toolChip: '#262a30',
      toolChipActive: '#f0b5c0',
      thinkingChip: '#d9b8a1',
      kittColor: '#f0b5c0',
      kittBracket: '#95848a',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#a9c0b2',
      warning: '#d9b8a1',
      error: '#f2a0ac',
      info: '#f0b5c0',
      separator: '#3b424d',
    },
  },
  {
    name: 'Colorless',
    description: 'Colorless',
    colors: {
      primary: '#caced1',
      secondary: '#90959c',
      accent: '#caced1',
      muted: '#7b828c',
      userMessage: '#9a9a9a',
      assistantMessage: '#e6e8ea',
      systemMessage: '#caced1',
      errorMessage: '#8f8f8f',
      border: '#3b424d',
      inputBorder: '#454d58',
      statusBar: '#caced1',
      highlight: '#caced1',
      background: '#000000',
      toolChip: '#262a30',
      toolChipActive: '#caced1',
      thinkingChip: '#9a9a9a',
      kittColor: '#caced1',
      kittBracket: '#90959c',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#838383',
      warning: '#9a9a9a',
      error: '#8f8f8f',
      info: '#9ea2a8',
      separator: '#3b424d',
    },
  },
  {
    name: 'Colorless Hints Blue',
    description: 'Colorless Hints Blue',
    colors: {
      primary: '#a8c0ff',
      secondary: '#8c93a6',
      accent: '#a8c0ff',
      muted: '#7b828c',
      userMessage: '#d7c6a0',
      assistantMessage: '#e6e8ea',
      systemMessage: '#a8c0ff',
      errorMessage: '#d9a7af',
      border: '#3b424d',
      inputBorder: '#454d58',
      statusBar: '#a8c0ff',
      highlight: '#a8c0ff',
      background: '#000000',
      toolChip: '#262a30',
      toolChipActive: '#a8c0ff',
      thinkingChip: '#d7c6a0',
      kittColor: '#a8c0ff',
      kittBracket: '#8c93a6',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#9fc4c0',
      warning: '#d7c6a0',
      error: '#d9a7af',
      info: '#9fbefc',
      separator: '#3b424d',
    },
  },
  {
    name: 'Colorless Hints Green',
    description: 'Colorless Hints Green',
    colors: {
      primary: '#b6d1b7',
      secondary: '#889489',
      accent: '#b6d1b7',
      muted: '#7b828c',
      userMessage: '#d6c7a1',
      assistantMessage: '#e6e8ea',
      systemMessage: '#b6d1b7',
      errorMessage: '#cba1a5',
      border: '#3b424d',
      inputBorder: '#454d58',
      statusBar: '#b6d1b7',
      highlight: '#b6d1b7',
      background: '#000000',
      toolChip: '#262a30',
      toolChipActive: '#b6d1b7',
      thinkingChip: '#d6c7a1',
      kittColor: '#b6d1b7',
      kittBracket: '#889489',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#a6d1ad',
      warning: '#d6c7a1',
      error: '#cba1a5',
      info: '#a5c7b3',
      separator: '#3b424d',
    },
  },
  {
    name: 'Colorless Hints Red',
    description: 'Colorless Hints Red',
    colors: {
      primary: '#f0b5c0',
      secondary: '#95848a',
      accent: '#f0b5c0',
      muted: '#7b828c',
      userMessage: '#d9b8a1',
      assistantMessage: '#e6e8ea',
      systemMessage: '#f0b5c0',
      errorMessage: '#f2a0ac',
      border: '#3b424d',
      inputBorder: '#454d58',
      statusBar: '#f0b5c0',
      highlight: '#f0b5c0',
      background: '#000000',
      toolChip: '#262a30',
      toolChipActive: '#f0b5c0',
      thinkingChip: '#d9b8a1',
      kittColor: '#f0b5c0',
      kittBracket: '#95848a',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#a9c0b2',
      warning: '#d9b8a1',
      error: '#f2a0ac',
      info: '#f0b5c0',
      separator: '#3b424d',
    },
  },
  {
    name: 'Crimson Spark',
    description: 'Crimson Spark',
    colors: {
      primary: '#ff4057',
      secondary: '#d47fb8',
      accent: '#ff5f87',
      muted: '#b89099',
      userMessage: '#ff7f3f',
      assistantMessage: '#f5e1e8',
      systemMessage: '#ff4057',
      errorMessage: '#ff4057',
      border: '#3d2530',
      inputBorder: '#ff5f87',
      statusBar: '#ff4057',
      highlight: '#ff5f87',
      background: '#000000',
      toolChip: '#2f1a27',
      toolChipActive: '#ff4057',
      thinkingChip: '#ff7f3f',
      kittColor: '#ff4057',
      kittBracket: '#d47fb8',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#5fdf9f',
      warning: '#ff7f3f',
      error: '#ff4057',
      info: '#cf9fff',
      separator: '#3d2530',
    },
  },
  {
    name: 'Cyber Nexus',
    description: 'Cyber Nexus',
    colors: {
      primary: '#0dffea',
      secondary: '#bf40ff',
      accent: '#00d9ff',
      muted: '#7a8fbd',
      userMessage: '#ff6b1a',
      assistantMessage: '#e0e8ff',
      systemMessage: '#0dffea',
      errorMessage: '#ff1f8f',
      border: '#1f2d47',
      inputBorder: '#0dffea',
      statusBar: '#0dffea',
      highlight: '#00d9ff',
      background: '#000000',
      toolChip: '#141b2b',
      toolChipActive: '#0dffea',
      thinkingChip: '#ff6b1a',
      kittColor: '#0dffea',
      kittBracket: '#bf40ff',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#39ff14',
      warning: '#ff6b1a',
      error: '#ff1f8f',
      info: '#4d9fff',
      separator: '#1f2d47',
    },
  },
  {
    name: 'Deep Ocean',
    description: 'Deep Ocean',
    colors: {
      primary: '#4dabf7',
      secondary: '#9775fa',
      accent: '#3bc9db',
      muted: '#85a1b3',
      userMessage: '#ffd43b',
      assistantMessage: '#d4e6f1',
      systemMessage: '#4dabf7',
      errorMessage: '#fa5252',
      border: '#1a3545',
      inputBorder: '#3bc9db',
      statusBar: '#4dabf7',
      highlight: '#3bc9db',
      background: '#000000',
      toolChip: '#112938',
      toolChipActive: '#4dabf7',
      thinkingChip: '#ffd43b',
      kittColor: '#4dabf7',
      kittBracket: '#9775fa',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#20c997',
      warning: '#ffd43b',
      error: '#fa5252',
      info: '#66d9ef',
      separator: '#1a3545',
    },
  },
  {
    name: 'Dracula',
    description: 'Dracula',
    colors: {
      primary: '#bd93f9',
      secondary: '#ff79c6',
      accent: '#8be9fd',
      muted: '#6272a4',
      userMessage: '#f1fa8c',
      assistantMessage: '#f8f8f2',
      systemMessage: '#bd93f9',
      errorMessage: '#ff5555',
      border: '#44475a',
      inputBorder: '#bd93f9',
      statusBar: '#bd93f9',
      highlight: '#8be9fd',
      background: '#000000',
      toolChip: '#44475a',
      toolChipActive: '#bd93f9',
      thinkingChip: '#f1fa8c',
      kittColor: '#bd93f9',
      kittBracket: '#ff79c6',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#50fa7b',
      warning: '#f1fa8c',
      error: '#ff5555',
      info: '#ffb86c',
      separator: '#44475a',
    },
  },
  {
    name: 'Emerald Twilight',
    description: 'Emerald Twilight',
    colors: {
      primary: '#5af0c8',
      secondary: '#bd93f9',
      accent: '#7ee8c8',
      muted: '#8ba8a3',
      userMessage: '#cfdf8f',
      assistantMessage: '#d8e9e7',
      systemMessage: '#5af0c8',
      errorMessage: '#ff6b7a',
      border: '#1f3640',
      inputBorder: '#5af0c8',
      statusBar: '#5af0c8',
      highlight: '#7ee8c8',
      background: '#000000',
      toolChip: '#172c34',
      toolChipActive: '#5af0c8',
      thinkingChip: '#cfdf8f',
      kittColor: '#5af0c8',
      kittBracket: '#bd93f9',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#50fa7b',
      warning: '#cfdf8f',
      error: '#ff6b7a',
      info: '#8be9fd',
      separator: '#1f3640',
    },
  },
  {
    name: 'Everforest',
    description: 'Everforest',
    colors: {
      primary: '#a7c080',
      secondary: '#7fbbb3',
      accent: '#d699b6',
      muted: '#7a8478',
      userMessage: '#e69875',
      assistantMessage: '#d3c6aa',
      systemMessage: '#a7c080',
      errorMessage: '#e67e80',
      border: '#859289',
      inputBorder: '#9da9a0',
      statusBar: '#a7c080',
      highlight: '#d699b6',
      background: '#000000',
      toolChip: '#343f44',
      toolChipActive: '#a7c080',
      thinkingChip: '#e69875',
      kittColor: '#a7c080',
      kittBracket: '#7fbbb3',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#a7c080',
      warning: '#e69875',
      error: '#e67e80',
      info: '#83c092',
      separator: '#859289',
    },
  },
  {
    name: 'Flexoki',
    description: 'Flexoki',
    colors: {
      primary: '#DA702C',
      secondary: '#4385BE',
      accent: '#8B7EC8',
      muted: '#6F6E69',
      userMessage: '#DA702C',
      assistantMessage: '#CECDC3',
      systemMessage: '#DA702C',
      errorMessage: '#D14D41',
      border: '#575653',
      inputBorder: '#6F6E69',
      statusBar: '#DA702C',
      highlight: '#8B7EC8',
      background: '#000000',
      toolChip: '#282726',
      toolChipActive: '#DA702C',
      thinkingChip: '#DA702C',
      kittColor: '#DA702C',
      kittBracket: '#4385BE',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#879A39',
      warning: '#DA702C',
      error: '#D14D41',
      info: '#3AA99F',
      separator: '#575653',
    },
  },
  {
    name: 'Galactic Purple',
    description: 'Galactic Purple',
    colors: {
      primary: '#b794f6',
      secondary: '#d4a5f6',
      accent: '#e879f9',
      muted: '#a08cc8',
      userMessage: '#ffb86c',
      assistantMessage: '#e9dcff',
      systemMessage: '#b794f6',
      errorMessage: '#ff6b9d',
      border: '#372454',
      inputBorder: '#e879f9',
      statusBar: '#b794f6',
      highlight: '#e879f9',
      background: '#000000',
      toolChip: '#291a3f',
      toolChipActive: '#b794f6',
      thinkingChip: '#ffb86c',
      kittColor: '#b794f6',
      kittBracket: '#d4a5f6',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#8ff9c8',
      warning: '#ffb86c',
      error: '#ff6b9d',
      info: '#818cf8',
      separator: '#372454',
    },
  },
  {
    name: 'Github',
    description: 'Github',
    colors: {
      primary: '#58a6ff',
      secondary: '#bc8cff',
      accent: '#39c5cf',
      muted: '#8b949e',
      userMessage: '#e3b341',
      assistantMessage: '#c9d1d9',
      systemMessage: '#58a6ff',
      errorMessage: '#f85149',
      border: '#30363d',
      inputBorder: '#58a6ff',
      statusBar: '#58a6ff',
      highlight: '#39c5cf',
      background: '#000000',
      toolChip: '#161b22',
      toolChipActive: '#58a6ff',
      thinkingChip: '#e3b341',
      kittColor: '#58a6ff',
      kittBracket: '#bc8cff',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#3fb950',
      warning: '#e3b341',
      error: '#f85149',
      info: '#d29922',
      separator: '#30363d',
    },
  },
  {
    name: 'Graphite',
    description: 'Graphite',
    colors: {
      primary: '#adadb8',
      secondary: '#82828f',
      accent: '#f0f0f4',
      muted: '#90909a',
      userMessage: '#adadb8',
      assistantMessage: '#e0e0e3',
      systemMessage: '#adadb8',
      errorMessage: '#cfcfd7',
      border: '#3c3c45',
      inputBorder: '#adadb8',
      statusBar: '#adadb8',
      highlight: '#f0f0f4',
      background: '#000000',
      toolChip: '#1f1f23',
      toolChipActive: '#adadb8',
      thinkingChip: '#adadb8',
      kittColor: '#adadb8',
      kittBracket: '#82828f',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#82828f',
      warning: '#adadb8',
      error: '#cfcfd7',
      info: '#adadb8',
      separator: '#3c3c45',
    },
  },
  {
    name: 'Gruvbox',
    description: 'Gruvbox',
    colors: {
      primary: '#83a598',
      secondary: '#d3869b',
      accent: '#8ec07c',
      muted: '#928374',
      userMessage: '#fe8019',
      assistantMessage: '#ebdbb2',
      systemMessage: '#83a598',
      errorMessage: '#fb4934',
      border: '#665c54',
      inputBorder: '#ebdbb2',
      statusBar: '#83a598',
      highlight: '#8ec07c',
      background: '#000000',
      toolChip: '#504945',
      toolChipActive: '#83a598',
      thinkingChip: '#fe8019',
      kittColor: '#83a598',
      kittBracket: '#d3869b',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#b8bb26',
      warning: '#fe8019',
      error: '#fb4934',
      info: '#fabd2f',
      separator: '#665c54',
    },
  },
  {
    name: 'Kanagawa',
    description: 'Kanagawa',
    colors: {
      primary: '#7E9CD8',
      secondary: '#957FB8',
      accent: '#D27E99',
      muted: '#727169',
      userMessage: '#D7A657',
      assistantMessage: '#DCD7BA',
      systemMessage: '#7E9CD8',
      errorMessage: '#E82424',
      border: '#54546D',
      inputBorder: '#C38D9D',
      statusBar: '#7E9CD8',
      highlight: '#D27E99',
      background: '#000000',
      toolChip: '#363646',
      toolChipActive: '#7E9CD8',
      thinkingChip: '#D7A657',
      kittColor: '#7E9CD8',
      kittBracket: '#957FB8',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#98BB6C',
      warning: '#D7A657',
      error: '#E82424',
      info: '#76946A',
      separator: '#54546D',
    },
  },
  {
    name: 'Knight Rider',
    description: 'Classic KITT red',
    colors: {
      primary: '#ff0000',
      secondary: '#ffffff',
      accent: '#ffff00',
      muted: '#888888',
      userMessage: '#ffff00',
      assistantMessage: '#ffffff',
      systemMessage: '#ff0000',
      errorMessage: '#ff0000',
      border: '#ff0000',
      inputBorder: '#ff0000',
      statusBar: '#ff0000',
      highlight: '#ff0000',
      background: '#000000',
      toolChip: '#330000',
      toolChipActive: '#ffff00',
      thinkingChip: '#ffff00',
      kittColor: '#ff0000',
      kittBracket: '#ff0000',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#00ff00',
      warning: '#ffff00',
      error: '#ff0000',
      info: '#00ffff',
      separator: '#888888',
    },
  },
  {
    name: 'Material',
    description: 'Material',
    colors: {
      primary: '#82aaff',
      secondary: '#c792ea',
      accent: '#89ddff',
      muted: '#546e7a',
      userMessage: '#ffcb6b',
      assistantMessage: '#eeffff',
      systemMessage: '#82aaff',
      errorMessage: '#f07178',
      border: '#37474f',
      inputBorder: '#82aaff',
      statusBar: '#82aaff',
      highlight: '#89ddff',
      background: '#000000',
      toolChip: '#37474f',
      toolChipActive: '#82aaff',
      thinkingChip: '#ffcb6b',
      kittColor: '#82aaff',
      kittBracket: '#c792ea',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#c3e88d',
      warning: '#ffcb6b',
      error: '#f07178',
      info: '#ffcb6b',
      separator: '#37474f',
    },
  },
  {
    name: 'Matrix',
    description: 'Matrix',
    colors: {
      primary: '#2eff6a',
      secondary: '#00efff',
      accent: '#c770ff',
      muted: '#8ca391',
      userMessage: '#e6ff57',
      assistantMessage: '#62ff94',
      systemMessage: '#2eff6a',
      errorMessage: '#ff4b4b',
      border: '#1e2a1b',
      inputBorder: '#2eff6a',
      statusBar: '#2eff6a',
      highlight: '#c770ff',
      background: '#000000',
      toolChip: '#141c12',
      toolChipActive: '#2eff6a',
      thinkingChip: '#e6ff57',
      kittColor: '#2eff6a',
      kittBracket: '#00efff',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#62ff94',
      warning: '#e6ff57',
      error: '#ff4b4b',
      info: '#30b3ff',
      separator: '#1e2a1b',
    },
  },
  {
    name: 'Mercury',
    description: 'Mercury',
    colors: {
      primary: '#8da4f5',
      secondary: '#a7b6f8',
      accent: '#8da4f5',
      muted: '#9d9da8',
      userMessage: '#fc9b6f',
      assistantMessage: '#dddde5',
      systemMessage: '#8da4f5',
      errorMessage: '#fc92b4',
      border: '#3a3a4a',
      inputBorder: '#8da4f5',
      statusBar: '#8da4f5',
      highlight: '#8da4f5',
      background: '#000000',
      toolChip: '#272735',
      toolChipActive: '#8da4f5',
      thinkingChip: '#fc9b6f',
      kittColor: '#8da4f5',
      kittBracket: '#a7b6f8',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#77c599',
      warning: '#fc9b6f',
      error: '#fc92b4',
      info: '#77becf',
      separator: '#3a3a4a',
    },
  },
  {
    name: 'Midnight Forge',
    description: 'Midnight Forge',
    colors: {
      primary: '#4fc3f7',
      secondary: '#ba68c8',
      accent: '#26c6da',
      muted: '#8585ad',
      userMessage: '#ffb74d',
      assistantMessage: '#d4d4e8',
      systemMessage: '#4fc3f7',
      errorMessage: '#ef5350',
      border: '#2a2a47',
      inputBorder: '#4fc3f7',
      statusBar: '#4fc3f7',
      highlight: '#26c6da',
      background: '#000000',
      toolChip: '#1d1d34',
      toolChipActive: '#4fc3f7',
      thinkingChip: '#ffb74d',
      kittColor: '#4fc3f7',
      kittBracket: '#ba68c8',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#66bb6a',
      warning: '#ffb74d',
      error: '#ef5350',
      info: '#4fc3f7',
      separator: '#2a2a47',
    },
  },
  {
    name: 'Monokai',
    description: 'Monokai',
    colors: {
      primary: '#66d9ef',
      secondary: '#ae81ff',
      accent: '#a6e22e',
      muted: '#75715e',
      userMessage: '#e6db74',
      assistantMessage: '#f8f8f2',
      systemMessage: '#66d9ef',
      errorMessage: '#f92672',
      border: '#3e3d32',
      inputBorder: '#66d9ef',
      statusBar: '#66d9ef',
      highlight: '#a6e22e',
      background: '#000000',
      toolChip: '#3e3d32',
      toolChipActive: '#66d9ef',
      thinkingChip: '#e6db74',
      kittColor: '#66d9ef',
      kittBracket: '#ae81ff',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#a6e22e',
      warning: '#e6db74',
      error: '#f92672',
      info: '#fd971f',
      separator: '#3e3d32',
    },
  },
  {
    name: 'Monolith',
    description: 'Monolith',
    colors: {
      primary: '#aaaaaa',
      secondary: '#8a8a8a',
      accent: '#ffffff',
      muted: '#888888',
      userMessage: '#aaaaaa',
      assistantMessage: '#e8e8e8',
      systemMessage: '#aaaaaa',
      errorMessage: '#cacaca',
      border: '#3a3a3a',
      inputBorder: '#aaaaaa',
      statusBar: '#aaaaaa',
      highlight: '#ffffff',
      background: '#000000',
      toolChip: '#151515',
      toolChipActive: '#aaaaaa',
      thinkingChip: '#aaaaaa',
      kittColor: '#aaaaaa',
      kittBracket: '#8a8a8a',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#8a8a8a',
      warning: '#aaaaaa',
      error: '#cacaca',
      info: '#aaaaaa',
      separator: '#3a3a3a',
    },
  },
  {
    name: 'Neon Wave',
    description: 'Neon Wave',
    colors: {
      primary: '#3a86ff',
      secondary: '#8338ec',
      accent: '#06ffa5',
      muted: '#a08dc0',
      userMessage: '#fb5607',
      assistantMessage: '#e8dfff',
      systemMessage: '#3a86ff',
      errorMessage: '#ff006e',
      border: '#3d2060',
      inputBorder: '#06ffa5',
      statusBar: '#3a86ff',
      highlight: '#06ffa5',
      background: '#000000',
      toolChip: '#2d1654',
      toolChipActive: '#3a86ff',
      thinkingChip: '#fb5607',
      kittColor: '#3a86ff',
      kittBracket: '#8338ec',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#06ffa5',
      warning: '#fb5607',
      error: '#ff006e',
      info: '#3a86ff',
      separator: '#3d2060',
    },
  },
  {
    name: 'Nightowl',
    description: 'Nightowl',
    colors: {
      primary: '#82AAFF',
      secondary: '#7fdbca',
      accent: '#c792ea',
      muted: '#5f7e97',
      userMessage: '#ecc48d',
      assistantMessage: '#d6deeb',
      systemMessage: '#82AAFF',
      errorMessage: '#EF5350',
      border: '#5f7e97',
      inputBorder: '#82AAFF',
      statusBar: '#82AAFF',
      highlight: '#c792ea',
      background: '#000000',
      toolChip: '#0b253a',
      toolChipActive: '#82AAFF',
      thinkingChip: '#ecc48d',
      kittColor: '#82AAFF',
      kittBracket: '#7fdbca',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#c5e478',
      warning: '#ecc48d',
      error: '#EF5350',
      info: '#82AAFF',
      separator: '#5f7e97',
    },
  },
  {
    name: 'Nord',
    description: 'Nord',
    colors: {
      primary: '#88C0D0',
      secondary: '#81A1C1',
      accent: '#8FBCBB',
      muted: '#8B95A7',
      userMessage: '#D08770',
      assistantMessage: '#ECEFF4',
      systemMessage: '#88C0D0',
      errorMessage: '#BF616A',
      border: '#434C5E',
      inputBorder: '#4C566A',
      statusBar: '#88C0D0',
      highlight: '#8FBCBB',
      background: '#000000',
      toolChip: '#434C5E',
      toolChipActive: '#88C0D0',
      thinkingChip: '#D08770',
      kittColor: '#88C0D0',
      kittBracket: '#81A1C1',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#A3BE8C',
      warning: '#D08770',
      error: '#BF616A',
      info: '#88C0D0',
      separator: '#434C5E',
    },
  },
  {
    name: 'Obsidian Depths',
    description: 'Obsidian Depths',
    colors: {
      primary: '#58a6ff',
      secondary: '#bc8cff',
      accent: '#56d4dd',
      muted: '#8b949e',
      userMessage: '#ffa657',
      assistantMessage: '#c9d1d9',
      systemMessage: '#58a6ff',
      errorMessage: '#ff7b72',
      border: '#30363d',
      inputBorder: '#58a6ff',
      statusBar: '#58a6ff',
      highlight: '#56d4dd',
      background: '#000000',
      toolChip: '#1c2128',
      toolChipActive: '#58a6ff',
      thinkingChip: '#ffa657',
      kittColor: '#58a6ff',
      kittBracket: '#bc8cff',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#7ee787',
      warning: '#ffa657',
      error: '#ff7b72',
      info: '#58a6ff',
      separator: '#30363d',
    },
  },
  {
    name: 'One Dark',
    description: 'One Dark',
    colors: {
      primary: '#61afef',
      secondary: '#c678dd',
      accent: '#56b6c2',
      muted: '#5c6370',
      userMessage: '#e5c07b',
      assistantMessage: '#abb2bf',
      systemMessage: '#61afef',
      errorMessage: '#e06c75',
      border: '#393f4a',
      inputBorder: '#61afef',
      statusBar: '#61afef',
      highlight: '#56b6c2',
      background: '#000000',
      toolChip: '#353b45',
      toolChipActive: '#61afef',
      thinkingChip: '#e5c07b',
      kittColor: '#61afef',
      kittBracket: '#c678dd',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#98c379',
      warning: '#e5c07b',
      error: '#e06c75',
      info: '#d19a66',
      separator: '#393f4a',
    },
  },
  {
    name: 'Opencode',
    description: 'Opencode',
    colors: {
      primary: '#fab283',
      secondary: '#5c9cf5',
      accent: '#f5a742',
      muted: '#808080',
      userMessage: '#f5a742',
      assistantMessage: '#eeeeee',
      systemMessage: '#fab283',
      errorMessage: '#e06c75',
      border: '#484848',
      inputBorder: '#606060',
      statusBar: '#fab283',
      highlight: '#f5a742',
      background: '#000000',
      toolChip: '#1e1e1e',
      toolChipActive: '#fab283',
      thinkingChip: '#f5a742',
      kittColor: '#fab283',
      kittBracket: '#5c9cf5',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#7fd88f',
      warning: '#f5a742',
      error: '#e06c75',
      info: '#56b6c2',
      separator: '#484848',
    },
  },
  {
    name: 'Orng',
    description: 'Orng',
    colors: {
      primary: '#EC5B2B',
      secondary: '#EE7948',
      accent: '#FFF7F1',
      muted: '#808080',
      userMessage: '#EC5B2B',
      assistantMessage: '#eeeeee',
      systemMessage: '#EC5B2B',
      errorMessage: '#e06c75',
      border: '#EC5B2B',
      inputBorder: '#EE7948',
      statusBar: '#EC5B2B',
      highlight: '#FFF7F1',
      background: '#000000',
      toolChip: '#1e1e1e',
      toolChipActive: '#EC5B2B',
      thinkingChip: '#EC5B2B',
      kittColor: '#EC5B2B',
      kittBracket: '#EE7948',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#6ba1e6',
      warning: '#EC5B2B',
      error: '#e06c75',
      info: '#56b6c2',
      separator: '#EC5B2B',
    },
  },
  {
    name: 'Palenight',
    description: 'Palenight',
    colors: {
      primary: '#82aaff',
      secondary: '#c792ea',
      accent: '#89ddff',
      muted: '#676e95',
      userMessage: '#ffcb6b',
      assistantMessage: '#a6accd',
      systemMessage: '#82aaff',
      errorMessage: '#f07178',
      border: '#32364a',
      inputBorder: '#82aaff',
      statusBar: '#82aaff',
      highlight: '#89ddff',
      background: '#000000',
      toolChip: '#32364a',
      toolChipActive: '#82aaff',
      thinkingChip: '#ffcb6b',
      kittColor: '#82aaff',
      kittBracket: '#c792ea',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#c3e88d',
      warning: '#ffcb6b',
      error: '#f07178',
      info: '#f78c6c',
      separator: '#32364a',
    },
  },
  {
    name: 'Phantom Code',
    description: 'Phantom Code',
    colors: {
      primary: '#818cf8',
      secondary: '#a78bfa',
      accent: '#c084fc',
      muted: '#8b8ea1',
      userMessage: '#fbbf24',
      assistantMessage: '#d9dce6',
      systemMessage: '#818cf8',
      errorMessage: '#fb7185',
      border: '#2d2f3e',
      inputBorder: '#c084fc',
      statusBar: '#818cf8',
      highlight: '#c084fc',
      background: '#000000',
      toolChip: '#23242f',
      toolChipActive: '#818cf8',
      thinkingChip: '#fbbf24',
      kittColor: '#818cf8',
      kittBracket: '#a78bfa',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#86efac',
      warning: '#fbbf24',
      error: '#fb7185',
      info: '#67e8f9',
      separator: '#2d2f3e',
    },
  },
  {
    name: 'Quantum Shift',
    description: 'Quantum Shift',
    colors: {
      primary: '#61afef',
      secondary: '#bb9af7',
      accent: '#7dcfff',
      muted: '#8a90b0',
      userMessage: '#e0af68',
      assistantMessage: '#dfe3f0',
      systemMessage: '#61afef',
      errorMessage: '#f7768e',
      border: '#2a2d3e',
      inputBorder: '#7dcfff',
      statusBar: '#61afef',
      highlight: '#7dcfff',
      background: '#000000',
      toolChip: '#1e202f',
      toolChipActive: '#61afef',
      thinkingChip: '#e0af68',
      kittColor: '#61afef',
      kittBracket: '#bb9af7',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#9ece6a',
      warning: '#e0af68',
      error: '#f7768e',
      info: '#61afef',
      separator: '#2a2d3e',
    },
  },
  {
    name: 'Rosepine',
    description: 'Rosepine',
    colors: {
      primary: '#9ccfd8',
      secondary: '#c4a7e7',
      accent: '#ebbcba',
      muted: '#6e6a86',
      userMessage: '#f6c177',
      assistantMessage: '#e0def4',
      systemMessage: '#9ccfd8',
      errorMessage: '#eb6f92',
      border: '#403d52',
      inputBorder: '#9ccfd8',
      statusBar: '#9ccfd8',
      highlight: '#ebbcba',
      background: '#000000',
      toolChip: '#26233a',
      toolChipActive: '#9ccfd8',
      thinkingChip: '#f6c177',
      kittColor: '#9ccfd8',
      kittBracket: '#c4a7e7',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#31748f',
      warning: '#f6c177',
      error: '#eb6f92',
      info: '#9ccfd8',
      separator: '#403d52',
    },
  },
  {
    name: 'Slate Noir',
    description: 'Slate Noir',
    colors: {
      primary: '#a1a1b3',
      secondary: '#77778a',
      accent: '#f4f4f7',
      muted: '#8c8c92',
      userMessage: '#a1a1b3',
      assistantMessage: '#e4e4e7',
      systemMessage: '#a1a1b3',
      errorMessage: '#c9c9d6',
      border: '#34343d',
      inputBorder: '#a1a1b3',
      statusBar: '#a1a1b3',
      highlight: '#f4f4f7',
      background: '#000000',
      toolChip: '#1a1a1e',
      toolChipActive: '#a1a1b3',
      thinkingChip: '#a1a1b3',
      kittColor: '#a1a1b3',
      kittBracket: '#77778a',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#77778a',
      warning: '#a1a1b3',
      error: '#c9c9d6',
      info: '#a1a1b3',
      separator: '#34343d',
    },
  },
  {
    name: 'Solarized',
    description: 'Solarized',
    colors: {
      primary: '#268bd2',
      secondary: '#6c71c4',
      accent: '#2aa198',
      muted: '#586e75',
      userMessage: '#b58900',
      assistantMessage: '#839496',
      systemMessage: '#268bd2',
      errorMessage: '#dc322f',
      border: '#073642',
      inputBorder: '#586e75',
      statusBar: '#268bd2',
      highlight: '#2aa198',
      background: '#000000',
      toolChip: '#073642',
      toolChipActive: '#268bd2',
      thinkingChip: '#b58900',
      kittColor: '#268bd2',
      kittBracket: '#6c71c4',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#859900',
      warning: '#b58900',
      error: '#dc322f',
      info: '#cb4b16',
      separator: '#073642',
    },
  },
  {
    name: 'Sunset Code',
    description: 'Sunset Code',
    colors: {
      primary: '#ff9e64',
      secondary: '#c792ea',
      accent: '#ff6e9c',
      muted: '#b89fa0',
      userMessage: '#ffc777',
      assistantMessage: '#f4e5d9',
      systemMessage: '#ff9e64',
      errorMessage: '#ff8a80',
      border: '#3d3240',
      inputBorder: '#ff6e9c',
      statusBar: '#ff9e64',
      highlight: '#ff6e9c',
      background: '#000000',
      toolChip: '#322837',
      toolChipActive: '#ff9e64',
      thinkingChip: '#ffc777',
      kittColor: '#ff9e64',
      kittBracket: '#c792ea',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#90cfa0',
      warning: '#ffc777',
      error: '#ff8a80',
      info: '#baacff',
      separator: '#3d3240',
    },
  },
  {
    name: 'Synthwave84',
    description: 'Synthwave84',
    colors: {
      primary: '#36f9f6',
      secondary: '#ff7edb',
      accent: '#b084eb',
      muted: '#848bbd',
      userMessage: '#fede5d',
      assistantMessage: '#ffffff',
      systemMessage: '#36f9f6',
      errorMessage: '#fe4450',
      border: '#495495',
      inputBorder: '#36f9f6',
      statusBar: '#36f9f6',
      highlight: '#b084eb',
      background: '#000000',
      toolChip: '#2a2139',
      toolChipActive: '#36f9f6',
      thinkingChip: '#fede5d',
      kittColor: '#36f9f6',
      kittBracket: '#ff7edb',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#72f1b8',
      warning: '#fede5d',
      error: '#fe4450',
      info: '#ff8b39',
      separator: '#495495',
    },
  },
  {
    name: 'Tokyonight',
    description: 'Tokyonight',
    colors: {
      primary: '#82aaff',
      secondary: '#c099ff',
      accent: '#ff966c',
      muted: '#828bb8',
      userMessage: '#ff966c',
      assistantMessage: '#c8d3f5',
      systemMessage: '#82aaff',
      errorMessage: '#ff757f',
      border: '#737aa2',
      inputBorder: '#9099b2',
      statusBar: '#82aaff',
      highlight: '#ff966c',
      background: '#000000',
      toolChip: '#222436',
      toolChipActive: '#82aaff',
      thinkingChip: '#ff966c',
      kittColor: '#82aaff',
      kittBracket: '#c099ff',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#c3e88d',
      warning: '#ff966c',
      error: '#ff757f',
      info: '#82aaff',
      separator: '#737aa2',
    },
  },
  {
    name: 'Vercel',
    description: 'Vercel',
    colors: {
      primary: '#0070F3',
      secondary: '#52A8FF',
      accent: '#8E4EC6',
      muted: '#878787',
      userMessage: '#FFB224',
      assistantMessage: '#EDEDED',
      systemMessage: '#0070F3',
      errorMessage: '#E5484D',
      border: '#1F1F1F',
      inputBorder: '#454545',
      statusBar: '#0070F3',
      highlight: '#8E4EC6',
      background: '#000000',
      toolChip: '#292929',
      toolChipActive: '#0070F3',
      thinkingChip: '#FFB224',
      kittColor: '#0070F3',
      kittBracket: '#52A8FF',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#46A758',
      warning: '#FFB224',
      error: '#E5484D',
      info: '#52A8FF',
      separator: '#1F1F1F',
    },
  },
  {
    name: 'Vesper',
    description: 'Vesper',
    colors: {
      primary: '#FFC799',
      secondary: '#99FFE4',
      accent: '#FFC799',
      muted: '#A0A0A0',
      userMessage: '#FFC799',
      assistantMessage: '#FFFFFF',
      systemMessage: '#FFC799',
      errorMessage: '#FF8080',
      border: '#282828',
      inputBorder: '#FFC799',
      statusBar: '#FFC799',
      highlight: '#FFC799',
      background: '#000000',
      toolChip: '#101010',
      toolChipActive: '#FFC799',
      thinkingChip: '#FFC799',
      kittColor: '#FFC799',
      kittBracket: '#99FFE4',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#99FFE4',
      warning: '#FFC799',
      error: '#FF8080',
      info: '#FFC799',
      separator: '#282828',
    },
  },
  {
    name: 'Void Runner',
    description: 'Void Runner',
    colors: {
      primary: '#82aaff',
      secondary: '#c792ea',
      accent: '#89ddff',
      muted: '#9090b0',
      userMessage: '#ffcb6b',
      assistantMessage: '#e6e6fa',
      systemMessage: '#82aaff',
      errorMessage: '#ff5370',
      border: '#1a1a30',
      inputBorder: '#89ddff',
      statusBar: '#82aaff',
      highlight: '#89ddff',
      background: '#000000',
      toolChip: '#101020',
      toolChipActive: '#82aaff',
      thinkingChip: '#ffcb6b',
      kittColor: '#82aaff',
      kittBracket: '#c792ea',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#c3e88d',
      warning: '#ffcb6b',
      error: '#ff5370',
      info: '#89ddff',
      separator: '#1a1a30',
    },
  },
  {
    name: 'Zenburn',
    description: 'Zenburn',
    colors: {
      primary: '#8cd0d3',
      secondary: '#dc8cc3',
      accent: '#93e0e3',
      muted: '#9f9f9f',
      userMessage: '#f0dfaf',
      assistantMessage: '#dcdccc',
      systemMessage: '#8cd0d3',
      errorMessage: '#cc9393',
      border: '#5f5f5f',
      inputBorder: '#8cd0d3',
      statusBar: '#8cd0d3',
      highlight: '#93e0e3',
      background: '#000000',
      toolChip: '#5f5f5f',
      toolChipActive: '#8cd0d3',
      thinkingChip: '#f0dfaf',
      kittColor: '#8cd0d3',
      kittBracket: '#dc8cc3',
      kittLit: '█',
      kittDim: '▓',
      kittFaint: '░',
      kittOff: '·',
      success: '#7f9f7f',
      warning: '#f0dfaf',
      error: '#cc9393',
      info: '#dfaf8f',
      separator: '#5f5f5f',
    },
  },
];

// Get initial theme from saved preference or default to first theme
function getInitialTheme(): Theme {
  const savedName = loadSavedThemeName();
  if (savedName) {
    const found = DEFAULT_THEMES.find((t) => t.name === savedName);
    if (found) return found;
  }
  return DEFAULT_THEMES[0];
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
  inputTokens: number;
  outputTokens: number;
  aiTools?: AiToolsService;
  agentMode: 'coding' | 'planning'; // Current agent mode
  chipDisplayStyle: 'inline' | 'boxes'; // How to display tool chips
  greyOutFinishedTools: boolean; // Whether to grey out finished tools
  contextChips: ContextChip[]; // Active context chips that apply to all messages
  // Orchestration state
  orchestration?: OrchestrationContext;
  subAgents: SubAgent[];
  subAgentsSectionExpanded: boolean;
  expandedAgentIds: Set<string>;
  expandedChipId: string | null; // Single expanded chip (mutual exclusivity)
  // Theme state
  currentTheme: Theme;
  showThemePicker: boolean;
  selectedThemeIndex: number;
  // Status bar popup state (mutually exclusive)
  activeStatusPopup: 'model' | 'mode' | 'context' | 'lsp' | 'idx' | 'patchModel' | null;
  selectedPopupIndex: number; // For keyboard navigation in popups
  // Agent message pagination state
  agentMessagesVisible: Map<string, number>; // agentId -> number of messages to display (starts at 20)
  expandedAgentMessageIds: Set<string>; // Which agents show their message blocks
  activeAgentTabId: string | null; // Which agent tab is active in the tabbed view
  // Session switching state
  pendingSessionSwitch?: { availableSessions: SessionSummary[]; prompted: boolean };
  // Agent panel resize state
  agentPanelHeight: number; // Height in terminal rows
  isDraggingResize: boolean; // Currently dragging resize handle
  dragStartY: number | null; // Y position where drag started
  dragStartHeight: number | null; // Panel height when drag started
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
function extractToolActivity(messages: Message[], greyOutFinishedTools: boolean = true): ToolActivity[] {
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

    // Tool is active if it has no result yet (or if greying out is disabled)
    const isToolActive = greyOutFinishedTools ? msg.toolResult === undefined : true;

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
    // Completed: show brain icon + duration
    return `🧠 ${elapsed.toFixed(0)}s`;
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
        return seg.chip.label;
      } else {
        return seg.context.label;
      }
    })
    .join('');
}

/**
 * Render text with multi-line support by splitting on newlines
 * Returns React elements for proper line-by-line display
 */
function renderMultilineText(
  text: string,
  fgColor: string,
  cursorPosOverall: number,
  cursorVisible: boolean,
  beforeText: string = '',
  afterText: string = ''
): React.ReactNode[] {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let charCount = beforeText.length;

  lines.forEach((line, lineIdx) => {
    const lineStart = charCount;
    const lineEnd = charCount + line.length;

    // Check if cursor is on this line
    const cursorOnLine = cursorPosOverall >= lineStart && cursorPosOverall <= lineEnd;
    const cursorOffsetInLine = cursorOnLine ? cursorPosOverall - lineStart : -1;

    if (cursorOnLine) {
      // Render cursor on this line
      const beforeCursor = line.slice(0, cursorOffsetInLine);
      const afterCursor = line.slice(cursorOffsetInLine);
      elements.push(
        <React.Fragment key={`line-${lineIdx}`}>
          <text content={beforeCursor} fg={fgColor} />
          <text content={cursorVisible ? '█' : ' '} fg="gray" />
          <text content={afterCursor} fg={fgColor} />
          {lineIdx < lines.length - 1 && <text content="" />}
        </React.Fragment>
      );
    } else {
      // Regular line
      elements.push(
        <text key={`line-${lineIdx}`} content={line} fg={fgColor} />
      );
    }

    charCount += line.length + 1; // +1 for newline
  });

  return elements;
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
    '/patch-model',
    '/toggle-grey-tools',
    '/theme'
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
 * Get completions for @ agent references
 */
function getAgentCompletions(prefix: string, agents: SubAgent[]): string[] {
  const search = prefix.slice(1).toLowerCase(); // Remove @ and lowercase

  return agents
    .filter((agent) => agent.id.toLowerCase().includes(search))
    .map((agent) => `@${agent.id}`);
}

/**
 * Extract @agent-id references from message content
 */
function extractAgentReferences(content: string, agents: SubAgent[]): { agentIds: string[]; cleanContent: string } {
  const agentIds: string[] = [];
  let cleanContent = content;

  // Find all @agent-id patterns
  const agentPattern = /@([a-z]+-\d+)/gi;
  const matches = content.matchAll(agentPattern);

  for (const match of matches) {
    const refText = match[0]; // @haiku-1
    const agentId = match[1]; // haiku-1

    // Check if this agent actually exists
    if (agents.some((a) => a.id === agentId)) {
      agentIds.push(agentId);
      // Remove agent reference from content (it's a routing directive, not content)
      cleanContent = cleanContent.replace(refText, '').trim();
    }
  }

  return { agentIds, cleanContent };
}

/**
 * Find completions for current input segments
 */
async function getCompletionsWithAgents(segments: InputSegment[], agents: SubAgent[]): Promise<string[]> {
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

  // Check if we're completing a file reference or agent reference
  if (input.includes('@')) {
    const lastAtIndex = input.lastIndexOf('@');
    // Check if this @ is after a space (new token) or at start
    if (lastAtIndex === 0 || input[lastAtIndex - 1] === ' ') {
      const afterAt = input.slice(lastAtIndex);
      const fileCompletions = await getFileCompletions(afterAt);

      // Add active agents to completion list at the TOP
      const agentCompletions = getAgentCompletions(afterAt, agents);

      // Agents first, then files
      return [...agentCompletions, ...fileCompletions];
    }
  }

  return [];
}

/**
 * Helper to switch model and update state/session
 */
async function switchModel(
  model: 'auto' | 'fast' | 'smart-sonnet' | 'smart-opus',
  session: AgentSessionHandle | null,
  updateState: (updates: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) => void
): Promise<void> {
  try {
    if (session && model !== 'auto') {
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
          <text
            key={`tool-box-${activity.name}`}
            content={` ${label}${countSuffix} `}
            fg={fgColor}
            bg={bgColor}
            bold={activity.isActive}
            style={{ marginRight: 1 }}
          />
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
      borderColor: 'gray',
      marginLeft: 2,
      marginBottom: 1
    }}
    onMouseUp={onToggle}
  >
    {/* Header - always visible */}
    <box style={{ flexDirection: 'row', paddingLeft: 1, paddingRight: 1 }}>
      <text content={isExpanded ? '[-]' : '[+]'} fg="gray" />
      <text content={` ${agent.id} `} fg="gray" />
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
        <text content={agent.currentTask || 'Waiting...'} fg="gray" />
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
 * TabbedAgentMessageBlock - Full-width block showing all agents as tabs
 * Only one agent's content is visible at a time, click tabs to switch
 */
const TabbedAgentMessageBlock: React.FC<{
  agents: SubAgent[];
  activeAgentId: string | null;
  visibleLineCount: number;
  maxHeight?: number;
  onSelectTab: (agentId: string) => void;
  onShowMore: () => void;
}> = ({ agents, activeAgentId, visibleLineCount, maxHeight = 30, onSelectTab, onShowMore }) => {
  // Set first agent as default if none selected
  const effectiveActiveId = activeAgentId || agents[0]?.id || null;
  const activeAgent = agents.find((a) => a.id === effectiveActiveId);

  if (!activeAgent) {
    return null;
  }

  const outputLines = activeAgent.liveOutput?.split('\n') || [];
  const totalLines = outputLines.length;
  const displayLines = outputLines.slice(0, visibleLineCount);
  const hasMore = visibleLineCount < totalLines;

  const statusColor =
    activeAgent.status === 'running' ? 'cyan' :
    activeAgent.status === 'done' ? 'green' :
    activeAgent.status === 'error' ? 'red' :
    activeAgent.status === 'waiting' ? 'yellow' : 'gray';

  // Calculate tab bar width for underline
  const tabBarWidth = agents.reduce((total, agent, idx) => {
    const tabWidth = agent.id.length + 2; // " agentId "
    const spacerWidth = idx < agents.length - 1 ? 1 : 0; // " " between tabs
    return total + tabWidth + spacerWidth;
  }, 2); // +2 for left/right padding

  return (
    <box style={{ marginBottom: 1, flexShrink: 0 }}>
      {/* Tab bar - all agents as clickable tabs */}
      <box style={{ flexDirection: 'row', paddingLeft: 1, paddingRight: 1, paddingBottom: 0, backgroundColor: '#1a1a1a' }}>
        {agents.map((agent, idx) => {
          const isActive = agent.id === effectiveActiveId;
          return (
            <React.Fragment key={`tab-${agent.id}`}>
              <text
                content={` ${agent.id} `}
                fg={isActive ? 'black' : 'gray'}
                bg={isActive ? 'gray' : undefined}
                bold={isActive}
                style={{ cursor: 'pointer' }}
                onMouseUp={() => onSelectTab(agent.id)}
              />
              {idx < agents.length - 1 && <text content=" " fg="gray" />}
            </React.Fragment>
          );
        })}
      </box>

      {/* Separator line - matches tab width */}
      <text content={'─'.repeat(tabBarWidth)} fg="gray" style={{ paddingLeft: 1 }} />

      {/* Content area for active agent - resizable height with scrolling */}
      <scrollbox
        scrollX={false}
        style={{
          maxHeight: maxHeight,
          flexShrink: 0
        }}
        options={{
          style: {
            scrollbar: {
              bg: 'gray'
            }
          }
        }}
      >
        <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1 }}>
          {/* Header with status and model */}
          <box style={{ flexDirection: 'row' }}>
            <text content={`${activeAgent.model}`} fg="gray" />
            <text content=" | " fg="gray" />
            <text content={activeAgent.status} fg={statusColor} bold />
            {activeAgent.progress && (
              <text content={` ${activeAgent.progress.percent}%`} fg="yellow" />
            )}
          </box>

          {/* Task description */}
          {activeAgent.currentTask && (
            <box style={{ marginTop: 1 }}>
              <text content="Task: " fg="gray" bold />
              <text content={activeAgent.currentTask} fg="gray" />
            </box>
          )}

          {/* Progress message */}
          {activeAgent.progress && (
            <text content={activeAgent.progress.message} fg="gray" style={{ marginTop: 1 }} />
          )}

          {/* Live output with pagination */}
          {displayLines.length > 0 && (
            <box style={{ marginTop: 1 }}>
              {displayLines.map((line, idx) => (
                <text key={`output-${idx}`} content={line} fg="gray" />
              ))}
              {/* Show more button */}
              {hasMore && (
                <box
                  style={{ marginTop: 1, flexDirection: 'row' }}
                  onMouseUp={onShowMore}
                >
                  <text content="[Show more " fg="blue" />
                  <text content={`(${totalLines - visibleLineCount} more lines)`} fg="cyan" />
                  <text content="]" fg="blue" />
                </box>
              )}
            </box>
          )}
        </box>
      </scrollbox>
    </box>
  );
};

/**
 * AgentMessageBlock - Displays agent as a collapsible message-like block within message flow
 * Shows agent status, current task, and paginated live output
 */
const AgentMessageBlock: React.FC<{
  agent: SubAgent;
  isExpanded: boolean;
  visibleLineCount: number;
  onToggle: () => void;
  onShowMore: () => void;
}> = ({ agent, isExpanded, visibleLineCount, onToggle, onShowMore }) => {
  // Split liveOutput into lines for pagination
  const outputLines = agent.liveOutput?.split('\n') || [];
  const totalLines = outputLines.length;
  const displayLines = outputLines.slice(0, visibleLineCount);
  const hasMore = visibleLineCount < totalLines;

  const statusColor =
    agent.status === 'running' ? 'cyan' :
    agent.status === 'done' ? 'green' :
    agent.status === 'error' ? 'red' :
    agent.status === 'waiting' ? 'yellow' : 'gray';

  return (
    <box style={{ marginBottom: 1, border: 'single', borderColor: 'blue' }}>
      {/* Header - always visible */}
      <box
        style={{ flexDirection: 'row', paddingLeft: 1, paddingRight: 1 }}
        onMouseUp={onToggle}
      >
        <text content={isExpanded ? '[-]' : '[+]'} fg="blue" bold />
        <text content={` Agent: ${agent.id} `} fg="blue" bold />
        <text content={`(${agent.model})`} fg="gray" />
        <text content=" | " fg="gray" />
        <text content={agent.status} fg={statusColor} bold />
        {agent.progress && (
          <text content={` ${agent.progress.percent}%`} fg="yellow" />
        )}
      </box>

      {/* Expanded content - task and output */}
      {isExpanded && (
        <box style={{ paddingLeft: 2, paddingRight: 1, paddingTop: 1, paddingBottom: 1 }}>
          {agent.currentTask && (
            <>
              <text content="Task: " fg="gray" bold />
              <text content={agent.currentTask} fg="gray" />
            </>
          )}
          {agent.progress && (
            <text content={agent.progress.message} fg="gray" />
          )}
          {/* Live output with pagination */}
          {displayLines.length > 0 && (
            <box style={{ marginTop: 1 }}>
              {displayLines.map((line, idx) => (
                <text key={`output-${idx}`} content={line} fg="gray" />
              ))}
              {/* Show more button */}
              {hasMore && (
                <box
                  style={{ marginTop: 1, flexDirection: 'row' }}
                  onMouseUp={onShowMore}
                >
                  <text content="[Show more " fg="blue" />
                  <text content={`(${totalLines - visibleLineCount} more lines)`} fg="cyan" />
                  <text content="]" fg="blue" />
                </box>
              )}
            </box>
          )}
        </box>
      )}
    </box>
  );
};

/**
 * CollapsibleSubAgentsSection - Shows all sub-agents in a collapsible section
 */
const CollapsibleSubAgentsSection: React.FC<{
  agents: SubAgent[];
  isExpanded: boolean;
  expandedAgents: Set<string>;
  onToggleSection: () => void;
  onToggleAgent: (agentId: string) => void;
  theme: Theme;
}> = ({ agents, isExpanded, expandedAgents, onToggleSection, onToggleAgent, theme }) => {
  return (
    <box style={{ marginTop: 1, marginBottom: 1, maxHeight: 20, flexShrink: 0 }}>
      {/* Section header - always visible */}
      <box
        style={{ flexDirection: 'row', paddingLeft: 1 }}
        onMouseUp={onToggleSection}
      >
        <text content={isExpanded ? '[-]' : '[+]'} fg={theme.colors.primary} bold />
        <text content=" Background Agents " fg={theme.colors.primary} bold />
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

      {/* Agent list - only when section expanded, with scrolling */}
      {isExpanded && agents.length > 0 && (
        <scrollbox
          scrollX={false}
          style={{
            maxHeight: 18,
            flexShrink: 0
          }}
          options={{
            style: {
              scrollbar: {
                bg: 'gray'
              }
            }
          }}
        >
          {agents.map(agent => (
            <SubAgentTaskBox
              key={agent.id}
              agent={agent}
              isExpanded={expandedAgents.has(agent.id)}
              onToggle={() => onToggleAgent(agent.id)}
            />
          ))}
        </scrollbox>
      )}

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

/**
 * MiniAgentPreview - Compact preview of agents shown when panel is collapsed
 * One row per agent with: status dot, ID, current tool/task, progress
 */
const MiniAgentPreview: React.FC<{
  agents: SubAgent[];
  onExpand: () => void;
  theme: Theme;
}> = ({ agents, onExpand, theme }) => {
  if (agents.length === 0) return null;

  // Status symbols for inline display
  const getStatusSymbol = (status: string) => {
    switch (status) {
      case 'running': return '●';
      case 'done': return '✓';
      case 'error': return '✗';
      case 'waiting': return '○';
      default: return '·';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'cyan';
      case 'done': return 'green';
      case 'error': return 'red';
      case 'waiting': return 'yellow';
      default: return 'gray';
    }
  };

  return (
    <box
      style={{
        marginBottom: 0,
        paddingLeft: 1,
        paddingRight: 1,
        flexShrink: 0,
        backgroundColor: '#1a1a1a'
      }}
      border={true}
      borderStyle="single"
      borderColor="#444444"
      onMouseUp={onExpand}
    >
      {/* Header row */}
      <text
        content={`[+] ${agents.length} agent${agents.length !== 1 ? 's' : ''} (click to expand)`}
        fg={theme.colors.muted}
      />
      {/* Agent rows - max 3 visible */}
      {agents.slice(0, 3).map((agent) => {
        const symbol = getStatusSymbol(agent.status);
        const color = getStatusColor(agent.status);
        const agentId = agent.id.slice(0, 7);
        const model = agent.model?.split('-')[0] || '';
        const progress = agent.progress ? ` ${agent.progress.percent}%` : '';

        // Get last meaningful line from output, clean it up
        const lastLine = agent.liveOutput
          ?.split('\n')
          .filter(l => l.trim())
          .slice(-1)[0]
          ?.replace(/\s+/g, ' ')
          .trim()
          .slice(0, 60) || '';

        // Build the full line as a single string
        const line = `${symbol} ${agentId} ${model}${progress}${lastLine ? ` - ${lastLine}` : ''}`;

        return (
          <text
            key={`mini-${agent.id}`}
            content={line}
            fg={color}
          />
        );
      })}
      {agents.length > 3 && (
        <text content={`  +${agents.length - 3} more...`} fg="gray" />
      )}
    </box>
  );
};

/**
 * Generate startup banner with model, path, and account info
 */
function generateStartupBanner(
  modelPreference: string,
  workingDir: string,
  authType: 'oauth' | 'api-key',
  sessionId?: string
): string {
  const modelDisplay = getModelDisplayFromPreference(modelPreference);
  const accountType = authType === 'oauth' ? 'Claude Max' : 'API Key';
  const shortPath = workingDir.replace(os.homedir(), '~');

  // Get username from environment
  const username = process.env.USER || process.env.USERNAME || 'User';

  const lines = [
    `╭${'─'.repeat(60)}╮`,
    `│${' '.repeat(60)}│`,
    `│  Welcome back ${username}!${' '.repeat(Math.max(0, 44 - username.length))}│`,
    `│${' '.repeat(60)}│`,
    `│  ${modelDisplay}${' '.repeat(Math.max(0, 58 - modelDisplay.length))}│`,
    `│  ${accountType}${' '.repeat(Math.max(0, 58 - accountType.length))}│`,
    `│  ${shortPath}${' '.repeat(Math.max(0, 58 - shortPath.length))}│`,
    `│${' '.repeat(60)}│`,
    `╰${'─'.repeat(60)}╯`
  ];

  return lines.join('\n');
}

const ChatApp: React.FC<{
  apiKey?: string;
  oauthToken?: string;
  resumeSession?: SessionData;
  authType?: 'oauth' | 'api-key';
}> = ({ apiKey, oauthToken, resumeSession, authType = 'api-key' }) => {
  // Track render timing
  renderCount++;
  if (renderCount <= 10 || renderCount % 10 === 0) {
    debugLog(`ChatApp render #${renderCount}`);
  }

  // Generate the startup banner
  const modelPref = resumeSession?.model || 'fast';
  const startupBanner = generateStartupBanner(modelPref, process.cwd(), authType, resumeSession?.sessionId);

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
          content: startupBanner,
          timestamp: new Date(),
          isBanner: true
        },
        {
          role: 'system' as const,
          content: `[↻] Resuming session ${resumeSession.sessionId.slice(0, 8)}... (${resumeSession.messages.length} messages)`,
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
          content: startupBanner,
          timestamp: new Date(),
          isBanner: true
        },
        {
          role: 'system' as const,
          content: 'Keyboard: Tab autocomplete | ↑↓ history | Shift+Enter newline | Ctrl+E expand | Ctrl+M models\nCommands: /help /model /sessions /quit',
          timestamp: new Date()
        }
      ];

  const [state, updateState] = useBatchedState<AppState>({
    messages: initialMessages,
    isResponding: false,
    currentModel: resumeSession?.model || 'smart-sonnet',
    sessionId: resumeSession?.sessionId,
    thinkingSessions: [],
    usedToolsInCurrentResponse: new Set(),
    queuedMessages: 0,
    showTaskList: false,
    expandedToolIds: new Set(),
    currentToolId: undefined,
    inputTokens: resumeSession?.inputTokens || 0,
    outputTokens: resumeSession?.outputTokens || 0,
    agentMode: 'coding',
    chipDisplayStyle: (process.env.CHIP_DISPLAY_STYLE === 'boxes' ? 'boxes' : 'inline') as 'inline' | 'boxes',
    greyOutFinishedTools: true, // Default: grey out finished tools
    contextChips: [], // Active context chips (transient, not persisted)
    // Orchestration state
    orchestration: undefined,
    subAgents: resumeSession?.subAgents?.map((stored) => ({
      id: stored.id,
      model: stored.model as ModelPreference,
      status: stored.status as SubAgentStatus,
      currentTask: stored.currentTask,
      liveOutput: stored.liveOutput,
      spawnedAt: new Date(stored.spawnedAt),
      completedAt: stored.completedAt ? new Date(stored.completedAt) : undefined,
      error: stored.error,
      events: new EventEmitter() // Create new emitter for display
    })) || [],
    subAgentsSectionExpanded: (resumeSession?.subAgents?.length || 0) > 0, // Auto-expand if agents exist

    expandedAgentIds: new Set(),
    expandedChipId: null,
    // Theme state
    currentTheme: getInitialTheme(),
    showThemePicker: false,
    selectedThemeIndex: DEFAULT_THEMES.findIndex((t) => t.name === getInitialTheme().name),
    // Status bar popup state
    activeStatusPopup: null,
    selectedPopupIndex: 0,
    // Agent message pagination state
    agentMessagesVisible: new Map(),
    expandedAgentMessageIds: new Set(),
    activeAgentTabId: null,
    // Agent panel resize state
    agentPanelHeight: 15, // Default 15 rows for agent panel
    isDraggingResize: false,
    dragStartY: null,
    dragStartHeight: null,
    // Session switching state
    pendingSessionSwitch: undefined
  });

  // Initialize session data ref if resuming
  const sessionDataRef = useRef<SessionData | null>(resumeSession || null);

  const [session, setSession] = useState<AgentSessionHandle | null>(null);
  const sessionRef = useRef<AgentSessionHandle | null>(null);
  const [inputSegments, setInputSegments] = useState<InputSegment[]>([{ type: 'text', text: '' }]);

  // Fast Mode Orchestrator - triages and delegates to sub-agents
  const orchestratorRef = useRef<FastModeCoordinator | null>(null);
  const activeOrchestrationContextIdRef = useRef<string | null>(null);

  // Smart message queue
  const messageQueueRef = useRef<SmartMessageQueue>(new SmartMessageQueue(30_000, TODOS_FILE));

  // Buffer for accumulating streamed tool input JSON
  const toolInputBuffersRef = useRef<Map<string, string>>(new Map());

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

    // Save sub-agent conversations
    sessionDataRef.current.subAgents = state.subAgents.map((agent) => ({
      id: agent.id,
      model: agent.model,
      status: agent.status,
      currentTask: agent.currentTask,
      liveOutput: agent.liveOutput,
      spawnedAt: agent.spawnedAt.toISOString(),
      completedAt: agent.completedAt?.toISOString(),
      error: agent.error
    }));

    try {
      await saveSession(sessionDataRef.current);
      debugLog(`Session auto-saved: ${sessionDataRef.current.sessionId}`);
    } catch (err) {
      debugLog(`Failed to auto-save session: ${err}`);
    }
  }, [state.messages, state.inputTokens, state.outputTokens, state.currentModel, state.subAgents]);

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

  // KITT animation state (Knight Rider style moving light)
  const [kittPosition, setKittPosition] = useState(0);
  const [kittDirection, setKittDirection] = useState<'right' | 'left'>('right');
  const [kittPauseFrames, setKittPauseFrames] = useState(0); // Pause at edges
  const kittWidth = 8; // Width of the KITT animation bar
  // Theme search
  const [themeSearch, setThemeSearch] = useState('');
  // Preview theme for live preview while scrolling through themes
  const [previewTheme, setPreviewTheme] = useState<Theme | null>(null);
  // Active theme is either the preview (while browsing) or the selected theme
  const activeTheme = previewTheme || state.currentTheme;

  // Available models and providers
  const models = [
    { id: 'fast', name: 'Haiku (Fast)', display: 'fast' },
    { id: 'smart-sonnet', name: 'Sonnet (Smart)', display: 'smart-sonnet' },
    { id: 'smart-opus', name: 'Opus (Advanced)', display: 'smart-opus' },
    { id: 'auto', name: 'Auto (Orchestrated)', display: 'auto' }
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

  // KITT animation effect - runs when there's activity
  const isActivityHappening = state.isResponding ||
    state.thinkingSessions.some(s => !s.endTime) ||
    !!state.currentTool;

  // Extended range for off-screen fade effect (pulse goes beyond visible area)
  const kittExtended = kittWidth + 6; // Extra positions for trail fade-out

  useEffect(() => {
    if (!isActivityHappening) {
      // Reset position when no activity
      setKittPosition(0);
      setKittDirection('right');
      setKittPauseFrames(0);
      return;
    }

    // Animate the KITT position (extended range for off-screen effect)
    const interval = setInterval(() => {
      // Handle pause at edges
      if (kittPauseFrames > 0) {
        setKittPauseFrames(prev => prev - 1);
        return;
      }

      setKittPosition(prev => {
        if (kittDirection === 'right') {
          if (prev >= kittExtended) {
            setKittDirection('left');
            setKittPauseFrames(4); // Pause for 4 frames at right edge
            return prev;
          }
          return prev + 1;
        } else {
          if (prev <= -6) { // Go off the left edge too
            setKittDirection('right');
            setKittPauseFrames(4); // Pause for 4 frames at left edge
            return prev;
          }
          return prev - 1;
        }
      });
    }, 80); // 80ms interval for smooth animation

    return () => clearInterval(interval);
  }, [isActivityHappening, kittDirection, kittExtended, kittPauseFrames]);

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
        const tools = AiToolsService.create(process.cwd());
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
        const comps = await getCompletionsWithAgents(inputSegments, state.subAgents);
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
  }, [inputSegments, state.subAgents]);

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

                // Initialize input buffer for this tool
                toolInputBuffersRef.current.set(tool.id, '');

                return {
                  currentTool: tool.name,
                  currentToolId: tool.id,
                  usedToolsInCurrentResponse: new Set([...prev.usedToolsInCurrentResponse, tool.name]),
                  messages: [...prev.messages, toolMessage]
                };
              });
            },

            onToolInputDelta: (data: { index: number; toolId: string; delta: string }) => {
              // Accumulate the streamed JSON input
              const current = toolInputBuffersRef.current.get(data.toolId) || '';
              toolInputBuffersRef.current.set(data.toolId, current + data.delta);
            },

            onContentBlockStop: (data: { index: number; toolId?: string }) => {
              if (data.toolId) {
                const jsonStr = toolInputBuffersRef.current.get(data.toolId);
                if (jsonStr) {
                  try {
                    const parsedInput = JSON.parse(jsonStr);
                    // Update the tool message with the complete input
                    updateState((prev) => ({
                      messages: prev.messages.map((msg) =>
                        msg.toolId === data.toolId
                          ? { ...msg, toolInput: parsedInput }
                          : msg
                      )
                    }));
                  } catch {
                    debugLog(`Failed to parse tool input JSON for ${data.toolId}`);
                  }
                  // Clean up buffer
                  toolInputBuffersRef.current.delete(data.toolId);
                }
              }
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

            // Always keep the agents panel in sync (liveOutput updates are held on the agent objects)
            updateState({ subAgents: orchestrator.getSubAgents() });

            if (event.type === 'toolStart') {
              updateState({ currentTool: event.toolName });
            } else if (event.type === 'toolComplete') {
              updateState({ currentTool: undefined });
            } else if (event.type === 'failed') {
              updateState((prev) => ({
                messages: [
                  ...prev.messages,
                  { role: 'system', content: `[x] Agent error: ${event.error}`, timestamp: new Date() }
                ]
              }));
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

    // Auto/orchestrated mode: smart queue injection targets the direct session only.
    if (state.currentModel === 'auto') {
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
  }, [state.isResponding, state.currentModel]);

  const handleSubmit = useCallback(
    async (segments: InputSegment[]) => {
      const displayText = segmentsToDisplayString(segments).trim();
      if (!displayText) return;

      // Handle pending session switch
      if (state.pendingSessionSwitch?.prompted) {
        const selection = displayText.toLowerCase().trim();
        if (selection === '0' || selection === 'cancel') {
          updateState((prev) => ({
            pendingSessionSwitch: undefined,
            messages: [
              ...prev.messages,
              { role: 'system', content: '[✗] Session switch cancelled.', timestamp: new Date() }
            ]
          }));
          setInputSegments([{ type: 'text', text: '' }]);
          setCursorPosition(0);
          return;
        }

        const idx = parseInt(selection) - 1;
        const sessions = state.pendingSessionSwitch.availableSessions;
        if (idx >= 0 && idx < sessions.length) {
          const selectedSession = sessions[idx];
          if (selectedSession.sessionId === sessionDataRef.current?.sessionId) {
            updateState((prev) => ({
              pendingSessionSwitch: undefined,
              messages: [
                ...prev.messages,
                { role: 'system', content: '[ℹ] Already in this session.', timestamp: new Date() }
              ]
            }));
            setInputSegments([{ type: 'text', text: '' }]);
            setCursorPosition(0);
            return;
          }

          // Auto-save current session
          if (sessionDataRef.current) {
            await autoSaveSession();
            await completeSession(sessionDataRef.current);
          }

          // Load the selected session
          try {
            const newSession = await loadSession(selectedSession.filePath);
            if (newSession) {
              sessionDataRef.current = newSession;
              // Reset state with new session
              const newMessages: Message[] = [
                { role: 'system', content: LOGO, timestamp: new Date() },
                { role: 'system', content: generateStartupBanner(newSession.model, process.cwd(), authType, newSession.sessionId), timestamp: new Date(), isBanner: true },
                { role: 'system', content: `[↻] Switched to session ${newSession.sessionId.slice(0, 8)}... (${newSession.messages.length} messages)`, timestamp: new Date() },
                ...newSession.messages.map((m) => ({
                  role: m.role,
                  content: m.content,
                  timestamp: new Date(m.timestamp),
                  toolName: m.toolName,
                  toolInput: m.toolInput,
                  toolResult: m.toolResult,
                  isCollapsed: m.role === 'tool'
                }))
              ];

              updateState((prev) => ({
                pendingSessionSwitch: undefined,
                messages: newMessages,
                sessionId: newSession.sessionId,
                currentModel: newSession.model,
                inputTokens: newSession.inputTokens,
                outputTokens: newSession.outputTokens
              }));
            }
          } catch (err) {
            updateState((prev) => ({
              pendingSessionSwitch: undefined,
              messages: [
                ...prev.messages,
                { role: 'system', content: `[✗] Failed to load session: ${err instanceof Error ? err.message : 'Unknown error'}`, timestamp: new Date() }
              ]
            }));
          }
          setInputSegments([{ type: 'text', text: '' }]);
          setCursorPosition(0);
          return;
        } else {
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: `[✗] Invalid selection. Please enter a number between 1 and ${sessions.length}.`, timestamp: new Date() }
            ]
          }));
          setInputSegments([{ type: 'text', text: '' }]);
          setCursorPosition(0);
          return;
        }
      }

      // If Claude is responding, queue the message instead of sending
      if (state.isResponding && !displayText.startsWith('/')) {
        // Auto/orchestrated mode: avoid injecting into the direct session.
        // Urgent messages stop the orchestration; other messages are rejected for now.
        if (state.currentModel === 'auto') {
          const urgent =
            /^(NO|STOP|WAIT|DONT|DON'T|NEVER|CANCEL|ABORT|!!|CRITICAL|URGENT|ERROR|ALERT)/i.test(displayText);

          if (urgent) {
            const orchId = activeOrchestrationContextIdRef.current;
            if (orchId && orchestratorRef.current) {
              void orchestratorRef.current.interruptContext(orchId, 'Urgent user message');
              activeOrchestrationContextIdRef.current = null;
            }

            updateState((prev) => ({
              messages: [
                ...prev.messages,
                { role: 'system', content: `[!] Stopping Auto orchestration: ${displayText}`, timestamp: new Date() }
              ]
            }));

            setInputSegments([{ type: 'text', text: '' }]);
            setCursorPosition(0);
            return;
          }

          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: '[i] Auto mode does not support queued messages yet. Wait for completion or press Ctrl+X×2 to stop.', timestamp: new Date() }
            ]
          }));
          setInputSegments([{ type: 'text', text: '' }]);
          setCursorPosition(0);
          return;
        }

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
/model <name>   - Switch model (auto/fast/haiku/sonnet/opus)
/theme          - Open theme picker
/sessions       - List saved sessions
/session        - Switch to another session
/logout         - Clear authentication
/toggle-grey-tools - Toggle greying out finished tools

[AI Tools]:
/search <query> - Semantic code search (MGrep)
/diagnose <file>- Get LSP diagnostics for file
/apply <patch>  - Apply code patch (FastApply)

[!] Bash Mode:
!<command>      - Execute shell command (e.g., !ls -la, !git status)

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

      // Handle /session - switch to another session
      if (displayText === '/session') {
        const allSessions = await listSessions();

        if (allSessions.length <= 1) {
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: '[ℹ] No other sessions available to switch to.', timestamp: new Date() }
            ]
          }));
          setInputSegments([{ type: 'text', text: '' }]);
          setCursorPosition(0);
          return;
        }

        // List all sessions with indices for user selection
        let sessionsList = '[🔄] Select a session to switch to:\n\n';
        for (let i = 0; i < allSessions.length; i++) {
          const s = allSessions[i];
          const isCurrent = sessionDataRef.current?.sessionId === s.sessionId;
          const current = isCurrent ? ' ← current' : '';
          const status = s.status === 'active' ? '●' : '○';
          const date = new Date(s.updatedAt).toLocaleDateString();
          const time = new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          sessionsList += `  ${i + 1}. ${status} [${s.sessionId.slice(0, 8)}] ${date} ${time} - ${s.messageCount} msgs${current}\n`;
          sessionsList += `     ${s.preview}\n`;
        }
        sessionsList += `\nEnter session number (1-${allSessions.length}) or 0 to cancel:`;

        updateState((prev) => ({
          messages: [
            ...prev.messages,
            { role: 'system', content: sessionsList, timestamp: new Date() }
          ],
          pendingSessionSwitch: {
            availableSessions: allSessions,
            prompted: true
          }
        }));
        setInputSegments([{ type: 'text', text: '' }]);
        setCursorPosition(0);
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
          thinkingSessions: [],
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

      // Handle /toggle-grey-tools
      if (displayText === '/toggle-grey-tools') {
        updateState((prev) => {
          const newSetting = !prev.greyOutFinishedTools;
          return {
            greyOutFinishedTools: newSetting,
            messages: [
              ...prev.messages,
              {
                role: 'system',
                content: `[+] Grey out finished tools: ${newSetting ? 'enabled' : 'disabled'}`,
                timestamp: new Date()
              }
            ]
          };
        });
        return;
      }

      // Handle /model
      if (displayText.startsWith('/model ')) {
        const modelArg = displayText.slice(7).trim();
        const modelMap: Record<string, 'auto' | 'fast' | 'smart-sonnet' | 'smart-opus'> = {
          auto: 'auto',
          orchestrated: 'auto',
          fast: 'fast',
          haiku: 'fast',
          sonnet: 'smart-sonnet',
          opus: 'smart-opus'
        };
        const model = modelMap[modelArg.toLowerCase()];
        if (model) {
          try {
            if (model !== 'auto') {
              await session?.setModel(model);
            }
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
                content: '[i] Unknown model. Use: auto, fast, haiku, sonnet, or opus',
                timestamp: new Date()
              }
            ]
          }));
        }
        return;
      }

      // Handle /theme command
      if (displayText === '/theme') {
        updateState((prev) => ({
          showThemePicker: true,
          messages: [
            ...prev.messages,
            { role: 'system', content: '[*] Opening theme picker... Use ↑↓ to select, Enter to apply, Esc to cancel', timestamp: new Date() }
          ]
        }));
        return;
      }

      // Handle /theme <name> direct switch
      if (displayText.startsWith('/theme ')) {
        const themeName = displayText.slice(7).trim().toLowerCase();
        const themeIndex = DEFAULT_THEMES.findIndex((t) => t.name.toLowerCase() === themeName);
        if (themeIndex !== -1) {
          saveThemeName(DEFAULT_THEMES[themeIndex].name); // Persist theme choice
          updateState((prev) => ({
            currentTheme: DEFAULT_THEMES[themeIndex],
            selectedThemeIndex: themeIndex,
            messages: [
              ...prev.messages,
              { role: 'system', content: `[+] Switched to "${DEFAULT_THEMES[themeIndex].name}" theme`, timestamp: new Date() }
            ]
          }));
        } else {
          const available = DEFAULT_THEMES.map((t) => t.name).join(', ');
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: `[i] Unknown theme. Available: ${available}`, timestamp: new Date() }
            ]
          }));
        }
        return;
      }

      // Handle ! bash mode - execute shell commands directly
      if (displayText.startsWith('!')) {
        const bashCmd = displayText.slice(1).trim();
        if (!bashCmd) {
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: '[i] Usage: !<command> (e.g., !ls -la, !git status)', timestamp: new Date() }
            ]
          }));
          return;
        }

        // Show command being executed
        updateState((prev) => ({
          messages: [
            ...prev.messages,
            { role: 'user', content: `$ ${bashCmd}`, timestamp: new Date() }
          ]
        }));

        try {
          const { execSync } = await import('child_process');
          const output = execSync(bashCmd, {
            cwd: process.cwd(),
            encoding: 'utf-8',
            timeout: 30000,
            maxBuffer: 1024 * 1024 * 10 // 10MB
          });
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: output || '[done]', timestamp: new Date() }
            ]
          }));
        } catch (err: unknown) {
          const error = err as { stdout?: string; stderr?: string; message?: string };
          const errorOutput = error.stderr || error.stdout || error.message || 'Command failed';
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: `[x] ${errorOutput}`, timestamp: new Date() }
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

        // Check for @agent-id routing (e.g., @haiku-1 "your message")
        const { agentIds, cleanContent } = extractAgentReferences(messageContent, state.subAgents);
        if (agentIds.length > 0) {
          // Route to specific agent(s)
          const orchestrator = orchestratorRef.current;
          if (!orchestrator) {
            throw new Error('Orchestrator not initialized - agents not available');
          }

          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: `[→] Routing to ${agentIds.join(', ')}`, timestamp: new Date() }
            ],
            subAgentsSectionExpanded: true
          }));

          // Send to each referenced agent
          for (const agentId of agentIds) {
            const agent = state.subAgents.find((a) => a.id === agentId);
            if (agent?.sessionHandle) {
              await agent.sessionHandle.sendMessage({
                role: 'user',
                content: cleanContent
              });
            }
          }

          debugLog('Message sent to agents:', agentIds);
          return; // Don't send to main session
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

        // 🚀 EPIC SHORT-CIRCUIT: Skip orchestration for trivial/conversational messages
        // Detect simple greetings, acknowledgments, and short messages that don't need multi-agent orchestration
        const trimmedContent = messageContent.trim();
        const isTrivialMessage =
          trimmedContent.length < 50 && // Short message
          /^(hi|hello|hey|thanks?|thank you|ok|okay|yes|no|sure|great|cool|bye|goodbye)\b/i.test(trimmedContent) && // Conversational
          segments.filter(s => s.type === 'chip').length === 0; // No file references

        const shouldOrchestrate = !modelOverride && state.currentModel === 'auto' && !isTrivialMessage;

        // If trivial message in auto mode, use fast model directly
        if (!modelOverride && state.currentModel === 'auto' && isTrivialMessage) {
          debugLog('Trivial message detected, bypassing orchestration and using Haiku directly');
          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: '[⚡] Quick reply mode (Haiku)', timestamp: new Date() }
            ]
          }));

          if (!session) {
            throw new Error('No session available');
          }

          // Temporarily switch to fast model for this message
          await session.setModel('fast');
          await session.sendMessage({ role: 'user', content: messageContent });
          // Model will be restored by response handler if needed
        } else if (shouldOrchestrate) {
          const orchestrator = orchestratorRef.current;
          if (!orchestrator) {
            throw new Error('Orchestrator not initialized');
          }

          updateState((prev) => ({
            messages: [
              ...prev.messages,
              { role: 'system', content: '[A] Orchestrating… (open Agents panel to watch)', timestamp: new Date() }
            ],
            subAgentsSectionExpanded: true
          }));

          const referencedFiles = segments
            .filter((s) => s.type === 'chip')
            .map((s) => (s as { type: 'chip'; chip: FileChip }).chip.filePath);

          const recentMessages = state.messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .slice(-12)
            .map((m) => ({ role: m.role, content: m.content }));

          const { contextId, done } = await orchestrator.start({
            content: messageContent,
            priority: 'NORMAL',
            context: {
              files: referencedFiles,
              previousMessages: recentMessages
            }
          });

          activeOrchestrationContextIdRef.current = contextId;

          done
            .then((response) => {
              activeOrchestrationContextIdRef.current = null;
              updateState((prev) => ({
                isResponding: false,
                currentTool: undefined,
                usedToolsInCurrentResponse: new Set(),
                messages: [
                  ...prev.messages,
                  { role: 'assistant', content: response, timestamp: new Date(), model: 'auto' }
                ]
              }));
            })
            .catch((err) => {
              activeOrchestrationContextIdRef.current = null;
              updateState((prev) => ({
                isResponding: false,
                messages: [
                  ...prev.messages,
                  { role: 'system', content: `[x] Orchestration error: ${String(err)}`, timestamp: new Date() }
                ]
              }));
            });
        } else {
          if (!session) {
            throw new Error('No session available');
          }
          debugLog('Using direct session...');
          await session.sendMessage({ role: 'user', content: messageContent });
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
    [session, state.isResponding, state.aiTools, state.contextChips, state.currentModel, state.messages]
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

    // Ctrl+C to quit - first press clears input, second press quits
    if (key.ctrl && key.name === 'c') {
      const hasInput = inputSegments.length > 1 ||
                      (inputSegments.length === 1 && inputSegments[0].type === 'text' && inputSegments[0].text !== '');

      if (hasInput && !ctrlCPressedOnce) {
        // First press with input - clear the input line
        debugLog('Ctrl+C pressed, clearing input');
        setInputSegments([{ type: 'text', text: '' }]);
        setCursorPosition(0);
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
        const rawClipboardText =
          process.platform === 'darwin' ?
            execSync('pbpaste', { encoding: 'utf-8' })
          : execSync('xclip -selection clipboard -o', { encoding: 'utf-8' });

        const clipboardText = SecurityValidator.sanitizeClipboard(rawClipboardText);

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
          const orchId = activeOrchestrationContextIdRef.current;
          if (orchId && orchestratorRef.current) {
            void orchestratorRef.current.interruptContext(orchId, 'User requested stop');
            activeOrchestrationContextIdRef.current = null;
            updateState({ isResponding: false, currentTool: undefined });
          } else {
            void session?.interrupt();
          }
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
    if (showModelDialog && (key.name === 'return' || key.name === 'space') && !key.shift) {
      const selected = models[selectedModelIndex];
      switchModel(selected.display as 'auto' | 'fast' | 'smart-sonnet' | 'smart-opus', session, updateState);
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
    if (showProviderDialog && (key.name === 'return' || key.name === 'space') && !key.shift) {
      updateState((prev) => ({
        messages: [
          ...prev.messages,
          {
            role: 'system',
            content: `[i] Provider switching not implemented yet (Anthropic only). Selected: ${providers[selectedProviderIndex].name}`,
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
      setPreviewTheme(null); // Clear preview on escape
      updateState({ showThemePicker: false, activeStatusPopup: null });
      return;
    }

    // Handle Theme Picker search typing
    if (state.showThemePicker && key.sequence && !key.ctrl && !key.meta) {
      if (key.name === 'backspace') {
        setThemeSearch(prev => prev.slice(0, -1));
        return;
      }
      // Only allow alphanumeric, space, dash, and underscore
      if (key.sequence.match(/^[a-zA-Z0-9 \-_]$/)) {
        setThemeSearch(prev => prev + key.sequence);
        return;
      }
    }

    // Handle Theme Picker navigation with live preview (use filtered list)
    if (state.showThemePicker && (key.name === 'up' || key.name === 'down')) {
      const filteredThemes = DEFAULT_THEMES.filter(t =>
        t.name.toLowerCase().includes(themeSearch.toLowerCase())
      );
      const currentIdx = filteredThemes.findIndex(t => t.name === state.currentTheme.name);
      const newIndex = key.name === 'up'
        ? (currentIdx - 1 + filteredThemes.length) % filteredThemes.length
        : (currentIdx + 1) % filteredThemes.length;
      const selectedTheme = filteredThemes[newIndex];
      setPreviewTheme(selectedTheme);
      updateState({ currentTheme: selectedTheme });
      return;
    }

    // Handle Theme Picker selection
    if (state.showThemePicker && (key.name === 'return' || key.name === 'space') && !key.shift) {
      setPreviewTheme(null);
      setThemeSearch('');
      updateState({ showThemePicker: false });
      return;
    }

    // Handle Status Bar Popup navigation (up/down)
    if (state.activeStatusPopup && (key.name === 'up' || key.name === 'down')) {
      const popupType = state.activeStatusPopup;
      let maxIndex = 0;

      if (popupType === 'model') maxIndex = models.length - 1;
      else if (popupType === 'mode') maxIndex = 1; // coding, planning

      if (key.name === 'up') {
        updateState((prev) => ({
          selectedPopupIndex: (prev.selectedPopupIndex - 1 + maxIndex + 1) % (maxIndex + 1)
        }));
      } else {
        updateState((prev) => ({
          selectedPopupIndex: (prev.selectedPopupIndex + 1) % (maxIndex + 1)
        }));
      }
      return;
    }

    // Handle Status Bar Popup selection (Enter/Space)
    if (state.activeStatusPopup && (key.name === 'return' || key.name === 'space') && !key.shift) {
      const popupType = state.activeStatusPopup;

      if (popupType === 'model') {
        updateState((prev) => ({
          currentModel: models[prev.selectedPopupIndex].display,
          activeStatusPopup: null
        }));
      } else if (popupType === 'mode') {
        const modes: Array<'coding' | 'planning'> = ['coding', 'planning'];
        updateState((prev) => ({
          agentMode: modes[prev.selectedPopupIndex],
          activeStatusPopup: null
        }));
      } else {
        // Close other popups on Enter
        updateState({ activeStatusPopup: null });
      }
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

    // Ctrl+O to toggle sub-agents section expansion
    if (key.ctrl && key.name === 'o') {
      updateState((prev) => ({
        subAgentsSectionExpanded: !prev.subAgentsSectionExpanded
      }));
      return;
    }

    // Ctrl+Shift+R to resize agent panel (cycle through sizes)
    if (key.ctrl && key.shift && key.name === 'r') {
      const sizes = [10, 15, 20, 25, 30];
      updateState((prev) => {
        const currentIndex = sizes.indexOf(prev.agentPanelHeight);
        const nextIndex = (currentIndex + 1) % sizes.length;
        return { agentPanelHeight: sizes[nextIndex] };
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
          setCursorPosition(1);
          return [...prev, { type: 'text', text: '\n' }];
        }
        // Insert newline at cursor position
        const text = lastSegment.text;
        const newText = text.slice(0, cursorPosition) + '\n' + text.slice(cursorPosition);
        setCursorPosition((p) => p + 1);
        return [...prev.slice(0, -1), { type: 'text', text: newText }];
      });
      return;
    }

    // If the terminal sends LF ("linefeed") via a keybind (e.g. Ghostty `shift+enter=text:\n`),
    // always treat it as inserting a newline
    if (key.name === 'linefeed') {
      setInputSegments((prev) => {
        const lastSegment = prev[prev.length - 1];
        if (!lastSegment || lastSegment.type !== 'text') {
          setCursorPosition(1);
          return [...prev, { type: 'text', text: '\n' }];
        }
        // Insert newline at cursor position
        const text = lastSegment.text;
        const newText = text.slice(0, cursorPosition) + '\n' + text.slice(cursorPosition);
        setCursorPosition((p) => p + 1);
        return [...prev.slice(0, -1), { type: 'text', text: newText }];
      });
      return;
    }

    // Return/Enter to submit (but not Shift+Enter)
    if ((key.name === 'return' || key.name === 'enter') && !key.shift) {
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

          // Remove the pattern from text and replace with space
          const textWithoutPattern = lastSegment.text.slice(0, -fullMatch.length);
          const newText = textWithoutPattern + ' ';
          setInputSegments((prev) => {
            const segments = [...prev.slice(0, -1)];
            // Add back the text (if any) with a space appended
            segments.push({ type: 'text', text: newText });
            return segments;
          });

          // Update cursor to be at the end of the new text (after the space)
          setCursorPosition(newText.length);

          // Add to active context chips
          updateState((prev) => ({ contextChips: [...prev.contextChips, newChip] }));
          return;
        }
      }

      // Fall through to regular space handling if no pattern matched
    }

    // Left arrow - move cursor left
    if (key.name === 'left' && !key.ctrl && !key.meta) {
      setCursorPosition((prev) => Math.max(0, prev - 1));
      return;
    }

    // Right arrow - move cursor right
    if (key.name === 'right' && !key.ctrl && !key.meta) {
      const textSegments = inputSegments.filter((s) => s.type === 'text');
      const lastTextSegment = textSegments[textSegments.length - 1];
      const maxPos = lastTextSegment ? lastTextSegment.text.length : 0;
      setCursorPosition((prev) => Math.min(maxPos, prev + 1));
      return;
    }

    // Home - move cursor to start
    if (key.name === 'home') {
      setCursorPosition(0);
      return;
    }

    // End - move cursor to end
    if (key.name === 'end') {
      const textSegments = inputSegments.filter((s) => s.type === 'text');
      const lastTextSegment = textSegments[textSegments.length - 1];
      const maxPos = lastTextSegment ? lastTextSegment.text.length : 0;
      setCursorPosition(maxPos);
      return;
    }

    // Backspace
    if (key.name === 'backspace' || key.name === 'delete') {
      setInputSegments((prev) => {
        if (prev.length === 0) return [{ type: 'text', text: '' }];

        const lastSegment = prev[prev.length - 1];

        // If cursor is at position 0, check if we should delete a chip
        if (cursorPosition === 0) {
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

          // At position 0 with text, nothing to delete
          if (lastSegment.type === 'text' && lastSegment.text.length === 0) {
            return prev;
          }
        }

        // If last segment is text, delete at cursor position
        if (lastSegment.type === 'text' && cursorPosition > 0) {
          const text = lastSegment.text;
          const newText = text.slice(0, cursorPosition - 1) + text.slice(cursorPosition);
          setCursorPosition((p) => Math.max(0, p - 1));
          if (newText === '' && prev.length > 1) {
            // Remove empty text segment
            const remaining = prev.slice(0, -1);
            return remaining;
          }
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

        // If last segment is text, insert at cursor position
        if (lastSegment && lastSegment.type === 'text') {
          const text = lastSegment.text;
          const newText = text.slice(0, cursorPosition) + effectiveChar + text.slice(cursorPosition);
          setCursorPosition((p) => p + 1);
          return [...prev.slice(0, -1), { type: 'text', text: newText }];
        }

        // If last segment is chip, create new text segment
        setCursorPosition(1);
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
      // Force a state update to trigger redraw
      updateState((prev) => ({ ...prev }));
    };
    process.stdout.on('resize', onResize);
    // Also handle SIGWINCH directly for better coverage
    process.on('SIGWINCH', onResize);
    return () => {
      process.stdout.off('resize', onResize);
      process.off('SIGWINCH', onResize);
    };
  }, [updateState]);

  // Calculate dynamic input height based on content
  const inputHeight = useMemo(() => {
    // Count newlines in text segments
    const textSegments = inputSegments.filter((s) => s.type === 'text');
    const totalText = textSegments.map((s) => s.text).join('');
    const lineCount = (totalText.match(/\n/g) || []).length + 1;

    // Base: 2 for borders + 1 for input line
    let height = 2 + lineCount;

    // Add 2 lines if context chips are present (for the chips row + separator)
    if (state.contextChips.length > 0) {
      height += 2;
    }

    return height;
  }, [inputSegments, state.contextChips.length]);

  // Calculate visible messages (with scroll offset) dynamically based on available lines
  // Use all messages - scrollbox handles viewport management
  const visibleMessages = state.messages;

  // Compute grouped tool activity for chips display
  const toolActivity = useMemo(() => extractToolActivity(state.messages, state.greyOutFinishedTools), [state.messages, state.greyOutFinishedTools]);

  // Compute input mode for visual feedback
  const inputMode = useMemo(() => {
    const text = segmentsToDisplayString(inputSegments);
    if (text.startsWith('!')) return 'bash';
    if (text.startsWith('/')) return 'command';
    return 'chat';
  }, [inputSegments]);

  // Get input border color based on mode (use theme color for default)
  const inputBorderColor = inputMode === 'bash' ? activeTheme.colors.error : inputMode === 'command' ? activeTheme.colors.warning : activeTheme.colors.inputBorder;
  const inputPrompt = inputMode === 'bash' ? '$ ' : '> ';

  return (
    <box style={{ flexDirection: 'column', height: '100%' }}>
      {/* Messages area */}
      <scrollbox
        stickyScroll
        stickyStart="bottom"
        scrollX={false}
        scrollbarOptions={{ visible: false }}
        verticalScrollbarOptions={{
          visible: state.messages.length > 10,
          trackOptions: { width: 1 }
        }}
        style={{
          flexGrow: 1,
          rootOptions: {
            flexGrow: 1,
            padding: 0,
            gap: 0,
            flexDirection: 'row',
            backgroundColor: 'transparent'
          },
          wrapperOptions: {
            flexGrow: 1,
            border: false,
            backgroundColor: 'transparent',
            flexDirection: 'column'
          },
          contentOptions: {
            flexDirection: 'column',
            gap: 0,
            justifyContent: 'flex-end',
            backgroundColor: 'transparent',
            paddingLeft: 1,
            paddingRight: 1,
            paddingTop: 1
          }
        }}
      >
        {(() => {
          // Group consecutive tool messages together for inline display
          const elements: React.ReactNode[] = [];
          let toolGroup: typeof visibleMessages = [];

          const flushToolGroup = () => {
            if (toolGroup.length === 0) return;

            // Aggregate tool messages by name
            const toolCounts = new Map<string, number>();
            toolGroup.forEach(msg => {
              const name = msg.toolName || 'tool';
              toolCounts.set(name, (toolCounts.get(name) || 0) + 1);
            });

            elements.push(
              <box
                key={`tool-group-${toolGroup[0].timestamp.getTime()}`}
                style={{ flexDirection: 'row', flexWrap: 'wrap', paddingLeft: 1, marginBottom: 1 }}
              >
                {Array.from(toolCounts.entries()).map(([name, count]) => (
                  <text
                    key={`tool-${name}-${toolGroup[0].timestamp.getTime()}`}
                    content={` ${name.toLowerCase()}${count > 1 ? ` x${count}` : ''} `}
                    fg="black"
                    bg={activeTheme.colors.toolChip}
                    style={{ marginRight: 1 }}
                  />
                ))}
              </box>
            );
            toolGroup = [];
          };

          visibleMessages.forEach((msg, i) => {
            const key = `${msg.timestamp.getTime()}-${msg.role}-${i}`;

            if (msg.role === 'tool') {
              toolGroup.push(msg);
              return;
            }

            // Flush any pending tool group before rendering non-tool message
            flushToolGroup();

            if (msg.role === 'user') {
              elements.push(
                <box key={key} style={{ flexDirection: 'column', marginBottom: 1 }}>
                  <box
                    style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 0, paddingBottom: 0 }}
                    bg="blackBright"
                  >
                    {renderMarkdown(msg.content)}
                  </box>
                </box>
              );
              return;
            }

            if (msg.role === 'assistant') {
              const modelDisplay = msg.model ? getModelDisplayFromPreference(msg.model) : null;

              elements.push(
                <box key={key} style={{ flexDirection: 'row', marginBottom: 1 }}>
                  <box
                    style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 0, paddingBottom: 0, flexGrow: 1 }}
                    bg="blackBright"
                    label={` Assistant ${modelDisplay ? `${modelDisplay}` : ''} `}
                    labelPosition="left"
                  >
                    {renderMarkdown(msg.content, 'gray')}
                  </box>
                </box>
              );
              return;
            }

            if (msg.role === 'system') {
              // Special styling for logo - no margin after logo
              const isLogo = msg.content.includes(',gggg,');
              if (isLogo) {
                elements.push(
                  <box key={key} style={{ marginBottom: 0 }}>
                    <text content={msg.content} fg={activeTheme.colors.primary} />
                  </box>
                );
                return;
              }

              // Special styling for startup banner - no margin after banner
              if (msg.isBanner) {
                elements.push(
                  <box key={key} style={{ marginBottom: 0 }}>
                    <text content={msg.content} fg={activeTheme.colors.accent} />
                  </box>
                );
                return;
              }

              // All other system messages get consistent spacing
              elements.push(
                <box key={key} style={{ marginBottom: 1 }}>
                  <text content={msg.content} fg={msg.content.includes('[↻]') || msg.content.startsWith('Keyboard:') ? activeTheme.colors.muted : activeTheme.colors.systemMessage} />
                </box>
              );
              return;
            }
          });

          // Flush any remaining tool group at the end
          flushToolGroup();

          return elements;
        })()}

        {/* Thinking content displayed in feed */}
        {state.thinkingSessions.length > 0 && (
          <box style={{ marginBottom: 1, flexDirection: 'column' }}>
            {state.thinkingSessions.map((session) => {
              const isActive = !session.endTime;
              const isExpanded = state.expandedChipId === `thinking-${session.id}`;
              const elapsed = ((session.endTime || new Date()).getTime() - session.startTime.getTime()) / 1000;
              const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

              return (
                <box
                  key={`feed-thinking-${session.id}`}
                  style={{ flexDirection: 'column', marginBottom: 0 }}
                >
                  <box style={{ flexDirection: 'row' }}>
                    <text
                      content={isActive
                        ? ` ${spinnerFrames[brailleFrame % spinnerFrames.length]} `
                        : ' ✓ '
                      }
                      fg={isActive ? activeTheme.colors.highlight : activeTheme.colors.success}
                      bold
                    />
                    <text
                      content={`thought ${elapsed.toFixed(0)}s`}
                      fg="white"
                      bold={isActive}
                      style={{ cursor: 'pointer' }}
                      onMouseUp={() => {
                        updateState((prev) => ({
                          expandedChipId: prev.expandedChipId === `thinking-${session.id}` ? null : `thinking-${session.id}`
                        }));
                      }}
                    />
                    <text
                      content={isExpanded ? ' ▼' : ' ▶'}
                      fg="gray"
                      style={{ cursor: 'pointer' }}
                      onMouseUp={() => {
                        updateState((prev) => ({
                          expandedChipId: prev.expandedChipId === `thinking-${session.id}` ? null : `thinking-${session.id}`
                        }));
                      }}
                    />
                  </box>
                  {/* Expanded thinking content */}
                  {isExpanded && session.content && (
                    <box
                      style={{ paddingLeft: 2, marginTop: 0 }}
                    >
                      <text content={session.content.slice(-1000)} fg="gray" dim />
                    </box>
                  )}
                </box>
              );
            })}
          </box>
        )}

        {/* Currently running tool indicator */}
        {state.currentTool && (
          <box style={{ marginBottom: 1, flexDirection: 'row', paddingLeft: 1 }}>
            <text
              content={` ${brailleFrames[brailleFrame]} ${state.currentTool} `}
              fg="black"
              bg={activeTheme.colors.toolChipActive}
              bold
              style={{ marginRight: 1 }}
            />
          </box>
        )}

        {/* Context chips */}
        {state.contextChips.length > 0 && (
          <box style={{ marginBottom: 1, flexDirection: 'row', flexWrap: 'wrap', paddingLeft: 1 }}>
            {state.contextChips.map((chip) => {
              const prefix = chip.isInclude ? '+' : '-';
              return (
                <text
                  key={`inline-context-${chip.id}`}
                  content={` ${prefix}${chip.label} `}
                  fg="black"
                  bg="gray"
                  bold
                  style={{ marginRight: 1, cursor: 'pointer' }}
                  onMouseUp={() => {
                    // Remove chip when clicked
                    updateState((prev) => ({
                      contextChips: prev.contextChips.filter((c) => c.id !== chip.id)
                    }));
                    setInputSegments((prev) => prev.filter((seg) => seg.type !== 'context' || seg.context.id !== chip.id));
                  }}
                />
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
            style={{ marginTop: 1, paddingLeft: 1, paddingRight: 1 }}
          >
            <text content="[!] Press Ctrl+X again to stop" fg="red" bold />
          </box>
        )}
        {showQuitWarning && (
          <box
            border={true}
            borderStyle="rounded"
            borderColor="yellow"
            style={{ marginTop: 1, paddingLeft: 1, paddingRight: 1 }}
          >
            <text content="[!] Press Ctrl+C again to quit" fg="yellow" bold />
          </box>
        )}
      </scrollbox>

      {/* Download progress indicator */}
      {downloadProgress && (
        <box
          border={true}
          borderStyle="rounded"
          borderColor="blue"
          style={{ marginTop: 1, paddingLeft: 1, paddingRight: 1 }}
        >
          <text
            content={`[⬇] Downloading ${downloadProgress.variant}: ${downloadProgress.percent.toFixed(1)}% (${(downloadProgress.speed / 1024 / 1024).toFixed(1)} MB/s) ETA: ${downloadProgress.eta}s`}
            fg="blue"
          />
        </box>
      )}

      {/* BOXES MODE is now deprecated - tools are shown inline in the message flow */}


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
              style={{ flexDirection: 'column', paddingLeft: 1, paddingRight: 1, marginTop: 1, maxHeight: 10, flexShrink: 0 }}
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
      {state.subAgentsSectionExpanded && state.subAgents.length > 0 && (
        <>
          {/* Resize handle - drag up/down to resize */}
          <box
            style={{
              height: 1,
              backgroundColor: state.isDraggingResize ? 'cyan' : 'gray',
              cursor: 'ns-resize',
              flexShrink: 0
            }}
            onMouseDown={(event) => {
              if (event.shift) return; // Allow terminal selection on Shift+drag
              updateState({
                isDraggingResize: true,
                dragStartY: event.y,
                dragStartHeight: state.agentPanelHeight
              });
            }}
            onMouseMove={(event) => {
              if (!state.isDraggingResize || !state.dragStartY || !state.dragStartHeight) return;
              if (event.shift) return; // Allow terminal selection on Shift+drag

              // Calculate height change from mouse movement
              const deltaY = state.dragStartY - event.y; // Inverted: drag up = positive = taller
              const newHeight = Math.max(5, Math.min(40, state.dragStartHeight + deltaY));

              updateState({ agentPanelHeight: newHeight });
            }}
            onMouseUp={(event) => {
              if (state.isDraggingResize) {
                updateState({
                  isDraggingResize: false,
                  dragStartY: null,
                  dragStartHeight: null
                });
              }

              // Show "Copied" feedback if Shift was held
              if (event.shift) {
                updateState((prev) => ({
                  messages: [
                    ...prev.messages,
                    { role: 'system', content: '[✓] Copied', timestamp: new Date() }
                  ]
                }));
              }
            }}
          >
            <text
              content={`${'═'.repeat(3)} [${state.agentPanelHeight} rows${state.isDraggingResize ? ' - dragging...' : ' - drag to resize'}] ${'═'.repeat(Math.max(0, Math.min(terminalSize.columns, 120) - 35))}`}
              fg={state.isDraggingResize ? 'cyan' : 'gray'}
            />
          </box>

          <TabbedAgentMessageBlock
            agents={state.subAgents}
            activeAgentId={state.activeAgentTabId}
            visibleLineCount={state.agentMessagesVisible.get(state.activeAgentTabId || state.subAgents[0]?.id) || 20}
            maxHeight={state.agentPanelHeight}
            onSelectTab={(agentId) => {
              updateState((prev) => ({
                activeAgentTabId: agentId
              }));
            }}
            onShowMore={() => {
              updateState((prev) => {
                const activeId = prev.activeAgentTabId || prev.subAgents[0]?.id;
                const currentLines = prev.agentMessagesVisible.get(activeId) || 20;
                const newMap = new Map(prev.agentMessagesVisible);
                newMap.set(activeId, currentLines + 20);
                return { agentMessagesVisible: newMap };
              });
            }}
          />
        </>
      )}
      {/* Empty state when panel expanded but no agents */}
      {state.subAgentsSectionExpanded && state.subAgents.length === 0 && (
        <box
          style={{ marginBottom: 1, border: 'single', borderColor: 'gray', paddingLeft: 1, paddingRight: 1, paddingTop: 0, paddingBottom: 0, flexShrink: 0 }}
        >
          <text content="No agents running" fg="gray" />
          <text content="Click [-] or press Ctrl+O to close" fg="gray" />
        </box>
      )}

      {/* Mini agent preview - shown when panel collapsed but agents exist */}
      {!state.subAgentsSectionExpanded && state.subAgents.length > 0 && (
        <MiniAgentPreview
          agents={state.subAgents}
          theme={activeTheme}
          onExpand={() => {
            updateState((prev) => ({
              subAgentsSectionExpanded: true
            }));
          }}
        />
      )}

      {/* Input bar - grows dynamically based on content and chips */}
      <box border={true} borderStyle="rounded" borderColor={inputBorderColor} style={{ paddingLeft: 1, flexShrink: 0, height: inputHeight }}>
        {/* Top line: Context chips (only shown when chips exist) */}
        {state.contextChips.length > 0 && (
          <>
            <box style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {state.contextChips.map((chip, idx) => {
                const chipBg = chip.isInclude ? 'white' : 'red';
                const chipFg = chip.isInclude ? 'black' : 'white';
                return (
                  <React.Fragment key={`ctx-${chip.id}`}>
                    <text
                      content={` ${chip.label} × `}
                      bg={chipBg}
                      fg={chipFg}
                      bold={true}
                      onMouseUp={() => {
                        // Remove chip when clicked
                        updateState((prev) => ({
                          contextChips: prev.contextChips.filter((c) => c.id !== chip.id)
                        }));
                      }}
                    />
                    {idx < state.contextChips.length - 1 && <text content=" " />}
                  </React.Fragment>
                );
              })}
            </box>
            <text content="" />
          </>
        )}
        {/* Input area - in the middle */}
        {true ?
          <box style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <text content={inputPrompt} fg={inputBorderColor === 'gray' ? 'gray' : inputBorderColor} bold={inputMode !== 'chat'} />
            {(() => {
              // Check if empty (ignoring context chips)
              const textAndChipSegments = inputSegments.filter((s) => s.type !== 'context');
              const isEmpty = textAndChipSegments.length === 1 &&
                             textAndChipSegments[0].type === 'text' &&
                             textAndChipSegments[0].text === '';

              if (isEmpty) {
                return (
                  <>
                    <text content={cursorVisible ? '█' : ' '} fg="gray" />
                    <text
                      content=" Type your message... (Tab: complete, ↑↓: history, Ctrl+X×2: stop, Ctrl+C: quit)"
                      fg="#666666"
                    />
                  </>
                );
              }

              // Render text and file chip segments (not context chips - those are on top line)
              const nonContextSegments = inputSegments.filter((s) => s.type !== 'context');
              const isLastSegmentText = nonContextSegments[nonContextSegments.length - 1]?.type === 'text';
              return (
                <>
                  {nonContextSegments.map((segment, idx) => {
                    const isLastText = isLastSegmentText && idx === nonContextSegments.length - 1;

                    if (segment.type === 'text') {
                      // For the last text segment, render with cursor in correct position
                      if (isLastText) {
                        const text = segment.text;
                        // Check if text contains newlines for multi-line rendering
                        if (text.includes('\n')) {
                          return (
                            <React.Fragment key={`text-${idx}`}>
                              {renderMultilineText(text, 'white', cursorPosition, cursorVisible)}
                            </React.Fragment>
                          );
                        }
                        // Single-line text with cursor
                        const beforeCursor = text.slice(0, cursorPosition);
                        const afterCursor = text.slice(cursorPosition);
                        return (
                          <React.Fragment key={`text-${idx}`}>
                            <text content={beforeCursor} fg="white" />
                            <text content={cursorVisible ? '█' : ' '} fg="gray" />
                            <text content={afterCursor} fg="white" />
                          </React.Fragment>
                        );
                      }
                      // Non-last text segments - check for newlines
                      if (segment.text.includes('\n')) {
                        return (
                          <React.Fragment key={`text-${idx}`}>
                            {renderMultilineText(segment.text, 'white', -1, false)}
                          </React.Fragment>
                        );
                      }
                      return <text key={`text-${idx}`} content={segment.text} fg="white" />;
                    } else if (segment.type === 'chip') {
                      return (
                        <text
                          key={`chip-${segment.chip.id}`}
                          content={` ${segment.chip.label} × `}
                          bg={activeTheme.colors.highlight}
                          fg="black"
                          bold={true}
                          onMouseUp={() => {
                            // Remove chip when clicked
                            setInputSegments((prev) => prev.filter((_, i) => i !== idx));
                          }}
                        />
                      );
                    }
                    return null;
                  })}
                  {/* Cursor at end if last segment is not text */}
                  {!isLastSegmentText && <text content={cursorVisible ? '█' : ' '} fg="gray" />}
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
      <box style={{ paddingLeft: 1, paddingRight: 1, marginTop: 0, flexDirection: 'row', flexShrink: 0 }}>
        {/* KITT Animation - clickable to open theme picker */}
        {isActivityHappening ? (
          <box
            style={{ flexDirection: 'row' }}
            onMouseUp={() => updateState((prev) => ({
              showThemePicker: !prev.showThemePicker,
              selectedThemeIndex: DEFAULT_THEMES.findIndex(t => t.name === state.currentTheme.name)
            }))}
          >
            <text content="[" fg={activeTheme.colors.kittBracket} />
            {Array.from({ length: kittWidth }).map((_, i) => {
              // Calculate distance behind the leading position (directional trail)
              const behindDistance = kittDirection === 'right'
                ? kittPosition - i  // Trail is to the left when moving right
                : i - kittPosition; // Trail is to the right when moving left

              const isLit = i === kittPosition;
              const isInTrail = behindDistance > 0 && behindDistance <= kittWidth;

              // Character: lit=▰, trail=▱, off=·
              const char = isLit ? activeTheme.colors.kittLit : isInTrail ? activeTheme.colors.kittDim : activeTheme.colors.kittOff;

              // Fade trail color based on distance (1.0 at front, fading to 0.2)
              const fadeAmount = isLit ? 1.0 : isInTrail ? Math.max(0.2, 1.0 - (behindDistance * 0.12)) : 0;

              // Dim the hex color by mixing with black
              const dimColor = (hex: string, intensity: number): string => {
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);
                const nr = Math.round(r * intensity);
                const ng = Math.round(g * intensity);
                const nb = Math.round(b * intensity);
                return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
              };

              const color = isLit || isInTrail ? dimColor(activeTheme.colors.kittColor, fadeAmount) : 'gray';

              return (
                <text
                  key={`kitt-${i}`}
                  content={char}
                  fg={color}
                  dimmed={!isLit && !isInTrail}
                />
              );
            })}
            <text content="]" fg={activeTheme.colors.kittBracket} />
          </box>
        ) : (
          <text
            content={`[${activeTheme.colors.kittOff.repeat(kittWidth)}]`}
            fg={activeTheme.colors.muted}
            onMouseUp={() => updateState((prev) => ({
              showThemePicker: !prev.showThemePicker,
              selectedThemeIndex: DEFAULT_THEMES.findIndex(t => t.name === state.currentTheme.name)
            }))}
          />
        )}
        <text content=" | " fg={activeTheme.colors.separator} />
        {/* Mode indicator - 4 chars for consistency: CODE/PLAN/TOOL/AGNT */}
        <text
          content={
            state.currentTool ? 'TOOL' :
            state.isResponding ? 'AGNT' :
            state.agentMode === 'coding' ? 'CODE' : 'PLAN'
          }
          fg={
            state.activeStatusPopup === 'mode' ? activeTheme.colors.highlight :
            state.currentTool ? activeTheme.colors.toolChipActive :
            state.isResponding ? activeTheme.colors.success :
            activeTheme.colors.secondary
          }
          bold
          onMouseUp={() => {
            updateState((prev) => ({
              activeStatusPopup: prev.activeStatusPopup === 'mode' ? null : 'mode',
              selectedPopupIndex: state.agentMode === 'coding' ? 0 : 1
            }));
          }}
        />
        <text content=" | " fg={activeTheme.colors.separator} />
        {/* Agents - responsive */}
        {terminalSize.columns >= 100 && <text content="Agents: " fg={activeTheme.colors.muted} />}
        <text
          content={terminalSize.columns >= 100 ? (state.subAgentsSectionExpanded ? '[-]' : '[+]') : `${state.subAgentsSectionExpanded ? '[-]' : '[+]'}`}
          fg={activeTheme.colors.muted}
          onMouseUp={() => {
            updateState((prev) => ({
              subAgentsSectionExpanded: !prev.subAgentsSectionExpanded
            }));
          }}
        />
        <text
          content={`${state.subAgents.length}`}
          fg={activeTheme.colors.secondary}
          bold
          onMouseUp={() => {
            updateState((prev) => ({
              subAgentsSectionExpanded: !prev.subAgentsSectionExpanded
            }));
          }}
        />
        {state.queuedMessages > 0 && <text content=" | " fg={activeTheme.colors.separator} />}
        {state.queuedMessages > 0 && (
          <text content={`Q${state.queuedMessages}`} fg={activeTheme.colors.info} bold />
        )}
        <text content=" | " fg={activeTheme.colors.separator} />
        {/* Context - responsive */}
        {terminalSize.columns >= 100 && <text content="Context: " fg={activeTheme.colors.muted} />}
        {(() => {
          const MAX_CONTEXT = 200000;
          const total = state.inputTokens + state.outputTokens;
          const percentLeft = Math.max(0, Math.round(((MAX_CONTEXT - total) / MAX_CONTEXT) * 100));
          return (
            <text
              content={`${percentLeft}%`}
              fg={state.activeStatusPopup === 'context' ? activeTheme.colors.highlight : activeTheme.colors.secondary}
              bold
              onMouseUp={() => {
                updateState((prev) => ({
                  activeStatusPopup: prev.activeStatusPopup === 'context' ? null : 'context'
                }));
              }}
            />
          );
        })()}
        <text content=" (" fg={activeTheme.colors.muted} />
        <text content="↑" fg={activeTheme.colors.muted} />
        <text content={state.inputTokens.toLocaleString()} fg={activeTheme.colors.secondary} />
        <text content=" ↓" fg={activeTheme.colors.muted} />
        <text content={state.outputTokens.toLocaleString()} fg={activeTheme.colors.secondary} />
        <text content=")" fg={activeTheme.colors.muted} />
        {historyIndex !== -1 && (
          <>
            <text content=" | " fg={activeTheme.colors.separator} />
            <text content={`H${historyIndex + 1}/${history.length}`} fg={activeTheme.colors.muted} />
          </>
        )}
        {aiStats && (
          <box style={{ flexDirection: 'row' }}>
            <text content=" | " fg={activeTheme.colors.separator} />
            {/* LSP - responsive */}
            {terminalSize.columns >= 100 && <text content="LSP: " fg={activeTheme.colors.muted} />}
            <text
              content="●"
              fg={
                aiStats.watcher === 'off' ? activeTheme.colors.muted :
                aiStats.watcher === 'starting' ? activeTheme.colors.warning :
                aiStats.watcher === 'ready' ? activeTheme.colors.success :
                aiStats.watcher === 'watching' ? activeTheme.colors.info :
                aiStats.watcher === 'error' ? activeTheme.colors.error : activeTheme.colors.muted
              }
              onMouseUp={() => {
                updateState((prev) => ({
                  activeStatusPopup: prev.activeStatusPopup === 'lsp' ? null : 'lsp'
                }));
              }}
            />
            <text
              content={`${aiStats.lsp.activeServers}`}
              fg={state.activeStatusPopup === 'lsp' ? activeTheme.colors.highlight : activeTheme.colors.secondary}
              onMouseUp={() => {
                updateState((prev) => ({
                  activeStatusPopup: prev.activeStatusPopup === 'lsp' ? null : 'lsp'
                }));
              }}
            />
            <text content=" | " fg={activeTheme.colors.separator} />
            {/* IDX - responsive */}
            {terminalSize.columns >= 100 && <text content="Index: " fg={activeTheme.colors.muted} />}
            <text
              content={
                terminalSize.columns >= 100 ? (
                  aiStats.indexer.isIndexing ?
                    `${Math.round((aiStats.indexer.current / aiStats.indexer.total) * 100)}%`
                  : 'Ready'
                ) : (
                  aiStats.indexer.isIndexing ?
                    `IDX${Math.round((aiStats.indexer.current / aiStats.indexer.total) * 100)}%`
                  : '✓'
                )
              }
              fg={state.activeStatusPopup === 'idx' ? activeTheme.colors.highlight : aiStats.indexer.isIndexing ? activeTheme.colors.warning : activeTheme.colors.success}
              onMouseUp={() => {
                updateState((prev) => ({
                  activeStatusPopup: prev.activeStatusPopup === 'idx' ? null : 'idx'
                }));
              }}
            />
            <text content=" | " fg={activeTheme.colors.separator} />
            {/* Patch model */}
            <text
              content={aiStats.patchModel}
              fg={state.activeStatusPopup === 'patchModel' ? activeTheme.colors.highlight : activeTheme.colors.muted}
              onMouseUp={() => {
                updateState((prev) => ({
                  activeStatusPopup: prev.activeStatusPopup === 'patchModel' ? null : 'patchModel'
                }));
              }}
            />
          </box>
        )}
        {/* Model selector - far right, responsive */}
        <box style={{ flexGrow: 1 }} />
        {terminalSize.columns >= 100 && <text content="Model: " fg={activeTheme.colors.muted} />}
        <text
          content={
            terminalSize.columns >= 100 ?
              getModelDisplayFromPreference(state.currentModel) :
              (state.currentModel === 'auto' ? 'A' : getModelDisplayFromPreference(state.currentModel).charAt(0))
          }
          fg={state.activeStatusPopup === 'model' ? activeTheme.colors.highlight : activeTheme.colors.primary}
          bold
          onMouseUp={() => {
            updateState((prev) => ({
              activeStatusPopup: prev.activeStatusPopup === 'model' ? null : 'model',
              selectedPopupIndex: models.findIndex(m => m.id === state.currentModel)
            }));
          }}
        />
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
            backgroundColor: activeTheme.colors.background
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
            height: models.length + 4,
            flexDirection: 'column',
            zIndex: 1000,
            backgroundColor: activeTheme.colors.background
          }}
          border={true}
          borderStyle="rounded"
          borderColor={activeTheme.colors.border}
        >
          {/* Header row with title and close button */}
          <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1, marginBottom: 1 }}>
            <text content="Select Model" fg={activeTheme.colors.muted} bold />
            <text
              content="×"
              fg={activeTheme.colors.muted}
              onMouseUp={() => setShowModelDialog(false)}
            />
          </box>
          {models.map((model, idx) => (
            <box
              key={model.id}
              style={{
                paddingLeft: 1,
                paddingRight: 1
              }}
            >
              <text
                content={selectedModelIndex === idx ? '▶ ' : '  '}
                fg={selectedModelIndex === idx ? activeTheme.colors.secondary : activeTheme.colors.muted}
              />
              <text
                content={model.name}
                fg={selectedModelIndex === idx ? activeTheme.colors.assistantMessage : activeTheme.colors.muted}
                bold={selectedModelIndex === idx}
              />
              <text content={state.currentModel === model.display ? ' ●' : ''} fg={activeTheme.colors.primary} />
            </box>
          ))}
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
            height: providers.length * 2 + 4,
            flexDirection: 'column',
            zIndex: 1000,
            backgroundColor: activeTheme.colors.background
          }}
          border={true}
          borderStyle="rounded"
          borderColor={activeTheme.colors.border}
        >
          {/* Header row with title and close button */}
          <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1, marginBottom: 1 }}>
            <text content="Select Provider" fg={activeTheme.colors.muted} bold />
            <text
              content="×"
              fg={activeTheme.colors.muted}
              onMouseUp={() => setShowProviderDialog(false)}
            />
          </box>
          {providers.map((provider, idx) => (
            <box
              key={provider.id}
              style={{
                paddingLeft: 1,
                paddingRight: 1,
                flexDirection: 'column'
              }}
            >
              <box>
                <text
                  content={selectedProviderIndex === idx ? '▶ ' : '  '}
                  fg={selectedProviderIndex === idx ? activeTheme.colors.secondary : activeTheme.colors.muted}
                />
                <text
                  content={provider.name}
                  fg={selectedProviderIndex === idx ? activeTheme.colors.assistantMessage : activeTheme.colors.muted}
                  bold={selectedProviderIndex === idx}
                />
              </box>
              <text content={`  ${provider.description}`} fg={activeTheme.colors.muted} />
            </box>
          ))}
        </box>
      )}

      {/* Theme Picker Dialog - centered and responsive */}
      {state.showThemePicker && (() => {
        const dialogWidth = 25;
        const maxVisibleThemes = 12;
        const dialogHeight = maxVisibleThemes + 5; // +5 for header, search input, borders
        const centerLeft = Math.max(0, Math.floor((terminalSize.columns - dialogWidth) / 2));
        const centerTop = Math.max(0, Math.floor((terminalSize.rows - dialogHeight) / 2));

        // Filter themes by search
        const filteredThemes = DEFAULT_THEMES.filter(t =>
          t.name.toLowerCase().includes(themeSearch.toLowerCase())
        );

        // Calculate scroll window
        const selectedIdx = filteredThemes.findIndex(t => t.name === state.currentTheme.name);
        const safeSelectedIdx = selectedIdx === -1 ? 0 : selectedIdx;
        const scrollStart = Math.max(0, Math.min(safeSelectedIdx - Math.floor(maxVisibleThemes / 2), filteredThemes.length - maxVisibleThemes));
        const visibleThemes = filteredThemes.slice(scrollStart, scrollStart + maxVisibleThemes);
        const hasScrollUp = scrollStart > 0;
        const hasScrollDown = scrollStart + maxVisibleThemes < filteredThemes.length;

        return (
          <box
            style={{
              position: 'absolute',
              left: centerLeft,
              top: centerTop,
              width: dialogWidth,
              height: dialogHeight,
              flexDirection: 'column',
              zIndex: 1001,
              backgroundColor: activeTheme.colors.background
            }}
            border={true}
            borderStyle="rounded"
            borderColor={activeTheme.colors.border}
          >
            {/* Header row */}
            <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1 }}>
              <text content="Themes" fg={activeTheme.colors.muted} bold />
              <text
                content="×"
                fg={activeTheme.colors.muted}
                onMouseUp={() => {
                  updateState({ showThemePicker: false });
                  setPreviewTheme(null);
                  setThemeSearch('');
                }}
              />
            </box>
            {/* Search input */}
            <box style={{ paddingLeft: 1, paddingRight: 1, marginBottom: 1 }}>
              <text content="Search: " fg={activeTheme.colors.muted} />
              <text content={themeSearch || '_'} fg={activeTheme.colors.secondary} />
            </box>
            {/* Scroll indicators */}
            <box style={{ paddingLeft: 1, paddingRight: 1, flexDirection: 'row', justifyContent: 'space-between' }}>
              <text content={`${filteredThemes.length} themes`} fg={activeTheme.colors.muted} />
              <box style={{ flexDirection: 'row' }}>
                {hasScrollUp && <text content="↑" fg={activeTheme.colors.secondary} />}
                {hasScrollDown && <text content="↓" fg={activeTheme.colors.secondary} />}
              </box>
            </box>
            {/* Theme list - scrollable, single column */}
            {visibleThemes.map((theme) => {
              const isCurrent = state.currentTheme.name === theme.name;
              return (
                <box
                  key={theme.name}
                  style={{
                    paddingLeft: 1,
                    paddingRight: 1,
                    flexDirection: 'row'
                  }}
                  onMouseUp={() => {
                    saveThemeName(theme.name);
                    updateState({
                      currentTheme: theme,
                      showThemePicker: false
                    });
                    setPreviewTheme(null);
                    setThemeSearch('');
                  }}
                  onMouseEnter={() => {
                    setPreviewTheme(theme);
                  }}
                >
                  <text
                    content={isCurrent ? '▸ ' : '  '}
                    fg={isCurrent ? theme.colors.primary : activeTheme.colors.muted}
                  />
                  <text
                    content={theme.name}
                    fg={isCurrent ? theme.colors.primary : activeTheme.colors.muted}
                    bold={isCurrent}
                  />
                  <text content={isCurrent ? ' ✓' : ''} fg={theme.colors.accent} />
                </box>
              );
            })}
          </box>
        );
      })()}

      {/* Status Bar Popups - appear above status bar */}

      {/* Model Selector Popup */}
      {state.activeStatusPopup === 'model' && (
        <box
          style={{
            position: 'absolute',
            right: 2,
            bottom: 2,
            width: 35,
            height: models.length + 4,
            flexDirection: 'column',
            zIndex: 1002,
            backgroundColor: activeTheme.colors.background
          }}
          border={true}
          borderStyle="rounded"
          borderColor={activeTheme.colors.border}
        >
          {/* Header row with title and close button */}
          <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1, marginBottom: 1 }}>
            <text content="Model" fg={activeTheme.colors.muted} bold />
            <text
              content="×"
              fg={activeTheme.colors.muted}
              onMouseUp={() => updateState({ activeStatusPopup: null })}
            />
          </box>
          {models.map((model, idx) => {
            const isSelected = state.selectedPopupIndex === idx;
            const isCurrent = state.currentModel === model.id;
            return (
              <box
                key={model.id}
                style={{ paddingLeft: 1, paddingRight: 1, flexDirection: 'row' }}
                onMouseUp={() => {
                  updateState({
                    currentModel: model.display,
                    activeStatusPopup: null
                  });
                }}
              >
                <text content={isSelected ? '▶ ' : '  '} fg={isSelected ? activeTheme.colors.secondary : activeTheme.colors.muted} />
                <text content={model.name} fg={isSelected ? activeTheme.colors.assistantMessage : activeTheme.colors.muted} bold={isSelected} />
                <text content={isCurrent ? ' ●' : ''} fg={activeTheme.colors.primary} />
              </box>
            );
          })}
        </box>
      )}

      {/* Mode Selector Popup */}
      {state.activeStatusPopup === 'mode' && (
        <box
          style={{
            position: 'absolute',
            left: 27,
            bottom: 2,
            width: 30,
            height: 6,
            flexDirection: 'column',
            zIndex: 1002,
            backgroundColor: activeTheme.colors.background
          }}
          border={true}
          borderStyle="rounded"
          borderColor={activeTheme.colors.border}
        >
          {/* Header row with title and close button */}
          <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1, marginBottom: 1 }}>
            <text content="Mode" fg={activeTheme.colors.muted} bold />
            <text
              content="×"
              fg={activeTheme.colors.muted}
              onMouseUp={() => updateState({ activeStatusPopup: null })}
            />
          </box>
          {(['coding', 'planning'] as const).map((mode, idx) => {
            const isSelected = state.selectedPopupIndex === idx;
            const isCurrent = state.agentMode === mode;
            return (
              <box
                key={mode}
                style={{ paddingLeft: 1, paddingRight: 1, flexDirection: 'row' }}
                onMouseUp={() => {
                  updateState({
                    agentMode: mode,
                    activeStatusPopup: null
                  });
                }}
              >
                <text content={isSelected ? '▶ ' : '  '} fg={isSelected ? activeTheme.colors.secondary : activeTheme.colors.muted} />
                <text content={mode.toUpperCase()} fg={isSelected ? activeTheme.colors.assistantMessage : activeTheme.colors.muted} bold={isSelected} />
                <text content={isCurrent ? ' ●' : ''} fg={activeTheme.colors.primary} />
              </box>
            );
          })}
        </box>
      )}

      {/* Context Status Popup */}
      {state.activeStatusPopup === 'context' && (
        <box
          style={{
            position: 'absolute',
            right: 5,
            bottom: 2,
            width: 55,
            height: 11,
            flexDirection: 'column',
            zIndex: 1002,
            backgroundColor: activeTheme.colors.background
          }}
          border={true}
          borderStyle="rounded"
          borderColor={activeTheme.colors.border}
        >
          {/* Header row with title and close button */}
          <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1 }}>
            <text content="Context Window" fg={activeTheme.colors.muted} bold />
            <text
              content="×"
              fg={activeTheme.colors.muted}
              onMouseUp={() => updateState({ activeStatusPopup: null })}
            />
          </box>
          {(() => {
            const MAX_CONTEXT = 200000;
            const total = state.inputTokens + state.outputTokens;
            const percentUsed = Math.round((total / MAX_CONTEXT) * 100);
            const percentLeft = 100 - percentUsed;
            const barWidth = 40;
            const filledWidth = Math.round((percentUsed / 100) * barWidth);
            const emptyWidth = barWidth - filledWidth;
            return (
              <>
                <box style={{ paddingLeft: 1 }}>
                  <text content="Usage: " fg={activeTheme.colors.muted} />
                  <text content={`${percentUsed}%`} fg={percentUsed > 80 ? activeTheme.colors.error : percentUsed > 50 ? activeTheme.colors.warning : activeTheme.colors.success} bold />
                  <text content={` (${percentLeft}% remaining)`} fg={activeTheme.colors.muted} />
                </box>
                <box style={{ paddingLeft: 1, marginTop: 1 }}>
                  <text content="[" fg={activeTheme.colors.muted} />
                  <text content={'█'.repeat(filledWidth)} fg={percentUsed > 80 ? activeTheme.colors.error : percentUsed > 50 ? activeTheme.colors.warning : activeTheme.colors.success} />
                  <text content={'░'.repeat(emptyWidth)} fg={activeTheme.colors.muted} />
                  <text content="]" fg={activeTheme.colors.muted} />
                </box>
                <box style={{ paddingLeft: 1, marginTop: 1 }}>
                  <text content="Input tokens:  " fg={activeTheme.colors.muted} />
                  <text content={state.inputTokens.toLocaleString()} fg={activeTheme.colors.secondary} bold />
                </box>
                <box style={{ paddingLeft: 1 }}>
                  <text content="Output tokens: " fg={activeTheme.colors.muted} />
                  <text content={state.outputTokens.toLocaleString()} fg={activeTheme.colors.secondary} bold />
                </box>
                <box style={{ paddingLeft: 1 }}>
                  <text content="Total:         " fg={activeTheme.colors.muted} />
                  <text content={total.toLocaleString()} fg={activeTheme.colors.secondary} bold />
                  <text content={` / ${MAX_CONTEXT.toLocaleString()}`} fg={activeTheme.colors.muted} />
                </box>
                <box style={{ marginTop: 1, paddingLeft: 1 }}>
                  <text content="Messages: " fg={activeTheme.colors.muted} />
                  <text content={`${state.messages.length}`} fg={activeTheme.colors.secondary} />
                </box>
              </>
            );
          })()}
        </box>
      )}

      {/* LSP Status Popup */}
      {state.activeStatusPopup === 'lsp' && aiStats && (
        <box
          style={{
            position: 'absolute',
            right: 25,
            bottom: 2,
            width: 50,
            height: 9,
            flexDirection: 'column',
            zIndex: 1002,
            backgroundColor: activeTheme.colors.background
          }}
          border={true}
          borderStyle="rounded"
          borderColor={activeTheme.colors.border}
        >
          {/* Header row with title and close button */}
          <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1 }}>
            <text content="LSP Status" fg={activeTheme.colors.muted} bold />
            <text
              content="×"
              fg={activeTheme.colors.muted}
              onMouseUp={() => updateState({ activeStatusPopup: null })}
            />
          </box>
          <box style={{ paddingLeft: 1, marginTop: 1 }}>
            <text content="Active Servers: " fg={activeTheme.colors.muted} />
            <text content={`${aiStats.lsp.activeServers}`} fg={activeTheme.colors.success} bold />
          </box>
          <box style={{ paddingLeft: 1 }}>
            <text content="Files w/ Diagnostics: " fg={activeTheme.colors.muted} />
            <text content={`${aiStats.lsp.filesWithDiagnostics}`} fg={activeTheme.colors.secondary} />
          </box>
          <box style={{ paddingLeft: 1, marginTop: 1 }}>
            <text content="Servers: " fg={activeTheme.colors.muted} />
          </box>
          <box style={{ paddingLeft: 2 }}>
            <text content="TypeScript, CSS, HTML, JSON" fg={activeTheme.colors.primary} />
          </box>
        </box>
      )}

      {/* IDX Status Popup */}
      {state.activeStatusPopup === 'idx' && aiStats && (
        <box
          style={{
            position: 'absolute',
            right: 15,
            bottom: 2,
            width: 55,
            height: 12,
            flexDirection: 'column',
            zIndex: 1002,
            backgroundColor: activeTheme.colors.background
          }}
          border={true}
          borderStyle="rounded"
          borderColor={activeTheme.colors.border}
        >
          {/* Header row with title and close button */}
          <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1 }}>
            <text content="Index Status" fg={activeTheme.colors.muted} bold />
            <text
              content="×"
              fg={activeTheme.colors.muted}
              onMouseUp={() => updateState({ activeStatusPopup: null })}
            />
          </box>
          <box style={{ paddingLeft: 1, marginTop: 1 }}>
            <text
              content={aiStats.indexer.isIndexing ? 'Indexing...' : 'Indexed'}
              fg={aiStats.indexer.isIndexing ? activeTheme.colors.warning : activeTheme.colors.success}
              bold
            />
          </box>
          {aiStats.indexer.isIndexing && (
            <box style={{ paddingLeft: 1 }}>
              <text content="Progress: " fg={activeTheme.colors.muted} />
              <text content={`${aiStats.indexer.current} / ${aiStats.indexer.total}`} fg={activeTheme.colors.secondary} />
              <text content={` (${aiStats.indexer.phase})`} fg={activeTheme.colors.primary} />
            </box>
          )}
          <box style={{ paddingLeft: 1, marginTop: 1 }}>
            <text content="Total Files:  " fg={activeTheme.colors.muted} />
            <text content={`${aiStats.indexer.totalFiles}`} fg={activeTheme.colors.secondary} bold />
          </box>
          <box style={{ paddingLeft: 1 }}>
            <text content="Total Chunks: " fg={activeTheme.colors.muted} />
            <text content={`${aiStats.indexer.totalChunks}`} fg={activeTheme.colors.secondary} bold />
          </box>
          <box style={{ paddingLeft: 1, marginTop: 1 }}>
            <text content="Test search: Type /search <query>" fg={activeTheme.colors.primary} />
          </box>
        </box>
      )}

      {/* Patch Model Popup */}
      {state.activeStatusPopup === 'patchModel' && aiStats && (
        <box
          style={{
            position: 'absolute',
            right: 5,
            bottom: 2,
            width: 50,
            height: 11,
            flexDirection: 'column',
            zIndex: 1002,
            backgroundColor: activeTheme.colors.background
          }}
          border={true}
          borderStyle="rounded"
          borderColor={activeTheme.colors.border}
        >
          {/* Header row with title and close button */}
          <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1 }}>
            <text content="AI Model" fg={activeTheme.colors.muted} bold />
            <text
              content="×"
              fg={activeTheme.colors.muted}
              onMouseUp={() => updateState({ activeStatusPopup: null })}
            />
          </box>
          <box style={{ paddingLeft: 1, marginTop: 1 }}>
            <text content="Model: " fg={activeTheme.colors.muted} />
            <text content={aiStats.patchModel} fg={activeTheme.colors.primary} bold />
          </box>
          <box style={{ paddingLeft: 1, marginTop: 1 }}>
            <text content="Provider: " fg={activeTheme.colors.muted} />
            <text content="Anthropic" fg={activeTheme.colors.secondary} />
          </box>
          <box style={{ paddingLeft: 1, marginTop: 1 }}>
            <text content="Capabilities:" fg={activeTheme.colors.muted} />
          </box>
          <box style={{ paddingLeft: 2 }}>
            <text content="• Code completion" fg={activeTheme.colors.secondary} />
          </box>
          <box style={{ paddingLeft: 2 }}>
            <text content="• Semantic search" fg={activeTheme.colors.secondary} />
          </box>
          <box style={{ paddingLeft: 2 }}>
            <text content="• Context-aware edits" fg={activeTheme.colors.secondary} />
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
      // Auto-resume the last active session (most recently updated)
      const lastSession = activeSessions[0];
      resumeSession = (await loadSession(lastSession.filePath)) || undefined;
      if (resumeSession) {
        console.log(`\n↻ Resuming session ${resumeSession.sessionId.slice(0, 8)}... (${lastSession.messageCount} messages)`);
        debugLog(`Auto-resuming last session: ${resumeSession.sessionId}`);
      }
    }
  } catch (err) {
    debugLog(`Error checking active sessions: ${err}`);
    // Continue with new session
  }

  if (!resumeSession) {
    console.log('\n✨ Starting new session...');
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
    useAlternateScreen: true, // Enabled for correct scroll wheel capture
    useThread: false, // Disable native threading - might cause event loop blocking
    targetFps: 24, // Reduced from 30 to minimize screen redraws
    debounceDelay: 100 // Increased from 50 to batch more updates together
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
  debugLog(`⏱️ Startup: session=${startupTimings.sessionSelection}ms, renderer=${startupTimings.renderer}ms, total=${startupTimings.preRender}ms`);

  const root = createRoot(renderer);
  const authType: 'oauth' | 'api-key' = oauthToken ? 'oauth' : 'api-key';
  root.render(
    <ChatApp
      apiKey={apiKey || undefined}
      oauthToken={oauthToken || undefined}
      resumeSession={resumeSession}
      authType={authType}
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
