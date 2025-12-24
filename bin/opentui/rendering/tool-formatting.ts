import type { Message } from '../types/index.js';

export interface FormattedToolCall {
  header: string;
  filePath?: string;
  params: string[];
  diff?: DiffLine[];
  isComplete: boolean;
}

export interface DiffLine {
  type: 'context' | 'removed' | 'added' | 'header';
  lineNumber?: number;
  content: string;
}

function capitalizeToolName(name: string): string {
  const nameMap: Record<string, string> = {
    'read': 'Read',
    'edit': 'Edit',
    'write': 'Write',
    'bash': 'Bash',
    'grep': 'Grep',
    'glob': 'Glob',
    'list': 'List',
    'task': 'Task',
    'todowrite': 'TodoWrite',
    'todoread': 'TodoRead',
    'webfetch': 'WebFetch',
    'lsp_hover': 'LSP Hover',
    'lsp_diagnostics': 'LSP Diagnostics',
    'lsp_goto_definition': 'LSP GotoDef',
    'lsp_find_references': 'LSP FindRefs',
    'lsp_document_symbols': 'LSP Symbols',
    'lsp_workspace_symbols': 'LSP WorkspaceSymbols',
    'lsp_rename': 'LSP Rename',
    'lsp_code_actions': 'LSP CodeActions',
    'ast_grep_search': 'AST Search',
    'ast_grep_replace': 'AST Replace',
  };
  return nameMap[name.toLowerCase()] || name.charAt(0).toUpperCase() + name.slice(1);
}

export function formatToolCall(msg: Message): FormattedToolCall {
  const toolName = msg.toolName || 'tool';
  const input = msg.toolInput || {};
  const isComplete = msg.toolResult !== undefined;
  const arrow = isComplete ? '←' : '→';
  
  let filePath: string | undefined;
  const params: string[] = [];
  let diff: DiffLine[] | undefined;

  switch (toolName.toLowerCase()) {
    case 'read': {
      filePath = input.filePath as string;
      if (input.offset !== undefined) params.push(`offset=${input.offset}`);
      if (input.limit !== undefined) params.push(`limit=${input.limit}`);
      break;
    }
    case 'edit': {
      filePath = input.filePath as string;
      if (input.oldString && input.newString) {
        diff = generateDiff(
          input.oldString as string,
          input.newString as string
        );
      }
      break;
    }
    case 'write': {
      filePath = input.filePath as string;
      const content = input.content as string;
      if (content) {
        const lines = content.split('\n').length;
        params.push(`${lines} lines`);
      }
      break;
    }
    case 'bash': {
      const cmd = input.command as string;
      if (cmd) {
        const shortCmd = cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
        params.push(shortCmd);
      }
      break;
    }
    case 'grep': {
      const pattern = input.pattern as string;
      if (pattern) params.push(`"${pattern}"`);
      if (input.path) filePath = input.path as string;
      if (input.include) params.push(`include=${input.include}`);
      break;
    }
    case 'glob': {
      const pattern = input.pattern as string;
      if (pattern) params.push(`"${pattern}"`);
      if (input.path) filePath = input.path as string;
      break;
    }
    case 'list': {
      filePath = input.path as string;
      break;
    }
    case 'task': {
      const desc = input.description as string;
      if (desc) params.push(desc);
      const agent = input.subagent_type as string;
      if (agent) params.push(`agent=${agent}`);
      break;
    }
    case 'lsp_hover':
    case 'lsp_goto_definition':
    case 'lsp_find_references': {
      filePath = input.filePath as string;
      if (input.line !== undefined) params.push(`L${input.line}`);
      break;
    }
    case 'lsp_diagnostics': {
      filePath = input.filePath as string;
      break;
    }
    default: {
      if (input.filePath) filePath = input.filePath as string;
      if (input.path) filePath = input.path as string;
    }
  }

  const displayName = capitalizeToolName(toolName);
  const pathDisplay = filePath ? ` ${shortenPath(filePath)}` : '';
  const paramsDisplay = params.length > 0 ? ` [${params.join(', ')}]` : '';
  const header = `${arrow} ${displayName}${pathDisplay}${paramsDisplay}`;

  return { header, filePath, params, diff, isComplete };
}

function shortenPath(path: string): string {
  const parts = path.split('/');
  if (parts.length <= 3) return path;
  return parts.slice(-3).join('/');
}

export function generateDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const result: DiffLine[] = [];
  
  let lineNum = 1;
  
  const lcs = longestCommonSubsequence(oldLines, newLines);
  let oldIdx = 0;
  let newIdx = 0;
  let lcsIdx = 0;
  
  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (lcsIdx < lcs.length && oldIdx < oldLines.length && oldLines[oldIdx] === lcs[lcsIdx]) {
      if (newIdx < newLines.length && newLines[newIdx] === lcs[lcsIdx]) {
        result.push({ type: 'context', lineNumber: lineNum++, content: oldLines[oldIdx] });
        oldIdx++;
        newIdx++;
        lcsIdx++;
      } else {
        result.push({ type: 'added', lineNumber: lineNum++, content: newLines[newIdx] });
        newIdx++;
      }
    } else if (oldIdx < oldLines.length && (lcsIdx >= lcs.length || oldLines[oldIdx] !== lcs[lcsIdx])) {
      result.push({ type: 'removed', lineNumber: lineNum, content: oldLines[oldIdx] });
      oldIdx++;
    } else if (newIdx < newLines.length) {
      result.push({ type: 'added', lineNumber: lineNum++, content: newLines[newIdx] });
      newIdx++;
    }
  }
  
  return result;
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  const result: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  
  return result;
}
