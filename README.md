# Claudelet 🎯
> Interactive Terminal UI for Claude Agent SDK with AI-powered tools, context chips, and intelligent code assistance
A powerful, feature-rich terminal interface for Claude that combines beautiful UI with advanced AI tools including semantic code search, LSP diagnostics, and fast code patching.
## Features
### 🎨 Modern Terminal UI (OpenTUI)
- **Beautiful interface** built with blessed-contrib
- **Mouse support** - Click chips to remove them
- **Fixed input bar** - Never scrolls away
- **Real-time indicators** - Thinking, tool usage, download progress
- **Context chips** - Visual tags for persistent context
- **Tool activity display** - See active tools at a glance
### 🧠 AI-Powered Development Tools
- **Semantic Code Search** (`/search`) - MGrep-based meaning search, not just text matching
- **LSP Diagnostics** (`/diagnose`) - Real-time error and warning detection
- **Fast Apply** (`/apply`) - Intelligent code patching with local LLM
- **On-demand indexing** - Automatic codebase indexing when needed
- **Multi-model support** - Switch patching models on the fly
### 📎 Smart Context Management
- **Context chips** - `[+label]` for includes, `[-label]` for excludes
- **File chips** - `@path/to/file` embeds file content
- **Persistent context** - Chips stay active until you click × to remove
- **Visual feedback** - Grey chips for context, white for active tools
- **Clickable UI** - Click any chip to remove it
### 🔧 Multi-Provider Support
- **Anthropic Claude** - Sonnet, Opus, Haiku
- **OpenRouter** - Access to 100+ models
- **Provider switching** - Ctrl+Shift+P to change providers
- **Model switching** - Ctrl+M for quick model selection
### ⌨️ Rich Keyboard Shortcuts
- **Tab** - Autocomplete files/commands
- **Shift+Tab** - Toggle coding/planning mode
- **↑↓** - History navigation
- **Shift+Enter** - Add newline (multi-line input)
- **Ctrl+E** - Expand/collapse tool details
- **Ctrl+M** - Model dialog
- **Ctrl+S** - AI status dialog
- **Ctrl+P/N** - Scroll messages
- **Ctrl+T** - Toggle task list
- **Ctrl+V** - Paste from clipboard
- **Ctrl+X×2** - Stop response
- **Ctrl+C** - Clear input (first press) / Quit (second press)
## Installation
### From Source
```bash
cd /path/to/claudelet
bun install
bun run dev
```
### Build for Distribution
```bash
bun run build
```
## Usage
### Quick Start
1. **Run Claudelet**
   ```bash
   bun run dev
   ```
2. **Choose authentication**
   - Anthropic OAuth (Account or Max subscription)
   - OpenRouter API key
   - Direct API key
   **OAuth paste tip:** when prompted, you can paste any of these:
   - Full callback URL: `https://console.anthropic.com/oauth/code/callback?code=...&state=...`
   - Code only: `afzcmRBFJHwy...`
   - Code + state: `afzcmRBFJHwy...#2da95480...`
3. **Start chatting**
   ```
   > Hello, can you help me understand this codebase?
   ```
### AI Tools
**Semantic Code Search**
```
/search authentication logic
```
Finds code by meaning, not just keyword matching. Automatically indexes on-demand.
**LSP Diagnostics**
```
/diagnose src/main.ts
```
Shows TypeScript/JavaScript errors and warnings using Language Server Protocol.
**Fast Apply Patches**
```
/apply
```
Applies code patches using local LLM for fast, intelligent edits.
**Switch Patching Model**
```
/patch-model qwen2.5-coder:0.5b
```
Change the model used for applying patches. Use `/patch-model list` to see options.
### Context Chips
**Add persistent context**
```
[+api_keys] Keep API keys in context
[-testing] Exclude testing details
```
Context chips appear above the tool activity bar and persist across messages until you click the × to remove them.
**Benefits:**
- Keep important context active
- Exclude irrelevant information
- Visual indicator of active context
- Click to remove when done
### File References
**Embed files in messages**
```
@src/main.ts explain this file
```
Press **Tab** after `@` to autocomplete file paths. Files appear as clickable blue chips `[filename×]` in the input.
### Commands
| Command | Description |
|---------|-------------|
| `/help` | Show all commands and shortcuts |
| `/init` | Generate AGENTS.md for the project |
| `/clear` | Clear conversation history |
| `/model <name>` | Switch model (fast/sonnet/opus) |
| `/search <query>` | Semantic code search |
| `/diagnose <file>` | Get LSP diagnostics |
| `/patch-model <name>` | Switch patching model |
| `/logout` | Clear authentication |
| `/quit` | Exit Claudelet |
## Interface Overview
```
┌─────────────────────────────────────────────────────────────┐
│ Messages Area (scrollable with Ctrl+P/N)                    │
│                                                               │
│ You: Can you help me understand this codebase?              │
│ Claude: I'd be happy to help! Let me take a look...        │
│ [...] Thinking...                                            │
│ [⚙] Running: read...                                        │
│                                                               │
│ [+test ×] [-docs ×] read x3  bash  grep                    │
│ ↑ context    ↑ tools (grey=idle, white=active)              │
│                                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ > Type your message...                                   │ │
│ └─────────────────────────────────────────────────────────┘ │
│ sonnet | Mode: CODING | 95% | LSP: 2 | IDX: ready          │
└─────────────────────────────────────────────────────────────┘
```
**Layout:**
- **Messages area** - Your conversation with Claude
- **Chip bar** - Context chips (grey) + tool activity (white when active)
- **Input bar** - Type here, chips appear inline
- **Status bar** - Model, mode, context %, AI tool stats
## Modes
**Coding Mode** (default)
- Full tool access
- File operations enabled
- Code-focused assistance
**Planning Mode** (Shift+Tab to toggle)
- Strategic thinking
- Architecture planning
- Limited tool access
## AI Tool Status
Press **Ctrl+S** to see detailed AI tool status:
```
┌─ AI Tools Status ────────────────────┐
│ LSP (Language Server Protocol)        │
│   Active Servers: 2                   │
│   Files w/ Diag:  5                   │
│                                        │
│ Indexer (MGrep Semantic Search)       │
│   Status:       Idle                  │
│   Total Files:  1,234                 │
│   Total Chunks: 8,567                 │
│                                        │
│ FastApply (Patching)                  │
│   Active Model: qwen2.5-coder:0.5b   │
└───────────────────────────────────────┘
```
## Configuration
### Environment Variables
```bash
# API Key
ANTHROPIC_API_KEY=sk-ant-...
# OpenRouter Key
OPENROUTER_API_KEY=sk-or-...
# Debug mode
DEBUG=1 bun run dev
```
See `docs/guides/AUTHENTICATION.md` for full OAuth/API key details.
### Custom Workspace
```bash
cd /my/project
bun run dev
```
## Keyboard Shortcuts Reference
### Input
- **Tab** - Autocomplete files/commands
- **↑/↓** - History navigation or completion selection
- **Shift+Enter** - Add newline
- **Enter** - Send message
- **Backspace** - Delete character or chip
- **Ctrl+V** - Paste from clipboard
### Navigation
- **Ctrl+P** - Scroll messages up
- **Ctrl+N** - Scroll messages down
- **Ctrl+E** - Expand/collapse last tool
### Dialogs
- **Ctrl+M** - Model selection dialog
- **Ctrl+S** - AI status dialog
- **Ctrl+Shift+P** - Provider selection
- **Ctrl+T** - Toggle task list
### Control
- **Shift+Tab** - Toggle coding/planning mode
- **Ctrl+X×2** - Stop response (press twice)
- **Ctrl+C** - Clear input / Quit (press twice)
## Architecture
### Components
**OpenTUI Interface**
- blessed-contrib for rich terminal UI
- React-style component architecture
- Mouse and keyboard event handling
**AI Tools Service**
- LSP integration for diagnostics
- MGrep for semantic search
- FastApply for code patching
- On-demand indexing
**Agent Session**
- Streaming response handling
- Tool execution
- Multi-provider support
### Data Flow
```
User Input
    ↓
Input Segments (text + chips)
    ↓
Command Parsing
    ├─ /commands → Execute locally
    └─ Regular → Send to Claude
    ↓
Streaming Response
    ├─ Text chunks
    ├─ Thinking blocks
    └─ Tool calls
    ↓
Display Updates (real-time)
```
## Project Structure
```
claudelet/
├── bin/
│   ├── claudelet-opentui.tsx    # OpenTUI interface (default)
│   ├── claudelet-tui.tsx        # Ink-based TUI
│   ├── claudelet-ai-tools.ts    # AI tools service
│   └── claudelet.ts             # Classic CLI
├── src/
│   ├── index.ts                 # Library exports
│   └── auth-storage.ts          # Auth file storage (~/.claude-agent-auth.json)
├── packages/                    # Workspace packages (agent loop, oauth, lsp, search, fast-apply)
├── package.json
└── README.md
```
## Troubleshooting
### AI Tools Not Working
**LSP servers not starting:**
- Check if TypeScript/JavaScript files exist
- Verify Node.js is installed
- Enable debug mode: `DEBUG=1`
**Search returns no results:**
- Wait for indexing to complete
- Check Ctrl+S status shows indexed files
- Try hybrid mode (automatic fallback to grep)
**Patching model download stuck:**
- Check internet connection
- Verify disk space
- Model downloads can be large (500MB+)
### Context/Chips Issues
**Chips not clickable:**
- Ensure mouse support is enabled in terminal
- Try using Backspace to remove chips
- Check terminal emulator supports mouse events
**Context not persisting:**
- Verify chips show in grey bar above input
- Click × on chip to remove manually
- Chips persist until explicitly removed
### Authentication
**OAuth failing:**
- Run `/logout` to clear tokens
- Delete `~/.claude-agent-auth.json` (auth cache) and try again
- When prompted, paste the full callback URL (or `code` / `code#state`)
- Use direct API key instead
More details: `docs/guides/AUTHENTICATION.md`.
## Development
### Build
```bash
bun run build
```
### Type Check
```bash
bun run typecheck
```
### Format
```bash
bun run format
```
### Run Tests
```bash
bun test
```
### Debug Logging
Debug logging is disabled by default for security. Enable it only when needed for troubleshooting:
```bash
CLAUDELET_DEBUG=true bun run dev
```
**Debug logs:**
- Location: `~/.claudelet/debug.log`
- Permissions: User read/write only (mode 0o600)
- Content: Sanitized (sensitive tokens/keys redacted)
- Size: No automatic rotation (monitor manually)
**Sensitive data protection:**
- Bearer tokens are redacted
- OAuth tokens (access/refresh) are redacted
- API keys are redacted
- User messages contain no sensitive data by default
**Cleaning up debug logs:**
```bash
rm ~/.claudelet/debug.log
```
## Performance
- **Memory**: ~50MB baseline, grows with context
- **CPU**: Minimal, spikes during indexing
- **Disk**: Model cache can be 1-2GB
- **Network**: Streaming API calls
## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.
## License
MIT - see [LICENSE](LICENSE) for details.
## Credits
Built with:
- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)
- blessed-contrib for terminal UI
- MGrep for semantic search
- FastApply for code patching
- Bun runtime
---
**Claudelet OpenTUI**: Your AI-powered terminal companion for intelligent coding 🚀
