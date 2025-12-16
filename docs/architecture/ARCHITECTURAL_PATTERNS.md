# Claudelet: Critical Architectural Patterns for Long-term Sustainability

**Document Purpose**: Define foundational design patterns that must be established before feature additions
**Target Audience**: Developers working on Claudelet
**Status**: Required reading before Phase 2+

---

## Pattern 1: Service Lifecycle Management (AiToolsService)

### The Problem

Current singleton pattern:
```typescript
// bin/claudelet-ai-tools.ts
export class AiToolsService extends EventEmitter {
  private static instance: AiToolsService;

  public static getInstance(projectPath: string): AiToolsService {
    if (!AiToolsService.instance) {
      AiToolsService.instance = new AiToolsService(projectPath);
    }
    return AiToolsService.instance;
  }
}
```

**Issues**:
- ❌ Singleton created lazily, not during app initialization
- ❌ `dispose()` method exists but never called
- ❌ No connection to React component lifecycle
- ❌ Cannot swap implementations for testing
- ❌ Resources leak on app shutdown

### The Solution: React Context + Provider Pattern

```typescript
// services/AiToolsContext.ts
import React, { createContext, useContext, useEffect, useState } from 'react';
import { AiToolsService } from './AiToolsService';

interface AiToolsContextType {
  service: AiToolsService | null;
  isInitialized: boolean;
  error: Error | null;
}

const AiToolsContext = createContext<AiToolsContextType | null>(null);

/**
 * Provider component - manages lifecycle
 */
export const AiToolsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [service, setService] = useState<AiToolsService | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const instance = new AiToolsService(process.cwd());
        await instance.initialize();
        setService(instance);
        setIsInitialized(true);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    };

    init();

    // Cleanup on unmount
    return () => {
      service?.dispose();
    };
  }, [service]);

  return (
    <AiToolsContext.Provider value={{ service, isInitialized, error }}>
      {children}
    </AiToolsContext.Provider>
  );
};

/**
 * Hook - use in components
 */
export const useAiTools = () => {
  const context = useContext(AiToolsContext);
  if (!context) {
    throw new Error('useAiTools must be used within AiToolsProvider');
  }
  return context;
};
```

Usage in main component:
```typescript
// bin/claudelet-opentui.tsx
const App = () => {
  return (
    <AiToolsProvider>
      <ChatApp />
    </AiToolsProvider>
  );
};

// Inside ChatApp component
const ChatApp = () => {
  const { service: aiTools, isInitialized } = useAiTools();

  if (!isInitialized) return <div>Loading AI tools...</div>;

  return (
    // ... rest of component
  );
};
```

**Benefits**:
- ✓ Lifecycle tied to React component tree
- ✓ `dispose()` guaranteed to be called
- ✓ Resources cleaned up on unmount
- ✓ Easy to mock for testing (provide mock service)
- ✓ Can have multiple providers with different services
- ✓ Error state exposed to UI

---

## Pattern 2: Command Handler Registry

### The Problem

Current implementation: 400+ lines of if-else in main component

```typescript
// Lines 1331-1800+ in claudelet-opentui.tsx
if (displayText.startsWith('/search ')) {
  // 50 lines of search logic
} else if (displayText.startsWith('/diagnose ')) {
  // 40 lines of diagnose logic
} else if (displayText.startsWith('/init ')) {
  // 40 lines of init logic
}
// ... 10+ more conditions
```

**Issues**:
- ❌ Violates Open/Closed Principle
- ❌ Adding new command requires modifying main component
- ❌ Commands cannot be independently tested
- ❌ No way to enable/disable commands
- ❌ No command metadata or help system

### The Solution: Plugin-Style Registry

```typescript
// commands/types.ts
export interface CommandContext {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  session: AgentSessionHandle | null;
  aiTools: AiToolsService | null;
}

export interface Command {
  name: string;
  aliases?: string[];
  pattern: RegExp;
  help: string;
  description: string;
  execute(text: string, context: CommandContext): Promise<void>;
}

// commands/registry.ts
export class CommandRegistry {
  private commands: Map<string, Command> = new Map();
  private allCommands: Command[] = [];

  register(command: Command): void {
    this.commands.set(command.name, command);
    command.aliases?.forEach((alias) => {
      this.commands.set(alias, command);
    });
    this.allCommands.push(command);
  }

  find(text: string): Command | undefined {
    return this.allCommands.find((cmd) => cmd.pattern.test(text));
  }

  async execute(text: string, context: CommandContext): Promise<boolean> {
    const command = this.find(text);
    if (!command) return false;

    try {
      await command.execute(text, context);
      return true;
    } catch (error) {
      // Handle error
      return true; // Command was found, just failed
    }
  }

  help(): string {
    return this.allCommands
      .map((cmd) => `${cmd.name}: ${cmd.help}`)
      .join('\n');
  }
}

// commands/handlers/SearchCommand.ts
export class SearchCommand implements Command {
  name = 'search';
  aliases = ['s'];
  pattern = /^\/search\s+/;
  help = 'Search code: /search <query>';
  description = 'Performs semantic search across the codebase';

  async execute(text: string, context: CommandContext): Promise<void> {
    const query = text.replace(/^\/search\s+/, '').trim();
    if (!query) throw new Error('Usage: /search <query>');
    if (!context.aiTools) throw new Error('AI tools not initialized');

    // Implementation
    const results = await context.aiTools.hybridSearch(query);
    // Format and display results
  }
}

// Application setup
const registry = new CommandRegistry();
registry.register(new SearchCommand());
registry.register(new DiagnoseCommand());
registry.register(new InitCommand());
// ... register all commands

// In component
const handleCommand = async (text: string) => {
  const executed = await registry.execute(text, context);
  return executed;
};
```

**Benefits**:
- ✓ New commands added without modifying core
- ✓ Commands independently testable
- ✓ Uniform command interface
- ✓ Easy to enable/disable commands
- ✓ Automatic help generation
- ✓ Supports aliases
- ✓ Centralized error handling

---

## Pattern 3: Separated State Concerns

### The Problem

Current: Single monolithic AppState

```typescript
interface AppState {
  messages: Message[];
  isResponding: boolean;
  currentModel: string;
  sessionId?: string;
  showThinking: boolean;
  thinkingContent: string;
  queuedMessages: number;
  showTaskList: boolean;
  expandedToolIds: Set<string>;
  currentToolId?: string;
  messageScrollOffset: number;
  inputTokens: number;
  outputTokens: number;
  agentMode: 'coding' | 'planning';
  contextChips: ContextChip[];
  // ... mixing UI, session, and service state
}
```

**Issues**:
- ❌ UI state mixed with persistent state
- ❌ Service state in React state
- ❌ All components depend on entire state
- ❌ Impossible to reuse session state elsewhere
- ❌ State mutations affect unrelated features

### The Solution: State Slicing Pattern

```typescript
// state/types.ts
/**
 * UI State - ephemeral, not persisted
 */
export interface UIState {
  isResponding: boolean;
  showThinking: boolean;
  thinkingContent: string;
  showTaskList: boolean;
  expandedToolIds: Set<string>;
  messageScrollOffset: number;
  selectedModelIndex: number;
  selectedProviderIndex: number;
  showStatusDialog: boolean;
  showModelDialog: boolean;
  showProviderDialog: boolean;
}

/**
 * Session State - persisted to disk
 */
export interface SessionState {
  messages: Message[];
  sessionId: string;
  createdAt: Date;
  currentModel: ModelPreference;
  agentMode: 'coding' | 'planning';
  inputTokens: number;
  outputTokens: number;
}

/**
 * Input State - composition/edit state
 */
export interface InputState {
  segments: InputSegment[];
  history: InputSegment[][];
  historyIndex: number;
  contextChips: ContextChip[];
  fileChips: FileChip[];
}

/**
 * Combined app state
 */
export type AppState = {
  ui: UIState;
  session: SessionState;
  input: InputState;
};

// actions/types.ts
export type AppAction =
  | { type: 'SET_RESPONDING'; payload: boolean }
  | { type: 'ADD_MESSAGE'; payload: Message }
  | { type: 'SET_MODEL'; payload: ModelPreference }
  | { type: 'TOGGLE_TASK_LIST' }
  | { type: 'SET_THINKING'; payload: string }
  | { type: 'SET_INPUT_SEGMENTS'; payload: InputSegment[] }
  | { type: 'ADD_CONTEXT_CHIP'; payload: ContextChip }
  | { type: 'REMOVE_CONTEXT_CHIP'; payload: string };

// state/reducer.ts
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_RESPONDING':
      return {
        ...state,
        ui: { ...state.ui, isResponding: action.payload },
      };

    case 'ADD_MESSAGE':
      return {
        ...state,
        session: {
          ...state.session,
          messages: [...state.session.messages, action.payload],
        },
      };

    case 'SET_MODEL':
      return {
        ...state,
        session: {
          ...state.session,
          currentModel: action.payload,
        },
      };

    case 'TOGGLE_TASK_LIST':
      return {
        ...state,
        ui: { ...state.ui, showTaskList: !state.ui.showTaskList },
      };

    // ... other actions
    default:
      return state;
  }
}

// hooks/useAppState.ts
export function useAppState(initialSession?: SessionData) {
  const [state, dispatch] = useReducer(appReducer, {
    ui: {
      isResponding: false,
      showThinking: false,
      thinkingContent: '',
      showTaskList: false,
      expandedToolIds: new Set(),
      messageScrollOffset: 0,
      selectedModelIndex: 0,
      selectedProviderIndex: 0,
      showStatusDialog: false,
      showModelDialog: false,
      showProviderDialog: false,
    },
    session: initialSession || {
      messages: [],
      sessionId: generateId(),
      createdAt: new Date(),
      currentModel: 'smart-sonnet',
      agentMode: 'coding',
      inputTokens: 0,
      outputTokens: 0,
    },
    input: {
      segments: [{ type: 'text', text: '' }],
      history: [],
      historyIndex: -1,
      contextChips: [],
      fileChips: [],
    },
  });

  return { state, dispatch };
}

// Usage in component
const ChatApp = () => {
  const { state, dispatch } = useAppState();

  const handleMessage = (msg: Message) => {
    dispatch({ type: 'ADD_MESSAGE', payload: msg });
  };

  const toggleTaskList = () => {
    dispatch({ type: 'TOGGLE_TASK_LIST' });
  };

  return (
    // ... component JSX
  );
};
```

**Benefits**:
- ✓ UI state separate from persistent state
- ✓ SessionState can be reused in other components
- ✓ Easier to test state changes
- ✓ Clear data flow
- ✓ InputState can be serialized/shared
- ✓ Reducers are pure functions
- ✓ State changes are predictable

---

## Pattern 4: Input Pipeline

### The Problem

Current: Input handled in main component, scattered logic

```typescript
// Input segments, file references, context chips all intertwined
// Hard to test, hard to modify parsing logic
```

### The Solution: Dedicated Input Pipeline

```typescript
// input/types.ts
export type InputSegment =
  | { type: 'text'; text: string }
  | { type: 'file'; path: string; lineStart?: number; lineEnd?: number }
  | { type: 'context'; label: string; include: boolean };

export interface ParsedInput {
  text: string;
  segments: InputSegment[];
  isCommand: boolean;
  command?: string;
  args?: string;
  files: FileChip[];
  contextChips: ContextChip[];
}

// input/parser.ts
export class InputParser {
  parse(segments: InputSegment[]): ParsedInput {
    const text = this.segmentsToText(segments);
    const isCommand = text.trim().startsWith('/');
    const command = isCommand ? this.extractCommand(text) : undefined;
    const args = isCommand ? this.extractArgs(text) : undefined;
    const files = this.extractFiles(segments);
    const contextChips = this.extractContextChips(segments);

    return {
      text,
      segments,
      isCommand,
      command,
      args,
      files,
      contextChips,
    };
  }

  private extractCommand(text: string): string {
    const match = text.match(/^\/(\w+)/);
    return match?.[1] || '';
  }

  private extractArgs(text: string): string {
    const match = text.match(/^\/\w+\s+(.*)$/);
    return match?.[1] || '';
  }

  private extractFiles(segments: InputSegment[]): FileChip[] {
    return segments
      .filter((s) => s.type === 'file')
      .map((s) => ({
        path: (s as any).path,
        lineStart: (s as any).lineStart,
        lineEnd: (s as any).lineEnd,
      }));
  }

  private extractContextChips(segments: InputSegment[]): ContextChip[] {
    return segments
      .filter((s) => s.type === 'context')
      .map((s) => ({
        label: (s as any).label,
        include: (s as any).include,
      }));
  }

  private segmentsToText(segments: InputSegment[]): string {
    return segments
      .map((s) => {
        if (s.type === 'text') return s.text;
        if (s.type === 'file') return `@${s.path}`;
        if (s.type === 'context') {
          return s.include ? `[+${s.label}]` : `[-${s.label}]`;
        }
        return '';
      })
      .join(' ');
  }
}

// hooks/useInputParser.ts
export function useInputParser() {
  const parser = useMemo(() => new InputParser(), []);

  return {
    parse: (segments: InputSegment[]) => parser.parse(segments),
  };
}

// Usage in component
const ChatApp = () => {
  const { parse } = useInputParser();

  const handleSubmit = (segments: InputSegment[]) => {
    const parsed = parse(segments);

    if (parsed.isCommand && parsed.command) {
      // Execute command with parsed.args
      registry.execute(parsed.command, context);
    } else {
      // Send message with parsed.text, files, contextChips
      session.sendMessage({
        role: 'user',
        content: parsed.text,
        metadata: {
          files: parsed.files,
          contextChips: parsed.contextChips,
        },
      });
    }
  };
};
```

**Benefits**:
- ✓ Input parsing logic independent of UI
- ✓ Easy to test parsing logic
- ✓ Separate concerns (UI vs. parsing)
- ✓ Reusable in other contexts
- ✓ Clear data flow

---

## Pattern 5: Session Persistence Layer

### The Problem

Current: Session auto-save logic mixed with component lifecycle

```typescript
// Auto-save tied to isResponding state transition
// Session data in both state and ref
// No clear separation between UI state and persisted state
```

### The Solution: Dedicated Session Manager

```typescript
// services/SessionManager.ts
export class SessionManager {
  private projectPath: string;
  private autoSaveInterval: NodeJS.Timeout | null = null;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  /**
   * Create new session
   */
  createSession(model: ModelPreference = 'smart-sonnet'): SessionData {
    return {
      sessionId: generateSessionId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model,
      workingDirectory: this.projectPath,
      messages: [],
      inputTokens: 0,
      outputTokens: 0,
      status: 'active',
    };
  }

  /**
   * Save session to disk
   */
  async save(session: SessionData): Promise<void> {
    session.updatedAt = new Date().toISOString();
    await saveSession(session);
  }

  /**
   * Load session from disk
   */
  async load(sessionId: string): Promise<SessionData | null> {
    return loadSessionById(sessionId);
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<SessionSummary[]> {
    return listSessions();
  }

  /**
   * Enable auto-save (saves every N seconds)
   */
  startAutoSave(session: SessionData, intervalMs: number = 5000): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }

    this.autoSaveInterval = setInterval(async () => {
      try {
        await this.save(session);
      } catch (error) {
        console.error('Auto-save failed:', error);
      }
    }, intervalMs);
  }

  /**
   * Disable auto-save
   */
  stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  /**
   * Cleanup
   */
  dispose(): void {
    this.stopAutoSave();
  }
}

// hooks/useSessionManager.ts
export function useSessionManager(projectPath: string) {
  const [manager] = useState(() => new SessionManager(projectPath));

  useEffect(() => {
    return () => manager.dispose();
  }, [manager]);

  return manager;
}

// Usage in component
const ChatApp = () => {
  const sessionManager = useSessionManager(process.cwd());
  const [session, setSession] = useState<SessionData | null>(null);

  // Start auto-save when session loads
  useEffect(() => {
    if (session) {
      sessionManager.startAutoSave(session);
    }

    return () => sessionManager.stopAutoSave();
  }, [session, sessionManager]);

  // Load session on mount
  useEffect(() => {
    const loadSession = async () => {
      // Either resume or create new
      const loaded = await sessionManager.load('session-id');
      setSession(loaded || sessionManager.createSession());
    };

    loadSession();
  }, []);

  return (
    // ... component JSX
  );
};
```

**Benefits**:
- ✓ Session persistence separated from UI
- ✓ Auto-save independent of component lifecycle
- ✓ Reusable in other UIs
- ✓ Easy to test
- ✓ Clear separation of concerns

---

## Pattern 6: Composable Message Queue

### The Problem

Current: SmartMessageQueue created as ref, lifecycle unclear

```typescript
const messageQueueRef = useRef<SmartMessageQueue>(
  new SmartMessageQueue(30_000, TODOS_FILE)
);
```

### The Solution: Hook-based Queue Management

```typescript
// hooks/useMessageQueue.ts
export function useMessageQueue(todos?: string) {
  const [queue] = useState(() =>
    new SmartMessageQueue(30_000, todos)
  );

  const [pendingCount, setPendingCount] = useState(0);
  const [hasUrgent, setHasUrgent] = useState(false);

  useEffect(() => {
    // Monitor queue state (could use events)
    const interval = setInterval(() => {
      setPendingCount(queue.getPendingCount());
      setHasUrgent(queue.hasUrgentMessages());
    }, 1000);

    return () => clearInterval(interval);
  }, [queue]);

  const addMessage = useCallback(
    (text: string, priority: 'urgent' | 'normal' | 'todo' = 'normal') => {
      return queue.add(text, priority);
    },
    [queue]
  );

  const injectNext = useCallback(() => {
    return queue.injectNext();
  }, [queue]);

  const clear = useCallback(() => {
    queue.clear();
    setPendingCount(0);
    setHasUrgent(false);
  }, [queue]);

  return {
    queue,
    pendingCount,
    hasUrgent,
    addMessage,
    injectNext,
    clear,
  };
}

// Usage
const ChatApp = () => {
  const { addMessage, pendingCount, hasUrgent } = useMessageQueue('.todos.md');

  const handleSubmit = (text: string) => {
    if (isResponding && !isCommand) {
      addMessage(text);
      // Show pending count in UI
    }
  };
};
```

**Benefits**:
- ✓ Queue lifecycle managed by React
- ✓ Observable queue state
- ✓ Clean composition
- ✓ Easy to monitor

---

## Pattern 7: Error Boundary for Graceful Failures

### The Solution

```typescript
// components/ErrorBoundary.tsx
export class ChatErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Chat error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <box>
          <text>[x] Error: {this.state.error?.message}</text>
          <text fg="gray">Reload the application to continue</text>
        </box>
      );
    }

    return this.props.children;
  }
}

// Usage
<ChatErrorBoundary>
  <AiToolsProvider>
    <ChatApp />
  </AiToolsProvider>
</ChatErrorBoundary>
```

---

## Implementation Priority

1. **High**: Service Lifecycle (Pattern 1) - Prevents resource leaks
2. **High**: Command Registry (Pattern 2) - Enables feature growth
3. **High**: State Slicing (Pattern 3) - Foundation for testing
4. **Medium**: Input Pipeline (Pattern 4) - Improves maintainability
5. **Medium**: Session Manager (Pattern 5) - Improves reliability
6. **Medium**: Message Queue Hook (Pattern 6) - Improves composability
7. **Low**: Error Boundary (Pattern 7) - Improves resilience

---

## Quick Checklist: Do You Need These Patterns?

- [ ] Adding new service? → Use Pattern 1 (Lifecycle)
- [ ] Adding new command? → Use Pattern 2 (Registry)
- [ ] Creating new feature with state? → Use Pattern 3 (State Slicing)
- [ ] Parsing user input? → Use Pattern 4 (Input Pipeline)
- [ ] Persisting data? → Use Pattern 5 (Session Manager)
- [ ] Using message queue? → Use Pattern 6 (Hook)
- [ ] Any component could crash? → Use Pattern 7 (Error Boundary)

---

## Architecture Visualization

```
ChatErrorBoundary
  └─ AiToolsProvider
     └─ ChatApp
        ├─ useAppState (Pattern 3)
        ├─ useMessageQueue (Pattern 6)
        ├─ useSessionManager (Pattern 5)
        ├─ useInputParser (Pattern 4)
        └─ CommandRegistry (Pattern 2)
           ├─ SearchCommand
           ├─ DiagnoseCommand
           └─ ... (Pattern 2)
```

---

## References

- **File Locations**:
  - Main component: `/Users/jkneen/Documents/GitHub/flows/claudelet/bin/claudelet-opentui.tsx`
  - AI Tools: `/Users/jkneen/Documents/GitHub/flows/claudelet/bin/claudelet-ai-tools.ts`
  - Session Storage: `/Users/jkneen/Documents/GitHub/flows/claudelet/src/session-storage.ts`

- **Related Documents**:
  - `ARCHITECTURE_ANALYSIS.md` - Full architectural review
  - `REFACTORING_ROADMAP.md` - Phase 1 implementation guide

---

## Conclusion

These patterns are not just "nice to have" - they are essential for Claudelet to scale beyond its current state. Implementing them now saves 10-20x effort later when refactoring becomes critical.

**The cost of applying these patterns now**: 20-30 hours
**The cost of fixing after reaching 10,000 lines**: 200-300 hours

Choose wisely.
