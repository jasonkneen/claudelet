# LSP Action Plan - Decisions Needed

**Status**: Awaiting user input before proceeding with implementation

## Decision Questions

### 1. Diagnostics Display
**Question**: Should LSP diagnostics (code quality issues) be displayed in the UI, and if so, where?

**Options**:
- [ ] Yes, in a dedicated panel (show all diagnostics in dedicated UI section)
- [ ] Yes, inline in the editor (red squiggles, error markers)
- [ ] Yes, both panel and inline
- [ ] No, keep them internal only (collect but don't expose)

### 2. Priority for LSP Fixes
**Question**: What's your priority for fixing LSP issues?

**Options**:
- [ ] Fix resource leaks & stability (shutdown cleanup, retry logic, error handling) **RECOMMENDED**
- [ ] Improve startup performance (move installation to background, show progress)
- [ ] Expose more features (hover, completion, go-to-definition)
- [ ] Everything - full refactor of LSP integration

### 3. Multi-Project Support
**Question**: Will this app ever need to analyze multiple projects simultaneously?

**Options**:
- [ ] No, single project only (singleton pattern is fine)
- [ ] Maybe in the future (keep scalability in mind but don't require now)
- [ ] Yes, we need multi-project support (design for multiple projects from start)

### 4. Server Recovery Strategy
**Question**: Should failed language servers auto-retry or require manual reset?

**Options**:
- [ ] Auto-retry with backoff (automatically restart failed servers after delays) **RECOMMENDED**
- [ ] Manual reset only (user must manually trigger restart)
- [ ] Leave as-is for now (don't change current behavior)

---

## Context Documents

When ready to implement:
- **LSP_AUDIT.md** - Full audit of current LSP implementation
- **LAZY_LOADING_PLAN.md** - MCP tool lazy loading strategy (related to startup performance)

## Notes

- User paused to handle other priority
- Return to this document when ready to proceed
- All information needed is documented above
- Ready to implement once decisions are made
