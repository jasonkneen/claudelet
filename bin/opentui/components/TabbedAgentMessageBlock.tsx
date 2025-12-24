/**
 * TabbedAgentMessageBlock - Full-width block showing all agents as tabs
 * Only one agent's content is visible at a time, click tabs to switch
 */

import type { SubAgent } from 'claude-agent-loop';
import React from 'react';

import type { Theme } from '../types/index.js';

export const TabbedAgentMessageBlock: React.FC<{
  agents: SubAgent[];
  activeAgentId: string | null;
  visibleLineCount: number;
  maxHeight?: number;
  theme: Theme;
  tabBackground: string;
  onSelectTab: (agentId: string) => void;
  onShowMore: () => void;
}> = ({
  agents,
  activeAgentId,
  visibleLineCount,
  maxHeight = 30,
  theme,
  tabBackground,
  onSelectTab,
  onShowMore
}) => {
  // Set first agent as default if none selected
  const effectiveActiveId = activeAgentId || agents[0]?.id || null;
  const activeAgent = agents.find((a) => a.id === effectiveActiveId);

  if (!activeAgent) {
    return null;
  }

  const outputLines = activeAgent.liveOutput?.split('\n') || [];
  const totalLines = outputLines.length;
  const displayLines = outputLines.slice(0, visibleLineCount);
  const hasMore = visibleLineCount < totalLines;

  const statusColor =
    activeAgent.status === 'running' ? 'cyan' :
    activeAgent.status === 'done' ? 'green' :
    activeAgent.status === 'error' ? 'red' :
    activeAgent.status === 'waiting' ? 'yellow' : 'gray';

  return (
    <box style={{ marginBottom: 1, flexShrink: 0 }}>
      {/* Tab bar - all agents as joined segmented tabs */}
      <box
        border={true}
        borderStyle="rounded"
        borderColor={theme.colors.border}
        style={{
          marginLeft: 1,
          marginRight: 1,
          marginTop: 0,
          flexDirection: 'row',
          height: 2,
          backgroundColor: tabBackground
        }}
      >
        {agents.map((agent, idx) => {
          const isActive = agent.id === effectiveActiveId;
          return (
            <React.Fragment key={`tab-${agent.id}`}>
              <box
                style={{
                  flexDirection: 'row',
                  flexGrow: 1,
                  justifyContent: 'center',
                  alignItems: 'center',
                  paddingLeft: 0,
                  paddingRight: 0
                }}
                onMouseUp={() => onSelectTab(agent.id)}
              >
                <text
                  content={agent.id}
                  fg={isActive ? theme.colors.highlight : theme.colors.muted}
                  bold={isActive}
                />
              </box>
              {idx < agents.length - 1 && <text content="│" fg={theme.colors.border} />}
            </React.Fragment>
          );
        })}
      </box>

      {/* Content area for active agent - resizable height with scrolling */}
      <scrollbox
        scrollX={false}
        style={{
          maxHeight: maxHeight,
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
        <box style={{ paddingLeft: 1, paddingRight: 1, paddingTop: 1, paddingBottom: 1 }}>
          {/* Header with status and model */}
          <box style={{ flexDirection: 'row' }}>
            <text content={`${activeAgent.model}`} fg="gray" />
            <text content=" | " fg="gray" />
            <text content={activeAgent.status} fg={statusColor} bold />
            {activeAgent.progress && (
              <text content={` ${activeAgent.progress.percent}%`} fg="yellow" />
            )}
          </box>

          {/* Task description */}
          {activeAgent.currentTask && (
            <box style={{ marginTop: 1 }}>
              <text content="Task: " fg="gray" bold />
              <text content={activeAgent.currentTask} fg="gray" />
            </box>
          )}

          {/* Progress message */}
          {activeAgent.progress && (
            <text content={activeAgent.progress.message} fg="gray" style={{ marginTop: 1 }} />
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
      </scrollbox>
    </box>
  );
};
