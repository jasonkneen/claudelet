/**
 * ChatApp - Main application component
 */

import { execSync } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  createAuthManager,
  FastModeCoordinator,
  getModelDisplayFromPreference,
  MODEL_DISPLAY,
  parseModelOverride,
  SmartMessageQueue,
  startAgentSession,
  type AgentSessionHandle,
  type OrchestrationContext,
  type SubAgent,
  type SubAgentEvent
} from 'claude-agent-loop';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useKeyboard, useRenderer } from '@opentui/react';

import { clearAuth, loadAuth, saveAuth } from '../../../src/auth-storage.js';
import { useBatchedState } from '../../../src/hooks/useBatchedState.js';
import { isMarkdown, renderMarkdown } from '../../../src/markdown-renderer.js';
import { calculateAvailableRows, calculateVisibleMessages, type RenderableMessage } from '../../../src/message-pagination.js';
import { SecurityValidator } from '../../../src/security-validator.js';
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
} from '../../../src/session-storage.js';
import { sanitizeText } from '../../../src/env-sanitizer.js';
import { AiToolsService } from '../../claudelet-ai-tools.js';
import { debugLog, estimateTokenCount, extractAgentReferences, getAgentCompletions, getCommandCompletions, getPrintableCharFromKeyEvent, renderMultilineText, segmentsToDisplayString } from '../utils/index.js';
import { DEFAULT_THEMES, getInitialTheme, saveThemeName } from '../themes/index.js';
import { extractToolActivity, extractTodos, formatThinkingChip, generateStartupBanner, LOGO } from '../rendering/index.js';
import type { AppState, ContextChip, FileChip, InputSegment, Message } from '../types/index.js';
import { AgentMessageBlock } from './AgentMessageBlock.tsx';
import { CollapsibleSubAgentsSection } from './CollapsibleSubAgentsSection.tsx';
import { MiniAgentPreview } from './MiniAgentPreview.tsx';
import { SubAgentTaskBox } from './SubAgentTaskBox.tsx';
import { TabbedAgentMessageBlock } from './TabbedAgentMessageBlock.tsx';
import { ToolActivityBoxes } from './ToolActivityBoxes.tsx';
import { formatToolCall, type DiffLine } from '../rendering/tool-formatting.js';

// Constants from main file
const MAX_THINKING_TOKENS = 16_000;
const TODOS_FILE = '.todos.md';
const MAX_FILE_SIZE = 500_000;
const FILE_EXPLORER_PAGE_SIZE = 120;

// Render count tracking
let renderCount = 0;

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
          return '```' + seg.chip.label + '\\n' + content + '\\n```';
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

export const ChatApp: React.FC<{
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
          content: 'Keyboard: Tab autocomplete | ↑↓ history | Shift+Enter newline | Ctrl+E expand | Ctrl+B layout | Ctrl+M models\nCommands: /help /model /sessions /quit',
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
    subAgentsSectionExpanded: (resumeSession?.subAgents?.length || 0) > 0,
    contextSectionExpanded: true,
    todosSectionExpanded: true,
    toolsSectionExpanded: false,
    changesSectionExpanded: false,

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
    openedSubagentTabs: [] as string[],
    // Agent panel resize state
    agentPanelHeight: 15, // Default 15 rows for agent panel
    isDraggingResize: false,
    dragStartY: null,
    dragStartHeight: null,
    // Sidebar layout state
    leftSidebarOpen: true,
    rightSidebarOpen: true,
    leftSidebarWidth: 40,
    rightSidebarWidth: 40,
    isDraggingSidebar: null,
    dragStartX: null,
    dragStartLeftWidth: null,
    dragStartRightWidth: null,
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
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const [layoutMenuIndex, setLayoutMenuIndex] = useState(0);
  type SessionGroupLabel = 'Today' | 'Yesterday' | 'This Week' | 'Last Week' | 'Older';
  const [leftSidebarTab, setLeftSidebarTab] = useState<'sessions' | 'files'>('sessions');
  const [leftSidebarSessions, setLeftSidebarSessions] = useState<SessionSummary[]>([]);
  const [leftSidebarSessionsLoading, setLeftSidebarSessionsLoading] = useState(false);
  const [sessionGroupExpanded, setSessionGroupExpanded] = useState<Record<SessionGroupLabel, boolean>>({
    Today: true,
    Yesterday: false,
    'This Week': false,
    'Last Week': false,
    Older: false
  });
  const [fileExplorerEntries, setFileExplorerEntries] = useState<Record<string, FileExplorerEntry[]>>({});
  const [fileExplorerExpanded, setFileExplorerExpanded] = useState<Set<string>>(() => new Set([os.homedir()]));
  const [fileExplorerLoading, setFileExplorerLoading] = useState<Set<string>>(new Set());
  const [fileExplorerError, setFileExplorerError] = useState<Record<string, string>>({});
  const [fileExplorerHasMore, setFileExplorerHasMore] = useState<Record<string, boolean>>({});
  const [fileExplorerScrollOffset, setFileExplorerScrollOffset] = useState(0);
  const fileExplorerDirHandlesRef = useRef<Map<string, fs.Dir>>(new Map());

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

  const layoutMenuOptions = [
    { id: 'left', label: state.leftSidebarOpen ? 'Close Left Sidebar' : 'Open Left Sidebar' },
    { id: 'right', label: state.rightSidebarOpen ? 'Close Right Sidebar' : 'Open Right Sidebar' }
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
Ctrl+B          - Layout menu
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

    // Ctrl+B to toggle layout menu
    if (key.ctrl && key.name === 'b') {
      setShowLayoutMenu((prev) => {
        if (!prev) {
          setLayoutMenuIndex(0);
        }
        return !prev;
      });
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

    // Handle Layout Menu navigation
    if (showLayoutMenu && (key.name === 'up' || key.name === 'down')) {
      const direction = key.name === 'up' ? -1 : 1;
      setLayoutMenuIndex((prev) => {
        const next = prev + direction;
        const count = layoutMenuOptions.length || 1;
        return (next + count) % count;
      });
      return;
    }

    // Handle Layout Menu selection
    if (showLayoutMenu && (key.name === 'return' || key.name === 'space') && !key.shift) {
      const selected = layoutMenuOptions[layoutMenuIndex];
      if (selected?.id === 'left') {
        updateState((prev) => ({ leftSidebarOpen: !prev.leftSidebarOpen }));
      } else if (selected?.id === 'right') {
        updateState((prev) => ({ rightSidebarOpen: !prev.rightSidebarOpen }));
      }
      setShowLayoutMenu(false);
      return;
    }

    // Close dialogs with Escape key
    if (key.name === 'escape') {
      setShowStatusDialog(false);
      setShowModelDialog(false);
      setShowProviderDialog(false);
      setShowLayoutMenu(false);
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
    // Only handle if shift isn't pressed (to avoid double-fire with the shift+enter handler above)
    if (key.name === 'linefeed' && !key.shift) {
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

  const inputPaddingTop = 1;
  const inputPaddingBottom = 0;
  const inputMetaSpacing = 1;
  const inputMetaLines = 1;
  const inputBottomHalfLine = 1;
  // Calculate dynamic input height based on content
  const inputHeight = useMemo(() => {
    // Count newlines in text segments
    const textSegments = inputSegments.filter((s) => s.type === 'text');
    const totalText = textSegments.map((s) => s.text).join('');
    const lineCount = (totalText.match(/\n/g) || []).length + 1;

    // Base: input lines + meta block
    let height = lineCount + inputMetaSpacing + inputMetaLines + inputBottomHalfLine;

    // Add 2 lines if context chips are present (for the chips row + separator)
    if (state.contextChips.length > 0) {
      height += 2;
    }

    height += inputPaddingTop + inputPaddingBottom;

    return Math.max(4, height);
  }, [
    inputSegments,
    state.contextChips.length,
    inputMetaSpacing,
    inputMetaLines,
    inputBottomHalfLine,
    inputPaddingTop,
    inputPaddingBottom
  ]);

  // Calculate visible messages (with scroll offset) dynamically based on available lines
  // Use all messages - scrollbox handles viewport management
  const visibleMessages = state.messages;

  // Compute grouped tool activity for chips display
  const toolActivity = useMemo(() => extractToolActivity(state.messages, state.greyOutFinishedTools), [state.messages, state.greyOutFinishedTools]);

  // Extract todos from todowrite tool calls
  const todos = useMemo(() => extractTodos(state.messages), [state.messages]);

  // Compute input mode for visual feedback
  const inputMode = useMemo(() => {
    const text = segmentsToDisplayString(inputSegments);
    if (text.startsWith('!')) return 'bash';
    if (text.startsWith('/')) return 'command';
    return 'chat';
  }, [inputSegments]);

  // Get input accent color based on mode (use theme color for default)
  const inputBorderColor = inputMode === 'bash' ? activeTheme.colors.error : inputMode === 'command' ? activeTheme.colors.warning : activeTheme.colors.inputBorder;
  const inputPrompt = '';
  const inputModelLabel = state.currentModel === 'auto' ? 'Auto' : getModelDisplayFromPreference(state.currentModel);
  const inputProviderLabel = providers[selectedProviderIndex]?.name || '';

  const minSidebarWidth = 40;
  const minMainWidth = 40;
  const sidebarDividerWidth = 1;
  const mainContentWidth = useMemo(() => {
    const left = state.leftSidebarOpen ? state.leftSidebarWidth + sidebarDividerWidth : 0;
    const right = state.rightSidebarOpen ? state.rightSidebarWidth + sidebarDividerWidth : 0;
    return Math.max(0, terminalSize.columns - left - right);
  }, [
    terminalSize.columns,
    state.leftSidebarOpen,
    state.leftSidebarWidth,
    state.rightSidebarOpen,
    state.rightSidebarWidth,
    sidebarDividerWidth
  ]);
  const messageTextWidth = useMemo(() => Math.max(10, mainContentWidth - 8), [mainContentWidth]);
  const estimateWrappedLines = useCallback((text: string) => {
    const maxWidth = Math.max(1, messageTextWidth);
    return text.split('\n').reduce((total, line) => {
      const length = line.length || 1;
      return total + Math.max(1, Math.ceil(length / maxWidth));
    }, 0);
  }, [messageTextWidth]);
  const buildRailLine = useCallback((lineCount: number) => {
    return Array.from({ length: Math.max(1, lineCount) }, () => '▏').join('\n');
  }, []);
  const inputInnerWidth = useMemo(() => Math.max(0, mainContentWidth - 3), [mainContentWidth]);
  const inputHalfLine = useMemo(() => '▀'.repeat(inputInnerWidth), [inputInnerWidth]);
  const verticalDividerLine = useMemo(() => {
    const height = Math.max(1, terminalSize.rows - 1);
    return Array.from({ length: height }, () => ' ').join('\n');
  }, [terminalSize.rows]);
  const dialogBackground = useMemo(() => {
    const parseHex = (hex: string) => {
      const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
      if (!match) return null;
      const value = parseInt(match[1], 16);
      return {
        r: (value >> 16) & 0xff,
        g: (value >> 8) & 0xff,
        b: value & 0xff
      };
    };
    const toHex = (value: number) => value.toString(16).padStart(2, '0');
    const base = parseHex(activeTheme.colors.background);
    const tint = parseHex(activeTheme.colors.border);
    if (!base || !tint) return activeTheme.colors.background;
    const weight = 0.25;
    const mix = (a: number, b: number) => Math.round(a * (1 - weight) + b * weight);
    return `#${toHex(mix(base.r, tint.r))}${toHex(mix(base.g, tint.g))}${toHex(mix(base.b, tint.b))}`;
  }, [activeTheme.colors.background, activeTheme.colors.border]);
  const dialogSurfaceStyle = useMemo(
    () => ({
      backgroundColor: dialogBackground,
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 1,
      paddingBottom: 1
    }),
    [dialogBackground]
  );
  const dialogHighlightText = useMemo(() => {
    const parseHex = (hex: string) => {
      const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
      if (!match) return null;
      const value = parseInt(match[1], 16);
      return {
        r: (value >> 16) & 0xff,
        g: (value >> 8) & 0xff,
        b: value & 0xff
      };
    };
    const highlight = parseHex(activeTheme.colors.highlight);
    if (!highlight) return activeTheme.colors.background;
    const luminance = (0.2126 * highlight.r + 0.7152 * highlight.g + 0.0722 * highlight.b) / 255;
    return luminance > 0.6 ? activeTheme.colors.background : activeTheme.colors.assistantMessage;
  }, [activeTheme.colors.highlight, activeTheme.colors.background, activeTheme.colors.assistantMessage]);
  const mixThemeBackground = useCallback((weight: number) => {
    const parseHex = (hex: string) => {
      const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
      if (!match) return null;
      const value = parseInt(match[1], 16);
      return {
        r: (value >> 16) & 0xff,
        g: (value >> 8) & 0xff,
        b: value & 0xff
      };
    };
    const toHex = (value: number) => value.toString(16).padStart(2, '0');
    const base = parseHex(activeTheme.colors.background);
    const tint = parseHex(activeTheme.colors.border);
    if (!base || !tint) return activeTheme.colors.background;
    const mix = (a: number, b: number) => Math.round(a * (1 - weight) + b * weight);
    return `#${toHex(mix(base.r, tint.r))}${toHex(mix(base.g, tint.g))}${toHex(mix(base.b, tint.b))}`;
  }, [activeTheme.colors.background, activeTheme.colors.border]);
  const panelBackground = useMemo(() => mixThemeBackground(0.48), [mixThemeBackground]);
  const assistantCardBackground = useMemo(() => mixThemeBackground(0.22), [mixThemeBackground]);
  const messageRailColors = useMemo(() => {
    const parseHex = (hex: string) => {
      const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
      if (!match) return null;
      const value = parseInt(match[1], 16);
      return {
        r: (value >> 16) & 0xff,
        g: (value >> 8) & 0xff,
        b: value & 0xff
      };
    };
    const toHex = (value: number) => value.toString(16).padStart(2, '0');
    const mixHex = (baseHex: string, tintHex: string, weight: number) => {
      const base = parseHex(baseHex);
      const tint = parseHex(tintHex);
      if (!base || !tint) return tintHex;
      const mix = (a: number, b: number) => Math.round(a * (1 - weight) + b * weight);
      return `#${toHex(mix(base.r, tint.r))}${toHex(mix(base.g, tint.g))}${toHex(mix(base.b, tint.b))}`;
    };
    return {
      user: mixHex(panelBackground, activeTheme.colors.userMessage, 0.55),
      assistant: mixHex(assistantCardBackground, activeTheme.colors.primary, 0.55)
    };
  }, [
    activeTheme.colors.primary,
    activeTheme.colors.userMessage,
    panelBackground,
    assistantCardBackground
  ]);
  const localUsername = useMemo(() => {
    try {
      return os.userInfo().username || 'you';
    } catch {
      return 'you';
    }
  }, []);
  const assistantName = 'Claude';
  const formatTimestamp = (timestamp: Date) => {
    const time = timestamp.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const date = timestamp.toLocaleDateString('en-US');
    return `${time} - ${date}`;
  };
  const formatSessionDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const getAgentStatusColor = (status: SubAgent['status']) => {
    switch (status) {
      case 'running': return 'cyan';
      case 'done': return 'green';
      case 'error': return 'red';
      case 'waiting': return 'yellow';
      default: return 'gray';
    }
  };

  const activeCenterAgent = useMemo(() => {
    if (!state.activeAgentTabId) return null;
    return state.subAgents.find((agent) => agent.id === state.activeAgentTabId) || null;
  }, [state.activeAgentTabId, state.subAgents]);

  useEffect(() => {
    if (state.activeAgentTabId && !activeCenterAgent) {
      updateState({ activeAgentTabId: null });
    }
  }, [state.activeAgentTabId, activeCenterAgent, updateState]);

  useEffect(() => {
    let isActive = true;
    if (!state.leftSidebarOpen || leftSidebarTab !== 'sessions') return;
    setLeftSidebarSessionsLoading(true);
    void (async () => {
      try {
        const sessions = await listSessions();
        if (!isActive) return;
        setLeftSidebarSessions(sessions);
      } finally {
        if (isActive) setLeftSidebarSessionsLoading(false);
      }
    })();
    return () => {
      isActive = false;
    };
  }, [state.leftSidebarOpen, leftSidebarTab, state.sessionId]);

  const loadDirectoryPage = useCallback(async (dirPath: string) => {
    setFileExplorerLoading((prev) => {
      if (prev.has(dirPath)) return prev;
      const next = new Set(prev);
      next.add(dirPath);
      return next;
    });
    try {
      let dirHandle = fileExplorerDirHandlesRef.current.get(dirPath);
      if (!dirHandle) {
        dirHandle = await fsp.opendir(dirPath);
        fileExplorerDirHandlesRef.current.set(dirPath, dirHandle);
      }

      const mapped: FileExplorerEntry[] = [];
      let hasMore = true;
      while (mapped.length < FILE_EXPLORER_PAGE_SIZE) {
        const entry = await dirHandle.read();
        if (!entry) {
          hasMore = false;
          break;
        }
        if (!entry.isDirectory() && !entry.isFile()) continue;
        if (entry.name.startsWith('.')) continue;
        mapped.push({
          name: entry.name,
          path: path.join(dirPath, entry.name),
          type: entry.isDirectory() ? 'dir' : 'file'
        });
      }

      setFileExplorerEntries((prev) => {
        const existing = prev[dirPath] || [];
        return {
          ...prev,
          [dirPath]: [...existing, ...mapped]
        };
      });
      setFileExplorerHasMore((prev) => ({
        ...prev,
        [dirPath]: hasMore
      }));
      if (!hasMore) {
        await dirHandle.close();
        fileExplorerDirHandlesRef.current.delete(dirPath);
      }
      setFileExplorerError((prev) => {
        if (!prev[dirPath]) return prev;
        const next = { ...prev };
        delete next[dirPath];
        return next;
      });
    } catch (err) {
      setFileExplorerError((prev) => ({
        ...prev,
        [dirPath]: err instanceof Error ? err.message : 'Unable to read directory'
      }));
      setFileExplorerHasMore((prev) => ({
        ...prev,
        [dirPath]: false
      }));
    } finally {
      setFileExplorerLoading((prev) => {
        if (!prev.has(dirPath)) return prev;
        const next = new Set(prev);
        next.delete(dirPath);
        return next;
      });
    }
  }, []);

  const ensureDirectoryLoaded = useCallback((dirPath: string) => {
    if (fileExplorerEntries[dirPath] && fileExplorerEntries[dirPath].length > 0) return;
    if (fileExplorerLoading.has(dirPath)) return;
    void loadDirectoryPage(dirPath);
  }, [fileExplorerEntries, fileExplorerLoading, loadDirectoryPage]);

  const toggleDirectory = useCallback((dirPath: string) => {
    const isExpanded = fileExplorerExpanded.has(dirPath);
    setFileExplorerExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
    if (!isExpanded) {
      ensureDirectoryLoaded(dirPath);
    }
  }, [ensureDirectoryLoaded, fileExplorerExpanded]);

  useEffect(() => {
    if (!state.leftSidebarOpen || leftSidebarTab !== 'files') return;
    ensureDirectoryLoaded(os.homedir());
  }, [state.leftSidebarOpen, leftSidebarTab, ensureDirectoryLoaded]);

  useEffect(() => {
    if (!state.leftSidebarOpen || leftSidebarTab !== 'files') return;
    setFileExplorerScrollOffset(0);
  }, [state.leftSidebarOpen, leftSidebarTab]);

  const sessionGroups = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const weekday = startOfToday.getDay();
    const startOfWeek = new Date(startOfToday);
    const weekOffset = (weekday + 6) % 7; // Monday = 0
    startOfWeek.setDate(startOfWeek.getDate() - weekOffset);
    const startOfLastWeek = new Date(startOfWeek);
    startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

    const groups: Record<SessionGroupLabel, SessionSummary[]> = {
      Today: [],
      Yesterday: [],
      'This Week': [],
      'Last Week': [],
      Older: []
    };

    for (const session of leftSidebarSessions) {
      const updated = new Date(session.updatedAt);
      if (!Number.isFinite(updated.getTime())) {
        groups.Older.push(session);
        continue;
      }
      if (updated >= startOfToday) {
        groups.Today.push(session);
      } else if (updated >= startOfYesterday) {
        groups.Yesterday.push(session);
      } else if (updated >= startOfWeek) {
        groups['This Week'].push(session);
      } else if (updated >= startOfLastWeek) {
        groups['Last Week'].push(session);
      } else {
        groups.Older.push(session);
      }
    }

    return groups;
  }, [leftSidebarSessions]);

  useEffect(() => {
    return () => {
      for (const handle of fileExplorerDirHandlesRef.current.values()) {
        void handle.close();
      }
      fileExplorerDirHandlesRef.current.clear();
    };
  }, []);

  const fileExplorerNodes = useMemo<FileExplorerNode[]>(() => {
    if (leftSidebarTab !== 'files') return [];
    const homeDir = os.homedir();
    const nodes: FileExplorerNode[] = [];
    const addDir = (dirPath: string, depth: number) => {
      const isExpanded = fileExplorerExpanded.has(dirPath);
      const isLoading = fileExplorerLoading.has(dirPath);
      const error = fileExplorerError[dirPath];
      const name = dirPath === homeDir ? '~' : path.basename(dirPath);
      nodes.push({
        kind: 'entry',
        entry: { name, path: dirPath, type: 'dir' },
        depth,
        expanded: isExpanded,
        loading: isLoading,
        error
      });
      if (!isExpanded) return;
      if (error) {
        nodes.push({ kind: 'status', label: 'Failed to load', depth: depth + 1 });
        return;
      }
      const entries = fileExplorerEntries[dirPath];
      if (!entries || entries.length === 0) {
        nodes.push({
          kind: 'status',
          label: isLoading ? 'Loading...' : '(empty)',
          depth: depth + 1
        });
        return;
      }
      for (const entry of entries) {
        if (entry.type === 'dir') {
          addDir(entry.path, depth + 1);
        } else {
          nodes.push({
            kind: 'entry',
            entry,
            depth: depth + 1,
            expanded: false,
            loading: false
          });
        }
      }
      if (fileExplorerHasMore[dirPath]) {
        nodes.push({ kind: 'loadMore', dirPath, depth: depth + 1 });
      }
    };

    addDir(homeDir, 0);
    return nodes;
  }, [
    leftSidebarTab,
    fileExplorerEntries,
    fileExplorerExpanded,
    fileExplorerLoading,
    fileExplorerError,
    fileExplorerHasMore
  ]);

  const maybeLoadMoreFileExplorer = useCallback((scrollOffset: number) => {
    if (!state.leftSidebarOpen || leftSidebarTab !== 'files') return;
    if (fileExplorerNodes.length === 0) return;
    const visibleRows = Math.max(6, terminalSize.rows - 12);
    const endIndex = scrollOffset + visibleRows;
    if (fileExplorerNodes.length - endIndex > 4) return;

    const searchStart = Math.min(fileExplorerNodes.length - 1, endIndex + 2);
    for (let i = searchStart; i >= 0; i--) {
      const node = fileExplorerNodes[i];
      if (node.kind === 'loadMore') {
        if (fileExplorerLoading.has(node.dirPath)) return;
        void loadDirectoryPage(node.dirPath);
        return;
      }
    }
  }, [
    state.leftSidebarOpen,
    leftSidebarTab,
    fileExplorerNodes,
    fileExplorerLoading,
    terminalSize.rows,
    loadDirectoryPage
  ]);

  useEffect(() => {
    if (!state.leftSidebarOpen || leftSidebarTab !== 'files') return;
    maybeLoadMoreFileExplorer(fileExplorerScrollOffset);
  }, [
    state.leftSidebarOpen,
    leftSidebarTab,
    fileExplorerScrollOffset,
    maybeLoadMoreFileExplorer
  ]);

  const handleResizeDrag = (event: { x: number; y: number; modifiers?: { shift?: boolean } }) => {
    if (state.isDraggingResize && state.dragStartY !== null && state.dragStartHeight !== null) {
      if (event.modifiers?.shift) return; // Allow terminal selection on Shift+drag
      const deltaY = state.dragStartY - event.y; // Inverted: drag up = positive = taller
      const newHeight = Math.max(5, Math.min(40, state.dragStartHeight + deltaY));
      updateState({ agentPanelHeight: newHeight });
      return;
    }

    if (state.isDraggingSidebar === 'left' && state.dragStartX !== null && state.dragStartLeftWidth !== null) {
      if (event.modifiers?.shift) return; // Allow terminal selection on Shift+drag
      const deltaX = event.x - state.dragStartX;
      const rightWidth = state.rightSidebarOpen ? state.rightSidebarWidth : 0;
      const rightDivider = state.rightSidebarOpen ? sidebarDividerWidth : 0;
      const available = terminalSize.columns - rightWidth - rightDivider - sidebarDividerWidth - minMainWidth;
      const maxWidth = Math.max(0, available);
      const minWidth = Math.min(minSidebarWidth, maxWidth);
      const newWidth = Math.max(minWidth, Math.min(maxWidth, state.dragStartLeftWidth + deltaX));
      updateState({ leftSidebarWidth: newWidth });
      return;
    }

    if (state.isDraggingSidebar === 'right' && state.dragStartX !== null && state.dragStartRightWidth !== null) {
      if (event.modifiers?.shift) return; // Allow terminal selection on Shift+drag
      const deltaX = event.x - state.dragStartX;
      const leftWidth = state.leftSidebarOpen ? state.leftSidebarWidth : 0;
      const leftDivider = state.leftSidebarOpen ? sidebarDividerWidth : 0;
      const available = terminalSize.columns - leftWidth - leftDivider - sidebarDividerWidth - minMainWidth;
      const maxWidth = Math.max(0, available);
      const minWidth = Math.min(minSidebarWidth, maxWidth);
      const newWidth = Math.max(minWidth, Math.min(maxWidth, state.dragStartRightWidth - deltaX));
      updateState({ rightSidebarWidth: newWidth });
    }
  };

  const endResizeDrag = () => {
    if (!state.isDraggingResize && !state.isDraggingSidebar) return;
    updateState({
      isDraggingResize: false,
      dragStartY: null,
      dragStartHeight: null,
      isDraggingSidebar: null,
      dragStartX: null,
      dragStartLeftWidth: null,
      dragStartRightWidth: null
    });
  };

  return (
    <box
      style={{ flexDirection: 'column', height: '100%' }}
      onMouseMove={handleResizeDrag}
      onMouseDrag={handleResizeDrag}
      onMouseDragEnd={endResizeDrag}
      onMouseUp={endResizeDrag}
    >
      <box style={{ flexDirection: 'row', flexGrow: 1 }}>
        {state.leftSidebarOpen && (
          <>
            <box
              style={{
                width: state.leftSidebarWidth,
                flexShrink: 0,
                flexDirection: 'column',
                backgroundColor: assistantCardBackground
              }}
            >
              <box style={{ flexShrink: 0, zIndex: 100, flexDirection: 'column', marginBottom: 1 }}>
                {(() => {
                  const firstTabWidth = Math.floor((state.leftSidebarWidth - 1) / 2);
                  const secondTabWidth = state.leftSidebarWidth - 1 - firstTabWidth;
                  return (
                    <box style={{ flexDirection: 'row' }}>
                      <text content={'▔'.repeat(firstTabWidth)} fg={leftSidebarTab === 'sessions' ? activeTheme.colors.highlight : panelBackground} bg={panelBackground} />
                      <text content="▔" fg={panelBackground} bg={panelBackground} />
                      <text content={'▔'.repeat(secondTabWidth)} fg={leftSidebarTab === 'files' ? activeTheme.colors.highlight : panelBackground} bg={panelBackground} />
                    </box>
                  );
                })()}
                <box
                  style={{
                    flexDirection: 'row',
                    backgroundColor: panelBackground
                  }}
                >
                  <box
                    style={{
                      flexDirection: 'row',
                      flexGrow: 1,
                      flexBasis: 0,
                      justifyContent: 'center',
                      alignItems: 'center',
                      paddingLeft: 1,
                      paddingRight: 1
                    }}
                    onMouseUp={() => setLeftSidebarTab('sessions')}
                  >
                    <text
                      content={`Sessions (${leftSidebarSessions.length})`}
                      fg={leftSidebarTab === 'sessions' ? activeTheme.colors.highlight : activeTheme.colors.muted}
                      bold={leftSidebarTab === 'sessions' ? true : false}
                    />
                  </box>
                  <text content="▐" fg={activeTheme.colors.border} />
                  <box
                    style={{
                      flexDirection: 'row',
                      flexGrow: 1,
                      flexBasis: 0,
                      justifyContent: 'center',
                      alignItems: 'center',
                      paddingLeft: 1,
                      paddingRight: 1
                    }}
                    onMouseUp={() => setLeftSidebarTab('files')}
                  >
                    <text
                      content="Files"
                      fg={leftSidebarTab === 'files' ? activeTheme.colors.highlight : activeTheme.colors.muted}
                      bold={leftSidebarTab === 'files' ? true : false}
                    />
                  </box>
                </box>
                <text content={'▀'.repeat(state.leftSidebarWidth)} fg={panelBackground} />
              </box>
              <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, flexDirection: 'column', flexGrow: 1 }}>
                {leftSidebarTab === 'sessions' ? (
                  <>
                    {leftSidebarSessions.length === 0 ? (
                      <text
                        content={leftSidebarSessionsLoading ? 'Loading sessions...' : 'No sessions yet'}
                        fg={activeTheme.colors.muted}
                      />
                    ) : (
                      <scrollbox
                        scrollX={false}
                        scrollbarOptions={{ visible: false }}
                        verticalScrollbarOptions={{ visible: false }}
                        style={{
                          flexGrow: 1,
                          rootOptions: {
                            flexGrow: 1,
                            padding: 0,
                            gap: 0,
                            flexDirection: 'column',
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
                            gap: 1,
                            backgroundColor: 'transparent'
                          }
                        }}
                      >
                        {(['Today', 'Yesterday', 'This Week', 'Last Week', 'Older'] as SessionGroupLabel[]).map((label) => {
                          const group = sessionGroups[label];
                          if (!group || group.length === 0) return null;
                          const isExpanded = sessionGroupExpanded[label];
                          return (
                            <box key={label} style={{ flexDirection: 'column', marginBottom: 1 }}>
                              <box
                                style={{ flexDirection: 'row', paddingLeft: 1, paddingRight: 1 }}
                                onMouseUp={() => {
                                  setSessionGroupExpanded((prev) => ({
                                    ...prev,
                                    [label]: !prev[label]
                                  }));
                                }}
                              >
                                <text
                                  content={`${isExpanded ? '▾' : '▣'} ${label}`}
                                  fg={activeTheme.colors.secondary}
                                  bold
                                />
                              </box>
                              {isExpanded && group.map((session) => {
                                const isCurrent = !!state.sessionId && session.sessionId === state.sessionId;
                                const statusDot = session.status === 'active' ? '●' : '○';
                                const lineColor = isCurrent ? activeTheme.colors.highlight : activeTheme.colors.muted;
                                return (
                                  <box
                                    key={session.sessionId}
                                    style={{
                                      flexDirection: 'column',
                                      paddingLeft: 1,
                                      paddingRight: 1,
                                      marginBottom: 1
                                    }}
                                  >
                                    <text
                                      content={`${statusDot} ${session.preview}`}
                                      fg={lineColor}
                                      bold={isCurrent}
                                    />
                                    <text
                                      content={`${formatSessionDate(session.updatedAt)} · ${session.messageCount} msgs`}
                                      fg={lineColor}
                                      bold={isCurrent}
                                    />
                                  </box>
                                );
                              })}
                            </box>
                          );
                        })}
                      </scrollbox>
                    )}
                  </>
                ) : (() => {
                  const truncateLabel = (label: string, maxLength: number) => {
                    if (label.length <= maxLength) return label;
                    if (maxLength <= 3) return label.slice(0, maxLength);
                    return `${label.slice(0, maxLength - 3)}...`;
                  };
                  const handleFileExplorerScroll = (event: any) => {
                    const nextOffset = Math.max(0, event?.scrollTop ?? event?.scrollOffset ?? event?.scrollY ?? 0);
                    setFileExplorerScrollOffset(nextOffset);
                    maybeLoadMoreFileExplorer(nextOffset);
                  };

                  return (
                    <>
                      <scrollbox
                        scrollX={false}
                        onScroll={handleFileExplorerScroll}
                        scrollbarOptions={{ visible: false }}
                        verticalScrollbarOptions={{ visible: false }}
                        style={{
                          flexGrow: 1,
                          rootOptions: {
                            flexGrow: 1,
                            padding: 0,
                            gap: 0,
                            flexDirection: 'column',
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
                            backgroundColor: 'transparent'
                          }
                        }}
                      >
                        {fileExplorerNodes.map((node, idx) => {
                          if (node.kind === 'status') {
                            const indent = ' '.repeat(node.depth * 2);
                            return (
                              <text
                                key={`status-${node.depth}-${node.label}-${idx}`}
                                content={`${indent}${node.label}`}
                                fg={activeTheme.colors.muted}
                              />
                            );
                          }

                          if (node.kind === 'loadMore') {
                            const indent = ' '.repeat(node.depth * 2);
                            const loading = fileExplorerLoading.has(node.dirPath);
                            return (
                              <text
                                key={`load-more-${node.dirPath}-${idx}`}
                                content={`${indent}${loading ? 'Loading...' : '… more'}`}
                                fg={activeTheme.colors.muted}
                                onMouseUp={() => {
                                  if (!loading) {
                                    void loadDirectoryPage(node.dirPath);
                                  }
                                }}
                              />
                            );
                          }

                          const indent = ' '.repeat(node.depth * 2);
                          const icon = node.entry.type === 'dir' ? (node.expanded ? '📂' : '📁') : '📄';
                          const maxLabelWidth = Math.max(8, state.leftSidebarWidth - 7 - node.depth * 2);
                          const displayName = truncateLabel(node.entry.name, maxLabelWidth);
                          const rowFg = node.entry.type === 'dir' ? activeTheme.colors.secondary : activeTheme.colors.muted;
                          return (
                            <text
                              key={node.entry.path}
                              content={`${indent}${icon} ${displayName}`}
                              fg={rowFg}
                              onMouseUp={() => {
                                if (node.entry.type === 'dir') {
                                  toggleDirectory(node.entry.path);
                                }
                              }}
                            />
                          );
                        })}
                      </scrollbox>
                    </>
                  );
                })()}
              </box>
            </box>
            <box
              style={{
                width: sidebarDividerWidth,
                flexShrink: 0,
                cursor: 'ew-resize'
              }}
              onMouseDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                event.preventDefault();
                updateState({
                  isDraggingSidebar: 'left',
                  dragStartX: event.x,
                  dragStartLeftWidth: state.leftSidebarWidth
                });
              }}
            >
              <text
                content={verticalDividerLine}
                fg={state.isDraggingSidebar === 'left' ? 'cyan' : 'gray'}
                dim={state.isDraggingSidebar !== 'left'}
                selectable={false}
              />
            </box>
          </>
        )}

        <box style={{ flexDirection: 'column', flexGrow: 1 }}>
          <box style={{ flexShrink: 0, zIndex: 100, flexDirection: 'column', marginBottom: 1 }}>
            {(() => {
              const openedAgents = state.subAgents.filter((agent) => state.openedSubagentTabs.includes(agent.id));
              const totalTabs = 1 + openedAgents.length;
              const numDividers = openedAgents.length;
              const availableWidth = mainContentWidth - numDividers;
              const baseWidth = Math.floor(availableWidth / totalTabs);
              const remainder = availableWidth % totalTabs;
              const sessionWidth = baseWidth;
              const agentWidths = openedAgents.map((_, idx) => baseWidth + (idx < remainder ? 1 : 0));
              
              return (
                <box style={{ flexDirection: 'row' }}>
                  <text 
                    content={'▔'.repeat(sessionWidth)} 
                    fg={!activeCenterAgent ? activeTheme.colors.highlight : panelBackground} 
                    bg={panelBackground} 
                  />
                  {openedAgents.map((agent, idx) => {
                    const isActive = activeCenterAgent?.id === agent.id;
                    return (
                      <React.Fragment key={`center-tab-bar-${agent.id}`}>
                        <text content="▔" fg={panelBackground} bg={panelBackground} />
                        <text 
                          content={'▔'.repeat(agentWidths[idx])} 
                          fg={isActive ? activeTheme.colors.highlight : panelBackground} 
                          bg={panelBackground} 
                        />
                      </React.Fragment>
                    );
                  })}
                </box>
              );
            })()}
            <box
              style={{
                flexDirection: 'row',
                backgroundColor: panelBackground
              }}
            >
              <box
                style={{
                  flexDirection: 'row',
                  flexGrow: 1,
                  justifyContent: 'center',
                  alignItems: 'center',
                  paddingLeft: 1,
                  paddingRight: 1
                }}
                onMouseUp={() => {
                  updateState({ activeAgentTabId: null });
                }}
              >
                <text
                  content="Session"
                  fg={!activeCenterAgent ? activeTheme.colors.highlight : activeTheme.colors.muted}
                  bold={!activeCenterAgent}
                />
              </box>
              {state.openedSubagentTabs.length > 0 && <text content="▐" fg={activeTheme.colors.border} />}
              {state.subAgents
                .filter((agent) => state.openedSubagentTabs.includes(agent.id))
                .map((agent, idx, arr) => {
                  const isActive = activeCenterAgent?.id === agent.id;
                  return (
                    <React.Fragment key={`center-tab-${agent.id}`}>
                      <box
                        style={{
                          flexDirection: 'row',
                          flexGrow: 1,
                          justifyContent: 'center',
                          alignItems: 'center',
                          paddingLeft: 1,
                          paddingRight: 1
                        }}
                        onMouseUp={() => {
                          updateState({ activeAgentTabId: agent.id });
                        }}
                      >
                        <text
                          content={agent.id}
                          fg={isActive ? activeTheme.colors.highlight : activeTheme.colors.muted}
                          bold={isActive}
                        />
                        <text
                          content=" ×"
                          fg={activeTheme.colors.muted}
                          onMouseUp={(e) => {
                            e.stopPropagation();
                            updateState((prev) => ({
                              openedSubagentTabs: prev.openedSubagentTabs.filter((id) => id !== agent.id),
                              activeAgentTabId: prev.activeAgentTabId === agent.id ? null : prev.activeAgentTabId
                            }));
                          }}
                        />
                      </box>
                      {idx < arr.length - 1 && <text content="▐" fg={activeTheme.colors.border} />}
                    </React.Fragment>
                  );
                })}
            </box>
            <text content={'▀'.repeat(mainContentWidth)} fg={panelBackground} />
          </box>
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
                paddingLeft: 0,
                paddingRight: 1,
                paddingTop: 1
              }
            }}
          >
            {(() => {
              if (activeCenterAgent) {
                const outputText = activeCenterAgent.liveOutput || '';
                const outputLines = outputText.length ? outputText.split('\n') : [];
                const totalLines = outputLines.length;
                const visibleLineCount = state.agentMessagesVisible.get(activeCenterAgent.id) || 40;
                const displayLines = outputLines.slice(Math.max(0, totalLines - visibleLineCount));
                const hiddenCount = Math.max(0, totalLines - displayLines.length);
                const statusColor = getAgentStatusColor(activeCenterAgent.status);
                const modelLabel = getModelDisplayFromPreference(activeCenterAgent.model);
                const progressLabel = activeCenterAgent.progress ? `${activeCenterAgent.progress.percent}%` : null;

                const outputLineCount = Math.max(1, displayLines.length);
                const headerLines = 1;
                const metaLines = 1
                  + (activeCenterAgent.currentTask ? 1 : 0)
                  + (activeCenterAgent.progress?.message ? 1 : 0)
                  + (hiddenCount > 0 ? 1 : 0);
                const railLines = headerLines + metaLines + outputLineCount;
                return (
                  <box style={{ flexDirection: 'column' }}>
                    <box style={{ flexDirection: 'row', marginBottom: 1 }}>
                      <box style={{ width: 1, flexShrink: 0 }}>
                        <text content={buildRailLine(railLines)} fg={messageRailColors.assistant} />
                      </box>
                      <box
                        style={{
                          flexDirection: 'column',
                          flexGrow: 1,
                          backgroundColor: assistantCardBackground,
                          paddingLeft: 1,
                          paddingRight: 1,
                          paddingTop: 1,
                          paddingBottom: 1
                        }}
                      >
                        <box style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 0 }}>
                          <text content={activeCenterAgent.id} fg={activeTheme.colors.primary} bold />
                          <text content={activeCenterAgent.status} fg={statusColor} />
                        </box>
                        <box style={{ flexDirection: 'row', marginBottom: activeCenterAgent.currentTask ? 1 : 0 }}>
                          <text content={modelLabel} fg={activeTheme.colors.muted} />
                          {progressLabel && <text content={` · ${progressLabel}`} fg={activeTheme.colors.secondary} />}
                        </box>
                        {activeCenterAgent.currentTask && (
                          <text content={`Task: ${activeCenterAgent.currentTask}`} fg={activeTheme.colors.muted} />
                        )}
                        {activeCenterAgent.progress?.message && (
                          <text content={activeCenterAgent.progress.message} fg={activeTheme.colors.muted} />
                        )}
                        {hiddenCount > 0 && (
                          <box
                            style={{ flexDirection: 'row', marginTop: 1 }}
                            onMouseUp={() => {
                              updateState((prev) => {
                                const next = new Map(prev.agentMessagesVisible);
                                const current = next.get(activeCenterAgent.id) || 40;
                                next.set(activeCenterAgent.id, current + 40);
                                return { agentMessagesVisible: next };
                              });
                            }}
                          >
                            <text content={`[Show ${hiddenCount} earlier lines]`} fg={activeTheme.colors.secondary} />
                          </box>
                        )}
                        {displayLines.length > 0 ? (
                          displayLines.map((line, idx) => (
                            <text key={`agent-line-${idx}`} content={line} fg={activeTheme.colors.muted} />
                          ))
                        ) : (
                          <text content="No output yet" fg={activeTheme.colors.muted} />
                        )}
                      </box>
                    </box>
                  </box>
                );
              }

              // Group consecutive tool messages together for inline display
              const elements: React.ReactNode[] = [];
              let toolGroup: typeof visibleMessages = [];

              const flushToolGroup = () => {
                if (toolGroup.length === 0) return;

                toolGroup.forEach((msg, idx) => {
                  const formatted = formatToolCall(msg);
                  const toolKey = `tool-${msg.timestamp.getTime()}-${idx}`;
                  const headerColor = formatted.isComplete ? activeTheme.colors.muted : activeTheme.colors.info;
                  
                  elements.push(
                    <box key={toolKey} style={{ flexDirection: 'column', marginBottom: 1 }}>
                      <text content={formatted.header} fg={headerColor} />
                      {formatted.diff && formatted.diff.length > 0 && (
                        <box style={{ flexDirection: 'column', marginTop: 0, marginLeft: 2, marginBottom: 0 }}>
                          {formatted.diff.slice(0, 20).map((line, lineIdx) => {
                            const lineNumStr = line.lineNumber !== undefined 
                              ? String(line.lineNumber).padStart(4, ' ') + ' '
                              : '     ';
                            const prefix = line.type === 'removed' ? '-' : line.type === 'added' ? '+' : ' ';
                            const lineColor = line.type === 'removed' 
                              ? activeTheme.colors.error 
                              : line.type === 'added' 
                                ? activeTheme.colors.success 
                                : activeTheme.colors.muted;
                            const content = `${lineNumStr}${prefix} ${line.content}`;
                            return (
                              <text 
                                key={`diff-${lineIdx}`} 
                                content={content.length > 80 ? content.slice(0, 77) + '...' : content}
                                fg={lineColor} 
                              />
                            );
                          })}
                          {formatted.diff.length > 20 && (
                            <text content={`     ... ${formatted.diff.length - 20} more lines`} fg={activeTheme.colors.muted} />
                          )}
                        </box>
                      )}
                    </box>
                  );
                });
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
                  const timestamp = formatTimestamp(msg.timestamp);
                  const contentLines = estimateWrappedLines(msg.content);
                  const totalLines = contentLines + 3;
                  const railBar = Array.from({ length: totalLines }, () => '▌').join('\n');
                  elements.push(
                    <box
                      key={key}
                      style={{
                        flexDirection: 'row',
                        marginBottom: 1,
                        backgroundColor: panelBackground
                      }}
                    >
                      <text content={railBar} fg={messageRailColors.user} style={{ flexShrink: 0 }} />
                      <box style={{ flexDirection: 'column', flexGrow: 1, paddingLeft: 1, paddingTop: 1, paddingBottom: 1 }}>
                        {renderMarkdown(msg.content, 'white')}
                        <box style={{ flexDirection: 'row' }}>
                          <text content={localUsername} fg={activeTheme.colors.userMessage} />
                          <text content={` · ${timestamp}`} fg={activeTheme.colors.muted} />
                        </box>
                      </box>
                    </box>
                  );
                  return;
                }

                if (msg.role === 'assistant') {
                  elements.push(
                    <box key={key} style={{ flexDirection: 'column', marginBottom: 1, paddingLeft: 1 }}>
                      {renderMarkdown(msg.content, activeTheme.colors.assistantMessage)}
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
                      <text content={msg.content} fg={msg.content.includes('[↻]') || msg.content.startsWith('Keyboard:') || msg.content.startsWith('[A]') || msg.content.startsWith('[i]') ? activeTheme.colors.muted : activeTheme.colors.systemMessage} />
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

      {/* Input bar - grows dynamically based on content and chips */}
      <box
        style={{
          flexDirection: 'row',
          flexShrink: 0,
          height: inputHeight,
          backgroundColor: panelBackground
        }}
      >
        <text content={Array.from({ length: inputHeight }, () => '▌').join('\n')} fg="cyan" style={{ flexShrink: 0 }} />
        <box
          style={{
            flexDirection: 'column',
            flexGrow: 1,
            paddingLeft: 1,
            paddingRight: 1,
            paddingTop: inputPaddingTop,
            paddingBottom: inputPaddingBottom
          }}
        >
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
            <box style={{ flexDirection: 'row', flexGrow: 1 }}>
              <box style={{ flexDirection: 'column', flexGrow: 1, paddingLeft: 1, justifyContent: 'space-between' }}>
                <box style={{ flexDirection: 'column' }}>
                  <box style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {inputPrompt && (
                      <text content={inputPrompt} fg={inputBorderColor === 'gray' ? 'gray' : inputBorderColor} bold />
                    )}
                    {(() => {
                    const textAndChipSegments = inputSegments.filter((s) => s.type !== 'context');
                    const isEmpty = textAndChipSegments.length === 1 &&
                                   textAndChipSegments[0].type === 'text' &&
                                   textAndChipSegments[0].text === '';

                    if (isEmpty) {
                      return <text content={cursorVisible ? '█' : ' '} fg="gray" />;
                    }

                    const nonContextSegments = inputSegments.filter((s) => s.type !== 'context');
                    const isLastSegmentText = nonContextSegments[nonContextSegments.length - 1]?.type === 'text';
                    return (
                      <>
                        {nonContextSegments.map((segment, idx) => {
                          const isLastText = isLastSegmentText && idx === nonContextSegments.length - 1;

                          if (segment.type === 'text') {
                            if (isLastText) {
                              const text = segment.text;
                              if (text.includes('\n')) {
                                return (
                                  <box key={`text-${idx}`} style={{ flexDirection: 'column' }}>
                                    {renderMultilineText(text, 'white', cursorPosition, cursorVisible)}
                                  </box>
                                );
                              }
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
                            if (segment.text.includes('\n')) {
                              return (
                                <box key={`text-${idx}`} style={{ flexDirection: 'column' }}>
                                  {renderMultilineText(segment.text, 'white', -1, false)}
                                </box>
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
                                  setInputSegments((prev) => prev.filter((_, i) => i !== idx));
                                }}
                              />
                            );
                          }
                          return null;
                        })}
                        {!isLastSegmentText && <text content={cursorVisible ? '█' : ' '} fg="gray" />}
                      </>
                    );
                  })()}
                  </box>
                </box>
                <box style={{ flexDirection: 'column' }}>
                  <text content="" />
                  <box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <box style={{ flexDirection: 'row' }}>
                      <text content={state.agentMode === 'planning' ? 'Planning' : 'Coding'} fg="cyan" />
                      <text content="  " />
                      <text content={inputModelLabel} fg="white" />
                      {inputProviderLabel ? (
                        <>
                          <text content="  " />
                          <text content={inputProviderLabel} fg="gray" />
                        </>
                      ) : null}
                    </box>
                    <text content="tab switch agent  ctrl+p commands" fg="gray" />
                  </box>
                  <text content="" />
                </box>
              </box>
            </box>
          : <box style={{ flexDirection: 'row' }}>
              <text content="▏" fg="cyan" />
              <box style={{ flexDirection: 'column', flexGrow: 1, paddingLeft: 1 }}>
                <box style={{ flexDirection: 'row' }}>
                  <text content="* " fg="red" bold />
                  <text content="Waiting for response..." fg="gray" />
                </box>
                <box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <box style={{ flexDirection: 'row' }}>
                    <text content={state.agentMode === 'planning' ? 'Planning' : 'Coding'} fg="cyan" />
                    <text content="  " />
                    <text content={inputModelLabel} fg="white" />
                    {inputProviderLabel ? (
                      <>
                        <text content="  " />
                        <text content={inputProviderLabel} fg="gray" />
                      </>
                    ) : null}
                  </box>
                  <text content="tab switch agent  ctrl+p commands" fg="gray" />
                </box>
              </box>
            </box>
          }
        </box>
      </box>
      </box>

        {state.rightSidebarOpen && (() => {
          const maxContextTokens = 200000;
          const totalTokens = state.inputTokens + state.outputTokens;
          const contextPercentUsed = Math.min(100, Math.round((totalTokens / maxContextTokens) * 100));
          const contextPercentLeft = Math.max(0, Math.round(((maxContextTokens - totalTokens) / maxContextTokens) * 100));
          const sidebarInnerWidth = Math.max(10, state.rightSidebarWidth - 4);
          const percentLabel = `${contextPercentUsed}%`;
          const barWidth = Math.max(8, sidebarInnerWidth - percentLabel.length - 2);
          const filledWidth = Math.min(barWidth, Math.round((contextPercentUsed / 100) * barWidth));
          const emptyWidth = Math.max(0, barWidth - filledWidth);
          const contextBar = `${'█'.repeat(filledWidth)}${'░'.repeat(emptyWidth)}`;
          const animFrame = Math.floor(Date.now() / 100) % 10;
          const toolCount = toolActivity.length;
          const todoCount = todos.length;
          const fileCount = state.contextChips.length;
          const contextCount = state.contextChips.length;
          const subagentCount = state.subAgents.length;
          const lastUserMessage = [...state.messages].reverse().find((msg) => msg.role === 'user');
          // Truncate title based on sidebar width: width - padding(4) - "Rename"(6) - gap(2) = max title
          const maxTitleLength = Math.max(12, state.rightSidebarWidth - 12);
          const rawTitle = lastUserMessage?.content.split('\n')[0].trim() || 'New Session';
          const sessionTitle = rawTitle.length > maxTitleLength ? rawTitle.slice(0, maxTitleLength - 1) + '…' : rawTitle;
          const modeLabel =
            state.currentTool ? 'TOOL' :
            state.isResponding ? 'AGNT' :
            state.agentMode === 'coding' ? 'CODE' : 'PLAN';
          const modeColor =
            state.activeStatusPopup === 'mode' ? activeTheme.colors.highlight :
            state.currentTool ? activeTheme.colors.toolChipActive :
            state.isResponding ? activeTheme.colors.success :
            activeTheme.colors.secondary;
          const queueLabel = state.queuedMessages > 0 ? `Q${state.queuedMessages}` : null;
          const historyLabel = historyIndex !== -1 ? `H${historyIndex + 1}/${history.length}` : null;
          const lspDotColor = aiStats
            ? (
              aiStats.watcher === 'off' ? activeTheme.colors.muted :
              aiStats.watcher === 'starting' ? activeTheme.colors.warning :
              aiStats.watcher === 'ready' ? activeTheme.colors.success :
              aiStats.watcher === 'watching' ? activeTheme.colors.info :
              aiStats.watcher === 'error' ? activeTheme.colors.error : activeTheme.colors.muted
            )
            : activeTheme.colors.muted;
          const lspCount = aiStats ? aiStats.lsp.activeServers : 0;
          const indexLabel = aiStats
            ? (
              aiStats.indexer.isIndexing
                ? `${Math.round((aiStats.indexer.current / Math.max(1, aiStats.indexer.total)) * 100)}%`
                : 'Ready'
            )
            : '—';
          const indexColor = aiStats
            ? (state.activeStatusPopup === 'idx'
              ? activeTheme.colors.highlight
              : aiStats.indexer.isIndexing
                ? activeTheme.colors.warning
                : activeTheme.colors.success)
            : activeTheme.colors.muted;
          const modelLabel = getModelDisplayFromPreference(state.currentModel);
          const agentModelLabel = activeCenterAgent ? getModelDisplayFromPreference(activeCenterAgent.model) : '';
          const agentStatusColor = activeCenterAgent ? getAgentStatusColor(activeCenterAgent.status) : 'gray';
          const agentOutputLineCount = activeCenterAgent?.liveOutput
            ? activeCenterAgent.liveOutput.split('\n').length
            : 0;
          const agentProgressLabel = activeCenterAgent?.progress
            ? `${activeCenterAgent.progress.percent}%`
            : null;
          const agentTaskLabel = activeCenterAgent?.currentTask || '';
          const agentStartedLabel = activeCenterAgent ? formatTimestamp(activeCenterAgent.spawnedAt) : '';
          const agentCompletedLabel = activeCenterAgent?.completedAt ? formatTimestamp(activeCenterAgent.completedAt) : '';

          return (
            <>
              <box
                style={{
                  width: sidebarDividerWidth,
                  flexShrink: 0,
                  cursor: 'ew-resize'
                }}
                onMouseDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  event.preventDefault();
                  updateState({
                    isDraggingSidebar: 'right',
                    dragStartX: event.x,
                    dragStartRightWidth: state.rightSidebarWidth
                  });
                }}
              >
                <text
                  content={verticalDividerLine}
                  fg={state.isDraggingSidebar === 'right' ? 'cyan' : 'gray'}
                  dim={state.isDraggingSidebar !== 'right'}
                  selectable={false}
                />
              </box>
              <box
                style={{
                  width: state.rightSidebarWidth,
                  flexShrink: 0,
                  flexDirection: 'column',
                  backgroundColor: assistantCardBackground
                }}
              >
                <text content={'▄'.repeat(state.rightSidebarWidth)} fg={panelBackground} />
                <box style={{ paddingLeft: 2, paddingRight: 2, flexDirection: 'row', justifyContent: 'space-between', backgroundColor: panelBackground, flexWrap: 'nowrap', overflow: 'hidden' }}>
                  {activeCenterAgent ? (
                    <>
                      <text content={activeCenterAgent.id} fg={activeTheme.colors.assistantMessage} bold />
                      <text content={agentModelLabel} fg={activeTheme.colors.muted} />
                    </>
                  ) : (
                    <>
                      <text content={sessionTitle} fg={activeTheme.colors.assistantMessage} bold />
                      <text content="Rename" fg={activeTheme.colors.secondary} underline />
                    </>
                  )}
                </box>
                <text content={'▀'.repeat(state.rightSidebarWidth)} fg={panelBackground} />
                <box style={{ paddingLeft: 1, paddingRight: 1, flexDirection: 'column' }}>
                  {activeCenterAgent ? (
                    <>
                      <text content="Agent" fg={activeTheme.colors.muted} bold />
                      <box style={{ flexDirection: 'column', marginTop: 1, marginBottom: 1 }}>
                        <box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <text content="Status" fg={activeTheme.colors.muted} />
                          <text content={activeCenterAgent.status} fg={agentStatusColor} bold />
                        </box>
                        {agentProgressLabel && (
                          <box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                            <text content="Progress" fg={activeTheme.colors.muted} />
                            <text content={agentProgressLabel} fg={activeTheme.colors.secondary} />
                          </box>
                        )}
                        {agentTaskLabel && (
                          <>
                            <text content="Task" fg={activeTheme.colors.muted} />
                            <text content={agentTaskLabel} fg={activeTheme.colors.muted} />
                          </>
                        )}
                        <box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <text content="Output" fg={activeTheme.colors.muted} />
                          <text content={`${agentOutputLineCount} lines`} fg={activeTheme.colors.muted} />
                        </box>
                        <box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <text content="Started" fg={activeTheme.colors.muted} />
                          <text content={agentStartedLabel} fg={activeTheme.colors.muted} />
                        </box>
                        {agentCompletedLabel && (
                          <box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                            <text content="Completed" fg={activeTheme.colors.muted} />
                            <text content={agentCompletedLabel} fg={activeTheme.colors.muted} />
                          </box>
                        )}
                        {activeCenterAgent.error && (
                          <>
                            <text content="Error" fg={activeTheme.colors.muted} />
                            <text content={activeCenterAgent.error} fg={activeTheme.colors.error} />
                          </>
                        )}
                      </box>
                    </>
                  ) : (
                    <>
                      <text content="Status" fg={activeTheme.colors.muted} bold />
                      <box style={{ flexDirection: 'column', marginTop: 1, marginBottom: 1 }}>
                        <box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <text content="Activity" fg={activeTheme.colors.muted} />
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
                                const behindDistance = kittDirection === 'right'
                                  ? kittPosition - i
                                  : i - kittPosition;

                                const isLit = i === kittPosition;
                                const isInTrail = behindDistance > 0 && behindDistance <= kittWidth;
                                const char = isLit ? activeTheme.colors.kittLit : isInTrail ? activeTheme.colors.kittDim : activeTheme.colors.kittOff;
                                const fadeAmount = isLit ? 1.0 : isInTrail ? Math.max(0.2, 1.0 - (behindDistance * 0.12)) : 0;
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
                                    key={`kitt-side-${i}`}
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
                        </box>

                        {queueLabel && (
                          <box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                            <text content="Queue" fg={activeTheme.colors.muted} />
                            <text content={queueLabel} fg={activeTheme.colors.info} bold />
                          </box>
                        )}
                        <box
                          style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                          onMouseUp={() => {
                            updateState((prev) => ({
                              activeStatusPopup: prev.activeStatusPopup === 'context' ? null : 'context'
                            }));
                          }}
                        >
                          <text content="Context" fg={activeTheme.colors.muted} />
                          <text
                            content={`${contextPercentLeft}%`}
                            fg={state.activeStatusPopup === 'context' ? activeTheme.colors.highlight : activeTheme.colors.secondary}
                            bold
                          />
                        </box>
                        <text
                          content={`↑${state.inputTokens.toLocaleString()} ↓${state.outputTokens.toLocaleString()}`}
                          fg={activeTheme.colors.muted}
                        />
                        {historyLabel && (
                          <box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                            <text content="History" fg={activeTheme.colors.muted} />
                            <text content={historyLabel} fg={activeTheme.colors.muted} />
                          </box>
                        )}
                        <box
                          style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                          onMouseUp={() => {
                            updateState((prev) => ({
                              activeStatusPopup: prev.activeStatusPopup === 'lsp' ? null : 'lsp'
                            }));
                          }}
                        >
                          <text content="LSP" fg={activeTheme.colors.muted} />
                          <box style={{ flexDirection: 'row' }}>
                            <text content="●" fg={lspDotColor} />
                            <text
                              content={` ${lspCount}`}
                              fg={state.activeStatusPopup === 'lsp' ? activeTheme.colors.highlight : activeTheme.colors.secondary}
                            />
                          </box>
                        </box>
                        <box
                          style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                          onMouseUp={() => {
                            updateState((prev) => ({
                              activeStatusPopup: prev.activeStatusPopup === 'idx' ? null : 'idx'
                            }));
                          }}
                        >
                          <text content="Index" fg={activeTheme.colors.muted} />
                          <text content={indexLabel} fg={indexColor} />
                        </box>
                        {aiStats && (
                          <box
                            style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                            onMouseUp={() => {
                              updateState((prev) => ({
                                activeStatusPopup: prev.activeStatusPopup === 'patchModel' ? null : 'patchModel'
                              }));
                            }}
                          >
                            <text content="Patch" fg={activeTheme.colors.muted} />
                            <text
                              content={aiStats.patchModel}
                              fg={state.activeStatusPopup === 'patchModel' ? activeTheme.colors.highlight : activeTheme.colors.muted}
                            />
                          </box>
                        )}
                        <box
                          style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                          onMouseUp={() => {
                            updateState((prev) => ({
                              activeStatusPopup: prev.activeStatusPopup === 'model' ? null : 'model',
                              selectedPopupIndex: models.findIndex(m => m.id === state.currentModel)
                            }));
                          }}
                        >
                          <text content="Model" fg={activeTheme.colors.muted} />
                          <text
                            content={modelLabel}
                            fg={state.activeStatusPopup === 'model' ? activeTheme.colors.highlight : activeTheme.colors.primary}
                            bold
                          />
                        </box>
                      </box>
                      <text content="Context" fg={activeTheme.colors.muted} bold />
                      <box style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1 }}>
                        <text content={contextBar} fg={activeTheme.colors.secondary} />
                        <text content={percentLabel} fg={activeTheme.colors.muted} />
                      </box>
                      <box style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 1 }}>
                        <text content="• " fg={activeTheme.colors.muted} />
                        <text content="System " fg={activeTheme.colors.muted} />
                        <text content="• " fg={activeTheme.colors.muted} />
                        <text content="AI " fg={activeTheme.colors.assistantMessage} />
                        <text content="• " fg={activeTheme.colors.muted} />
                        <text content="User " fg={activeTheme.colors.userMessage} />
                        <text content="• " fg={activeTheme.colors.muted} />
                        <text content="Tool/Cached" fg={activeTheme.colors.warning} />
                      </box>
                      <text content={`${totalTokens.toLocaleString()} tokens (0% prompt cached)`} fg={activeTheme.colors.muted} />
                      <text content="$0.00 spent (saved $0.00)" fg={activeTheme.colors.muted} />
                      <box
                        style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 1 }}
                        onMouseUp={() => updateState((prev) => ({ todosSectionExpanded: !prev.todosSectionExpanded }))}
                      >
                        <text content={`${state.todosSectionExpanded ? '▾' : '▣'} Todos (${todoCount})`} fg={activeTheme.colors.secondary} bold />
                      </box>
                      {state.todosSectionExpanded && (
                        todoCount === 0 ? (
                          <text content="  No todos yet" fg={activeTheme.colors.muted} />
                        ) : (
                          todos.map((todo) => {
                            const statusIcon = todo.status === 'completed' ? '✓' :
                              todo.status === 'in_progress' ? '◐' :
                              todo.status === 'cancelled' ? '✗' : '○';
                            const statusColor = todo.status === 'completed' ? activeTheme.colors.success :
                              todo.status === 'in_progress' ? activeTheme.colors.info :
                              todo.status === 'cancelled' ? activeTheme.colors.error : activeTheme.colors.muted;
                            const contentColor = todo.status === 'completed' ? activeTheme.colors.muted : activeTheme.colors.text;
                            return (
                              <box key={`todo-${todo.id}`} style={{ flexDirection: 'row' }}>
                                <text content={`  ${statusIcon} `} fg={statusColor} />
                                <text content={todo.content.slice(0, 35) + (todo.content.length > 35 ? '…' : '')} fg={contentColor} />
                              </box>
                            );
                          })
                        )
                      )}
                      <box
                        style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 1 }}
                        onMouseUp={() => updateState((prev) => ({ toolsSectionExpanded: !prev.toolsSectionExpanded }))}
                      >
                        <text content={`${state.toolsSectionExpanded ? '▾' : '▣'} Tools (${toolCount})`} fg={activeTheme.colors.secondary} bold />
                      </box>
                      {state.toolsSectionExpanded && (
                        toolCount === 0 ? (
                          <text content="  No tools used yet" fg={activeTheme.colors.muted} />
                        ) : (
                          <box style={{ flexDirection: 'row', flexWrap: 'wrap', paddingLeft: 2 }}>
                            {toolActivity.map((tool) => (
                              <text
                                key={`tool-chip-${tool.name}`}
                                content={` ${tool.name.toLowerCase()}${tool.count > 1 ? ` x${tool.count}` : ''} `}
                                fg={tool.isActive ? 'black' : activeTheme.colors.muted}
                                bg={tool.isActive ? activeTheme.colors.toolChipActive : undefined}
                                style={{ marginRight: 1 }}
                              />
                            ))}
                          </box>
                        )
                      )}
                      <box
                        style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 1 }}
                        onMouseUp={() => updateState((prev) => ({ contextSectionExpanded: !prev.contextSectionExpanded }))}
                      >
                        <text content={`${state.contextSectionExpanded ? '▾' : '▣'} Context (${contextCount})`} fg={activeTheme.colors.secondary} bold />
                        <text content="+ edit" fg={activeTheme.colors.secondary} />
                      </box>
                      {state.contextSectionExpanded && (
                        contextCount === 0 ? (
                          <text content="  No contexts created yet" fg={activeTheme.colors.muted} />
                        ) : (
                          state.contextChips.map((chip) => (
                            <text key={`context-side-${chip.id}`} content={`  • ${chip.label}`} fg={activeTheme.colors.muted} />
                          ))
                        )
                      )}
                      <box
                        style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 1 }}
                        onMouseUp={() => updateState((prev) => ({ subAgentsSectionExpanded: !prev.subAgentsSectionExpanded }))}
                      >
                        <text content={`${state.subAgentsSectionExpanded ? '▾' : '▣'} Subagents (${subagentCount})`} fg={activeTheme.colors.secondary} bold />
                      </box>
                      {state.subAgentsSectionExpanded && (
                        subagentCount === 0 ? (
                          <text content="  No subagents yet" fg={activeTheme.colors.muted} />
                        ) : (
                          state.subAgents.map((agent, agentIdx) => {
                            const brailleFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
                            const isProcessing = agent.status === 'running' || agent.status === 'waiting';
                            const icon = isProcessing ? brailleFrames[animFrame % brailleFrames.length] : '•';
                            const contextLabel = agent.progress?.percent !== undefined 
                              ? `${agent.progress.percent}%` 
                              : '';
                            return (
                              <box
                                key={`subagent-${agent.id}`}
                                style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                                onMouseUp={() => {
                                  updateState((prev) => ({
                                    openedSubagentTabs: prev.openedSubagentTabs.includes(agent.id)
                                      ? prev.openedSubagentTabs
                                      : [...prev.openedSubagentTabs, agent.id],
                                    activeAgentTabId: agent.id
                                  }));
                                }}
                              >
                                <text content={`  ${icon} ${agent.id}`} fg={isProcessing ? activeTheme.colors.info : activeTheme.colors.muted} />
                                <box style={{ flexDirection: 'row' }}>
                                  {contextLabel && <text content={contextLabel} fg={activeTheme.colors.muted} style={{ marginRight: 2 }} />}
                                  <text content={agent.status} fg={getAgentStatusColor(agent.status)} />
                              </box>
                            </box>
                          );
                        })
                        )
                      )}
                      <box
                        style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 1 }}
                        onMouseUp={() => updateState((prev) => ({ changesSectionExpanded: !prev.changesSectionExpanded }))}
                      >
                        <text content={`${state.changesSectionExpanded ? '▾' : '▣'} Changes`} fg={activeTheme.colors.secondary} bold />
                      </box>
                      {state.changesSectionExpanded && (
                        <text content="  No changes tracked yet" fg={activeTheme.colors.muted} />
                      )}
                    </>
                  )}
                </box>
              </box>
            </>
          );
        })()}
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
            ...dialogSurfaceStyle
          }}
        >
          <box style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1 }}>
            <text content="AI Tools Status" fg={activeTheme.colors.muted} bold />
            <text
              content="esc"
              fg={activeTheme.colors.muted}
              onMouseUp={() => setShowStatusDialog(false)}
            />
          </box>
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
            ...dialogSurfaceStyle
          }}
        >
          {/* Header row with title and close button */}
          <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1, marginBottom: 1 }}>
            <text content="Select Model" fg={activeTheme.colors.muted} bold />
            <text
              content="esc"
              fg={activeTheme.colors.muted}
              onMouseUp={() => setShowModelDialog(false)}
            />
          </box>
          {models.map((model, idx) => {
            const isSelected = selectedModelIndex === idx;
            const isCurrent = state.currentModel === model.display;
            return (
              <box
                key={model.id}
                style={{
                  paddingLeft: 1,
                  paddingRight: 1,
                  flexDirection: 'row',
                  ...(isSelected ? { backgroundColor: activeTheme.colors.highlight } : {})
                }}
              >
                <text
                  content={model.name}
                  fg={isSelected ? dialogHighlightText : activeTheme.colors.muted}
                  bold={isSelected}
                />
                <text
                  content={isCurrent ? ' ●' : ''}
                  fg={isSelected ? dialogHighlightText : activeTheme.colors.primary}
                />
              </box>
            );
          })}
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
            ...dialogSurfaceStyle
          }}
        >
          {/* Header row with title and close button */}
          <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1, marginBottom: 1 }}>
            <text content="Select Provider" fg={activeTheme.colors.muted} bold />
            <text
              content="esc"
              fg={activeTheme.colors.muted}
              onMouseUp={() => setShowProviderDialog(false)}
            />
          </box>
          {providers.map((provider, idx) => {
            const isSelected = selectedProviderIndex === idx;
            const rowText = isSelected ? dialogHighlightText : activeTheme.colors.muted;
            return (
              <box
                key={provider.id}
                style={{
                  paddingLeft: 1,
                  paddingRight: 1,
                  flexDirection: 'column',
                  ...(isSelected ? { backgroundColor: activeTheme.colors.highlight } : {})
                }}
              >
                <box>
                  <text
                    content={provider.name}
                    fg={rowText}
                    bold={isSelected}
                  />
                </box>
                <text content={`  ${provider.description}`} fg={rowText} />
              </box>
            );
          })}
        </box>
      )}

      {/* Layout Menu (Ctrl+B to toggle) */}
      {showLayoutMenu && (() => {
        const dialogWidth = 34;
        const dialogHeight = layoutMenuOptions.length + 4;
        const centerLeft = Math.max(0, Math.floor((terminalSize.columns - dialogWidth) / 2));
        const centerTop = Math.max(0, Math.floor((terminalSize.rows - dialogHeight) / 2));

        return (
          <box
            style={{
              position: 'absolute',
              left: centerLeft,
              top: centerTop,
              width: dialogWidth,
              height: dialogHeight,
              flexDirection: 'column',
              zIndex: 1000,
              ...dialogSurfaceStyle
            }}
          >
            {/* Header row with title and close button */}
            <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1, marginBottom: 1 }}>
              <text content="Layout" fg={activeTheme.colors.muted} bold />
              <text
                content="esc"
                fg={activeTheme.colors.muted}
                onMouseUp={() => setShowLayoutMenu(false)}
              />
            </box>
            {layoutMenuOptions.map((option, idx) => {
              const isSelected = layoutMenuIndex === idx;
              return (
                <box
                  key={option.id}
                  style={{
                    paddingLeft: 1,
                    paddingRight: 1,
                    flexDirection: 'row',
                    ...(isSelected ? { backgroundColor: activeTheme.colors.highlight } : {})
                  }}
                  onMouseUp={() => {
                    if (option.id === 'left') {
                      updateState((prev) => ({ leftSidebarOpen: !prev.leftSidebarOpen }));
                    } else if (option.id === 'right') {
                      updateState((prev) => ({ rightSidebarOpen: !prev.rightSidebarOpen }));
                    }
                    setShowLayoutMenu(false);
                  }}
                >
                  <text
                    content={option.label}
                    fg={isSelected ? dialogHighlightText : activeTheme.colors.muted}
                    bold={isSelected}
                  />
                </box>
              );
            })}
          </box>
        );
      })()}

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
              ...dialogSurfaceStyle
            }}
          >
            {/* Header row */}
            <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1 }}>
              <text content="Themes" fg={activeTheme.colors.muted} bold />
              <text
                content="esc"
                fg={activeTheme.colors.muted}
                onMouseUp={() => {
                  updateState({ showThemePicker: false });
                  setPreviewTheme(null);
                  setThemeSearch('');
                }}
              />
            </box>
            {/* Search input */}
            <box style={{ marginBottom: 1 }}>
              <text content="Search" fg={activeTheme.colors.muted} />
              <box style={{ backgroundColor: activeTheme.colors.background, paddingLeft: 1, paddingRight: 1 }}>
                <text content={cursorVisible ? '█' : ' '} fg={activeTheme.colors.secondary} />
                <text
                  content={themeSearch || 'Type to filter'}
                  fg={themeSearch ? activeTheme.colors.assistantMessage : activeTheme.colors.muted}
                />
              </box>
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
              const rowFg = isCurrent ? dialogHighlightText : activeTheme.colors.muted;
              return (
                <box
                  key={theme.name}
                  style={{
                    paddingLeft: 1,
                    paddingRight: 1,
                    flexDirection: 'row',
                    ...(isCurrent ? { backgroundColor: activeTheme.colors.highlight } : {})
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
                    content={theme.name}
                    fg={rowFg}
                    bold={isCurrent}
                  />
                  <text content={isCurrent ? ' ✓' : ''} fg={isCurrent ? dialogHighlightText : theme.colors.accent} />
                </box>
              );
            })}
          </box>
        );
      })()}

      {/* Status Bar Popups - centered dialogs */}

      {/* Model Selector Popup */}
      {state.activeStatusPopup === 'model' && (() => {
        const dialogWidth = 35;
        const dialogHeight = models.length + 4;
        const centerLeft = Math.max(0, Math.floor((terminalSize.columns - dialogWidth) / 2));
        const centerTop = Math.max(0, Math.floor((terminalSize.rows - dialogHeight) / 2));
        return (
          <box
            style={{
              position: 'absolute',
              left: centerLeft,
              top: centerTop,
              width: dialogWidth,
              height: dialogHeight,
              flexDirection: 'column',
              zIndex: 1002,
              ...dialogSurfaceStyle
            }}
          >
          {/* Header row with title and close button */}
          <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1, marginBottom: 1 }}>
            <text content="Model" fg={activeTheme.colors.muted} bold />
            <text
              content="esc"
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
                style={{
                  paddingLeft: 1,
                  paddingRight: 1,
                  flexDirection: 'row',
                  ...(isSelected ? { backgroundColor: activeTheme.colors.highlight } : {})
                }}
                onMouseUp={() => {
                  updateState({
                    currentModel: model.display,
                    activeStatusPopup: null
                  });
                }}
              >
                <text
                  content={model.name}
                  fg={isSelected ? dialogHighlightText : activeTheme.colors.muted}
                  bold={isSelected}
                />
                <text
                  content={isCurrent ? ' ●' : ''}
                  fg={isSelected ? dialogHighlightText : activeTheme.colors.primary}
                />
              </box>
            );
          })}
          </box>
        );
      })()}

      {/* Mode Selector Popup */}
      {state.activeStatusPopup === 'mode' && (() => {
        const dialogWidth = 30;
        const dialogHeight = 6;
        const centerLeft = Math.max(0, Math.floor((terminalSize.columns - dialogWidth) / 2));
        const centerTop = Math.max(0, Math.floor((terminalSize.rows - dialogHeight) / 2));
        return (
          <box
            style={{
              position: 'absolute',
              left: centerLeft,
              top: centerTop,
              width: dialogWidth,
              height: dialogHeight,
              flexDirection: 'column',
              zIndex: 1002,
              ...dialogSurfaceStyle
            }}
          >
          {/* Header row with title and close button */}
          <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1, marginBottom: 1 }}>
            <text content="Mode" fg={activeTheme.colors.muted} bold />
            <text
              content="esc"
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
                style={{
                  paddingLeft: 1,
                  paddingRight: 1,
                  flexDirection: 'row',
                  ...(isSelected ? { backgroundColor: activeTheme.colors.highlight } : {})
                }}
                onMouseUp={() => {
                  updateState({
                    agentMode: mode,
                    activeStatusPopup: null
                  });
                }}
              >
                <text
                  content={mode.toUpperCase()}
                  fg={isSelected ? dialogHighlightText : activeTheme.colors.muted}
                  bold={isSelected}
                />
                <text
                  content={isCurrent ? ' ●' : ''}
                  fg={isSelected ? dialogHighlightText : activeTheme.colors.primary}
                />
              </box>
            );
          })}
          </box>
        );
      })()}

      {/* Context Status Popup */}
      {state.activeStatusPopup === 'context' && (() => {
        const dialogWidth = 55;
        const dialogHeight = 11;
        const centerLeft = Math.max(0, Math.floor((terminalSize.columns - dialogWidth) / 2));
        const centerTop = Math.max(0, Math.floor((terminalSize.rows - dialogHeight) / 2));
        return (
          <box
            style={{
              position: 'absolute',
              left: centerLeft,
              top: centerTop,
              width: dialogWidth,
              height: dialogHeight,
              flexDirection: 'column',
              zIndex: 1002,
              ...dialogSurfaceStyle
            }}
          >
          {/* Header row with title and close button */}
          <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1 }}>
            <text content="Context Window" fg={activeTheme.colors.muted} bold />
            <text
              content="esc"
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
        );
      })()}

      {/* LSP Status Popup */}
      {state.activeStatusPopup === 'lsp' && aiStats && (() => {
        const dialogWidth = 50;
        const dialogHeight = 9;
        const centerLeft = Math.max(0, Math.floor((terminalSize.columns - dialogWidth) / 2));
        const centerTop = Math.max(0, Math.floor((terminalSize.rows - dialogHeight) / 2));
        return (
          <box
            style={{
              position: 'absolute',
              left: centerLeft,
              top: centerTop,
              width: dialogWidth,
              height: dialogHeight,
              flexDirection: 'column',
              zIndex: 1002,
              ...dialogSurfaceStyle
            }}
          >
          {/* Header row with title and close button */}
          <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1 }}>
            <text content="LSP Status" fg={activeTheme.colors.muted} bold />
            <text
              content="esc"
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
        );
      })()}

      {/* IDX Status Popup */}
      {state.activeStatusPopup === 'idx' && aiStats && (() => {
        const dialogWidth = 55;
        const dialogHeight = 12;
        const centerLeft = Math.max(0, Math.floor((terminalSize.columns - dialogWidth) / 2));
        const centerTop = Math.max(0, Math.floor((terminalSize.rows - dialogHeight) / 2));
        return (
          <box
            style={{
              position: 'absolute',
              left: centerLeft,
              top: centerTop,
              width: dialogWidth,
              height: dialogHeight,
              flexDirection: 'column',
              zIndex: 1002,
              ...dialogSurfaceStyle
            }}
          >
          {/* Header row with title and close button */}
          <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1 }}>
            <text content="Index Status" fg={activeTheme.colors.muted} bold />
            <text
              content="esc"
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
        );
      })()}

      {/* Patch Model Popup */}
      {state.activeStatusPopup === 'patchModel' && aiStats && (() => {
        const dialogWidth = 50;
        const dialogHeight = 11;
        const centerLeft = Math.max(0, Math.floor((terminalSize.columns - dialogWidth) / 2));
        const centerTop = Math.max(0, Math.floor((terminalSize.rows - dialogHeight) / 2));
        return (
          <box
            style={{
              position: 'absolute',
              left: centerLeft,
              top: centerTop,
              width: dialogWidth,
              height: dialogHeight,
              flexDirection: 'column',
              zIndex: 1002,
              ...dialogSurfaceStyle
            }}
          >
          {/* Header row with title and close button */}
          <box style={{ flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 1, paddingRight: 1 }}>
            <text content="AI Model" fg={activeTheme.colors.muted} bold />
            <text
              content="esc"
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
        );
      })()}
    </box>
  );
};
