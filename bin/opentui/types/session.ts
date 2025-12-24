/**
 * Session-related types
 */

// Thinking session - tracks a single thinking block
export interface ThinkingSession {
  id: string;
  startTime: Date;
  endTime?: Date; // undefined while active
  content: string;
}

/**
 * Tool activity for grouped chip display
 * Shows one chip per tool type with count and active state
 */
export interface ToolActivity {
  name: string;
  count: number;
  isActive: boolean; // true if any instance is currently executing (no result yet)
  order: number; // for maintaining first-appearance order
}
