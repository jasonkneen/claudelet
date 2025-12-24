# Refactoring Completion Guide

## Current Status ✅

### Completed Work (Phases 1-6 Partial)

**File Reduction Progress:**
- Original: 8,786 lines
- Current: 6,227 lines
- Reduction: 2,559 lines (29.1%)
- Build Status: ✅ Passing

**Modules Extracted:**

1. **types/** (7 files) ✅
   - All TypeScript interfaces and types
   - Clean type definitions

2. **utils/** (6 files) ✅
   - Keyboard handling
   - Debug logging
   - Token estimation
   - Completions
   - Text formatting

3. **themes/** (4 files) ✅
   - 58 theme definitions (~1,900 lines!)
   - Theme management functions
   - **BIGGEST WIN**

4. **auth/** (4 files) ✅
   - OAuth flow
   - API key authentication
   - Auth prompts

5. **rendering/** (3 files) ✅
   - Startup banner & LOGO
   - Tool activity extraction
   - Thinking chip formatting

6. **components/** (3 of 7 files) ⏳
   - ToolActivityBoxes.tsx ✅
   - SubAgentTaskBox.tsx ✅
   - MiniAgentPreview.tsx ✅
   - CollapsibleSubAgentsSection.tsx ⏳
   - AgentMessageBlock.tsx ⏳
   - TabbedAgentMessageBlock.tsx ⏳
   - ChatApp.tsx ⏳ (MASSIVE - ~5,400 lines)

## Remaining Work

### Components to Extract (Line Ranges in Current File)

#### 1. CollapsibleSubAgentsSection (lines ~625-697)
**Size:** ~73 lines
**Location:** Search for `const CollapsibleSubAgentsSection: React.FC`
**Dependencies:** SubAgent, Theme types
**Complexity:** Medium

#### 2. AgentMessageBlock (lines ~549-624)
**Size:** ~76 lines
**Location:** Search for `const AgentMessageBlock: React.FC`
**Dependencies:** Message, Theme types, renderMarkdown
**Complexity:** Medium

#### 3. TabbedAgentMessageBlock (lines ~400-548)
**Size:** ~149 lines
**Location:** Search for `const TabbedAgentMessageBlock: React.FC`
**Dependencies:** SubAgent, Theme types, renderMultilineText
**Complexity:** High

#### 4. ChatApp (lines ~783-end)
**Size:** ~5,444 lines 🔥
**Location:** Search for `const ChatApp: React.FC`
**Dependencies:** EVERYTHING
**Complexity:** VERY HIGH

This is the main application component containing:
- All state management
- Event handlers
- Session management
- Keyboard shortcuts
- Mouse handlers
- Message rendering
- Input handling
- File explorer
- Theme picker UI
- Agent orchestration
- Many helper functions

## Manual Completion Steps

### Step 1: Extract CollapsibleSubAgentsSection

```bash
# Find the component
grep -n "const CollapsibleSubAgentsSection" bin/claudelet-opentui.tsx

# Extract to file
sed -n '[START_LINE],[END_LINE]p' bin/claudelet-opentui.tsx > bin/opentui/components/CollapsibleSubAgentsSection.tsx

# Add imports at top
```

**Required imports:**
```typescript
import type { SubAgent } from 'claude-agent-loop';
import React from 'react';
import type { Theme } from '../types/index.js';
```

### Step 2: Extract AgentMessageBlock

Similar process, required imports:
```typescript
import React from 'react';
import type { Message, Theme } from '../types/index.js';
import { renderMarkdown } from '../../src/markdown-renderer.js';
```

### Step 3: Extract TabbedAgentMessageBlock

Required imports:
```typescript
import type { SubAgent } from 'claude-agent-loop';
import React from 'react';
import type { Theme } from '../types/index.js';
import { renderMultilineText } from '../utils/index.js';
```

### Step 4: Extract ChatApp

This is the BIG one. Two options:

**Option A: Single File Extract** (Simpler)
1. Extract entire ChatApp component to `ChatApp.tsx`
2. Add ALL necessary imports
3. Export as default or named export

**Option B: Split ChatApp** (Better long-term)
1. Create `ChatApp.tsx` as shell
2. Extract sub-components:
   - `MessageList.tsx`
   - `InputBar.tsx`
   - `StatusBar.tsx`
   - `ThemePicker.tsx`
   - `FileExplorer.tsx`
3. Create `hooks/` directory:
   - `useKeyboardShortcuts.ts`
   - `useSessionManagement.ts`
   - `useAgentOrchestration.ts`

### Step 5: Create Component Barrel Export

Create `bin/opentui/components/index.ts`:
```typescript
export { AgentMessageBlock } from './AgentMessageBlock.tsx';
export { ChatApp } from './ChatApp.tsx';
export { CollapsibleSubAgentsSection } from './CollapsibleSubAgentsSection.tsx';
export { MiniAgentPreview } from './MiniAgentPreview.tsx';
export { SubAgentTaskBox } from './SubAgentTaskBox.tsx';
export { TabbedAgentMessageBlock } from './TabbedAgentMessageBlock.tsx';
export { ToolActivityBoxes } from './ToolActivityBoxes.tsx';
```

### Step 6: Update Main File

In `bin/claudelet-opentui.tsx`, add to imports:
```typescript
import {
  AgentMessageBlock,
  ChatApp,
  CollapsibleSubAgentsSection,
  MiniAgentPreview,
  SubAgentTaskBox,
  TabbedAgentMessageBlock,
  ToolActivityBoxes
} from './opentui/components/index.js';
```

Remove the extracted component definitions from the file.

### Step 7: Test Build

```bash
npm run build
npm run typecheck
```

Fix any import errors that arise.

## Expected Final Results

### If All Components Extracted (Option A):
- Main file: ~800-1,200 lines (entry point + main() function)
- Total reduction: ~7,000 lines (80% reduction!)
- Components: 7 files (~4,000 lines)

### File Structure:
```
bin/
├── claudelet-opentui.tsx (~800-1,200 lines) - Entry point
└── opentui/
    ├── types/ (7 files)
    ├── utils/ (6 files)
    ├── themes/ (4 files, 58 themes)
    ├── auth/ (4 files)
    ├── rendering/ (3 files)
    └── components/ (8 files)
        ├── AgentMessageBlock.tsx
        ├── ChatApp.tsx (~5,400 lines)
        ├── CollapsibleSubAgentsSection.tsx
        ├── MiniAgentPreview.tsx
        ├── SubAgentTaskBox.tsx
        ├── TabbedAgentMessageBlock.tsx
        ├── ToolActivityBoxes.tsx
        └── index.ts
```

## Benefits Achieved

✅ **Maintainability**: Easy to find and modify specific functionality
✅ **Testability**: Components can be tested in isolation
✅ **Reusability**: Themes, utils, components can be used elsewhere
✅ **Developer Experience**: Much easier to navigate
✅ **Build Performance**: No degradation
✅ **Type Safety**: All maintained with proper imports

## Future Improvements

1. **Split ChatApp** into logical sub-components
2. **Extract hooks** to dedicated files
3. **Create services** for API/session management
4. **Add tests** for extracted modules
5. **Document components** with JSDoc
6. **Consider state management** library (Zustand/Jotai)

## Troubleshooting

### Common Issues:

**Import errors after extraction:**
- Check that all dependencies are imported in new files
- Verify barrel exports (`index.ts`) are correct
- Ensure file extensions include `.js` in imports

**Build failures:**
- Run `npm run typecheck` to find type errors
- Check for circular dependencies
- Verify all React imports are present

**Missing types:**
- Import from `../types/index.js`
- Check if types need to be re-exported

## Time Estimates

- **Remaining 3 small components**: 30-45 minutes
- **ChatApp extraction (Option A)**: 1-2 hours
- **ChatApp split (Option B)**: 4-6 hours
- **Testing & fixes**: 30-60 minutes

**Total to complete Phase 6:** 2-8 hours depending on approach

## Success Criteria

- [ ] All 7 components extracted
- [ ] Main file under 1,500 lines
- [ ] `npm run build` succeeds
- [ ] `npm run typecheck` passes
- [ ] Application runs without errors
- [ ] All functionality works as before
- [ ] Clear file organization

---

**Status:** 3 of 7 components extracted, 29% reduction achieved, all builds passing ✅
