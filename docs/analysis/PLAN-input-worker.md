# Plan: Non-blocking Input via Worker Thread

## Problem

The Claudelet TUI input locks up during agent activity because:
- Agent SDK streaming runs on main thread
- Each text chunk triggers `setState` → re-render
- Re-renders block the event loop
- Input events queue up and feel laggy/unresponsive

## Solution Overview

Move the Claude Agent SDK session to a **Worker Thread**, keeping UI/input on the main thread. Communicate via message passing.

```
┌─────────────────────────────────────────────────────────────┐
│                      MAIN THREAD                            │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Input     │───▶│   State     │───▶│   Render    │     │
│  │  (keyboard) │    │  (React)    │    │  (OpenTUI)  │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                  ▲                                │
│         │                  │ batched updates                │
│         ▼                  │                                │
│  ┌─────────────────────────┴───────────────────────────┐   │
│  │              MessageChannel                          │   │
│  └─────────────────────────┬───────────────────────────┘   │
└─────────────────────────────┼───────────────────────────────┘
                              │
┌─────────────────────────────┼───────────────────────────────┐
│                      WORKER THREAD                          │
│                             ▼                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Claude Agent Session                    │   │
│  │  - SDK query() streaming                            │   │
│  │  - Tool execution                                   │   │
│  │  - Message queue processing                         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### Phase 1: Create Worker Module

**File: `bin/agent-worker.ts`**

```typescript
import { parentPort } from 'worker_threads';
import { startAgentSession, type AgentSessionHandle } from 'claude-agent-loop';

let session: AgentSessionHandle | null = null;

// Message types from main thread
type WorkerCommand =
  | { type: 'start'; apiKey?: string; oauthToken?: string; workingDirectory: string; resumeSessionId?: string }
  | { type: 'send'; message: { role: string; content: string } }
  | { type: 'interrupt' }
  | { type: 'stop' }
  | { type: 'setModel'; preference: string };

// Message types to main thread
type WorkerEvent =
  | { type: 'sessionInit'; sessionId: string; resumed: boolean }
  | { type: 'textChunk'; text: string }
  | { type: 'thinkingStart' }
  | { type: 'thinkingChunk'; delta: string }
  | { type: 'toolUseStart'; id: string; name: string; input: object }
  | { type: 'toolResult'; toolUseId: string; content: string; isError: boolean }
  | { type: 'messageComplete' }
  | { type: 'error'; message: string }
  | { type: 'stopped' };

parentPort?.on('message', async (cmd: WorkerCommand) => {
  switch (cmd.type) {
    case 'start':
      await startSession(cmd);
      break;
    case 'send':
      await session?.sendMessage(cmd.message);
      break;
    case 'interrupt':
      await session?.interrupt();
      break;
    case 'stop':
      await session?.stop();
      session = null;
      break;
    case 'setModel':
      await session?.setModel(cmd.preference);
      break;
  }
});

async function startSession(opts: Extract<WorkerCommand, { type: 'start' }>) {
  session = await startAgentSession({
    apiKey: opts.apiKey,
    oauthToken: opts.oauthToken,
    workingDirectory: opts.workingDirectory,
    resumeSessionId: opts.resumeSessionId,
  }, {
    onSessionInit: (data) => emit({ type: 'sessionInit', ...data }),
    onTextChunk: (text) => emit({ type: 'textChunk', text }),
    onThinkingStart: () => emit({ type: 'thinkingStart' }),
    onThinkingChunk: (data) => emit({ type: 'thinkingChunk', delta: data.delta }),
    onToolUseStart: (data) => emit({ type: 'toolUseStart', id: data.id, name: data.name, input: data.input }),
    onToolResultComplete: (data) => emit({ type: 'toolResult', ...data }),
    onMessageComplete: () => emit({ type: 'messageComplete' }),
    onError: (msg) => emit({ type: 'error', message: msg }),
    onMessageStopped: () => emit({ type: 'stopped' }),
  });
}

function emit(event: WorkerEvent) {
  parentPort?.postMessage(event);
}
```

### Phase 2: Create Worker Manager Hook

**File: `bin/hooks/useAgentWorker.ts`**

```typescript
import { Worker } from 'worker_threads';
import { useEffect, useRef, useCallback } from 'react';

export function useAgentWorker(handlers: WorkerEventHandlers) {
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker('./agent-worker.ts');
    workerRef.current = worker;

    worker.on('message', (event: WorkerEvent) => {
      // Batch updates using requestAnimationFrame equivalent
      setImmediate(() => {
        switch (event.type) {
          case 'textChunk':
            handlers.onTextChunk?.(event.text);
            break;
          // ... handle other events
        }
      });
    });

    return () => {
      worker.terminate();
    };
  }, []);

  const send = useCallback((cmd: WorkerCommand) => {
    workerRef.current?.postMessage(cmd);
  }, []);

  return { send };
}
```

### Phase 3: Add Text Chunk Batching

Batch rapid text chunks to reduce render frequency:

```typescript
// In worker or main thread
let textBuffer = '';
let flushTimeout: NodeJS.Timeout | null = null;

function onTextChunk(text: string) {
  textBuffer += text;

  if (!flushTimeout) {
    flushTimeout = setTimeout(() => {
      emit({ type: 'textChunk', text: textBuffer });
      textBuffer = '';
      flushTimeout = null;
    }, 16); // ~60fps
  }
}
```

### Phase 4: Update ChatApp Component

```typescript
// Replace direct session usage with worker
const { send } = useAgentWorker({
  onTextChunk: (text) => {
    setState(prev => updateAssistantMessage(prev, text));
  },
  onSessionInit: (data) => {
    setState(prev => ({ ...prev, sessionId: data.sessionId }));
  },
  // ... other handlers
});

// Send message via worker
const handleSubmit = async (content: string) => {
  send({ type: 'send', message: { role: 'user', content } });
};
```

## File Changes Summary

| File | Change |
|------|--------|
| `bin/agent-worker.ts` | **NEW** - Worker thread module |
| `bin/hooks/useAgentWorker.ts` | **NEW** - React hook for worker communication |
| `bin/claudelet-opentui.tsx` | **MODIFY** - Replace direct session with worker hook |
| `package.json` | **MODIFY** - May need worker build config |

## Quick Win Alternative

If worker threads are too complex, a simpler fix is **debounced state updates**:

```typescript
// Batch text chunks before updating state
const textBufferRef = useRef('');
const flushTimeoutRef = useRef<NodeJS.Timeout | null>(null);

const onTextChunk = useCallback((text: string) => {
  textBufferRef.current += text;

  if (!flushTimeoutRef.current) {
    flushTimeoutRef.current = setTimeout(() => {
      const buffered = textBufferRef.current;
      textBufferRef.current = '';
      flushTimeoutRef.current = null;

      setState(prev => {
        // Update assistant message with buffered text
        const lastMsg = prev.messages[prev.messages.length - 1];
        if (lastMsg?.role === 'assistant') {
          return {
            ...prev,
            messages: [
              ...prev.messages.slice(0, -1),
              { ...lastMsg, content: lastMsg.content + buffered }
            ]
          };
        }
        return {
          ...prev,
          messages: [...prev.messages, { role: 'assistant', content: buffered, timestamp: new Date() }]
        };
      });
    }, 32); // ~30fps, good balance
  }
}, []);
```

## Risks & Considerations

1. **Worker thread limitations** - Can't share React state directly, need message serialization
2. **Bun worker support** - Verify Bun's worker_threads compatibility
3. **Session state sync** - Need to keep main thread informed of session state
4. **Error handling** - Worker crashes need graceful recovery
5. **Tool execution** - Some tools may need main thread access (file dialogs, etc.)

## Testing Plan

1. Start session, verify streaming works
2. Type while agent is responding - input should not lag
3. Interrupt mid-response - verify clean stop
4. Resume session - verify state restored
5. Heavy tool output - verify batching prevents lockup

## Recommendation

Start with the **Quick Win** (text batching) - it's a 10-minute change that will significantly improve responsiveness. If still insufficient, implement the full worker solution.
