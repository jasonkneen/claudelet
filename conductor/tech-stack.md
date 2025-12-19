# Tech Stack: Claudelet

## Runtime & Language
- **Runtime:** Bun (primary), Node.js (>=18.0.0 compatible)
- **Language:** TypeScript (strict mode)
- **Module System:** ESM

## Core Frameworks
- **UI Framework:** OpenTUI (@opentui/core, @opentui/react) - blessed-contrib based terminal UI
- **Alternative UI:** Ink (React for CLI)
- **React:** v19.2.0

## Workspace Packages
```
packages/
├── claude-agent-loop    # Core agent session and streaming
├── anthropic-oauth      # OAuth authentication client
├── fast-apply          # Local LLM code patching
├── lsp                 # Language Server Protocol client
└── mgrep-local         # Semantic code search
```

## Key Dependencies
- **@opentui/core** - Terminal UI foundation
- **@opentui/react** - React bindings for OpenTUI
- **ink** - Alternative React-based terminal UI
- **chokidar** - File watching
- **marked** - Markdown rendering
- **highlight.js** - Syntax highlighting
- **ansi-colors** - Terminal color support

## Build Tools
- **Bun:** Build, bundling, runtime
- **TypeScript:** Type checking
- **Prettier:** Code formatting

## Project Structure
```
claudelet/
├── bin/                    # Entry points
│   ├── claudelet-opentui.tsx  # Default OpenTUI interface
│   ├── claudelet-tui.tsx      # Ink-based TUI
│   ├── claudelet-ai-tools.ts  # AI tools service
│   └── claudelet.ts           # Classic CLI
├── src/                    # Library source
│   ├── index.ts              # Exports
│   ├── auth-storage.ts       # Auth persistence
│   ├── session-storage.ts    # Session persistence
│   └── security-validator.ts # Security utilities
├── packages/               # Workspace packages
└── conductor/              # Development context
```

## Code Style
- 2-space indentation
- No semicolons
- Trailing commas
- Strict TypeScript with explicit return types
- React functional components with hooks
- camelCase for variables/functions, PascalCase for types/components

## Authentication
- Anthropic OAuth (Account/Max subscription)
- OpenRouter API key
- Direct API key fallback
- Auth stored in `~/.claude-agent-auth.json`

## AI/ML Integration
- **Claude Agent SDK:** Core AI interaction
- **Local LLM (Ollama):** Fast code patching via qwen2.5-coder
- **MGrep:** Semantic code search with embeddings
- **LSP:** TypeScript/JavaScript diagnostics
