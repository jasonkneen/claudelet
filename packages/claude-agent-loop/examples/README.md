# Claude Agent Loop Examples

This directory contains example implementations of the Claude Agent Loop.

## Examples

### 1. Basic Chat (`basic-chat.ts`)

A simple command-line chat interface using `readline/promises`.

**Features:**
- OAuth and API key authentication
- Persistent auth storage
- Basic command support (`/quit`, `/stop`, `/model`, `/logout`)
- Streaming responses

**Run:**
```bash
bun run chat
# or
bun run examples/basic-chat.ts
```

### 2. Ink Chat (`ink-chat.tsx`)

A beautiful terminal UI built with [Ink](https://github.com/vadimdemedes/ink) (React for CLIs).

**Features:**
- ✨ Fixed input bar at the bottom with visual separator
- 📜 Scrolling message history (last 15 messages)
- 🎨 Color-coded messages (user, assistant, system)
- 💭 Real-time thinking and tool usage indicators
- 🔄 Model and status display in footer
- ⌨️ Ctrl+C to quit

**Run:**
```bash
bun run ink-chat
# or
bun run examples/ink-chat.tsx
```

**First Time Setup:**
1. Run `basic-chat.ts` first to authenticate (OAuth or API key)
2. Authentication will be saved locally
3. Run `ink-chat.tsx` to use the Ink interface

**Interface:**
```
┌─────────────────────────────────────────┐
│ You: Hello!                             │
│ Claude: Hi there! How can I help?       │
│ 💭 Thinking...                          │
│ 🔧 Using tool: read_file                │
└─────────────────────────────────────────┘
╔═════════════════════════════════════════╗
║ > Type your message... (Ctrl+C to quit) ║
║ Model: smart-sonnet | ✅ Ready          ║
╚═════════════════════════════════════════╝
```

## Commands

Both examples support these commands:

- `/quit` or `/exit` - Exit the chat
- `/stop` - Interrupt the current response
- `/model <name>` - Switch model (fast, haiku, sonnet, opus)
- `/logout` - Clear saved authentication

## Authentication

Authentication is saved in `~/.claude-agent-auth.json` and includes:
- API key (if using direct authentication)
- OAuth tokens (if using OAuth authentication)

Tokens are automatically refreshed when needed.
