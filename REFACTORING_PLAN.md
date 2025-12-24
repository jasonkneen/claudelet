# Refactoring Plan: claudelet-opentui.tsx

## Current State
- **File**: `bin/claudelet-opentui.tsx`
- **Size**: 8,786 lines (300KB)
- **Complexity**: Single file contains all logic, components, types, and utilities

## Goals
1. Split monolithic file into logical, maintainable modules
2. Improve code organization and discoverability
3. Enable better testing and reusability
4. Follow existing project structure patterns (src/ directory exists)
5. Maintain all functionality - zero behavior changes

## Proposed Directory Structure

```
claudelet/
├── bin/
│   ├── claudelet-opentui.tsx (MAIN - orchestrates everything)
│   └── opentui/
│       ├── types/
│       │   ├── index.ts               # Re-exports all types
│       │   ├── messages.ts            # Message, StoredMessage
│       │   ├── input.ts               # FileChip, ContextChip, InputSegment
│       │   ├── theme.ts               # Theme, KITT animation types
│       │   ├── session.ts             # ThinkingSession, ToolActivity
│       │   ├── state.ts               # AppState interface
│       │   └── file-explorer.ts       # FileExplorerEntry, FileExplorerNode
│       │
│       ├── themes/
│       │   ├── index.ts               # Exports theme utilities
│       │   ├── definitions.ts         # All 58 theme definitions
│       │   ├── manager.ts             # loadSavedThemeName, saveThemeName, getInitialTheme
│       │   └── constants.ts           # THEME_CONFIG_FILE path
│       │
│       ├── auth/
│       │   ├── index.ts               # Exports auth functions
│       │   ├── prompt.ts              # promptAuthMethod
│       │   ├── oauth.ts               # handleOAuthFlow
│       │   └── api-key.ts             # handleApiKeyAuth
│       │
│       ├── utils/
│       │   ├── index.ts               # Re-exports utilities
│       │   ├── keyboard.ts            # Key event handling, SHIFTED_CHAR_MAP, getPrintableCharFromKeyEvent
│       │   ├── token-estimation.ts    # estimateTokenCount
│       │   ├── completions.ts         # getCommandCompletions, getAgentCompletions
│       │   ├── agent-references.ts    # extractAgentReferences
│       │   ├── text-formatting.ts     # segmentsToDisplayString, renderMultilineText
│       │   └── debug.ts               # debugLog, ensureDebugDir, DEBUG constants
│       │
│       ├── rendering/
│       │   ├── index.ts               # Exports rendering utilities
│       │   ├── tool-activity.ts       # extractToolActivity, formatThinkingChip
│       │   └── startup-banner.ts      # generateStartupBanner, LOGO constant
│       │
│       └── components/
│           ├── index.ts               # Re-exports all components
│           ├── ToolActivityBoxes.tsx  # Tool activity display
│           ├── SubAgentTaskBox.tsx    # Sub-agent task display
│           ├── TabbedAgentMessageBlock.tsx  # Tabbed message view
│           ├── AgentMessageBlock.tsx  # Agent message display
│           ├── CollapsibleSubAgentsSection.tsx  # Sub-agents collapsible section
│           ├── MiniAgentPreview.tsx   # Mini agent preview
│           └── ChatApp.tsx            # Main ChatApp component (largest component)
│
└── src/  (existing structure - no changes needed)
    ├── auth-storage.js
    ├── markdown-renderer.js
    ├── session-storage.js
    ├── env-sanitizer.js
    └── security-validator.js
```

## Migration Steps

### Phase 1: Extract Types (Low Risk)
1. Create `bin/opentui/types/` directory structure
2. Move all interfaces and types to appropriate files:
   - `Message`, `FileChip`, `ContextChip`, `InputSegment` → messages.ts & input.ts
   - `ThinkingSession`, `ToolActivity`, `FileExplorerEntry` → session.ts & file-explorer.ts
   - `Theme` → theme.ts
   - `AppState` → state.ts
3. Create index.ts barrel export
4. Update main file to import from `./opentui/types`

### Phase 2: Extract Constants and Utilities (Low Risk)
1. Create `bin/opentui/utils/` directory
2. Move utility functions:
   - Keyboard handling → keyboard.ts
   - Debug logging → debug.ts
   - Token estimation → token-estimation.ts
   - Completions → completions.ts
   - Text formatting → text-formatting.ts
3. Move constants (MAX_THINKING_TOKENS, TODOS_FILE, etc.)
4. Create index.ts barrel export

### Phase 3: Extract Theme System (Medium Risk)
1. Create `bin/opentui/themes/` directory
2. Move all 58 theme definitions → definitions.ts
3. Move theme management functions → manager.ts
4. Move theme constants → constants.ts
5. Create index.ts barrel export
6. Update main file imports

### Phase 4: Extract Authentication (Medium Risk)
1. Create `bin/opentui/auth/` directory
2. Move authentication prompts and flows:
   - `promptAuthMethod` → prompt.ts
   - `handleOAuthFlow` → oauth.ts
   - `handleApiKeyAuth` → api-key.ts
3. Create index.ts barrel export

### Phase 5: Extract Rendering Utilities (Medium Risk)
1. Create `bin/opentui/rendering/` directory
2. Move LOGO constant and banner generation → startup-banner.ts
3. Move tool activity extraction and formatting → tool-activity.ts
4. Create index.ts barrel export

### Phase 6: Extract React Components (High Risk)
1. Create `bin/opentui/components/` directory
2. Extract smaller components first:
   - `ToolActivityBoxes` → ToolActivityBoxes.tsx
   - `SubAgentTaskBox` → SubAgentTaskBox.tsx
   - `MiniAgentPreview` → MiniAgentPreview.tsx
3. Extract larger components:
   - `TabbedAgentMessageBlock` → TabbedAgentMessageBlock.tsx
   - `AgentMessageBlock` → AgentMessageBlock.tsx
   - `CollapsibleSubAgentsSection` → CollapsibleSubAgentsSection.tsx
4. Extract main ChatApp component → ChatApp.tsx
5. Create index.ts barrel export

### Phase 7: Update Main Entry Point (Critical)
1. Update `bin/claudelet-opentui.tsx` to import from new modules
2. Keep only:
   - Shebang and top-level comments
   - Main imports from modules
   - Main execution logic (main() function)
   - Process signal handlers
3. Verify all imports resolve correctly

### Phase 8: Testing and Validation
1. Run TypeScript compiler: `npm run typecheck`
2. Run build: `npm run build`
3. Test application startup
4. Test all commands (/help, /model, /sessions, /quit)
5. Test authentication flows
6. Test theme switching
7. Test agent interactions
8. Verify session persistence

## Import Strategy

Use barrel exports (index.ts) for clean imports:

```typescript
// Before refactoring
// Everything in one file

// After refactoring
import type { Message, AppState, Theme } from './opentui/types'
import { getInitialTheme, saveThemeName } from './opentui/themes'
import { promptAuthMethod, handleOAuthFlow } from './opentui/auth'
import { debugLog, estimateTokenCount } from './opentui/utils'
import { ChatApp, ToolActivityBoxes } from './opentui/components'
import { generateStartupBanner, extractToolActivity } from './opentui/rendering'
```

## Risk Mitigation

### Low Risk
- Types and interfaces (no runtime impact)
- Pure utility functions
- Constants

### Medium Risk
- Functions with side effects
- State management utilities
- Theme system (file I/O)

### High Risk
- React components (rendering logic)
- Main application logic
- Session management integration

### Mitigation Steps
1. Create backups before each phase
2. Run tests after each module extraction
3. Use git commits for each completed phase
4. Keep main file working at each step
5. Test incrementally, not all at once

## Benefits

### Maintainability
- Easier to find and modify specific functionality
- Clear separation of concerns
- Reduced cognitive load

### Testability
- Individual modules can be tested in isolation
- Easier to mock dependencies
- Better test coverage

### Reusability
- Components can be reused in other projects
- Utilities can be imported independently
- Theme system can be used standalone

### Developer Experience
- Faster IDE navigation
- Better autocomplete
- Clearer import statements
- Smaller files to understand

## Timeline Estimate

- Phase 1 (Types): ~30 minutes
- Phase 2 (Utils): ~45 minutes
- Phase 3 (Themes): ~30 minutes
- Phase 4 (Auth): ~30 minutes
- Phase 5 (Rendering): ~30 minutes
- Phase 6 (Components): ~2 hours
- Phase 7 (Main update): ~30 minutes
- Phase 8 (Testing): ~1 hour

**Total**: ~6 hours of focused work

## Success Criteria

✅ All functionality works exactly as before
✅ TypeScript compilation succeeds with no new errors
✅ Build completes successfully
✅ Application starts without errors
✅ All commands work (/help, /model, /sessions, /quit)
✅ Authentication flows work (OAuth + API key)
✅ Theme switching works
✅ Agent orchestration works
✅ Session persistence works
✅ File is under 500 lines (down from 8,786)
✅ All modules under 300 lines each
✅ Clear, logical organization
✅ Improved import statements
