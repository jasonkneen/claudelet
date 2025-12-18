#!/usr/bin/env bun
/**
 * Claudelet TUI - Beautiful Terminal UI for Claude Agent
 *
 * Features:
 * - Fixed input bar with clean design
 * - Real-time thinking and tool indicators
 * - Smart message queue visualization
 * - @ file references with autocomplete
 * - All /commands supported
 *
 * Run with:
 *   bun run bin/claudelet-tui.tsx
 *   claudelet (if installed globally)
 */
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import {
  createAuthManager,
  startAgentSession,
  type AgentSessionHandle
} from 'claude-agent-loop';
import { Box, render, Text, useApp, useInput, useStdin } from 'ink';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { clearAuth, loadAuth, saveAuth } from '../src/auth-storage.js';
import { sanitizeText } from '../src/env-sanitizer.js';
import { AiToolsService } from './claudelet-ai-tools.js';

const MAX_THINKING_TOKENS = 16_000;
const TODOS_FILE = '.todos.md';
const MAX_FILE_SIZE = 500_000; // 500KB

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
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

// Input segment - either text or a chip
type InputSegment = { type: 'text'; text: string } | { type: 'chip'; chip: FileChip };

interface AppState {
  messages: Message[];
  isResponding: boolean;
  currentModel: string;
  sessionId?: string;
  showThinking: boolean;
  thinkingContent: string;
  currentTool?: string;
  queuedMessages: number;
  showTaskList: boolean;
  expandedToolIds: Set<string>;
  currentToolId?: string; // Track the currently active tool for capturing output
  messageScrollOffset: number; // For scrolling through messages
  inputTokens: number;
  outputTokens: number;
  aiTools?: AiToolsService;
  agentMode: 'coding' | 'planning'; // Current agent mode
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
      } else {
        return `[${seg.chip.label}]`;
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
      } else {
        const content = await resolveFileReference(seg.chip.filePath);
        if (content) {
          return `\`\`\`${seg.chip.label}\n${content}\n\`\`\``;
        } else {
          return `[File not found: ${seg.chip.label}]`;
        }
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
 * Get background color for tool chip based on tool name
 */
function getToolChipColor(toolName?: string): 'white' | 'gray' | 'blackBright' | 'cyan' | 'yellow' | 'green' {
  if (!toolName) return 'white';
  const normalized = toolName.toLowerCase();

  // Map tool names to colors
  const colorMap: Record<string, 'white' | 'gray' | 'blackBright' | 'cyan' | 'yellow' | 'green'> = {
    edit: 'white',
    read: 'gray',
    write: 'white',
    bash: 'blackBright',
    grep: 'gray',
    glob: 'white',
    task: 'gray',
    websearch: 'white',
    webfetch: 'gray',
    search: 'cyan',
    diagnose: 'yellow',
    apply: 'green'
  };

  return colorMap[normalized] || 'white';
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

    // Read directory contents asynchronously
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
 * Find completions for current input segments (async for file I/O)
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

const ChatApp: React.FC<{
  apiKey?: string;
  oauthToken?: string;
}> = ({ apiKey, oauthToken }) => {
  const { exit } = useApp();
  const { stdin } = useStdin();
  const [state, setState] = useState<AppState>({
    messages: [
      {
        role: 'system',
        content:
          '[*] Claudelet - Claude Agent Chat\n\nCommands: /help /init /quit /stop /model /logout\nNew: /search <query>, /diagnose <file>\nFile refs: @path/to/file.ts → Tab to add as chip\n\nTab: autocomplete | ↑↓: history | Ctrl+J: newline | Ctrl+E: expand tool | Ctrl+P/N: scroll | Ctrl+T: tasks | Shift+Tab: toggle mode',
        timestamp: new Date()
      }
    ],
    isResponding: false,
    currentModel: 'smart-sonnet',
    showThinking: false,
    thinkingContent: '',
    queuedMessages: 0,
    showTaskList: false,
    expandedToolIds: new Set(),
    currentToolId: undefined,
    messageScrollOffset: 0,
    inputTokens: 0,
    outputTokens: 0,
    agentMode: 'coding'
  });
  const [inputSegments, setInputSegments] = useState<InputSegment[]>([{ type: 'text', text: '' }]);
  const [session, setSession] = useState<AgentSessionHandle | null>(null);
  const [inputMode, setInputMode] = useState<'chat' | 'blocked'>('chat');

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
    indexer: { isIndexing: boolean; current: number; total: number; totalFiles: number; totalChunks: number; phase: string };
    patchModel: string;
  } | null>(null);

  // Initialize AI Tools
  useEffect(() => {
    const initAiTools = async () => {
      try {
        // Use factory method instead of singleton pattern
        const tools = AiToolsService.create(process.cwd());

        // Attach listeners
        tools.on('download:progress', (p) => {
          setDownloadProgress(p);
        });
        tools.on('download:complete', () => {
          setDownloadProgress(null);
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, { role: 'system', content: '[+] Model download complete', timestamp: new Date() }]
          }));
        });

        tools.on('status:change', (stats) => {
          setAiStats(stats);
        });

        await tools.initialize();
        setState(prev => ({ ...prev, aiTools: tools }));
        setAiStats(tools.getStats());

        // Cleanup on unmount
        return () => {
          tools.dispose().catch((err) => {
            // Silently fail if dispose errors
          });
        };
      } catch (err) {
        // Silently fail if tools cant init
      }
    };
    initAiTools();
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
  const [showStopWarning, setShowStopWarning] = useState(false);

  // Flashing cursor
  const [cursorVisible, setCursorVisible] = useState(true);

  // Debounce for completions to prevent blocking I/O on every keystroke
  const completionsDebounceRef = useRef<NodeJS.Timeout | null>(null);

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

  // Flashing cursor effect
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorVisible((prev) => !prev);
    }, 530); // Blink every 530ms
    return () => clearInterval(interval);
  }, []);

  // Update completions when input changes (debounced to prevent blocking I/O on every keystroke)
  useEffect(() => {
    // Clear previous timeout
    if (completionsDebounceRef.current) {
      clearTimeout(completionsDebounceRef.current);
    }

    if (inputMode === 'chat' && inputSegments.length > 0) {
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
  }, [inputSegments, inputMode]);

  // Initialize session
  useEffect(() => {
    const initSession = async (): Promise<void> => {
      try {
        const newSession = await startAgentSession(
          {
            ...(oauthToken ? { oauthToken } : { apiKey: apiKey! }),
            workingDirectory: process.cwd(),
            modelPreference: 'smart-sonnet',
            maxThinkingTokens: MAX_THINKING_TOKENS,
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
              setState((prev) => {
                const lastMsg = prev.messages[prev.messages.length - 1];
                // Append to last message if it's assistant, otherwise create new
                if (lastMsg?.role === 'assistant') {
                  return {
                    ...prev,
                    showThinking: false, // Clear thinking state when text starts
                    outputTokens: prev.outputTokens + estimateTokenCount(text),
                    messages: [
                      ...prev.messages.slice(0, -1),
                      { ...lastMsg, content: lastMsg.content + text }
                    ]
                  };
                } else {
                  return {
                    ...prev,
                    showThinking: false, // Clear thinking state when text starts
                    outputTokens: prev.outputTokens + estimateTokenCount(text),
                    messages: [
                      ...prev.messages,
                      { role: 'assistant', content: text, timestamp: new Date() }
                    ]
                  };
                }
              });
            },

            onThinkingStart: () => {
              setState((prev) => ({ ...prev, showThinking: true, thinkingContent: '' }));
            },
            onThinkingChunk: (data: { delta: string }) => {
              setState((prev) => ({
                ...prev,
                thinkingContent: prev.thinkingContent + data.delta,
                outputTokens: prev.outputTokens + estimateTokenCount(data.delta)
              }));
            },

            onToolUseStart: (tool: {
              id: string;
              name: string;
              input: Record<string, unknown>;
            }) => {
              setState((prev) => {
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
                  ...prev,
                  currentTool: tool.name,
                  currentToolId: tool.id,
                  messages: [...prev.messages, toolMessage]
                };
              });
            },
            onToolResultComplete: (result: {
              toolUseId: string;
              content: string;
              isError?: boolean;
            }) => {
              setState((prev) => {
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
                  ...prev,
                  currentTool: undefined,
                  currentToolId: undefined,
                  messages: updatedMessages
                };
              });
            },

            onSessionInit: (data: { sessionId: string; resumed?: boolean }) => {
              setState((prev) => ({
                ...prev,
                sessionId: data.sessionId,
                messages: [
                  ...prev.messages,
                  {
                    role: 'system',
                    content: `[+] Session: ${data.sessionId.slice(0, 8)}${data.resumed ? ' (resumed)' : ''}`,
                    timestamp: new Date()
                  }
                ]
              }));
            },
            onMessageComplete: () => {
              setState((prev) => ({
                ...prev,
                isResponding: false,
                showThinking: false,
                thinkingContent: '',
                currentTool: undefined
              }));
              setInputMode('chat');
            },
            onMessageStopped: () => {
              setState((prev) => ({
                ...prev,
                isResponding: false,
                showThinking: false,
                messages: [
                  ...prev.messages,
                  { role: 'system', content: '[!] Response stopped', timestamp: new Date() }
                ]
              }));
              setInputMode('chat');
            },
            onError: (error: string) => {
              setState((prev) => ({
                ...prev,
                isResponding: false,
                showThinking: false,
                messages: [
                  ...prev.messages,
                  { role: 'system', content: `[x] Error: ${error}`, timestamp: new Date() }
                ]
              }));
              setInputMode('chat');
            }
          }
        );
        setSession(newSession);
        setInputMode('chat');
      } catch (error) {
        setState((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              role: 'system',
              content: `[x] Failed to start session: ${error}`,
              timestamp: new Date()
            }
          ]
        }));
        setTimeout(() => exit(), 2000);
      }
    };

    initSession();

    return () => {
      session?.stop();
    };
  }, [apiKey, oauthToken]);

  const handleSubmit = useCallback(
    async (segments: InputSegment[]) => {
      const displayText = segmentsToDisplayString(segments).trim();
      if (!displayText) return;

      // Add to history
      setHistory((prev) => [...prev, segments]);
      setHistoryIndex(-1);
      setTempInput([{ type: 'text', text: '' }]);

      // Add user message (display version) and update input tokens
      setState((prev) => ({
        ...prev,
        inputTokens: prev.inputTokens + estimateTokenCount(displayText),
        messages: [...prev.messages, { role: 'user', content: displayText, timestamp: new Date() }]
      }));
      setInputSegments([{ type: 'text', text: '' }]);
      setShowCompletions(false);

      // Handle /help command
      if (displayText === '/help') {
        setState((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              role: 'system',
              content: `[?] Commands:
/help           - Show this help
/init           - Generate AGENTS.md for this project
/clear          - Clear conversation
/quit, /exit    - Exit chat
/stop           - Interrupt response
/model <name>   - Switch model (fast/haiku/sonnet/opus)
/logout         - Clear authentication

[AI Tools]:
/search <query> - Semantic code search (MGrep)
/diagnose <file>- Get LSP diagnostics for file
/apply <patch>  - Apply code patch (FastApply)

[@] File References:
@path/to/file   - Tab to add as chip (file content embedded)
@./             - Reference from cwd

[⌨] Keyboard Shortcuts:
Tab             - Autocomplete files/commands
Shift+Tab       - Toggle coding/planning mode
↑/↓             - History navigation / Completions
Enter           - Submit message
Ctrl+J          - Add newline (multi-line input)
Ctrl+T          - Toggle task list
Ctrl+E          - Toggle tool expansion
Ctrl+P          - Scroll messages up (previous)
Ctrl+N          - Scroll messages down (next)
Ctrl+X (×2)     - Stop response (press twice)
Ctrl+C          - Exit

[Q] Smart Queue:
Type while Claude responds to queue messages
Urgent keywords inject immediately`,
              timestamp: new Date()
            }
          ]
        }));
        return;
      }

      // Handle /search (Hybrid: Semantic + Grep fallback with on-demand indexing)
      if (displayText.startsWith('/search ')) {
        const query = displayText.slice(8).trim();
        if (!state.aiTools) {
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, { role: 'system', content: '[x] AI Tools not initialized', timestamp: new Date() }]
          }));
          return;
        }

        setState(prev => ({
          ...prev,
          messages: [...prev.messages, { role: 'system', content: `[🔍] Searching for: "${query}"...`, timestamp: new Date() }]
        }));

        try {
          const { results, source } = await state.aiTools.hybridSearch(query, 5); // Limit to 5 results

          const sourceLabel = source === 'semantic' ? '🧠 semantic'
            : source === 'hybrid' ? '🔀 hybrid (indexed on-demand)'
            : '📝 grep';

          const resultText = results.length > 0
            ? `[${sourceLabel}] ${results.length} result${results.length > 1 ? 's' : ''}\n\n` + results.map(r =>
                `${r.filePath}:${r.metadata.startLine} (${(r.similarity*100).toFixed(0)}%)\n${r.content.trim().slice(0, 120)}${r.content.length > 120 ? '...' : ''}`
              ).join('\n\n')
            : 'No results found.';

          setState(prev => ({
            ...prev,
            messages: [...prev.messages, {
              role: 'tool',
              toolName: 'search',
              toolInput: { query },
              content: resultText,
              timestamp: new Date()
            }]
          }));
        } catch (err) {
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, { role: 'system', content: `[x] Search error: ${err}`, timestamp: new Date() }]
          }));
        }
        return;
      }

      // Handle /diagnose (LSP)
      if (displayText.startsWith('/diagnose ') || displayText.startsWith('/diag ')) {
        const fileArg = displayText.split(' ')[1];
        if (!state.aiTools) {
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, { role: 'system', content: '[x] AI Tools not initialized', timestamp: new Date() }]
          }));
          return;
        }

        if (!fileArg) {
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, { role: 'system', content: '[i] Usage: /diagnose <file>', timestamp: new Date() }]
          }));
          return;
        }

        setState(prev => ({
          ...prev,
          messages: [...prev.messages, { role: 'system', content: `[🩺] Diagnosing ${fileArg}...`, timestamp: new Date() }]
        }));

        try {
          const diagnostics = await state.aiTools.getDiagnostics(fileArg);
          const diagText = diagnostics.map(d => 
            `[${d.severity === 1 ? 'Error' : 'Warning'}] Line ${d.range.start.line + 1}: ${d.message}`
          ).join('\n');

          setState(prev => ({
            ...prev,
            messages: [...prev.messages, { 
              role: 'tool', 
              toolName: 'diagnose', 
              toolInput: { file: fileArg }, 
              content: diagText || 'No issues found.', 
              timestamp: new Date() 
            }]
          }));
        } catch (err) {
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, { role: 'system', content: `[x] Diagnosis error: ${err}`, timestamp: new Date() }]
          }));
        }
        return;
      }

      // Handle /patch-model
      if (displayText.startsWith('/patch-model')) {
        const arg = displayText.split(' ')[1];
        if (!state.aiTools) {
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, { role: 'system', content: '[x] AI Tools not initialized', timestamp: new Date() }]
          }));
          return;
        }

        if (!arg || arg === 'list') {
          const current = state.aiTools.getPatchingModel();
          const available = state.aiTools.getAvailablePatchingModels();
          const list = available.map(m => m === current ? `* ${m}` : `  ${m}`).join('\n');
          
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, { 
              role: 'system', 
              content: `[🤖] Patching Models:\n${list}\n\nUse /patch-model <name> to switch.`, 
              timestamp: new Date() 
            }]
          }));
          return;
        }

        const available = state.aiTools.getAvailablePatchingModels();
        if (!available.includes(arg)) {
           setState(prev => ({
            ...prev,
            messages: [...prev.messages, { role: 'system', content: `[x] Invalid model. Available: ${available.join(', ')}`, timestamp: new Date() }]
          }));
          return;
        }

        setState(prev => ({
          ...prev,
          messages: [...prev.messages, { role: 'system', content: `[⬇] Switching to ${arg}... (may download)`, timestamp: new Date() }]
        }));

        try {
          await state.aiTools.setPatchingModel(arg);
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, { role: 'system', content: `[+] Switched to ${arg}`, timestamp: new Date() }]
          }));
        } catch (err) {
          setState(prev => ({
            ...prev,
            messages: [...prev.messages, { role: 'system', content: `[x] Error switching model: ${err}`, timestamp: new Date() }]
          }));
        }
        return;
      }

      // Handle /init command
      if (displayText === '/init') {
        setState((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              role: 'system',
              content: '[*] Analyzing project and generating AGENTS.md...',
              timestamp: new Date()
            }
          ],
          isResponding: true
        }));
        setInputMode('blocked');

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
          setState((prev) => ({
            ...prev,
            isResponding: false,
            messages: [
              ...prev.messages,
              { role: 'system', content: `[x] Error: ${error}`, timestamp: new Date() }
            ]
          }));
          setInputMode('chat');
        }
        return;
      }

      // Handle /quit
      if (displayText === '/quit' || displayText === '/exit') {
        setState((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            { role: 'system', content: '[-] Goodbye!', timestamp: new Date() }
          ]
        }));
        setTimeout(() => exit(), 500);
        return;
      }

      // Handle /logout
      if (displayText === '/logout') {
        clearAuth();
        setState((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              role: 'system',
              content: '[+] Logged out. Restart to login again.',
              timestamp: new Date()
            }
          ]
        }));
        setTimeout(() => exit(), 500);
        return;
      }

      // Handle /stop
      if (displayText === '/stop') {
        if (state.isResponding) {
          await session?.interrupt();
        } else {
          setState((prev) => ({
            ...prev,
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
        setState((prev) => ({
          ...prev,
          inputTokens: 0,
          outputTokens: 0,
          messages: [
            {
              role: 'system',
              content:
                '[*] Claudelet - Claude Agent Chat\n\nCommands: /help /init /quit /stop /model /logout',
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
            setState((prev) => ({
              ...prev,
              currentModel: model,
              messages: [
                ...prev.messages,
                { role: 'system', content: `[+] Switched to ${model}`, timestamp: new Date() }
              ]
            }));
          } catch (e) {
            setState((prev) => ({
              ...prev,
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
          setState((prev) => ({
            ...prev,
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

      // Send message to Claude
      try {
        setState((prev) => ({ ...prev, isResponding: true }));
        setInputMode('blocked');

        // Convert segments to message content (with file content embedded)
        const messageContent = await segmentsToMessageContent(segments);

        await session?.sendMessage({ role: 'user', content: messageContent });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          isResponding: false,
          messages: [
            ...prev.messages,
            { role: 'system', content: `[x] Error: ${error}`, timestamp: new Date() }
          ]
        }));
        setInputMode('chat');
      }
    },
    [session, state.isResponding, exit, state.aiTools]
  );

  // Handle custom input when in chat mode
  useInput(
    (input, key) => {
      if (inputMode !== 'chat') return;

      // Ctrl+C to exit
      if ((key.ctrl && input === 'c') || input === '\x03') {
        exit();
        return;
      }

      // Ctrl+X to stop/cancel - requires two presses
      if ((key.ctrl && input === 'x') || input === '\x18') {
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
      if (key.shift && key.tab) {
        setState((prev) => {
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
      if ((key.ctrl && input === 't') || input === '\x14') {
        const toggleTaskList = async () => {
          if (!state.showTaskList) {
            // Show task list
            const taskContent = await readTaskList();
            setState((prev) => ({
              ...prev,
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
            setState((prev) => ({ ...prev, showTaskList: false }));
          }
        };
        toggleTaskList();
        return;
      }

      // Ctrl+E to toggle last tool expansion
      if ((key.ctrl && input === 'e') || input === '\x05') {
        setState((prev) => {
          // Find the last tool message
          const lastToolIndex = [...prev.messages]
            .reverse()
            .findIndex((m) => m.role === 'tool');

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
      if ((key.ctrl && input === 'n') || input === '\x0e') {
        setState((prev) => ({
          ...prev,
          messageScrollOffset: Math.max(0, prev.messageScrollOffset - 5)
        }));
        return;
      }

      // Ctrl+P to scroll messages up (previous page)
      if ((key.ctrl && input === 'p') || input === '\x10') {
        setState((prev) => {
          const maxOffset = Math.max(0, prev.messages.length - 15);
          return {
            ...prev,
            messageScrollOffset: Math.min(maxOffset, prev.messageScrollOffset + 5)
          };
        });
        return;
      }

      // Early filter: ignore ONLY control characters that aren't handled above
      // Tab = 0x09 (9), Ctrl+J = 0x0A (10), Enter = 0x0D (13), Ctrl+C = 0x03, Ctrl+X = 0x18, Ctrl+T = 0x14, Ctrl+E = 0x05, Ctrl+N = 0x0e, Ctrl+P = 0x10
      const charCode = input ? input.charCodeAt(0) : -1;
      const allowedControlChars = new Set([9, 10, 13, 3, 24, 20, 5, 14, 16]); // Tab, Ctrl+J, Enter, Ctrl+C, Ctrl+X, Ctrl+T, Ctrl+E, Ctrl+N, Ctrl+P
      if (charCode > 0 && charCode < 32 && !allowedControlChars.has(charCode)) {
        // Ignore unhandled control characters
        return;
      }

      // Tab to complete
      if (key.tab && showCompletions && completions.length > 0) {
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
      if (key.upArrow) {
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

      if (key.downArrow) {
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

      // Ctrl+J to add newline (multi-line input) - linefeed character
      if ((key.ctrl && input === 'j') || input === '\x0a') {
        setInputSegments((prev) => {
          const lastSegment = prev[prev.length - 1];
          if (!lastSegment || lastSegment.type !== 'text') {
            return [...prev, { type: 'text', text: '\n' }];
          }
          return [...prev.slice(0, -1), { type: 'text', text: lastSegment.text + '\n' }];
        });
        return;
      }

      // Return/Enter to submit
      if (key.return) {
        handleSubmit(inputSegments);
        return;
      }

      // Backspace - delete last segment or character
      if (key.backspace || key.delete) {
        setInputSegments((prev) => {
          if (prev.length === 0) return [{ type: 'text', text: '' }];

          const lastSegment = prev[prev.length - 1];

          // If last segment is a chip, remove it entirely
          if (lastSegment.type === 'chip') {
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
            return [...prev.slice(0, -1), { type: 'text', text: newText }];
          }

          return prev;
        });
        return;
      }

      // Regular character input - append to last text segment
      // Ignore control characters (ASCII < 32) and delete (127)
      if (
        input &&
        !key.ctrl &&
        !key.meta &&
        input.charCodeAt(0) >= 32 &&
        input.charCodeAt(0) !== 127
      ) {
        setInputSegments((prev) => {
          const lastSegment = prev[prev.length - 1];

          // Reset history navigation
          if (historyIndex !== -1) {
            setHistoryIndex(-1);
          }

          // If last segment is text, append to it
          if (lastSegment && lastSegment.type === 'text') {
            return [...prev.slice(0, -1), { type: 'text', text: lastSegment.text + input }];
          }

          // If last segment is chip, create new text segment
          return [...prev, { type: 'text', text: input }];
        });
      }
    },
    { isActive: inputMode === 'chat' }
  );

  // Calculate visible messages (with scroll offset) - memoized to avoid unnecessary slices
  const { visibleMessages, scrollOffset } = useMemo(() => {
    const MAX_VISIBLE_MESSAGES = 15;
    const totalMessages = state.messages.length;
    const offset = Math.max(
      0,
      Math.min(state.messageScrollOffset, totalMessages - MAX_VISIBLE_MESSAGES)
    );
    const startIdx =
      totalMessages <= MAX_VISIBLE_MESSAGES ? 0 : totalMessages - MAX_VISIBLE_MESSAGES - offset;
    const endIdx = totalMessages - offset;
    return {
      visibleMessages: state.messages.slice(startIdx, endIdx),
      scrollOffset: offset
    };
  }, [state.messages, state.messageScrollOffset]);

  // Track current row for message display
  let currentRow = 2;

  return (
    <Box flexDirection="column" height="100%">
      {/* Messages area */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
        {visibleMessages.map((msg, i) => {
          const msgStartRow = currentRow;

          return (
            <Box key={`${msg.timestamp.getTime()}-${msg.role}-${i}`} marginBottom={msg.role === 'assistant' ? 1 : 0}>
              {msg.role === 'user' && (
                <Text>
                  <Text bold color="cyan">{'> '}</Text>
                  <Text color="white">{msg.content}</Text>
                </Text>
              )}
              {msg.role === 'assistant' && (
                <Text backgroundColor="green" color="black">
                  {msg.content}
                </Text>
              )}
              {msg.role === 'system' && (
                <Text dimColor italic>
                  {msg.content}
                </Text>
              )}
              {msg.role === 'tool' &&
                (() => {
                  const toolId = msg.toolId;
                  const chipBg = getToolChipColor(msg.toolName);

                  currentRow += msg.isCollapsed ? 3 : 10;

                  return (
                    <Box flexDirection="column">
                      {
                        msg.isCollapsed ?
                          // Collapsed view - just show chip on single line
                          <>
                            <Box>
                              <Text
                                backgroundColor={chipBg}
                                color="black"
                                bold
                              >
                                {` ${msg.toolName?.toUpperCase() || 'TOOL'} `}
                              </Text>
                              {msg.toolInput?.description && (
                                <>
                                  <Text> </Text>
                                  <Text color="white">{msg.toolInput.description as string}</Text>
                                </>
                              )}
                            </Box>
                            {msg.toolMessages && msg.toolMessages.length > 0 && (
                              <Text dimColor italic>
                                {msg.toolMessages.slice(-2).join(' • ')}
                              </Text>
                            )}
                            {msg.content && (
                              <Text dimColor italic>
                                {msg.content.slice(0, 100)}
                                {msg.content.length > 100 && '...'}
                              </Text>
                            )}
                          </>
                          // Expanded view
                        : <>
                            <Box>
                              <Text bold color="cyan">
                                ▾
                              </Text>
                              <Text> </Text>
                              <Text
                                backgroundColor={chipBg}
                                color="black"
                                bold
                              >
                                {` ${msg.toolName?.toUpperCase() || 'TOOL'} `}
                              </Text>
                              {msg.toolInput?.description && (
                                <>
                                  <Text> </Text>
                                  <Text color="white">{msg.toolInput.description as string}</Text>
                                </>
                              )}
                            </Box>
                            {msg.toolInput && Object.keys(msg.toolInput).length > 0 && (
                              <Box flexDirection="column" marginLeft={2}>
                                <Text dimColor>Input:</Text>
                                <Text color="white">{JSON.stringify(msg.toolInput, null, 2)}</Text>
                              </Box>
                            )}
                            {msg.content && (
                              <Box flexDirection="column" marginLeft={2}>
                                <Text dimColor>Result:</Text>
                                <Text color="white">{msg.content}</Text>
                              </Box>
                            )}
                          </>

                      }
                    </Box>
                  );
                })()}
              {(() => {
                // Update row counter for non-tool messages
                if (msg.role !== 'tool') {
                  currentRow += 2; // Approximate 2 rows per message
                }
                return null;
              })()}
            </Box>
          );
        })}

        {/* Horizontal tool chips display - show all active/recent tools on one line */}
        {state.messages.filter((m) => m.role === 'tool').length > 0 && (
          <Box marginTop={1}>
            <Text dimColor>Tools: </Text>
            {state.messages
              .filter((m) => m.role === 'tool')
              .slice(-10)
              .map((msg, idx) => {
                const chipBg = getToolChipColor(msg.toolName);
                return (
                  <Box key={`chip-${msg.toolId}-${idx}`}>
                    <Text
                      backgroundColor={chipBg}
                      color="black"
                      bold
                    >
                      {` ${msg.toolName?.toUpperCase() || 'TOOL'} `}
                    </Text>
                    {idx < state.messages.filter((m) => m.role === 'tool').length - 1 && (
                      <Text> </Text>
                    )}
                  </Box>
                );
              })}
          </Box>
        )}

        {/* Scroll indicators */}
        {scrollOffset > 0 && (
          <Box marginTop={0}>
            <Text color="gray" italic>
              ↑ Scroll up to see {scrollOffset} earlier message{scrollOffset > 1 ? 's' : ''}
            </Text>
          </Box>
        )}

        {/* Status indicator - mutually exclusive: tool OR thinking */}
        {state.currentTool ? (
          <Box marginTop={1}>
            <Text color="magenta" italic>
              [⚙] Running: {state.currentTool}...
            </Text>
          </Box>
        ) : state.showThinking ? (
          <Box marginTop={1}>
            <Text color="yellow" italic>
              [...] Thinking...
            </Text>
          </Box>
        ) : null}

        {/* Queue indicator */}
        {state.queuedMessages > 0 && (
          <Box marginTop={0}>
            <Text color="blue" italic>
              [Q] {state.queuedMessages} message{state.queuedMessages > 1 ? 's' : ''} queued
            </Text>
          </Box>
        )}

        {/* Download progress */}
        {downloadProgress && (
          <Box marginTop={0}>
             <Text color="blue">
               [⬇] Downloading {downloadProgress.variant}: {downloadProgress.percent.toFixed(1)}% ({(downloadProgress.speed / 1024 / 1024).toFixed(1)} MB/s) ETA: {downloadProgress.eta}s
             </Text>
          </Box>
        )}

        {/* Stop warning */}
        {showStopWarning && (
          <Box marginTop={0}>
            <Text color="red" bold>
              [!] Press Ctrl+X again to stop
            </Text>
          </Box>
        )}
      </Box>

      {/* Completions dropdown (shown above input) */}
      {showCompletions &&
        completions.length > 0 &&
        (() => {
          const MAX_VISIBLE = 5;
          const total = completions.length;

          // Calculate sliding window to show selected item
          let startIdx = 0;
          let endIdx = Math.min(MAX_VISIBLE, total);

          if (selectedCompletion >= MAX_VISIBLE) {
            // Slide window to show selected item
            startIdx = Math.min(
              selectedCompletion - Math.floor(MAX_VISIBLE / 2),
              total - MAX_VISIBLE
            );
            endIdx = startIdx + MAX_VISIBLE;
          }

          const visibleCompletions = completions.slice(startIdx, endIdx);

          return (
            <Box
              flexDirection="column"
              borderStyle="single"
              borderColor="blue"
              paddingX={1}
              marginX={1}
              marginBottom={0}
            >
              <Text bold color="blue">
                Completions (Tab to select, ↑↓ to navigate):
              </Text>
              {startIdx > 0 && (
                <Text dimColor italic>
                  ↑ {startIdx} more above
                </Text>
              )}
              {visibleCompletions.map((comp, i) => {
                const actualIdx = startIdx + i;

                return (
                  <Box key={`completion-item-${actualIdx}`}>
                    <Text
                      color={actualIdx === selectedCompletion ? 'cyan' : 'white'}
                      bold={actualIdx === selectedCompletion}
                    >
                      {actualIdx === selectedCompletion ? '→ ' : '  '}
                      {comp}
                    </Text>
                  </Box>
                );
              })}
              {endIdx < total && (
                <Text dimColor italic>
                  ↓ {total - endIdx} more below
                </Text>
              )}
            </Box>
          );
        })()}

      {/* Fixed input bar */}
      <Box flexDirection="column">
        {/* Multi-line input support: render each line separately */}
        {inputMode === 'chat' && (
          inputSegments.length === 1 &&
          inputSegments[0].type === 'text' &&
          inputSegments[0].text === ''
        ) ? (
          <Box borderStyle="round" borderColor="gray" paddingX={1}>
            <Text bold color="cyan">{'>'} </Text>
            <Text color="cyan">{cursorVisible ? '█' : ' '}</Text>
            <Text color="gray" italic>
              {' '}
              Type your message... (Tab: complete, ↑↓: history, Ctrl+X×2: stop, Ctrl+C: quit)
            </Text>
          </Box>
        ) : inputMode === 'chat' ? (
          <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={0}>
            {/* Split input into lines for proper cursor display */}
            {(() => {
              const allText = inputSegments
                .map(s => (s.type === 'text' ? s.text : `[${s.chip.label}]`))
                .join('');
              const lines = allText.split('\n');

              return lines.map((line, lineIdx) => (
                <Box key={`line-${lineIdx}`}>
                  {lineIdx === 0 && (
                    <Text bold color="cyan">
                      {'>'}
                    </Text>
                  )}
                  {lineIdx > 0 && (
                    <Text bold color="cyan">
                      {'│ '}
                    </Text>
                  )}
                  {inputSegments.map((segment, i) => {
                    if (segment.type === 'text') {
                      const segmentLines = segment.text.split('\n');
                      const lineText = segmentLines[lineIdx] || '';
                      return lineText ? (
                        <Text key={`text-${i}-${lineIdx}`} color="white">
                          {lineText}
                        </Text>
                      ) : null;
                    } else if (lineIdx === 0) {
                      // Only show chips on first line
                      return (
                        <Text
                          key={`chip-${segment.chip.id}`}
                          backgroundColor="blue"
                          color="white"
                          bold
                        >
                          [{segment.chip.label}]
                        </Text>
                      );
                    }
                    return null;
                  })}
                  {/* Cursor at end of last line */}
                  {lineIdx === lines.length - 1 && (
                    <Text color="cyan">{cursorVisible ? '█' : ' '}</Text>
                  )}
                </Box>
              ));
            })()}
          </Box>
        ) : (
          <Box borderStyle="round" borderColor="gray" paddingX={1}>
            <Text bold color="red">{'[*]'} </Text>
            <Text color="gray" italic>Waiting for response...</Text>
          </Box>
        )}
      {/* Status bar */}
      <Box paddingX={1} paddingRight={1} marginTop={0} flexDirection="row">
        <Text color="gray">
          {state.currentModel} | {state.isResponding ? '[~] Responding' : '[+] Ready'} | Mode:
          <Text bold color={state.agentMode === 'planning' ? 'yellow' : 'green'}>
            {' '}{state.agentMode.toUpperCase()}
          </Text>
          {historyIndex !== -1 && ` | History [${historyIndex + 1}/${history.length}]`}
          {' | Context: '}
          <Text bold color={state.inputTokens + state.outputTokens > 100000 ? 'yellow' : 'cyan'}>
            {(state.inputTokens + state.outputTokens).toLocaleString()} tokens
          </Text>
          {' (↑'}
          <Text color="white">{state.inputTokens.toLocaleString()}</Text>
          {' ↓'}
          <Text color="white">{state.outputTokens.toLocaleString()}</Text>
          {')'}
        </Text>
        
        {/* AI Stats */}
        {aiStats && (
          <Box marginLeft={2}>
             <Text color="gray"> | </Text>
             <Text color={aiStats.lsp.activeServers > 0 ? 'green' : 'gray'}>
               LSP: {aiStats.lsp.activeServers}
             </Text>
             <Text> </Text>
             <Text color={aiStats.indexer.isIndexing ? 'yellow' : 'blue'}>
               IDX: {aiStats.indexer.isIndexing ? `${aiStats.indexer.phase} ${Math.round((aiStats.indexer.current/aiStats.indexer.total)*100)}%` : aiStats.indexer.totalFiles}
             </Text>
             <Text> </Text>
             <Text color="magenta">
               Patch: {aiStats.patchModel}
             </Text>
          </Box>
        )}
      </Box>
      </Box>
    </Box>
  );
};

// Main entry point
async function main(): Promise<void> {
  let apiKey: string | null = null;
  let oauthToken: string | null = null;
  const authManager = createAuthManager();

  // Try to load existing auth
  const storedAuth = loadAuth();

  if (storedAuth) {
    if (storedAuth.type === 'api-key' && storedAuth.apiKey) {
      apiKey = storedAuth.apiKey;
    } else if (storedAuth.type === 'oauth' && storedAuth.oauthTokens) {
      authManager.loadAuthConfig({ oauthTokens: storedAuth.oauthTokens });
      const accessToken = await authManager.getOAuthAccessToken();
      if (accessToken) {
        oauthToken = accessToken;
        const newConfig = authManager.getAuthConfig();
        if (newConfig.oauthTokens) {
          saveAuth({ type: 'oauth', oauthTokens: newConfig.oauthTokens });
        }
      } else {
        console.log('⚠️  Saved tokens expired. Please run claudelet to re-authenticate.');
        process.exit(1);
      }
    }
  }

  if (!apiKey && !oauthToken) {
    console.log('[x] No authentication found. Please run: bun run bin/claudelet.ts');
    console.log('    (The original claudelet handles authentication setup)');
    process.exit(1);
  }

  const { stdin, stdout } = process;

  // Enable raw mode before rendering
  if (stdin.isTTY && stdin.setRawMode) {
    stdin.setRawMode(true);
    stdin.resume();
  }

  // Render the Ink app
  const { waitUntilExit } = render(
    <ChatApp apiKey={apiKey || undefined} oauthToken={oauthToken || undefined} />,
    {
      stdin,
      stdout,
      stderr: process.stderr,
      debug: false,
      exitOnCtrlC: false, // We handle Ctrl+C manually
      patchConsole: false
    }
  );

  // Guarantee cleanup on ANY exit
  process.on('SIGINT', () => {
    if (stdin.isTTY && stdin.setRawMode) {
      stdin.setRawMode(false);
    }
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    if (stdin.isTTY && stdin.setRawMode) {
      stdin.setRawMode(false);
    }
    process.exit(0);
  });

  // Clean up on normal exit
  waitUntilExit().finally(() => {
    if (stdin.isTTY && stdin.setRawMode) {
      stdin.setRawMode(false);
    }
    // Reset Application Cursor Keys
    process.stdout.write('\x1b[?1l');
  });
}

main();
