# Multi-Session Architecture

## Overview

The LSP implementation now supports multi-session operation, enabling multiple shell instances to analyze different projects concurrently without interference.

## Architecture Changes

### 1. LSPManager - Per-Project Instances

**Before:**
```typescript
// Singleton-like pattern with setProjectPath()
const manager = createLSPManager();
manager.setProjectPath('/project-a');
```

**After:**
```typescript
// Per-project instances via constructor options
const managerA = createLSPManager({ projectPath: '/project-a' });
const managerB = createLSPManager({ projectPath: '/project-b' });
// Each manager is isolated and can run concurrently
```

**Key Changes:**

- **Constructor Options**: Added `projectPath` to `LSPManagerOptions`
- **Instance ID**: Each manager gets a unique 8-character hash ID based on project path
- **Isolated State**: Each manager maintains its own:
  - Client map (`Map<string, LSPClient>`)
  - Spawning requests (`Map<string, Promise>`)
  - Broken servers set (`Set<string>`)
  - Retry strategy instance

- **Deprecation**: `setProjectPath()` is now deprecated and warns if called after servers have started

**New Methods:**
```typescript
manager.getProjectPath(): string       // Get the project path
manager.getInstanceId(): string        // Get the instance hash ID (for debugging)
```

**Logging:**
All log messages now include the instance ID for debugging:
```
[LSP:a1b2c3d4] Spawning typescript for /project-a
[LSP:e5f6g7h8] Spawning typescript for /project-b
```

### 2. AiToolsService - Multi-Instance Support

**Before:**
```typescript
// Singleton pattern - only one instance per process
const service = AiToolsService.getInstance(projectPath);
```

**After:**
```typescript
// Per-project instances with automatic isolation
const serviceA = AiToolsService.getInstance('/project-a');
const serviceB = AiToolsService.getInstance('/project-b');
// Different projects get different instances
// Same project path returns the same instance
```

**Key Changes:**

- **Instance Manager**: New `AiToolsInstanceManager` class tracks instances by project path
- **Path Normalization**: Project paths are normalized using `path.resolve()` for consistent keys
- **Shared Resources**: LSP servers are installed once globally, but each project gets its own LSP client instances
- **Isolated State**: Each service maintains its own:
  - LSP manager instance
  - Vector store (stored in `{project}/.opencode/vectors`)
  - File watcher worker
  - Indexer and searcher

**New Static Methods:**
```typescript
AiToolsService.getInstance(projectPath: string): AiToolsService
AiToolsService.disposeInstance(projectPath: string): Promise<void>
AiToolsService.disposeAll(): Promise<void>
```

**New Instance Methods:**
```typescript
service.getProjectPath(): string  // Get the project path for this instance
```

### 3. Resource Management

**LSP Servers:**
- **Installation**: Servers are installed once in a global cache (`~/.cache/claudelet/lsp/`)
- **Instances**: Each project spawns its own server process instances
- **Isolation**: Server processes are isolated by project root directory

**Vector Stores:**
- **Per-Project**: Each project has its own vector database in `.opencode/vectors/`
- **No Sharing**: Vector indices are never shared between projects

**File Watchers:**
- **Per-Project**: Each AiToolsService instance has its own file watcher worker
- **Isolation**: Watchers only monitor their respective project directories

## Usage Examples

### Shell Instance 1 - Project A
```typescript
// In /home/user/project-a
const tools = AiToolsService.getInstance('/home/user/project-a');
await tools.initialize();

// LSP analyzes files in project-a
await tools.getDiagnostics('/home/user/project-a/src/index.ts');

// Semantic search in project-a
const results = await tools.hybridSearch('authentication');
```

### Shell Instance 2 - Project B
```typescript
// In /home/user/project-b (different shell, running concurrently)
const tools = AiToolsService.getInstance('/home/user/project-b');
await tools.initialize();

// LSP analyzes files in project-b (isolated from project-a)
await tools.getDiagnostics('/home/user/project-b/src/app.ts');

// Semantic search in project-b (different index)
const results = await tools.hybridSearch('database');
```

### Cleanup
```typescript
// Dispose specific project
await AiToolsService.disposeInstance('/home/user/project-a');

// Dispose all projects (on app exit)
await AiToolsService.disposeAll();
```

## Migration Guide

### For LSPManager Users

**No Migration Required (Backward Compatible):**
```typescript
// This still works (uses process.cwd() as default)
const manager = createLSPManager();
manager.setProjectPath(projectPath); // Works, but deprecated

// Recommended new approach:
const manager = createLSPManager({ projectPath });
```

**Breaking Changes:**
- None. The API is fully backward compatible.

**Deprecations:**
- `setProjectPath()`: Use constructor options instead. Warns if called after servers have started.

### For AiToolsService Users

**No Migration Required:**
```typescript
// Old code continues to work
const service = AiToolsService.getInstance(projectPath);
```

**New Capabilities:**
```typescript
// Multiple projects in different shells
const serviceA = AiToolsService.getInstance('/project-a');
const serviceB = AiToolsService.getInstance('/project-b');

// Proper cleanup
await AiToolsService.disposeInstance('/project-a');
await AiToolsService.disposeAll();
```

## Testing

### LSPManager Tests
See `/Users/jkneen/Documents/GitHub/flows/claudelet/packages/lsp/tests/multi-session.test.ts`

Key test cases:
- ✅ Unique instance IDs for different projects
- ✅ Isolated client maps
- ✅ Independent event emission
- ✅ Independent shutdown
- ✅ Consistent instance IDs for same path

### AiToolsService Tests
See `/Users/jkneen/Documents/GitHub/flows/claudelet/tests/ai-tools-multi-instance.test.ts`

Key test cases:
- ✅ Separate instances for different projects
- ✅ Same instance for same project path
- ✅ Isolated LSP managers
- ✅ Isolated vector stores
- ✅ Independent event emission
- ✅ Concurrent operations

## Performance Considerations

**Resource Usage:**
- Each project instance spawns its own LSP server processes
- Each project maintains its own vector index
- File watchers run in separate worker threads per project

**Recommended Limits:**
- **Concurrent Projects**: 5-10 projects per machine (depends on available memory)
- **LSP Servers**: Each TypeScript project uses ~100-200MB RAM
- **Vector Stores**: Varies by project size (~10-100MB for typical projects)

**Optimization:**
- LSP servers are installed once and shared across all projects
- Embedder model is loaded once per process and shared
- FastApply model cache is shared globally

## Debugging

**Instance IDs:**
All log messages include instance IDs for easy debugging:
```
[LSP:a1b2c3d4] Spawning typescript for /project-a
[LSP:a1b2c3d4] TypeScript server closed for /project-a
[AiTools] Creating new instance for: /project-a
```

**Getting Active Instances:**
```typescript
import { AiToolsInstanceManager } from './bin/claudelet-ai-tools';

// Get list of all active project paths
const active = AiToolsInstanceManager.getActiveInstances();
console.log('Active projects:', active);
```

**Inspecting LSP Manager State:**
```typescript
const manager = createLSPManager({ projectPath });

console.log('Project:', manager.getProjectPath());
console.log('Instance ID:', manager.getInstanceId());
console.log('Status:', await manager.getStatus());
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Process                               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐         ┌──────────────────┐          │
│  │  Shell 1         │         │  Shell 2         │          │
│  │  /project-a      │         │  /project-b      │          │
│  ├──────────────────┤         ├──────────────────┤          │
│  │ AiToolsService   │         │ AiToolsService   │          │
│  │   instance A     │         │   instance B     │          │
│  ├──────────────────┤         ├──────────────────┤          │
│  │ LSPManager       │         │ LSPManager       │          │
│  │  ID: a1b2c3d4    │         │  ID: e5f6g7h8    │          │
│  ├──────────────────┤         ├──────────────────┤          │
│  │ Clients:         │         │ Clients:         │          │
│  │  ├─ typescript   │         │  ├─ typescript   │          │
│  │  └─ pyright      │         │  └─ gopls        │          │
│  ├──────────────────┤         ├──────────────────┤          │
│  │ Vector Store     │         │ Vector Store     │          │
│  │  .opencode/      │         │  .opencode/      │          │
│  └──────────────────┘         └──────────────────┘          │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │           Shared Resources                             │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │ LSP Server Binaries: ~/.cache/claudelet/lsp/          │ │
│  │ Embedder Model: ~/.cache/claudelet/mgrep/models/      │ │
│  │ FastApply Models: ~/.cache/claudelet/fast-apply/      │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Future Enhancements

- **Resource Limits**: Add configurable limits on concurrent projects
- **Health Monitoring**: Track resource usage per project instance
- **Project Registry**: Persistent registry of active projects across restarts
- **Graceful Degradation**: Automatically disable instances if system resources are low
