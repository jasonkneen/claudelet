# useBatchedState Hook - Usage Guide

## Overview

`useBatchedState` is a custom React hook that simplifies managing state with partial updates. It replaces the repetitive pattern of `setState((prev) => ({ ...prev, ... }))` with a cleaner API.

## Import

```typescript
import { useBatchedState } from './src/hooks/useBatchedState'
```

## Basic Usage

### Simple State Object

```typescript
interface AppState {
  count: number
  name: string
}

function MyComponent() {
  const [state, updateState] = useBatchedState<AppState>({
    count: 0,
    name: 'initial'
  })

  return (
    <div>
      <p>Count: {state.count}, Name: {state.name}</p>
      <button onClick={() => updateState({ count: 1 })}>
        Increment
      </button>
    </div>
  )
}
```

## Update Patterns

### 1. Object Update (Most Common)

Update one or more fields at once:

```typescript
// Single field
updateState({ count: 5 })

// Multiple fields
updateState({ count: 5, name: 'updated' })

// Nested field (replaces entire nested object)
updateState({ data: { nested: 'value' } })
```

### 2. Function Update (For Computed Values)

Update based on previous state:

```typescript
// Increment based on previous value
updateState((prev) => ({ count: prev.count + 1 }))

// Append to array
updateState((prev) => ({
  messages: [...prev.messages, newMessage]
}))

// Map and update
updateState((prev) => ({
  items: prev.items.map(item => ({
    ...item,
    active: item.id === targetId
  }))
}))
```

## Complex Examples

### Message Queue State

```typescript
interface State {
  messages: Message[]
  queuedCount: number
  isResponding: boolean
}

const [state, updateState] = useBatchedState<State>({
  messages: [],
  queuedCount: 0,
  isResponding: false
})

// Add message
updateState((prev) => ({
  messages: [...prev.messages, newMessage],
  queuedCount: prev.queuedCount + 1
}))

// Clear queue
updateState({ queuedCount: 0 })

// Stop responding
updateState({
  isResponding: false,
  queuedCount: 0
})
```

### Tool State Management

```typescript
interface ToolState {
  toolName: string
  toolId: string
  isActive: boolean
}

// Start tool
updateState((prev) => ({
  toolName: tool.name,
  toolId: tool.id,
  isActive: true
}))

// Complete tool
updateState({ isActive: false })
```

### Thinking State

```typescript
// Start thinking
updateState({
  showThinking: true,
  thinkingContent: ''
})

// Append thinking chunk
updateState((prev) => ({
  thinkingContent: prev.thinkingContent + chunk
}))

// Clear thinking
updateState({
  showThinking: false,
  thinkingContent: ''
})
```

## Comparison: Before & After

### Before (Old Pattern)

```typescript
const [state, setState] = useState<AppState>({
  messages: [],
  isResponding: false
})

// Simple update
setState((prev) => ({ ...prev, isResponding: true }))

// Multiple fields
setState((prev) => ({
  ...prev,
  isResponding: false,
  count: 0,
  showThinking: false
}))

// Complex update
setState((prev) => ({
  ...prev,
  messages: [
    ...prev.messages,
    newMessage
  ]
}))
```

### After (With useBatchedState)

```typescript
const [state, updateState] = useBatchedState<AppState>({
  messages: [],
  isResponding: false
})

// Simple update
updateState({ isResponding: true })

// Multiple fields
updateState({
  isResponding: false,
  count: 0,
  showThinking: false
})

// Complex update
updateState((prev) => ({
  messages: [...prev.messages, newMessage]
}))
```

## Performance Notes

- The hook uses `useCallback` to memoize the update function, preventing unnecessary re-renders
- Update function is stable across renders
- Safe to pass to child components as a dependency

## Type Safety

Full TypeScript support with generics:

```typescript
interface MyState {
  count: number
  name: string
  items: Item[]
}

// Correctly typed
const [state, updateState] = useBatchedState<MyState>({...})

// ✅ Valid updates
updateState({ count: 5 })                    // Single field
updateState({ count: 5, name: 'new' })      // Multiple fields
updateState((prev) => ({                      // Function update
  items: [...prev.items, newItem]
}))

// ❌ Type errors caught
updateState({ count: 'five' })                // Type mismatch
updateState({ unknownField: true })           // Unknown field
```

## Real-World Example: Chat Component

```typescript
interface ChatState {
  messages: Message[]
  isResponding: boolean
  thinkingContent: string
  showThinking: boolean
  currentTool?: string
}

function ChatApp() {
  const [state, updateState] = useBatchedState<ChatState>({
    messages: [],
    isResponding: false,
    thinkingContent: '',
    showThinking: false
  })

  const handleResponseStart = () => {
    updateState({
      isResponding: true,
      showThinking: true,
      thinkingContent: ''
    })
  }

  const handleThinkingChunk = (chunk: string) => {
    updateState((prev) => ({
      thinkingContent: prev.thinkingContent + chunk
    }))
  }

  const handleMessageChunk = (text: string) => {
    updateState((prev) => {
      const lastMsg = prev.messages[prev.messages.length - 1]
      if (lastMsg?.role === 'assistant') {
        return {
          messages: [
            ...prev.messages.slice(0, -1),
            { ...lastMsg, content: lastMsg.content + text }
          ]
        }
      } else {
        return {
          messages: [...prev.messages, { role: 'assistant', content: text }]
        }
      }
    })
  }

  const handleResponseComplete = () => {
    updateState({
      isResponding: false,
      showThinking: false,
      thinkingContent: '',
      currentTool: undefined
    })
  }

  return (
    // Component JSX...
  )
}
```

## Tips & Best Practices

1. **Use object updates for simple changes:**
   ```typescript
   updateState({ field: value })  // ✅ Clear and concise
   ```

2. **Use function updates when you need prev state:**
   ```typescript
   updateState((prev) => ({ items: [...prev.items, new] }))
   ```

3. **Group related updates together:**
   ```typescript
   // Good: Related fields updated together
   updateState({
     isResponding: false,
     showThinking: false,
     thinkingContent: ''
   })
   ```

4. **Avoid multiple sequential updates:**
   ```typescript
   // ❌ Not ideal: Causes multiple renders
   updateState({ field1: value1 })
   updateState({ field2: value2 })

   // ✅ Better: Single update
   updateState({ field1: value1, field2: value2 })
   ```

5. **Use TypeScript for safety:**
   ```typescript
   const [state, updateState] = useBatchedState<YourStateType>(initial)
   // Compiler helps catch typos and type mismatches
   ```

## Troubleshooting

### Getting undefined values
```typescript
// ❌ Wrong: Initial state was undefined
const [state, updateState] = useBatchedState(undefined)

// ✅ Correct: Provide initial state
const [state, updateState] = useBatchedState({ field: '' })
```

### Update not taking effect
```typescript
// ❌ Wrong: Mutations don't work
updateState({
  items: state.items  // This is the same reference
})

// ✅ Correct: Create new array
updateState({
  items: [...state.items, newItem]
})
```

### Type errors
```typescript
// ✅ Always type the hook
const [state, updateState] = useBatchedState<MyType>(initial)

// Type checker will catch these errors:
updateState({ unknownField: value })  // Field doesn't exist
updateState({ field: wrongType })     // Type mismatch
```

## Migration Guide

To convert existing `useState` to `useBatchedState`:

1. **Change the hook call:**
   ```typescript
   // Before
   const [state, setState] = useState(initialState)

   // After
   const [state, updateState] = useBatchedState(initialState)
   ```

2. **Update all setState calls:**
   ```typescript
   // Before
   setState((prev) => ({ ...prev, field: value }))

   // After
   updateState({ field: value })
   ```

3. **For function updates, remove the spread:**
   ```typescript
   // Before
   setState((prev) => ({ ...prev, items: [...prev.items, item] }))

   // After
   updateState((prev) => ({ items: [...prev.items, item] }))
   ```

## See Also

- `/src/hooks/useBatchedState.ts` - Hook implementation
- `/tests/hooks/useBatchedState.test.ts` - Test examples
- `/bin/claudelet-opentui.tsx` - Real-world usage examples
