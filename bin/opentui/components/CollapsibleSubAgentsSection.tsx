/**
 * CollapsibleSubAgentsSection - Collapsible section showing background agents
 */

import type { SubAgent } from 'claude-agent-loop';
import React from 'react';

import type { Theme } from '../types/index.js';
import { SubAgentTaskBox } from './SubAgentTaskBox.tsx';

export const CollapsibleSubAgentsSection: React.FC<{
  agents: SubAgent[];
  isExpanded: boolean;
  expandedAgents: Set<string>;
  onToggleSection: () => void;
  onToggleAgent: (agentId: string) => void;
  theme: Theme;
}> = ({ agents, isExpanded, expandedAgents, onToggleSection, onToggleAgent, theme }) => {
  return (
    <box style={{ marginTop: 1, marginBottom: 1, maxHeight: 20, flexShrink: 0 }}>
      {/* Section header - always visible */}
      <box
        style={{ flexDirection: 'row', paddingLeft: 1 }}
        onMouseUp={onToggleSection}
      >
        <text content={isExpanded ? '[-]' : '[+]'} fg={theme.colors.primary} bold />
        <text content=" Background Agents " fg={theme.colors.primary} bold />
        {agents.length > 0 && (
          <>
            <text content={`(${agents.length})`} fg="gray" />
            {agents.some(a => a.status === 'running') && (
              <text content=" ..." fg="cyan" />
            )}
          </>
        )}
        {agents.length === 0 && isExpanded && (
          <text content=" (none running) " fg="gray" italic />
        )}
      </box>

      {/* Agent list - only when section expanded, with scrolling */}
      {isExpanded && agents.length > 0 && (
        <scrollbox
          scrollX={false}
          style={{
            maxHeight: 18,
            flexShrink: 0
          }}
          options={{
            style: {
              scrollbar: {
                bg: 'gray'
              }
            }
          }}
        >
          {agents.map(agent => (
            <SubAgentTaskBox
              key={agent.id}
              agent={agent}
              isExpanded={expandedAgents.has(agent.id)}
              onToggle={() => onToggleAgent(agent.id)}
            />
          ))}
        </scrollbox>
      )}

      {/* Empty state message */}
      {isExpanded && agents.length === 0 && (
        <box style={{ paddingLeft: 2, paddingTop: 0 }}>
          <text content="No background agents running" fg="gray" />
          <text content="When agents spawn in the background, they will appear here." fg="gray" />
          <text content="Press Ctrl+O to close this panel." fg="gray" />
        </box>
      )}
    </box>
  );
};
