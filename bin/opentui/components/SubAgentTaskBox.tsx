/**
 * SubAgentTaskBox - Purple bordered task box showing agent status
 * Expandable to show live progress via Ctrl+O or mouse click
 */

import type { SubAgent } from 'claude-agent-loop';
import React from 'react';

export const SubAgentTaskBox: React.FC<{
  agent: SubAgent;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ agent, isExpanded, onToggle }) => (
  <box
    style={{
      border: 'single',
      borderColor: 'gray',
      marginLeft: 2,
      marginBottom: 1
    }}
    onMouseUp={onToggle}
  >
    {/* Header - always visible */}
    <box style={{ flexDirection: 'row', paddingLeft: 1, paddingRight: 1 }}>
      <text content={isExpanded ? '[-]' : '[+]'} fg="gray" />
      <text content={` ${agent.id} `} fg="gray" />
      <text content={`(${agent.model})`} fg="gray" />
      <text content=" | " fg="gray" />
      <text
        content={agent.status}
        fg={
          agent.status === 'running' ? 'cyan' :
          agent.status === 'done' ? 'green' :
          agent.status === 'error' ? 'red' :
          agent.status === 'waiting' ? 'yellow' : 'gray'
        }
      />
      {agent.progress && (
        <text content={` ${agent.progress.percent}%`} fg="yellow" />
      )}
    </box>

    {/* Expanded content - live progress */}
    {isExpanded && (
      <box style={{ paddingLeft: 3, paddingTop: 1 }}>
        <text content={agent.currentTask || 'Waiting...'} fg="gray" />
        {agent.progress && (
          <text content={agent.progress.message} fg="gray" />
        )}
        {/* Live streaming output */}
        {agent.liveOutput && (
          <box style={{ maxHeight: 8 }}>
            <text
              content={agent.liveOutput.slice(-500)}
              fg="gray"
            />
          </box>
        )}
      </box>
    )}
  </box>
);
