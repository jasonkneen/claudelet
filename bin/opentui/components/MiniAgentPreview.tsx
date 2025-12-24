/**
 * MiniAgentPreview - Compact agent status display
 */

import type { SubAgent } from 'claude-agent-loop';
import React from 'react';

import type { Theme } from '../types/index.js';
export const MiniAgentPreview: React.FC<{
  agents: SubAgent[];
  onExpand: () => void;
  theme: Theme;
}> = ({ agents, onExpand, theme }) => {
  if (agents.length === 0) return null;

  // Status symbols for inline display
  const getStatusSymbol = (status: string) => {
    switch (status) {
      case 'running': return '●';
      case 'done': return '✓';
      case 'error': return '✗';
      case 'waiting': return '○';
      default: return '·';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'cyan';
      case 'done': return 'green';
      case 'error': return 'red';
      case 'waiting': return 'yellow';
      default: return 'gray';
    }
  };

  return (
    <box
      style={{
        marginBottom: 0,
        paddingLeft: 1,
        paddingRight: 1,
        flexShrink: 0,
        backgroundColor: '#1a1a1a'
      }}
      border={true}
      borderStyle="single"
      borderColor="#444444"
      onMouseUp={onExpand}
    >
      {/* Header row */}
      <text
        content={`[+] ${agents.length} agent${agents.length !== 1 ? 's' : ''} (click to expand)`}
        fg={theme.colors.muted}
      />
      {/* Agent rows - max 3 visible */}
      {agents.slice(0, 3).map((agent) => {
        const symbol = getStatusSymbol(agent.status);
        const color = getStatusColor(agent.status);
        const agentId = agent.id.slice(0, 7);
        const model = agent.model?.split('-')[0] || '';
        const progress = agent.progress ? ` ${agent.progress.percent}%` : '';

        // Get last meaningful line from output, clean it up
        const lastLine = agent.liveOutput
          ?.split('\n')
          .filter(l => l.trim())
          .slice(-1)[0]
          ?.replace(/\s+/g, ' ')
          .trim()
          .slice(0, 60) || '';

        // Build the full line as a single string
        const line = `${symbol} ${agentId} ${model}${progress}${lastLine ? ` - ${lastLine}` : ''}`;

        return (
          <text
            key={`mini-${agent.id}`}
            content={line}
            fg={color}
          />
        );
      })}
      {agents.length > 3 && (
        <text content={`  +${agents.length - 3} more...`} fg="gray" />
      )}
    </box>
  );
};
