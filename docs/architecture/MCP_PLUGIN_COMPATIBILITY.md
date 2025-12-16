# MCP Plugin Compatibility Report

**Date**: December 17, 2025
**Issue**: `settingSources: ['user', 'project']` causing silent session hangs and slow startup

## Root Causes

### 1. Missing Dependencies (Silent Hangs)
Plugins with **missing dependencies** cause the Claude Agent SDK to hang silently during MCP server startup. When an MCP server command fails (e.g., `mise` not installed), the SDK waits indefinitely without error.

### 2. Eager Initialization (30s+ Startup Delay)
Unlike the Claude CLI which appears to load MCP servers **lazily** (on first use), the SDK does **eager initialization** of all MCP servers at startup. With 4+ plugins enabled, this causes 30+ second startup delays.

**Recommendation**: Use `settingSources: ['project']` (default) for fast ~5s startup. Only use `['user', 'project']` if you need user plugins and can accept the delay.

## Working Plugins

These plugins work correctly with `settingSources: ['user', 'project']`:

| Plugin | Source |
|--------|--------|
| `compound-engineering` | every-marketplace |
| `code-review` | claude-plugins-official |
| `commit-commands` | claude-plugins-official |
| `context7` | claude-plugins-official |
| `explanatory-output-style` | claude-plugins-official |
| `feature-dev` | claude-plugins-official |
| `firebase` | claude-plugins-official |
| `frontend-design` | claude-plugins-official |
| `github` | claude-plugins-official |
| `hookify` | claude-plugins-official |
| `learning-output-style` | claude-plugins-official |

## Problematic Plugins

These plugins cause session hangs and should remain **disabled**:

| Plugin | Source | Issue |
|--------|--------|-------|
| `xcode` | tuist-marketplace | Requires `mise` command (not installed) |
| `greptile` | claude-plugins-official | Requires `GREPTILE_API_KEY` environment variable |
| `vercel` | claude-plugins-official | Requires multiple MCP servers: `go-sdk-server`, `server-memory`, `mcp-language-server`, etc. |
| `plugin-dev` | claude-plugins-official | Unknown timeout issue (no MCP config found) |

## Untested Plugins (Likely Problematic)

These were disabled without testing but likely require external dependencies:

| Plugin | Source | Likely Issue |
|--------|--------|--------------|
| `vtsls` | claude-code-lsps | Requires TypeScript language server |
| `rust-analyzer` | claude-code-lsps | Requires rust-analyzer binary |
| `pyright` | claude-code-lsps | Requires pyright language server |
| `gopls` | claude-code-lsps | Requires Go language server |
| `vscode-langservers` | claude-code-lsps | Requires VS Code language servers |
| `model-trainer` | huggingface-skills | Likely requires HF tools/credentials |
| `hugging-face-paper-publisher` | huggingface-skills | Likely requires HF credentials |
| `hugging-face-dataset-creator` | huggingface-skills | Likely requires HF credentials |
| `hugging-face-evaluation-manager` | huggingface-skills | Likely requires HF credentials |
| `agent-sdk-dev` | claude-code-plugins | Unknown |
| `agent-sdk-dev` | claude-plugins-official | Unknown |
| `ai-ml-toolkit` | claude-code-templates | Likely requires ML tools |
| `claude-opus-4-5-migration` | claude-code-plugins | Unknown |
| `devops-automation` | claude-code-templates | Likely requires DevOps tools |
| `documentation-generator` | claude-code-templates | Unknown |
| `git-workflow` | claude-code-templates | Unknown |
| `nextjs-vercel-pro` | claude-code-templates | Likely requires Vercel tools |
| `performance-optimizer` | claude-code-templates | Unknown |

## MCP Server Details

### xcode@tuist-marketplace
```json
{
  "mcpServers": {
    "xcodeproj": {
      "command": "mise",
      "args": ["x", "spm:giginet/xcodeproj-mcp-server@1.4.0", "--", "xcodeproj-mcp-server"]
    }
  }
}
```
**Fix**: Install `mise` via `brew install mise` or disable the plugin.

### greptile@claude-plugins-official
```json
{
  "greptile": {
    "type": "http",
    "url": "https://api.greptile.com/mcp",
    "headers": {
      "Authorization": "Bearer ${GREPTILE_API_KEY}"
    }
  }
}
```
**Fix**: Set `GREPTILE_API_KEY` environment variable or disable the plugin.

### vercel@claude-plugins-official
Requires multiple MCP servers including:
- `go-sdk-server`
- `mcp-language-server`
- `server-memory`
- `code-reasoning`
- `server-brave-search`
- `server-google-maps`
- `mcp-code-graph`

**Fix**: Install all required servers or disable the plugin.

## Configuration

### Current ~/.claude/settings.json
```json
{
  "enabledPlugins": {
    "compound-engineering@every-marketplace": true,
    "code-review@claude-plugins-official": true,
    "commit-commands@claude-plugins-official": true,
    "context7@claude-plugins-official": true,
    "explanatory-output-style@claude-plugins-official": true,
    "feature-dev@claude-plugins-official": true,
    "firebase@claude-plugins-official": true,
    "frontend-design@claude-plugins-official": true,
    "github@claude-plugins-official": true,
    "hookify@claude-plugins-official": true,
    "learning-output-style@claude-plugins-official": true,
    "xcode@tuist-marketplace": false,
    "greptile@claude-plugins-official": false,
    "vercel@claude-plugins-official": false,
    "plugin-dev@claude-plugins-official": false
  }
}
```

### agent-session.ts Change
```typescript
// Now defaults to ['user', 'project'] instead of just ['project']
const settingSources = process.env.SKIP_MCP
  ? []
  : (options.settingSources ?? ['user', 'project']);
```

## Debugging Tips

1. **Test individual plugins**: Enable one plugin at a time and run a test session
2. **Check MCP configs**: `find ~/.claude/plugins -name ".mcp.json" -path "*pluginname*" | xargs cat`
3. **Check for missing commands**: `which <command>` for each MCP server command
4. **Use SKIP_MCP**: Set `SKIP_MCP=1` environment variable to disable all MCP loading
5. **Increase timeout**: Session init with many MCP servers can take 60+ seconds

## Future Improvements

1. **SDK Enhancement**: The Claude Agent SDK should timeout and report errors for MCP servers that fail to start
2. **Plugin Validation**: Plugins should validate their dependencies before enabling
3. **Graceful Degradation**: Failed MCP servers should be skipped rather than blocking the entire session
4. **Lazy MCP Loading**: Implement lazy initialization of MCP servers (like Claude CLI does) to avoid 30s+ startup delay when using `['user', 'project']` settings

## TODO

- [ ] Solve user settings (`settingSources: ['user']`) loading without 30s+ startup delay
- [ ] Investigate how Claude CLI achieves fast startup with user plugins (likely lazy loading)
- [ ] Consider implementing our own lazy MCP server initialization wrapper
