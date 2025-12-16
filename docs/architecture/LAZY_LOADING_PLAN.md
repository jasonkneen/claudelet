# MCP Tool Lazy Loading Implementation Plan

## Current State Analysis

### Bottlenecks Identified
- **30+ second startup delays** when using `settingSources: ['user', 'project']`
- **Eager initialization** of ALL MCP servers at startup
- **No tool caching** between sessions
- **Schema incompatibility** (draft-07 vs draft-2020-12)
- **Hard-coded allow-lists** prevent dynamic tool discovery

### Current Architecture
- MCP servers loaded via Claude Agent SDK's `query()` function
- `settingSources` determines which MCP servers initialize
- Tools registered through `ListToolsRequestSchema` handler
- Tool schemas sent to Claude API for capability discovery
- `allowedTools` allow-list in agent-session.ts (default: Bash, WebFetch, WebSearch, Skill)

---

## Option 1: Lazy MCP Server Initialization (SDK Level)

### Approach
**Defer MCP server startup until a tool is actually requested**

```
Session Start (Fast ✓)
  ↓
Tool Request Received
  ↓
Check if MCP server needed
  ↓
Initialize server on-demand
  ↓
Execute tool
```

### Implementation
- Keep `settingSources: ['project']` (safe, no Claude Desktop conflicts)
- Hook into SDK's tool execution to trigger lazy initialization
- Maintain server instance map to avoid re-initialization
- Cache tool schemas after first discovery

### Pros
✅ **Minimal startup time** - zero delay at initialization
✅ **Simple implementation** - requires SDK hook interception only
✅ **Safe** - uses project-only settings, avoids Claude Desktop compatibility issues
✅ **Backward compatible** - works with existing code
✅ **Memory efficient** - only active servers stay in memory

### Cons
❌ **First tool use is slower** - includes initialization overhead
❌ **Requires SDK-level changes** - may need to fork/patch SDK
❌ **No pre-warming** - can't predict which tools users need
❌ **Cold start on new tools** - every unused tool adds latency on first call

### Complexity: **Low-Medium**
### Startup Impact: **Excellent** (50-100ms vs 30s+)
### First Tool Impact: **Poor** (500ms-2s depending on server)

---

## Option 2: Staged Tool Discovery (Hybrid)

### Approach
**Load tool schemas immediately, but defer server initialization**

```
Session Start (Fast ✓)
  ↓
Load cached tool schemas from disk
  ↓
Tell Claude about tools (without initializing them)
  ↓
Claude chooses which tool to use
  ↓
Initialize only that server
  ↓
Execute tool
```

### Implementation
- Create `.mcp-tool-cache.json` storing schemas for each server
- Update cache on system changes (detected via file watching)
- Skip full server initialization at startup
- Initialize servers only when tools are actually called

### Pros
✅ **Fast startup** - schemas cached, no re-discovery
✅ **Claude sees all available tools** - can make informed decisions
✅ **Predictable performance** - first tool use still fast (cached schema)
✅ **Works with current SDK** - no SDK modifications needed
✅ **Works with `settingSources: ['user', 'project']`** - can filter schema versions

### Cons
❌ **Cache invalidation complexity** - must detect server changes
❌ **Schema drift** - cached schemas may become stale
❌ **Still has first-tool latency** - server still initializes on demand
❌ **More code to maintain** - caching layer + invalidation logic

### Complexity: **Medium**
### Startup Impact: **Excellent** (50-200ms)
### First Tool Impact: **Fair** (500ms-2s for server init, but schema already known)

---

## Option 3: Progressive Tool Registration

### Approach
**Load tool schemas in phases based on frequency/priority**

```
Session Start (Fast ✓)
  ↓
Load Tier 1 tools (high priority: WebFetch, WebSearch, Bash)
  ↓
Return to Claude immediately
  ↓
Background: Load Tier 2 tools (medium priority: Skill, custom tools)
  ↓
Background: Load Tier 3 tools (low priority: MCP servers)
  ↓
Tools become available as they load
```

### Implementation
- Categorize tools: essential, common, rare
- Load Tier 1 synchronously (must-have tools)
- Load Tier 2-3 asynchronously in background
- Use SDK's ability to update tool schemas mid-session
- Prioritize based on usage analytics

### Pros
✅ **Very fast startup** - only load critical tools
✅ **Progressive feature discovery** - tools appear as they load
✅ **User can act immediately** - doesn't wait for all tools
✅ **Better UX** - apparent responsiveness
✅ **Scalable** - works with growing tool count

### Cons
❌ **Complex logic** - needs tool categorization + async coordination
❌ **Tools aren't immediately available** - may confuse users
❌ **Race conditions possible** - tool request before loading
❌ **SDK compatibility** - may not support mid-session tool updates
❌ **Requires classification logic** - must decide tool priority

### Complexity: **High**
### Startup Impact: **Excellent** (10-50ms for Tier 1)
### User Experience: **Good** (perceived fast, tools appear over time)

---

## Option 4: Micro-loading with MCP Schema Bundling

### Approach
**Pre-generate optimized, schema-only MCP servers**

```
Build Time: Generate minimal schema servers
  ↓
Session Start (Fast ✓)
  ↓
Load schema-only servers (list tools, no execution)
  ↓
When tool called: Load full implementation
  ↓
Execute tool
```

### Implementation
- Create lightweight "schema proxy" servers that only expose `ListTools`
- Generate these at build time from existing MCP servers
- Actual implementations load on-demand via dynamic import
- Share tool definitions between schema layer and execution layer

### Files Involved
- New: `packages/mcp-schema-generator/` - generates proxy servers
- Modify: `packages/mgrep-local/src/mcp/tools.ts` - export schemas separately
- Modify: `agent-session.ts` - use proxy servers initially

### Pros
✅ **Ultra-fast startup** - schema servers are minimal
✅ **Claude sees all tools** - no discovery delay
✅ **Clean separation** - schemas ≠ implementation
✅ **Scalable** - works with any number of tools
✅ **No first-tool latency** - server loads quickly when needed

### Cons
❌ **Most complex** - requires build-time code generation
❌ **Two server implementations** - duplication risk
❌ **Build step required** - can't just change MCP servers
❌ **Debugging harder** - proxy layer adds complexity
❌ **May not worth it** - only valuable with 20+ tools

### Complexity: **Very High**
### Startup Impact: **Excellent** (5-20ms)
### Maintenance: **Complex** (build step + dual implementations)

---

## Option 5: Adaptive Tool Loading (Smart)

### Approach
**Learn which tools are used most, prioritize loading them**

```
Session 1-5: Load all tools eagerly (build profile)
  ↓
Session 6+: Load tools based on usage history
  ↓
Most-used tools: Load immediately
  ↓
Rarely-used tools: Lazy load on demand
  ↓
Unused tools: Skip loading entirely
```

### Implementation
- Track tool usage in `.mcp-usage-stats.json`
- Update stats after each session
- Sort tools by frequency at startup
- Load top 80% of tools, lazy load bottom 20%
- User can configure usage profile location

### Pros
✅ **Data-driven** - optimizes for actual usage patterns
✅ **Personal** - each user gets custom performance
✅ **Progressive improvement** - faster over time
✅ **Can combine with other options** - use alongside caching
✅ **Fair compromise** - balances startup vs features

### Cons
❌ **Requires history** - slow on first sessions
❌ **Privacy concerns** - tracking tool usage
❌ **Not portable** - stats specific to one user/machine
❌ **Can be wrong** - new tools won't load until used
❌ **Complexity** - needs analytics infrastructure

### Complexity: **Medium-High**
### Startup Impact: **Scales** (Improves after several uses)
### Privacy: **Potential concern** (local stats only, but still tracked)

---

## Option 6: Manual Tool Registration (Explicit)

### Approach
**Users explicitly specify which tools they want loaded**

```
Project Configuration: List desired tools
  ↓
Session Start (Fast ✓)
  ↓
Load ONLY those tools
  ↓
Other tools not available
```

### Implementation
- Extend `.claudelet/config.json`:
```json
{
  "mcpTools": {
    "enabled": ["Bash", "WebFetch", "WebSearch", "mgrep"],
    "lazy": ["semantic-search", "custom-tool"]
  }
}
```
- Load enabled tools eagerly
- Load lazy tools on-demand
- Update agent-session.ts to respect config

### Pros
✅ **Simple to understand** - explicit is clear
✅ **User control** - no surprises
✅ **Fast startup** - only load what's specified
✅ **No guessing** - no adaptive logic needed
✅ **Easy to debug** - config is visible

### Cons
❌ **Requires user knowledge** - need to know what tools exist
❌ **Manual maintenance** - must update config when adding tools
❌ **Feature discovery** - users might not know about available tools
❌ **Not automatic** - doesn't adapt to new projects/tools
❌ **Common mistake** - users load too much or too little

### Complexity: **Low**
### Startup Impact: **Depends on config** (can be very fast)
### User Experience: **Moderate** (requires configuration knowledge)

---

## Recommendation Summary

| Option | Startup Time | Complexity | Maintenance | Recommendation |
|--------|-------------|-----------|------------|-----------------|
| 1. Lazy Init | 50-100ms | Low-Medium | Low | ✅ **Best** if SDK supports hooks |
| 2. Staged Discovery | 50-200ms | Medium | Medium | ⭐ **Best all-around** if Option 1 not possible |
| 3. Progressive Loading | 10-50ms | High | High | Good if UX drift is acceptable |
| 4. Micro-loading | 5-20ms | Very High | High | Only if 20+ tools & startup critical |
| 5. Adaptive Loading | Scales | Medium-High | Medium | Good for power users over time |
| 6. Manual Config | User-defined | Low | Low | Fallback option, combine with others |

---

## Recommended Path Forward

### Phase 1: Quick Win (Next Session)
Implement **Option 2: Staged Tool Discovery** because:
- No SDK modifications required
- Works immediately with current code
- ~15x startup speedup achievable
- Low risk, well-understood approach

### Phase 2: Future Improvement
If SDK adds lazy loading hooks → Implement **Option 1** for even better performance

### Phase 3: Scale (Many Tools)
If tool count grows to 20+ → Consider **Option 4: Schema Bundling**

---

## Quick Implementation Check

### Option 1 Requirements
```bash
grep -n "settingSources" packages/claude-agent-loop/src/agent-session.ts
# Check if SDK has tool execution hooks for lazy init
```

### Option 2 Requirements
```bash
ls -la packages/mgrep-local/src/mcp/
# Look for tool schema exports that can be cached
```

### Critical Fix to Include
Always use `settingSources: ['project']` to avoid:
- 30+ second startup hangs
- Schema version incompatibility errors
- Claude Desktop plugin conflicts

---

## Questions Before Implementation

1. **How many MCP tools** do you typically have active?
2. **Acceptable first-tool latency**: 500ms? 1s? 2s?
3. **Is user configuration acceptable** for specifying tools?
4. **Should tool schema be version-agnostic** (handle both draft-07 and draft-2020-12)?
5. **Do you need tools available for Claude immediately**, or can they load asynchronously?
