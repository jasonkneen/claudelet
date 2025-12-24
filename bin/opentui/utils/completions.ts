/**
 * Autocomplete utilities for commands and agent references
 */

import type { SubAgent } from 'claude-agent-loop';

/**
 * Get completions for / commands
 */
export function getCommandCompletions(prefix: string): string[] {
  const commands = [
    '/help',
    '/init',
    '/clear',
    '/save',
    '/load',
    '/debug',
    '/quit',
    '/exit',
    '/logout',
    '/stop',
    '/model',
    '/search',
    '/diagnose',
    '/apply',
    '/patch-model',
    '/toggle-grey-tools',
    '/theme'
  ];

  return commands.filter((cmd) => cmd.startsWith(prefix));
}

/**
 * Get completions for @ agent references
 */
export function getAgentCompletions(prefix: string, agents: SubAgent[]): string[] {
  const search = prefix.slice(1).toLowerCase(); // Remove @ and lowercase

  return agents
    .filter((agent) => agent.id.toLowerCase().includes(search))
    .map((agent) => `@${agent.id}`);
}

/**
 * Extract @agent-id references from message content
 */
export function extractAgentReferences(content: string, agents: SubAgent[]): { agentIds: string[]; cleanContent: string } {
  const agentIds: string[] = [];
  let cleanContent = content;

  // Find all @agent-id patterns
  const agentPattern = /@([a-z]+-\d+)/gi;
  const matches = content.matchAll(agentPattern);

  for (const match of matches) {
    const refText = match[0]; // @haiku-1
    const agentId = match[1]; // haiku-1

    // Check if this agent actually exists
    if (agents.some((a) => a.id === agentId)) {
      agentIds.push(agentId);
      // Remove agent reference from content (it's a routing directive, not content)
      cleanContent = cleanContent.replace(refText, '').trim();
    }
  }

  return { agentIds, cleanContent };
}
