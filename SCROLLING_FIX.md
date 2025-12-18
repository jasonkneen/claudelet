# OpenTUI Scrolling Fix Guide

## The Problem: Jumping Scroll Behavior

### Current Broken Implementation
Our app uses **manual scroll offset state management** which causes jerky, unpredictable scrolling:

```typescript
// BAD: Manual state tracking
messageScrollOffset: number;  // State variable

// On every scroll event:
messageScrollOffset: prev.messageScrollOffset + 5   // Scroll up
messageScrollOffset: Math.max(0, prev.messageScrollOffset - 5)  // Scroll down

// Then manually slice content:
const { visibleMessages } = useMemo(() => {
  const sliced = allMessages.slice(scrollOffset, scrollOffset + VISIBLE_COUNT)
  return { visibleMessages: sliced, scrollOffset }
})

// Render "scroll indicators":
{scrollOffset > 0 && <box>↑ Scroll up to see {scrollOffset} lines</box>}
```

### Why This Breaks

1. **Multiple events queue up** → scroll increments by 5 or 15 multiple times rapidly
2. **No content height awareness** → offset can exceed available messages
3. **No desyncing protection** → state can drift from actual scroll position
4. **Manual re-rendering** → slicing messages creates layout shifts
5. **Up-scroll is unbounded** → "No strict max offset for lines, just let it scroll back"
6. **User expectations broken** → scroll position resets on new messages

### Symptoms in User Experience
- ❌ Scroll wheel causes jumpy, laggy movement
- ❌ Chat jumps to random positions
- ❌ Scrolling doesn't stick to bottom when new messages arrive
- ❌ Page Up/Down (Ctrl+P/N) causes jerky movement
- ❌ Can scroll infinitely in both directions

---

## The Solution: Native OpenTUI Scrollbox

### Replace Manual Logic with Built-in Scrollbox

Use OpenTUI's `<scrollbox>` component which handles all scroll math internally:

```typescript
<scrollbox
  ref={scrollRef}
  stickyScroll           // Remember scroll position across updates
  stickyStart="bottom"   // Auto-stick to BOTTOM of content
  scrollX={false}        // Vertical scrolling only
  scrollbarOptions={{ visible: false }}
  verticalScrollbarOptions={{
    visible: hasMoreMessages,
    trackOptions: { width: 1 }
  }}
  style={{
    flexGrow: 1,         // Take all available space
    rootOptions: {
      flexGrow: 1,
      padding: 0,
      gap: 0,
      flexDirection: 'row',
      backgroundColor: 'transparent',
    },
    wrapperOptions: {
      flexGrow: 1,
      border: false,
      backgroundColor: 'transparent',
      flexDirection: 'column',
    },
    contentOptions: {
      flexDirection: 'column',
      gap: 0,
      justifyContent: 'flex-end',  // Push content to BOTTOM
      backgroundColor: 'transparent',
      paddingLeft: 1,
      paddingRight: 2,
    },
  }}
>
  {/* Render ALL messages - scrollbox handles viewport */}
  {messages.map((message) => (
    <MessageComponent key={message.id} message={message} />
  ))}
</scrollbox>
```

### Key Props Explained

| Prop | Purpose |
|------|---------|
| `stickyScroll` | Remember scroll position when content changes |
| `stickyStart="bottom"` | Auto-stick to bottom (new messages don't scroll you up) |
| `scrollX={false}` | Disable horizontal scrolling |
| `justifyContent: 'flex-end'` | Content flows from bottom upward |
| `flexGrow: 1` | Take all available space |

---

## What to Remove

### 1. Delete Scroll Offset State
```typescript
// REMOVE from state:
messageScrollOffset: number;

// REMOVE from initial state:
messageScrollOffset: 0,
```

### 2. Delete All Manual Scroll Updates
```typescript
// REMOVE these patterns:
messageScrollOffset: prev.messageScrollOffset + 5
Math.max(0, prev.messageScrollOffset - 5)
```

### 3. Delete Manual Visibility Calculation
```typescript
// REMOVE:
const { visibleMessages, scrollOffset } = useMemo(() => {
  // Slicing logic based on offset
  const sliced = allMessages.slice(scrollOffset, scrollOffset + COUNT)
  return { visibleMessages: sliced, scrollOffset }
})

// Just render all messages:
const visibleMessages = messages  // Simple!
```

### 4. Delete Scroll Indicators
```typescript
// REMOVE:
{scrollOffset > 0 && (
  <box>
    <text>↑ Scroll up to see {scrollOffset} earlier lines</text>
  </box>
)}
```

### 5. Delete Manual Scroll Keyboard Handlers
```typescript
// REMOVE these:

// Ctrl+N to scroll down
if (key.ctrl && key.name === 'n') {
  messageScrollOffset: prev.messageScrollOffset + 5
}

// Ctrl+P to scroll up
if (key.ctrl && key.name === 'p') {
  messageScrollOffset: Math.max(0, prev.messageScrollOffset - 5)
}

// Page Up/Down
if (key.name === 'pageup') {
  messageScrollOffset: prev.messageScrollOffset - 15
}

if (key.name === 'pagedown') {
  messageScrollOffset: prev.messageScrollOffset + 15
}

// Mouse wheel
if (seq.includes('<64;')) {  // Scroll up
  messageScrollOffset: prev.messageScrollOffset + 5
}

if (seq.includes('<65;')) {  // Scroll down
  messageScrollOffset: Math.max(0, prev.messageScrollOffset - 5)
}
```

### 6. Delete Mouse Wheel Event Parsing
```typescript
// REMOVE:
// SGR format: \x1b[<64;x;yM (scroll up) or \x1b[<65;x;yM (scroll down)
if (key.sequence) {
  const seq = key.sequence;
  if (seq.includes('<64;') || seq.includes('<68;')) {
    // ...
  }
  if (seq.includes('<65;') || seq.includes('<69;')) {
    // ...
  }
}
```

The scrollbox handles mouse wheel natively.

---

## How It Works

### Before (Broken)
```
User scrolls wheel
  ↓
Manual offset state incremented by 5
  ↓
Content re-sliced based on offset
  ↓
Multiple events cause +5, +5, +5 (jumpy!)
  ↓
Offset can exceed content (scroll infinitely)
  ↓
Position resets when messages update
  ↓
User sees jumping, laggy experience ❌
```

### After (Fixed)
```
User scrolls wheel
  ↓
OpenTUI scrollbox processes internally
  ↓
Internal viewport tracking updated smoothly
  ↓
All messages always rendered (scrollbox culls what's hidden)
  ↓
Scroll position remembered (stickyScroll)
  ↓
Auto-sticks to bottom (stickyStart="bottom")
  ↓
User sees smooth, predictable scrolling ✓
```

---

## Migration Checklist

### Phase 1: Replace Scrollbox Structure
- [ ] Find your `<scrollbox>` or message rendering container
- [ ] Replace with new scrollbox structure above
- [ ] Add `stickyScroll` and `stickyStart="bottom"` props
- [ ] Add `justifyContent: 'flex-end'` to contentOptions
- [ ] Test rendering (should show all messages)

### Phase 2: Remove State
- [ ] Delete `messageScrollOffset` from state type
- [ ] Delete initial state value
- [ ] Remove all `setMessageScrollOffset()` calls
- [ ] Verify no references remain

### Phase 3: Remove Handlers
- [ ] Delete mouse wheel event parsing
- [ ] Delete Ctrl+P/N scroll handlers
- [ ] Delete Page Up/Down scroll handlers
- [ ] Delete scroll indicator UI

### Phase 4: Simplify Rendering
- [ ] Change `{visibleMessages.map(...)}` to `{messages.map(...)}`
- [ ] Delete `visibleMessages` useMemo calculation
- [ ] Remove `scrollOffset` variable usage

### Phase 5: Test
- [ ] Scroll with mouse wheel → should be smooth
- [ ] New messages arrive → should stick to bottom
- [ ] Scroll up → should remember position
- [ ] Scroll to top → should show old messages
- [ ] No jumping or jerky behavior ✓

---

## Advanced: Scroll Ref Usage

If you need to programmatically control scrolling:

```typescript
const scrollRef = useRef<ScrollBoxRenderable | null>(null)

// Scroll to bottom
const scrollToBottom = () => {
  if (scrollRef.current) {
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }
}

// Get scroll position
const isAtBottom = () => {
  if (!scrollRef.current) return false
  const { scrollTop, scrollHeight, viewport } = scrollRef.current
  return scrollTop + viewport.height >= scrollHeight - 1
}

// Restore scroll position
const restoreScroll = (position: number) => {
  if (scrollRef.current) {
    scrollRef.current.scrollTop = position
  }
}

// Use in useEffect:
useEffect(() => {
  if (isAtBottom()) {
    scrollToBottom()
  }
}, [messages])
```

---

## Why Codebuff's Approach Works

From `codebuff/cli/src/chat.tsx`:

```typescript
<scrollbox
  stickyScroll
  stickyStart="bottom"
  style={{
    flexGrow: 1,
    contentOptions: {
      justifyContent: 'flex-end',
      backgroundColor: 'transparent',
    },
  }}
>
  {visibleTopLevelMessages.map((msg) => (
    <MessageWithAgents key={msg.id} message={msg} />
  ))}
</scrollbox>
```

**They:**
- ✓ Let scrollbox handle ALL scroll logic
- ✓ Render all messages (scrollbox viewport-culls internally)
- ✓ Use `justifyContent: 'flex-end'` to anchor bottom
- ✓ Use `stickyStart="bottom"` for auto-stick behavior
- ✓ Zero manual offset tracking
- ✓ Zero jumpy behavior

---

## Common Pitfalls to Avoid

### ❌ Don't Do This
```typescript
// Bad: Still manually tracking offset
const [scrollOffset, setScrollOffset] = useState(0)
const visibleMessages = messages.slice(scrollOffset, scrollOffset + 20)

// Bad: Trying to control scrollbox with state
const [scrollTop, setScrollTop] = useState(0)
scrollRef.current.scrollTop = scrollTop

// Bad: Removing stickyStart
<scrollbox stickyScroll>  {/* Missing stickyStart="bottom" */}
```

### ✓ Do This Instead
```typescript
// Good: Let scrollbox handle it
const visibleMessages = messages  // ALL messages

// Good: Let scrollbox manage internal state
// Only use ref for measurements, not mutations

// Good: Always specify sticky behavior
<scrollbox
  stickyScroll
  stickyStart="bottom"
>
```

---

## Performance Notes

### Rendering All Messages
You might worry: "Won't rendering ALL messages be slow?"

**Answer: No!** OpenTUI's scrollbox is optimized:
- Only renders visible lines (viewport culling)
- Reuses DOM nodes for scrolled-out content
- Efficient diff algorithm
- Performs better than manual slicing

### Optimization Tips
If you have 10,000+ messages:

1. **Paginate on load**: Load messages in batches
2. **Use unique keys**: `key={message.id}` not `key={index}`
3. **Memoize message components**:
   ```typescript
   const Message = React.memo(({ message }) => ...)
   ```
4. **Lazy load old messages**:
   ```typescript
   {hiddenMessageCount > 0 && (
     <button onClick={loadPrevious}>Load older messages</button>
   )}
   ```

---

## Testing Checklist

After migration, test these scenarios:

### Scroll Behavior
- [ ] Scroll wheel up/down works smoothly
- [ ] No lag or jumping
- [ ] Scroll position remembered when new message arrives
- [ ] Auto-sticks to bottom when new messages come
- [ ] Can scroll to top to see old messages

### Message Updates
- [ ] New message arrives → scroll sticks to bottom
- [ ] Typing in input → doesn't scroll up
- [ ] Long messages wrap properly
- [ ] Images/code blocks display correctly

### Edge Cases
- [ ] Scroll to top while messages still loading
- [ ] Rapid message arrivals
- [ ] Empty message list
- [ ] Single message
- [ ] Terminal resize during scroll

### Keyboard
- [ ] Page Up/Down work (if you kept them for accessibility)
- [ ] Ctrl+Home/End go to top/bottom (if implemented)
- [ ] No conflicts with input handling

---

## Files to Check

In `/Users/jkneen/Documents/GitHub/flows/claudelet/bin/claudelet-opentui.tsx`:

- Line 2302: `messageScrollOffset` declaration → DELETE
- Line 2914: `messageScrollOffset: 0` initialization → DELETE
- Line 4515-4550: Mouse wheel handling → DELETE/REPLACE
- Line 4819-4890: Ctrl+P/N/PageUp/Down handlers → DELETE/REPLACE
- Line 5224-5251: `visibleMessages` calculation → SIMPLIFY
- Line 5437-5440: Scroll offset UI → DELETE

---

## Summary

| Aspect | Before | After |
|--------|--------|-------|
| Scroll tracking | Manual state | Native scrollbox |
| Offset calculation | Manual math | Internal |
| Viewport culling | Manual slicing | Automatic |
| Jump behavior | Frequent ❌ | Never ✓ |
| Sticky bottom | Manual logic | `stickyStart="bottom"` |
| Code complexity | High | Low |
| Lines of code | ~150 | ~50 |
| Performance | Variable | Consistent |
| User experience | Jerky | Smooth |

---

## Questions?

If scrolling is still weird after this:
1. Check `stickyScroll` is set
2. Check `stickyStart="bottom"` is set
3. Check no manual offset state remains
4. Check `justifyContent: 'flex-end'` in contentOptions
5. Check `flexGrow: 1` on scrollbox
6. Verify all messages render (not sliced)

Good luck! 🚀
