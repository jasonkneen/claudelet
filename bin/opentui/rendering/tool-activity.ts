/**
 * Tool activity and thinking chip rendering utilities
 */

import type { Message, ThinkingSession, ToolActivity } from '../types/index.js';

/**
 * Extract tool activity from messages, grouped by tool name
 * Returns one entry per tool type with count and active state
 */
export function extractToolActivity(messages: Message[], greyOutFinishedTools: boolean = true): ToolActivity[] {
  // Filter for tool messages
  const toolMessages = messages.filter((m) => m.role === 'tool' && m.toolName);

  if (toolMessages.length === 0) {
    return [];
  }

  // Group by tool name, tracking count and active state
  const toolMap = new Map<string, { count: number; isActive: boolean; order: number }>();

  toolMessages.forEach((msg, index) => {
    const toolName = msg.toolName!;
    const existing = toolMap.get(toolName);

    // Tool is active if it has no result yet (or if greying out is disabled)
    const isToolActive = greyOutFinishedTools ? msg.toolResult === undefined : true;

    if (existing) {
      existing.count += 1;
      // Tool is active if ANY instance is active
      existing.isActive = existing.isActive || isToolActive;
    } else {
      toolMap.set(toolName, {
        count: 1,
        isActive: isToolActive,
        order: index
      });
    }
  });

  // Convert to array and sort by first appearance order
  return Array.from(toolMap.entries())
    .map(([name, data]) => ({
      name,
      count: data.count,
      isActive: data.isActive,
      order: data.order
    }))
    .sort((a, b) => a.order - b.order);
}

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

export function extractTodos(messages: Message[]): TodoItem[] {
  const todoMessages = messages.filter(
    (m) => m.role === 'tool' && m.toolName === 'todowrite' && m.toolInput?.todos
  );
  
  if (todoMessages.length === 0) return [];
  
  const lastTodoMessage = todoMessages[todoMessages.length - 1];
  const todos = lastTodoMessage.toolInput?.todos as TodoItem[] | undefined;
  
  return todos || [];
}

export function formatThinkingChip(session: ThinkingSession, animate: boolean, animFrame: number): string {
  const brailleFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const now = new Date();
  const elapsed = session.endTime
    ? (session.endTime.getTime() - session.startTime.getTime()) / 1000
    : (now.getTime() - session.startTime.getTime()) / 1000;

  if (!session.endTime) {
    // Active: show animation + elapsed time
    const frame = brailleFrames[animFrame % brailleFrames.length];
    return elapsed < 1 ? `${frame} thinking` : `${frame} ${elapsed.toFixed(0)}s`;
  } else {
    // Completed: show brain icon + duration
    return `🧠 ${elapsed.toFixed(0)}s`;
  }
}
