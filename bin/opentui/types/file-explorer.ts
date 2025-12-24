/**
 * File explorer types
 */

export interface FileExplorerEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
}

export type FileExplorerNode =
  | { kind: 'entry'; entry: FileExplorerEntry; depth: number; expanded: boolean; loading: boolean; error?: string }
  | { kind: 'status'; label: string; depth: number }
  | { kind: 'loadMore'; dirPath: string; depth: number };
