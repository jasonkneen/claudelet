# Mouse Support in Claudelet TUI

## Overview
Full mouse support has been implemented in the Claudelet TUI using terminal escape sequences. No external dependencies required!

## Features Implemented

### 🖱️ Click Support
- **Completions**: Click on any autocomplete suggestion to select it instantly
- **Tool Messages**: Click on tool/subagent output to expand/collapse (alternative to Ctrl+O)
- All clickable elements are fully keyboard-accessible too

### 📜 Scroll Support
- **Scroll Up**: Navigate to earlier messages in the conversation history
- **Scroll Down**: Return to recent messages
- Visual indicator shows how many messages are hidden above

### ⌨️ Keyboard + Mouse Harmony
- All existing keyboard shortcuts still work
- Mouse is additive - use whichever is more convenient
- No conflicts between mouse and keyboard input

## Technical Implementation

### Escape Sequences Used
```javascript
'\x1b[?1000h'  // Enable X10 mouse mode
'\x1b[?1002h'  // Enable button event tracking
'\x1b[?1015h'  // Enable urxvt mouse mode
'\x1b[?1006h'  // Enable SGR mouse mode (best compatibility)
```

### Critical Fix: Filtering Mouse Events
**Problem**: Mouse escape sequences were leaking into Ink's input handler, causing garbage characters to appear in the input field.

**Solution**: We intercept ALL stdin data listeners:
1. Capture all existing data listeners (including Ink's)
2. Remove them temporarily
3. Install a filtering handler that:
   - Checks if data is a mouse event
   - If yes: handle it and stop propagation
   - If no: manually call all original listeners with the data
4. On cleanup: restore all original listeners

This ensures mouse events never reach Ink's input system.

### SGR Mouse Format
Events arrive as: `\x1b[<button;x;y[M|m]`
- `M` = press, `m` = release
- Button codes: 0=left, 1=middle, 2=right, 64=scroll-up, 65=scroll-down
- Coordinates are 1-indexed

### Clickable Regions
Dynamically tracked on each render:
```typescript
interface ClickableRegion {
  startRow: number
  endRow: number
  startCol: number
  endCol: number
  action: () => void
  label: string // For debugging
}
```

### Message Scrolling
- New state field: `messageScrollOffset: number`
- Messages rendered from sliding window based on offset
- Max 15 messages visible at once
- Scroll events adjust offset with bounds checking

## Terminal Compatibility

✅ **Supported Terminals:**
- iTerm2 (macOS)
- Hyper
- Windows Terminal
- Alacritty
- kitty
- Most modern terminal emulators

⚠️ **Limited/No Support:**
- Basic Terminal.app (macOS) - may work with reduced features
- Very old terminal emulators
- SSH sessions (depends on terminal AND SSH client support)

## Usage

Mouse support is **automatically enabled** when you run:
```bash
bun run dev
# or
bun run tui
```

### Interactions
1. **Selecting completions**: Just click on the one you want
2. **Expanding tool output**: Click anywhere on the tool message
3. **Scrolling history**: Use mouse wheel to navigate messages
4. **Mix and match**: Use Tab, arrow keys, clicks interchangeably

## Code Location

All mouse handling code is in `bin/claudelet-tui.tsx`:

1. **Mouse parsing**: `parseMouseEvent()` function (line ~94)
2. **Event handler**: `handleMouseEvent()` callback (line ~352)
3. **Setup/cleanup**: `useEffect()` with stdin listener (line ~392)
4. **Clickable regions**: Registered during render, tracked in ref (line ~349)

## Debugging

To debug mouse events, you can temporarily add logging:
```typescript
const handleData = (data: Buffer) => {
  const str = data.toString('utf8')
  const mouseEvent = parseMouseEvent(str)
  if (mouseEvent) {
    // Write to file instead of console to avoid breaking TUI
    fs.appendFileSync('/tmp/mouse-debug.log',
      JSON.stringify(mouseEvent) + '\n')
    handleMouseEvent(mouseEvent)
  }
}
```

## Performance

- ✅ Zero external dependencies
- ✅ Minimal overhead (parse only on mouse events)
- ✅ No impact when mouse not in use
- ✅ Regions recalculated on render (cheap operation)

## Future Enhancements

Possible additions:
- [ ] Drag to select text (complex, requires terminal copy mode)
- [ ] Right-click context menus
- [ ] Hover effects (limited by terminal capabilities)
- [ ] Double-click to execute completions
- [ ] Mouse support for file chip deletion

## Lessons Learned

1. **Raw mode required**: Mouse events only work in raw mode (already enabled)
2. **SGR format best**: Most compatible modern format
3. **Approximate positioning**: TUI rendering doesn't give exact row numbers, need estimation
4. **Cleanup critical**: Must disable mouse tracking on exit or terminal gets confused
5. **Ink compatibility**: Works great with Ink - just need stdin access via `useStdin()`

---

**Implementation Date**: 2025-12-04
**No external dependencies required!**
