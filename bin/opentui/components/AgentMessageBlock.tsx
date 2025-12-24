/**
 * AgentMessageBlock - Display agent message with expandable output
 */

import type { SubAgent } from 'claude-agent-loop';
import React from 'react';

export const AgentMessageBlock: React.FC<{
  agent: SubAgent;
  isExpanded: boolean;
  visibleLineCount: number;
  onToggle: () => void;
  onShowMore: () => void;
}> = ({ agent, isExpanded, visibleLineCount, onToggle, onShowMore }) => {
  // Split liveOutput into lines for pagination
  const outputLines = agent.liveOutput?.split('\n') || [];
  const totalLines = outputLines.length;
  const displayLines = outputLines.slice(0, visibleLineCount);
  const hasMore = visibleLineCount < totalLines;

  const statusColor =
    agent.status === 'running' ? 'cyan' :
    agent.status === 'done' ? 'green' :
    agent.status === 'error' ? 'red' :
    agent.status === 'waiting' ? 'yellow' : 'gray';

  return (
    <box style={{ marginBottom: 1, border: 'single', borderColor: 'blue' }}>
      {/* Header - always visible */}
      <box
        style={{ flexDirection: 'row', paddingLeft: 1, paddingRight: 1 }}
        onMouseUp={onToggle}
      >
        <text content={isExpanded ? '[-]' : '[+]'} fg="blue" bold />
        <text content={` Agent: ${agent.id} `} fg="blue" bold />
        <text content={`(${agent.model})`} fg="gray" />
        <text content=" | " fg="gray" />
        <text content={agent.status} fg={statusColor} bold />
        {agent.progress && (
          <text content={` ${agent.progress.percent}%`} fg="yellow" />
        )}
      </box>

      {/* Expanded content - task and output */}
      {isExpanded && (
        <box style={{ paddingLeft: 2, paddingRight: 1, paddingTop: 1, paddingBottom: 1 }}>
          {agent.currentTask && (
            <>
              <text content="Task: " fg="gray" bold />
              <text content={agent.currentTask} fg="gray" />
            </>
          )}
          {agent.progress && (
            <text content={agent.progress.message} fg="gray" />
          )}
          {/* Live output with pagination */}
          {displayLines.length > 0 && (
            <box style={{ marginTop: 1 }}>
              {displayLines.map((line, idx) => (
                <text key={`output-${idx}`} content={line} fg="gray" />
              ))}
              {/* Show more button */}
              {hasMore && (
                <box
                  style={{ marginTop: 1, flexDirection: 'row' }}
                  onMouseUp={onShowMore}
                >
                  <text content="[Show more " fg="blue" />
                  <text content={`(${totalLines - visibleLineCount} more lines)`} fg="cyan" />
                  <text content="]" fg="blue" />
                </box>
              )}
            </box>
          )}
        </box>
      )}
    </box>
  );
};
