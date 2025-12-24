/**
 * Input-related types for the chat application
 */

// Represents a file chip in the input
export interface FileChip {
  id: string;
  label: string; // Display name like "readme.md"
  filePath: string; // Full path like "path/to/readme.md"
}

// Represents a context chip in the input (+include / -exclude)
export interface ContextChip {
  id: string;
  label: string; // Display name like "aisdk" or "customcode"
  isInclude: boolean; // true for +include (white), false for -exclude (red)
}

// Input segment - text, file chip, or context chip
export type InputSegment =
  | { type: 'text'; text: string }
  | { type: 'chip'; chip: FileChip }
  | { type: 'context'; context: ContextChip };
