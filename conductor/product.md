# Product Context: Claudelet

## Vision
Claudelet is an interactive terminal UI for Claude Agent SDK that provides individual developers with a powerful, feature-rich AI-powered coding assistant directly in their terminal.

## Target Users
- **Primary:** Individual developers who want AI-powered assistance without leaving the terminal
- **Use cases:** Code understanding, semantic search, LSP diagnostics, intelligent code patching, multi-model AI chat

## Core Value Propositions
1. **Native terminal experience** - Beautiful UI with mouse support, keyboard shortcuts, and real-time feedback
2. **AI-powered development tools** - Semantic code search, LSP diagnostics, fast code patching
3. **Smart context management** - Context chips for persistent context, file references with autocomplete
4. **Multi-provider flexibility** - Anthropic Claude, OpenRouter with 100+ models

## Key Features

### Terminal UI (OpenTUI)
- Blessed-contrib based terminal interface
- Mouse support for chip interaction
- Fixed input bar with context chips
- Real-time thinking/tool activity indicators
- Status bar with model, mode, and AI tool stats

### AI Tools
- `/search` - MGrep-based semantic code search
- `/diagnose` - LSP real-time error/warning detection
- `/apply` - Intelligent code patching with local LLM
- On-demand indexing and multi-model support

### Context Management
- `[+label]` / `[-label]` context chips for persistent context
- `@path/to/file` file embedding with tab completion
- Clickable UI for chip management

### Authentication
- Anthropic OAuth (Account or Max subscription)
- OpenRouter API key
- Direct API key support

## Non-Goals
- Web-based UI (terminal-only)
- Team collaboration features (individual developer focus)
- IDE plugin (standalone CLI tool)

## Quality Attributes
- **Performance:** ~50MB memory baseline, minimal CPU except during indexing
- **Security:** Sanitized debug logs, no sensitive data exposure
- **Usability:** Rich keyboard shortcuts, intuitive chip-based context
