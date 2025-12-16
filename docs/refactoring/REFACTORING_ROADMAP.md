# Claudelet Refactoring Roadmap: Phase 1 Implementation Guide

**Purpose**: Concrete, actionable steps for Phase 1 refactoring (1-2 weeks)
**Target**: Reduce main file from 3,166 to ~1,500 lines while maintaining functionality

---

## Overview: What Phase 1 Accomplishes

```
BEFORE:                          AFTER:
claudelet-opentui.tsx (3166)     claudelet-opentui.tsx (1200)
  ├─ Everything mixed            ├─ Root component
                                 ├─ useSessionState.ts
                                 ├─ useAiTools.ts
                                 ├─ commands/
                                 │  ├─ registry.ts
                                 │  ├─ SearchCommand.ts
                                 │  ├─ DiagnoseCommand.ts
                                 │  └─ ...
                                 └─ services/
                                    └─ SessionManager.ts
```

**Impact**:
- Main file reduced 60%
- Commands isolated and independently testable
- State management simplified
- Services properly lifecycle-managed

---

## Step 1: Create Command Registry System (2-3 hours)

### File 1: `bin/commands/types.ts` (NEW)

```typescript
/**
 * Command system types and interfaces
 */
import type { AgentSessionHandle } from 'claude-agent-loop';
import type { AiToolsService } from '../claudelet-ai-tools';

export interface CommandContext {
  state: any; // Use proper type from main component
  setState: React.Dispatch<React.SetStateAction<any>>;
  session: AgentSessionHandle | null;
  aiTools: AiToolsService | null;
  messageQueue: any;
}

export interface CommandResult {
  success: boolean;
  message?: string;
  updatedState?: Partial<any>;
}

export interface CommandHandler {
  name: string;
  pattern: RegExp;
  help: string;
  execute(args: string, context: CommandContext): Promise<CommandResult>;
}
```

### File 2: `bin/commands/registry.ts` (NEW)

```typescript
/**
 * Command registry - centralized command management
 */
import type { CommandHandler } from './types';
import { SearchCommand } from './handlers/SearchCommand';
import { DiagnoseCommand } from './handlers/DiagnoseCommand';
import { ApplyCommand } from './handlers/ApplyCommand';
import { PatchModelCommand } from './handlers/PatchModelCommand';
import { ModelCommand } from './handlers/ModelCommand';
import { InitCommand } from './handlers/InitCommand';
import { HelpCommand } from './handlers/HelpCommand';
import { ClearCommand } from './handlers/ClearCommand';
import { QuitCommand } from './handlers/QuitCommand';
import { LogoutCommand } from './handlers/LogoutCommand';
import { StopCommand } from './handlers/StopCommand';

export class CommandRegistry {
  private commands: CommandHandler[] = [];

  constructor() {
    this.registerCommands();
  }

  private registerCommands(): void {
    [
      new SearchCommand(),
      new DiagnoseCommand(),
      new ApplyCommand(),
      new PatchModelCommand(),
      new ModelCommand(),
      new InitCommand(),
      new HelpCommand(),
      new ClearCommand(),
      new QuitCommand(),
      new LogoutCommand(),
      new StopCommand(),
    ].forEach((cmd) => this.register(cmd));
  }

  register(command: CommandHandler): void {
    this.commands.push(command);
  }

  /**
   * Find and return command matching input text
   */
  findCommand(text: string): CommandHandler | undefined {
    return this.commands.find((cmd) => cmd.pattern.test(text));
  }

  /**
   * Get all commands with help text
   */
  getAllCommands(): CommandHandler[] {
    return this.commands;
  }

  /**
   * Check if text is a command
   */
  isCommand(text: string): boolean {
    return text.startsWith('/') && this.findCommand(text) !== undefined;
  }

  /**
   * Parse command arguments
   */
  parseArgs(text: string): string {
    // Extract arguments after command name
    const match = text.match(/^\/\w+\s+(.*)$/);
    return match?.[1] ?? '';
  }
}

export const commandRegistry = new CommandRegistry();
```

### File 3: `bin/commands/BaseCommand.ts` (NEW)

```typescript
/**
 * Base class for all commands - provides common utilities
 */
import type { CommandHandler, CommandContext, CommandResult } from './types';

export abstract class BaseCommand implements CommandHandler {
  abstract name: string;
  abstract pattern: RegExp;
  abstract help: string;

  abstract execute(args: string, context: CommandContext): Promise<CommandResult>;

  /**
   * Utility: Add message to UI
   */
  protected addMessage(
    context: CommandContext,
    role: 'system' | 'assistant' | 'user',
    content: string
  ): void {
    context.setState((prev: any) => ({
      ...prev,
      messages: [
        ...prev.messages,
        { role, content, timestamp: new Date() },
      ],
    }));
  }

  /**
   * Utility: Update state
   */
  protected updateState(context: CommandContext, updates: Record<string, any>): void {
    context.setState((prev: any) => ({ ...prev, ...updates }));
  }
}
```

### File 4: `bin/commands/handlers/SearchCommand.ts` (NEW)

Extract lines 1331-1400 from main file:

```typescript
/**
 * /search command - Semantic code search
 */
import { BaseCommand } from '../BaseCommand';
import type { CommandContext, CommandResult } from '../types';

export class SearchCommand extends BaseCommand {
  name = 'search';
  pattern = /^\/search\s+/;
  help = 'Search codebase: /search <query>';

  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    if (!args.trim()) {
      return { success: false, message: 'Usage: /search <query>' };
    }

    const query = args.trim();

    if (!context.aiTools) {
      return { success: false, message: 'AI tools not initialized' };
    }

    this.addMessage(context, 'system', `[🔍] Searching for: ${query}`);

    try {
      const results = await context.aiTools.hybridSearch(query);

      if (results.results.length === 0) {
        this.addMessage(context, 'system', '[!] No results found');
        return { success: true };
      }

      // Format results
      let content = `[🔍] Found ${results.results.length} results (${results.source}):\n\n`;
      results.results.forEach((r, i) => {
        content += `${i + 1}. **${r.filePath}** (similarity: ${(r.similarity * 100).toFixed(0)}%)\n`;
        content += `   Lines ${r.metadata.startLine}-${r.metadata.endLine}\n`;
        content += `   \`\`\`\n${r.content.split('\n').slice(0, 3).join('\n')}\n   ...\n\`\`\`\n\n`;
      });

      this.addMessage(context, 'system', content);

      return {
        success: true,
        message: `Found ${results.results.length} results`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Search error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
```

### File 5: Similar structure for other commands:
- `DiagnoseCommand.ts` - `/diagnose` (lines 1401-1450)
- `ApplyCommand.ts` - `/apply` (lines 1451-1500)
- `PatchModelCommand.ts` - `/patch-model` (lines 1501-1571)
- `ModelCommand.ts` - `/model` (lines 1693-1750)
- `InitCommand.ts` - `/init` (lines 1573-1614)
- `ClearCommand.ts` - `/clear` (lines 1670-1691)
- `QuitCommand.ts` - `/quit` (lines 1616-1631)
- `LogoutCommand.ts` - `/logout` (lines 1633-1652)
- `StopCommand.ts` - `/stop` (lines 1654-1668)
- `HelpCommand.ts` - `/help` (new)

---

## Step 2: Create AI Tools Integration Hook (1.5-2 hours)

### File: `bin/hooks/useAiTools.ts` (NEW)

Extract AI tools initialization and listener setup (lines 760-795):

```typescript
/**
 * Hook for AI tools lifecycle management
 */
import { useEffect, useState, useCallback } from 'react';
import { AiToolsService } from '../claudelet-ai-tools';

export interface DownloadProgress {
  percent: number;
  speed: number;
  eta: number;
  variant: string;
}

export interface AiToolsStats {
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
}

export function useAiTools() {
  const [aiTools, setAiTools] = useState<AiToolsService | null>(null);
  const [stats, setStats] = useState<AiToolsStats | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initAiTools = async () => {
      try {
        const tools = AiToolsService.getInstance(process.cwd());

        // Attach listeners
        tools.on('download:progress', (p: DownloadProgress) => {
          setDownloadProgress(p);
        });

        tools.on('download:complete', () => {
          setDownloadProgress(null);
        });

        tools.on('status:change', (newStats: AiToolsStats) => {
          setStats(newStats);
        });

        // Initialize
        await tools.initialize();
        setAiTools(tools);
        setStats(tools.getStats());
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to initialize AI tools'
        );
      }
    };

    initAiTools();

    // Cleanup
    return () => {
      // Note: Don't dispose here as singleton is shared
      // This will be fixed in Phase 2 with proper Context API
    };
  }, []);

  const setPatchingModel = useCallback(async (model: string) => {
    if (!aiTools) throw new Error('AI tools not initialized');
    await aiTools.setPatchingModel(model);
    setStats(aiTools.getStats());
  }, [aiTools]);

  return {
    aiTools,
    stats,
    downloadProgress,
    error,
    setPatchingModel,
  };
}
```

---

## Step 3: Create Session State Hook (1.5-2 hours)

### File: `bin/hooks/useSessionState.ts` (NEW)

Extract session lifecycle and auto-save (lines 663-716):

```typescript
/**
 * Hook for managing session state and persistence
 */
import { useEffect, useRef, useCallback, useState, Dispatch, SetStateAction } from 'react';
import {
  saveSession,
  createSessionData,
  type SessionData,
} from '../../src/session-storage';

export function useSessionState(resumeSession?: SessionData) {
  const [sessionId, setSessionId] = useState<string | undefined>(resumeSession?.sessionId);
  const sessionDataRef = useRef<SessionData | null>(resumeSession || null);
  const [isSaving, setIsSaving] = useState(false);

  // Auto-save when session data changes
  const autoSaveSession = useCallback(async (data: SessionData) => {
    if (!data) return;

    sessionDataRef.current = data;
    setIsSaving(true);

    try {
      await saveSession(data);
      console.debug(`Session auto-saved: ${data.sessionId}`);
    } catch (err) {
      console.error(`Failed to auto-save session:`, err);
    } finally {
      setIsSaving(false);
    }
  }, []);

  // Create new session on first run
  useEffect(() => {
    if (!sessionDataRef.current && !resumeSession) {
      sessionDataRef.current = createSessionData('smart-sonnet');
      setSessionId(sessionDataRef.current.sessionId);
    }
  }, [resumeSession]);

  return {
    sessionId,
    setSessionId,
    sessionDataRef,
    isSaving,
    autoSaveSession,
  };
}
```

---

## Step 4: Extract Command Handler Hook (1-1.5 hours)

### File: `bin/hooks/useCommandHandler.ts` (NEW)

```typescript
/**
 * Hook for handling command execution
 */
import { useCallback } from 'react';
import { commandRegistry } from '../commands/registry';
import type { CommandContext } from '../commands/types';

export function useCommandHandler(context: CommandContext) {
  const handleCommand = useCallback(
    async (text: string) => {
      if (!text.startsWith('/')) {
        return false;
      }

      const command = commandRegistry.findCommand(text);
      if (!command) {
        context.setState((prev: any) => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              role: 'system',
              content: `[!] Unknown command: ${text}\nType /help for available commands`,
              timestamp: new Date(),
            },
          ],
        }));
        return false;
      }

      try {
        const args = commandRegistry.parseArgs(text);
        const result = await command.execute(args, context);

        if (!result.success && result.message) {
          context.setState((prev: any) => ({
            ...prev,
            messages: [
              ...prev.messages,
              {
                role: 'system',
                content: `[!] ${result.message}`,
                timestamp: new Date(),
              },
            ],
          }));
        }

        return true;
      } catch (error) {
        context.setState((prev: any) => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              role: 'system',
              content: `[x] Command error: ${error instanceof Error ? error.message : String(error)}`,
              timestamp: new Date(),
            },
          ],
        }));
        return true;
      }
    },
    [context]
  );

  return { handleCommand };
}
```

---

## Step 5: Modify Main Component (1-1.5 hours)

### Changes to `bin/claudelet-opentui.tsx`

**Remove**: Lines 1331-1800+ (all command handlers)

**Add imports** (top of file):
```typescript
import { commandRegistry } from './commands/registry';
import { useAiTools } from './hooks/useAiTools';
import { useSessionState } from './hooks/useSessionState';
import { useCommandHandler } from './hooks/useCommandHandler';
```

**Replace in ChatApp component**:

```typescript
// REPLACE: Old AI tools initialization (lines 760-795)
// WITH: New hook
const { aiTools, stats: aiStats, downloadProgress, setPatchingModel } = useAiTools();

// REPLACE: Old session state (lines 663-716)
// WITH: New hook
const {
  sessionId,
  setSessionId,
  sessionDataRef,
  autoSaveSession,
} = useSessionState(resumeSession);

// Add to existing state.setState
// Remove aiTools from state - it's now a separate reference

// Add command handler hook
const { handleCommand } = useCommandHandler({
  state,
  setState,
  session: sessionRef.current,
  aiTools,
  messageQueue: messageQueueRef.current,
});
```

**Replace command handling in handleSubmit** (around line 1180):

```typescript
// BEFORE: ~400+ lines of if/else chain
if (displayText === '/search ') { /* 50 lines */ }
else if (displayText.startsWith('/diagnose ')) { /* 40 lines */ }
// ... etc

// AFTER: One simple call
if (await handleCommand(displayText)) {
  setInputSegments([{ type: 'text', text: '' }]);
  return;
}
```

---

## Step 6: Update Import Paths

### File: `bin/index.ts` or update in main

```typescript
// Export new utilities for potential reuse
export { commandRegistry } from './commands/registry';
export type { CommandHandler, CommandContext } from './commands/types';
export { useAiTools } from './hooks/useAiTools';
export { useSessionState } from './hooks/useSessionState';
export { useCommandHandler } from './hooks/useCommandHandler';
```

---

## Step 7: Testing the Refactoring

### Validation Checklist

- [ ] Component still renders without errors
- [ ] All 11 commands execute correctly:
  - [ ] `/search test-query`
  - [ ] `/diagnose src/main.ts`
  - [ ] `/patch-model Q4_K_M`
  - [ ] `/model sonnet`
  - [ ] `/init`
  - [ ] `/help`
  - [ ] `/clear`
  - [ ] `/quit`
  - [ ] `/logout`
  - [ ] `/stop`
  - [ ] Unknown command shows help
- [ ] Keyboard shortcuts still work
- [ ] Session persistence still works
- [ ] AI tools still initialize
- [ ] No console errors

### Quick Verification Script

```bash
#!/bin/bash

# Type check
bun run typecheck

# Run with --help to validate entry point
bun ./bin/claudelet-opentui.tsx --help 2>&1 | head -5

# Check line counts
echo "Main file lines:"
wc -l bin/claudelet-opentui.tsx

echo ""
echo "New command files:"
find bin/commands -name "*.ts" -exec wc -l {} + | tail -1

echo ""
echo "New hook files:"
find bin/hooks -name "*.ts" -exec wc -l {} + | tail -1
```

---

## File Structure After Phase 1

```
bin/
├── claudelet-opentui.tsx     (3,166 → ~1,500 lines)
├── claudelet-ai-tools.ts     (unchanged)
├── claudelet-tui.tsx         (unchanged)
├── claudelet.ts              (unchanged)
├── commands/                 (NEW)
│   ├── index.ts
│   ├── registry.ts           (~80 lines)
│   ├── types.ts              (~50 lines)
│   ├── BaseCommand.ts        (~50 lines)
│   └── handlers/             (NEW)
│       ├── SearchCommand.ts  (~70 lines)
│       ├── DiagnoseCommand.ts
│       ├── ApplyCommand.ts
│       ├── PatchModelCommand.ts
│       ├── ModelCommand.ts
│       ├── InitCommand.ts
│       ├── ClearCommand.ts
│       ├── QuitCommand.ts
│       ├── LogoutCommand.ts
│       ├── StopCommand.ts
│       └── HelpCommand.ts    (~100 lines)
└── hooks/                    (NEW)
    ├── useAiTools.ts         (~100 lines)
    ├── useSessionState.ts    (~60 lines)
    └── useCommandHandler.ts  (~80 lines)

src/
├── index.ts
├── auth-storage.ts
├── session-storage.ts
└── markdown-renderer.tsx
```

---

## Migration Checklist

### Pre-Refactoring
- [ ] Create feature branch: `git checkout -b refactor/command-registry`
- [ ] Ensure tests pass: `npm test` (or create basic smoke test)
- [ ] Verify current functionality works
- [ ] Document any undocumented behaviors

### During Refactoring
- [ ] Create `bin/commands/` directory
- [ ] Create `bin/hooks/` directory
- [ ] Implement command registry
- [ ] Implement command base class
- [ ] Implement each command (one at a time)
- [ ] Implement hooks (one at a time)
- [ ] Update main component imports
- [ ] Replace command handling in main component
- [ ] Replace state initialization with hooks

### Post-Refactoring
- [ ] Verify all commands still work
- [ ] Check component renders without errors
- [ ] Run type checker: `bun run typecheck`
- [ ] Verify no console errors/warnings
- [ ] Test keyboard shortcuts
- [ ] Test session persistence
- [ ] Commit: `git commit -m "refactor: extract command registry and hooks"`
- [ ] Create PR for review

---

## Expected Line Count Reduction

| Module | Before | After | Saved |
|--------|--------|-------|-------|
| claudelet-opentui.tsx | 3,166 | 1,500 | 1,666 |
| commands/registry.ts | - | 80 | - |
| commands/handlers/* | - | 700 | - |
| hooks/* | - | 240 | - |
| **Total** | 3,166 | **2,520** | -1,354 |

**Net change**: Main file reduced 52% ✓

---

## Risk Mitigation

### Potential Issues & Solutions

**Issue**: Command registry doesn't find command
**Solution**: Debug with `console.log(commandRegistry.getAllCommands())` before first use

**Issue**: AI tools not available in command
**Solution**: Check `context.aiTools` is not null, add initialization in useAiTools hook

**Issue**: State updates not reflecting in UI
**Solution**: Ensure `setState` callback is called, not direct mutation

**Issue**: TypeScript errors in new files
**Solution**: Run `bun run typecheck` frequently during development

---

## Timeline Estimate

| Task | Hours | Person | Days |
|------|-------|--------|------|
| Command registry | 2-3 | Dev | 1 |
| Command handlers | 3-4 | Dev | 1 |
| useAiTools hook | 1.5-2 | Dev | 0.5 |
| useSessionState hook | 1.5-2 | Dev | 0.5 |
| useCommandHandler hook | 1-1.5 | Dev | 0.5 |
| Main component updates | 1.5-2 | Dev | 0.5 |
| Testing & fixes | 1-2 | Dev | 0.5 |
| **Total** | 12-16 | **Dev** | **4-5** |

**Estimated Completion**: 5 business days working part-time or 2-3 days full-time

---

## Success Metrics

After Phase 1 refactoring:

1. **Main component reduced** from 3,166 to <1,500 lines ✓
2. **Commands isolated** into separate modules ✓
3. **Commands individually testable** ✓
4. **All keyboard shortcuts still work** ✓
5. **All commands still functional** ✓
6. **AI tools initialization proper lifecycle** ✓
7. **No console errors** ✓
8. **Session persistence works** ✓

---

## Next Steps (Phase 2)

After Phase 1 is complete and stable:

1. **Extract pure rendering component** (ChatUI.tsx)
2. **Split state into slices** (UIState, SessionState, InputState)
3. **Add unit tests** (commands, state, utilities)
4. **Create component hierarchy** (ChatApp → ChatContainer → Chat*)
5. **Move to React Context** for AiToolsService lifecycle

---

## References

- Current file: `/Users/jkneen/Documents/GitHub/flows/claudelet/bin/claudelet-opentui.tsx`
- AI Tools: `/Users/jkneen/Documents/GitHub/flows/claudelet/bin/claudelet-ai-tools.ts`
- Session Storage: `/Users/jkneen/Documents/GitHub/flows/claudelet/src/session-storage.ts`
