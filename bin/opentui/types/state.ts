/**
 * Application state type
 */

import type { OrchestrationContext, SubAgent } from 'claude-agent-loop';
import type { SessionSummary } from '../../../src/session-storage.js';
import type { AiToolsService } from '../../claudelet-ai-tools.js';
import type { ContextChip } from './input.js';
import type { Message } from './messages.js';
import type { Theme } from './theme.js';
import type { ThinkingSession } from './session.js';

export interface AppState {
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
  // Sidebar layout state
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  leftSidebarWidth: number;
  rightSidebarWidth: number;
  isDraggingSidebar: 'left' | 'right' | null;
  dragStartX: number | null;
  dragStartLeftWidth: number | null;
  dragStartRightWidth: number | null;
}
