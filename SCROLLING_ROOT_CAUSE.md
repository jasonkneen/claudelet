# Scrolling Root Cause Analysis

## The Problem: Jumping Scroll Behavior

When users scroll, the message area jumps unpredictably instead of scrolling smoothly.

---

## Root Causes (In Order of Impact)

### 1. **Multiple Rapid Scroll Events Without Debouncing** ⭐⭐⭐⭐⭐

**Location:** `/bin/claudelet-opentui.tsx`, lines 4515-4540

```typescript
// PROBLEM: Every scroll wheel event increments by 5
if (seq.includes('<64;') || seq.includes('<68;')) {
  updateState((prev) => {
    return {
      ...prev,
      messageScrollOffset: prev.messageScrollOffset + 5  // ← +5 EACH TIME
    };
  });
  return;
}

if (seq.includes('<65;') || seq.includes('<69;')) {
  updateState((prev) => ({
    ...prev,
    messageScrollOffset: Math.max(0, prev.messageScrollOffset - 5)  // ← -5 EACH TIME
  }));
  return;
}
```

**Why this breaks:**
- One mouse wheel turn fires **5-10 scroll events**
- Each event increments/decrements offset by 5
- Result: offset jumps by 25-50 lines per wheel turn
- Events are processed by updateState → setState → re-render
- If render cycle can't keep up, multiple events queue and execute together
- **User sees big jumps, not smooth scrolling**

**Example Flow:**
```
User scrolls wheel once
  ↓
Event 1: offset 0 → 5
Event 2: offset 5 → 10  (before render from Event 1!)
Event 3: offset 10 → 15
Event 4: offset 15 → 20
Event 5: offset 20 → 25
  ↓
All processed together or rapidly → JUMP to offset 25
  ↓
User sees content suddenly jump 25 lines
```

---

### 2. **availableRows Calculation Is Unstable** ⭐⭐⭐⭐

**Location:** `/bin/claudelet-opentui.tsx`, lines 5240-5260

```typescript
const { visibleMessages, scrollOffset } = useMemo(() => {
  const config = {
    inputHeight: inputHeight,        // ← CHANGES when user types!
    statusHeight: 2,
    paddingHeight: 2,
    toolChipsHeight: (state.thinkingSessions.length > 0 || ...) ? 2 : 0,  // ← CHANGES!
    contextChipsHeight: state.contextChips.length > 0 ? 2 : 0  // ← CHANGES!
  };

  const availableRows = calculateAvailableRows(terminalSize, config);
  // ...
}, [
  state.messages,
  state.messageScrollOffset,
  terminalSize,
  state.thinkingSessions.length,   // ← Dependency!
  state.currentTool,               // ← Dependency!
  state.contextChips.length,       // ← Dependency!
  inputHeight                      // ← Dependency!
]);
```

**Why this breaks:**
- `inputHeight` changes every time user types
- Tool chips appear/disappear → `toolChipsHeight` changes
- Context chips change → `contextChipsHeight` changes
- Thinking sessions start/stop → height changes
- **When any dependency changes, available rows recalculated**
- **This causes visibleMessages selection to change even if user didn't scroll**
- Messages shift up/down automatically
- **Feels like jumping when it's actually recalculation**

**Example Flow:**
```
State: offset=20, availableRows=30, shows messages 50-80
User types a character
  ↓
inputHeight changes: 3→4
  ↓
availableRows recalculated: 30→29 (one less row!)
  ↓
visibleMessages recalculated with offset=20, availableRows=29
  ↓
Now shows messages 51-79 instead of 50-80
  ↓
User didn't scroll but content shifted!
```

---

### 3. **Line-Based Partial Rendering Is Complex and Brittle** ⭐⭐⭐

**Location:** `/src/message-pagination.ts`, lines 133-200

The algorithm tries to **partially render messages** (crop at top and bottom):

```typescript
// CASE 1: Skip this entire message (scrolled past it)
if (linesToSkip >= msgHeight) {
  linesToSkip -= msgHeight
  continue
}

// CASE 2: Partially visible
let visibleStart = 0
let visibleEnd = msgHeight - linesToSkip
linesToSkip = 0

// Check if overflows top
const linesToAdd = visibleEnd - visibleStart
if (currentVisibleRows + linesToAdd > availableRows) {
  // Crop the start (top)
  const spaceRemaining = availableRows - currentVisibleRows
  visibleStart = visibleEnd - spaceRemaining  // ← CROP MESSAGE
}

// Store partial visibility range
const renderable: RenderableMessage = {
  ...msg,
  visibleLines: { start: visibleStart, end: visibleEnd }  // ← SLICE INFO
}
```

**Why this breaks:**
- Line counting must be **perfectly accurate**
- Each message height calculated with wrapping + ANSI stripping
- **Then rendering slices content by line indices**
- If height calc is off by 1, rendered content misaligns
- Wrapped lines are counted during height calc but re-computed during render
- **Wrapping can differ based on terminal width, font changes, etc.**
- Result: **content appears in wrong place or disappears**

**Example of line miscounting:**
```
Height calc sees: "Long line wrapped to 2 rows" → height = 5
But during render: Terminal width changed → wraps to 3 rows
Partial visibility expects line 2-4, but actually shows lines 2-3
Bottom line missing, or wrong content shown
```

---

### 4. **Visual Line vs Text Line Mismapping** ⭐⭐⭐

**Location:** `/src/message-pagination.ts`, lines 320-365 (content slicing)

```typescript
// Trying to map visual lines to content lines
const contentSliceStart = Math.max(0, startLine - 1);
const contentSliceEnd = Math.max(0, endLine - 1);
let renderedLines = 0;

for (let i = contentSliceStart; i < contentSliceEnd; i++) {
  if (i >= lines.length) break;
  const line = lines[i];
  const wrappedCount = Math.ceil(stripAnsi(line).length / terminalColumns);
  renderedLines += wrappedCount;
  // ... render line ...
}
```

**Why this breaks:**
- `startLine` and `endLine` are **visual line numbers** (after wrapping)
- `lines.split('\n')` gives **text line numbers** (unwrapped)
- Trying to map visual→text is error-prone
- If a line is 200 chars and terminal is 80 wide:
  - Text has 1 line
  - Visually it's 3 lines
  - Algorithm must account for this
- **Off-by-one errors cause wrong slicing**
- **Content appears at wrong position**

---

### 5. **No Rate Limiting on Keyboard/Mouse Scroll** ⭐⭐

**Location:** `/bin/claudelet-opentui.tsx`, lines 4819-4890

```typescript
// Page Up: Scroll 15 lines
if (key.name === 'pageup') {
  updateState(prev => ({
    messageScrollOffset: Math.max(0, prev.messageScrollOffset - 15)
  }));
}

// Page Down: Scroll 15 lines
if (key.name === 'pagedown') {
  updateState(prev => ({
    messageScrollOffset: prev.messageScrollOffset + 15
  }));
}

// Ctrl+P: Scroll 5 lines
if (key.ctrl && key.name === 'p') {
  updateState(prev => ({
    messageScrollOffset: Math.max(0, prev.messageScrollOffset - 5)
  }));
}

// Ctrl+N: Scroll 5 lines
if (key.ctrl && key.name === 'n') {
  updateState(prev => ({
    messageScrollOffset: prev.messageScrollOffset + 5
  }));
}
```

**Why this breaks:**
- Each keypress immediately updates state
- No debouncing or throttling
- If user holds Page Up for 1 second:
  - Multiple key events fire
  - Multiple updates queue
  - **Offset jumps by 15, 30, 45, 60 all at once**
- No smooth scrolling possible

---

### 6. **No Upper Bound on Scroll Offset** ⭐⭐

**Location:** `/bin/claudelet-opentui.tsx`, line 4525

```typescript
// WRONG: No upper bound!
messageScrollOffset: prev.messageScrollOffset + 5  // ← Can grow infinitely

// But scrolling down has a bound:
messageScrollOffset: Math.max(0, prev.messageScrollOffset - 5)  // ← Min is 0
```

**Why this breaks:**
- Can scroll infinitely upward (offset has no max)
- But can only scroll down to 0
- Algorithm expects offset to be bounded
- **If offset exceeds actual content, calculateVisibleMessages returns empty**
- Then user sees blank screen but offset is still set
- **Scrolling down doesn't work because offset > max**

---

## Summary of Causes

| # | Cause | Impact | Severity |
|---|-------|--------|----------|
| 1 | No debouncing on scroll | Offset jumps by 25-50 lines | ⭐⭐⭐⭐⭐ |
| 2 | availableRows recalculates too often | Content shifts on unrelated state changes | ⭐⭐⭐⭐ |
| 3 | Partial message rendering logic | Complex, buggy line calculations | ⭐⭐⭐ |
| 4 | Visual line ↔ text line mismapping | Content appears in wrong place | ⭐⭐⭐ |
| 5 | No keyboard scroll rate limiting | Large jumps on key press | ⭐⭐ |
| 6 | Unbounded scroll offset | Can scroll past content | ⭐⭐ |

---

## Why Codebuff Doesn't Have This Problem

They use OpenTUI's native `<scrollbox>`:

```typescript
<scrollbox
  stickyScroll
  stickyStart="bottom"
  // ...
>
  {messages.map(msg => <MessageWithAgents key={msg.id} message={msg} />)}
</scrollbox>
```

**No scrolling issues because:**
- ✓ OpenTUI handles all scroll events natively
- ✓ Built-in debouncing/throttling
- ✓ Viewport culling is automatic (only renders visible)
- ✓ No manual line calculations
- ✓ No partial message rendering complexity
- ✓ Scroll position automatically bounded
- ✓ `stickyStart="bottom"` auto-sticks when new content arrives
- ✓ `stickyScroll` remembers position across updates

---

## The Fix

**Delete all this manual complexity:**

```typescript
// DELETE:
messageScrollOffset: number  // ← State
messageScrollOffset: 0       // ← Init
messageScrollOffset: prev + 5  // ← Updates
calculateVisibleMessages()   // ← Line calc
visibleLines slicing         // ← Partial render
Ctrl+P/N scroll handlers     // ← Keyboard
Page Up/Down handlers        // ← Keyboard
Mouse wheel parsing          // ← Mouse
calculateMessageHeight()     // ← Height calc (mostly)
```

**Replace with:**
```typescript
<scrollbox
  stickyScroll
  stickyStart="bottom"
  style={{ flexGrow: 1 }}
>
  {messages.map(msg => <Message key={msg.id} message={msg} />)}
</scrollbox>
```

**Result:**
- ✓ All scroll logic handled by OpenTUI
- ✓ ~500 lines of code deleted
- ✓ 0 manual line calculations
- ✓ No jumping, no shifting
- ✓ Smooth scrolling
- ✓ Memory efficient (viewport culling)

---

## Implementation Order

1. **Add `<scrollbox>` with sticky props**
2. **Stop manual offset updates**
3. **Render all messages (no slicing)**
4. **Delete calculateVisibleMessages**
5. **Delete calculateMessageHeight**
6. **Delete scroll event handlers**
7. **Delete keyboard scroll handlers**
8. **Test**

---

## Files to Modify

- `/bin/claudelet-opentui.tsx`
  - Delete `messageScrollOffset` state
  - Delete scroll event handlers
  - Delete keyboard scroll handlers
  - Delete `calculateAvailableRows` calls
  - Wrap messages in `<scrollbox>`

- `/src/message-pagination.ts`
  - Delete `calculateVisibleMessages` function
  - Delete `calculateMessageHeight` function
  - Delete `calculateAvailableRows` function
  - This whole file can probably be deleted eventually

---

## Testing

After fix, verify:
- ✓ Scroll wheel scrolls smoothly
- ✓ No jumping between messages
- ✓ No content shifting on state changes
- ✓ Auto-sticks to bottom on new messages
- ✓ Can scroll to top for old messages
- ✓ Scrollbar appears/disappears appropriately
- ✓ Performance is good (1000+ messages)
