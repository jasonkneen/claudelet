# Claude Agent Loop

A standalone package that provides the core agentic conversation loops for the Claude Agent SDK. This package extracts the message queue and streaming session management from [Claude Agent Desktop](https://github.com/pheuter/claude-agent-desktop).

## Overview

This package provides two interconnected loops that power agentic conversations:

### 1. Message Queue (Input Loop)

The message queue is an async generator that creates a continuous message stream:

```
User Input → queueMessage() → messageGenerator() → SDK query()
```

- Runs in an infinite `while(true)` loop waiting for messages
- Polls a queue every 100ms for new messages
- Yields `SDKUserMessage` objects to the SDK
- Can be aborted gracefully for clean shutdown

### 2. Agent Session (Output Loop)

The agent session processes streaming responses from the SDK:

```
SDK query() → for await (sdkMessage) → Event Handlers
```

- Uses `for await` to iterate over SDK streaming responses
- Parses different message types (text, thinking, tool use, results)
- Emits events for each type of content
- Handles session lifecycle (start, interrupt, stop)

## Installation

```bash
bun add claude-agent-loop
# or
npm install claude-agent-loop
```

## Quick Start

```typescript
import { startAgentSession } from 'claude-agent-loop';

const session = await startAgentSession(
  {
    apiKey: process.env.ANTHROPIC_API_KEY!,
    workingDirectory: process.cwd(),
    modelPreference: 'smart-sonnet'
  },
  {
    onTextChunk: (text) => process.stdout.write(text),
    onToolUseStart: (tool) => console.log(`\n[Using ${tool.name}]`),
    onMessageComplete: () => console.log('\n---')
  }
);

// Send a message
await session.sendMessage({ role: 'user', content: 'Hello, Claude!' });

// Later, stop the session
await session.stop();
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Your Application                          │
│                                                                    │
│   ┌──────────────────────────────────────────────────────────┐    │
│   │  Session Handle                                           │    │
│   │  - sendMessage()   ──┬────────────────────────────────┐   │    │
│   │  - interrupt()       │                                │   │    │
│   │  - stop()            │                                │   │    │
│   │  - setModel()        │                                │   │    │
│   └──────────────────────┼────────────────────────────────┼───┘    │
│                          │                                │        │
│                          ▼                                │        │
│   ┌────────────────────────────────────────────┐          │        │
│   │  Message Queue (Input Loop)                │          │        │
│   │  ┌──────────────────────────────────────┐  │          │        │
│   │  │  async function* messageGenerator()  │  │          │        │
│   │  │    while (true) {                    │  │          │        │
│   │  │      await waitForMessage()          │  │          │        │
│   │  │      yield SDKUserMessage            │──┼──────────┤        │
│   │  │    }                                 │  │          │        │
│   │  └──────────────────────────────────────┘  │          │        │
│   └────────────────────────────────────────────┘          │        │
│                                                           │        │
│                          ┌────────────────────────────────┘        │
│                          ▼                                         │
│   ┌────────────────────────────────────────────┐                   │
│   │  Claude Agent SDK                          │                   │
│   │  query({ prompt: messageGenerator() })     │                   │
│   └─────────────────────┬──────────────────────┘                   │
│                         │                                          │
│                         ▼                                          │
│   ┌────────────────────────────────────────────┐                   │
│   │  Agent Session (Output Loop)               │                   │
│   │  ┌──────────────────────────────────────┐  │                   │
│   │  │  for await (sdkMessage of session) { │  │                   │
│   │  │    if (stream_event) emit(...)       │──┼──► onTextChunk    │
│   │  │    if (tool_use) emit(...)           │──┼──► onToolUseStart │
│   │  │    if (result) emit(...)             │──┼──► onMessageComplete│
│   │  │  }                                   │  │                   │
│   │  └──────────────────────────────────────┘  │                   │
│   └────────────────────────────────────────────┘                   │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

## API Reference

### `startAgentSession(options, events)`

Starts a new agent session.

#### Options

| Option              | Type                                                | Required | Default                                      | Description                        |
| ------------------- | --------------------------------------------------- | -------- | -------------------------------------------- | ---------------------------------- |
| `apiKey`            | `string`                                            | Yes      | -                                            | Your Anthropic API key             |
| `workingDirectory`  | `string`                                            | Yes      | -                                            | Directory where agent commands run |
| `modelPreference`   | `'fast' \| 'smart-sonnet' \| 'smart-opus'`          | No       | `'fast'`                                     | Model to use                       |
| `maxThinkingTokens` | `number`                                            | No       | `32_000`                                     | Max tokens for extended thinking   |
| `permissionMode`    | `'acceptEdits' \| 'bypassPermissions' \| 'default'` | No       | `'acceptEdits'`                              | Permission mode                    |
| `allowedTools`      | `string[]`                                          | No       | `['Bash', 'WebFetch', 'WebSearch', 'Skill']` | Allowed tools                      |
| `systemPrompt`      | `object`                                            | No       | -                                            | Custom system prompt               |
| `claudeCodeCliPath` | `string`                                            | No       | -                                            | Path to Claude Code CLI            |
| `executable`        | `string`                                            | No       | -                                            | Script executor (e.g., 'bun')      |
| `env`               | `Record<string, string>`                            | No       | -                                            | Additional environment variables   |
| `resumeSessionId`   | `string`                                            | No       | -                                            | Session ID to resume               |

#### Events

| Event                  | Callback Signature                           | Description                   |
| ---------------------- | -------------------------------------------- | ----------------------------- |
| `onTextChunk`          | `(text: string) => void`                     | Streaming text from assistant |
| `onThinkingStart`      | `({ index }) => void`                        | Thinking block started        |
| `onThinkingChunk`      | `({ index, delta }) => void`                 | Thinking text chunk           |
| `onToolUseStart`       | `({ id, name, input, streamIndex }) => void` | Tool invocation started       |
| `onToolInputDelta`     | `({ index, toolId, delta }) => void`         | Tool input JSON streaming     |
| `onContentBlockStop`   | `({ index, toolId? }) => void`               | Content block ended           |
| `onToolResultStart`    | `({ toolUseId, content, isError }) => void`  | Tool result starting          |
| `onToolResultComplete` | `({ toolUseId, content, isError? }) => void` | Tool result complete          |
| `onDebugMessage`       | `(message: string) => void`                  | Debug message from stderr     |
| `onSessionInit`        | `({ sessionId, resumed }) => void`           | Session initialized           |
| `onMessageComplete`    | `() => void`                                 | Agent finished responding     |
| `onMessageStopped`     | `() => void`                                 | Response was interrupted      |
| `onError`              | `(error: string) => void`                    | Error occurred                |

#### Returns: `AgentSessionHandle`

```typescript
interface AgentSessionHandle {
  isActive: () => boolean;
  sendMessage: (message: SDKUserMessage['message']) => Promise<void>;
  interrupt: () => Promise<boolean>;
  stop: () => Promise<void>;
  setModel: (preference: ModelPreference) => Promise<void>;
  getSessionId: () => string;
}
```

### Low-Level Message Queue Functions

For advanced use cases, you can use the message queue directly:

```typescript
// Create your own SDK query with the generator
import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  abortGenerator,
  clearMessageQueue,
  getSessionId,
  messageGenerator,
  queueMessage,
  setSessionId
} from 'claude-agent-loop';

const session = query({
  prompt: messageGenerator(),
  options: { model: 'claude-sonnet-4-5-20250929' }
});

// Queue messages
await queueMessage({ role: 'user', content: 'Hello!' });

// When done
abortGenerator();
clearMessageQueue();
```

## Examples

### Basic CLI Chat

```typescript
import * as readline from 'readline';
import { startAgentSession } from 'claude-agent-loop';

const session = await startAgentSession(
  {
    apiKey: process.env.ANTHROPIC_API_KEY!,
    workingDirectory: process.cwd()
  },
  {
    onTextChunk: (text) => process.stdout.write(text),
    onMessageComplete: () => console.log('\n')
  }
);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.on('line', async (input) => {
  await session.sendMessage({ role: 'user', content: input });
});
```

### With Tool Tracking

```typescript
const session = await startAgentSession(
  { apiKey, workingDirectory: process.cwd() },
  {
    onTextChunk: (text) => process.stdout.write(text),

    onToolUseStart: (tool) => {
      console.log(`\n📦 Tool: ${tool.name}`);
      console.log(`   Input: ${JSON.stringify(tool.input).slice(0, 100)}...`);
    },

    onToolResultComplete: (result) => {
      const status = result.isError ? '❌' : '✅';
      console.log(`${status} Result: ${result.content.slice(0, 100)}...`);
    },

    onMessageComplete: () => console.log('\n--- Done ---\n')
  }
);
```

### Session Resume

```typescript
// Save the session ID
const sessionId = session.getSessionId();
console.log('Session ID:', sessionId);

// Later, resume the session
const resumedSession = await startAgentSession({
  apiKey,
  workingDirectory,
  resumeSessionId: sessionId // Resume from previous conversation
});
```

### Interrupt Response

```typescript
// User presses Ctrl+C
process.on('SIGINT', async () => {
  const wasInterrupted = await session.interrupt();
  if (wasInterrupted) {
    console.log('\nResponse interrupted');
  }
});
```

## How the Loops Work

### The Input Loop (Message Generator)

```typescript
// Simplified view of what messageGenerator does
async function* messageGenerator() {
  while (true) {
    // Wait for a message to be queued
    await waitForMessage();

    // Get the message and yield it to the SDK
    const message = getNextMessage();
    yield {
      type: 'user',
      message: message,
      session_id: getSessionId()
    };
  }
}
```

This generator is passed to `query()` and keeps the conversation alive indefinitely, waiting for messages to be queued.

### The Output Loop (Streaming Session)

```typescript
// Simplified view of the streaming loop
for await (const sdkMessage of querySession) {
  switch (sdkMessage.type) {
    case 'stream_event':
      // Real-time streaming: text, thinking, tool input
      handleStreamEvent(sdkMessage.event);
      break;

    case 'assistant':
      // Complete message with tool results
      handleToolResults(sdkMessage.message);
      break;

    case 'result':
      // Agent finished this turn
      onMessageComplete();
      break;

    case 'system':
      // Session initialized
      if (sdkMessage.subtype === 'init') {
        onSessionInit(sdkMessage.session_id);
      }
      break;
  }
}
```

This loop processes everything the agent sends back, parsing different message types and emitting appropriate events.

## License

MIT
