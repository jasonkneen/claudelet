/**
 * ToolActivityBoxes - Display active tools as colored chips
 */

import React from 'react';

export const ToolActivityBoxes: React.FC<{
  activities: Array<{ name: string; count: number; isActive: boolean }>;
}> = ({ activities }) => {
  if (activities.length === 0) return null;

  return (
    <box style={{ marginTop: 1, flexDirection: 'row' }}>
      {activities.map((activity) => {
        const countSuffix = activity.count > 1 ? ` x${activity.count}` : '';
        const bgColor = activity.isActive ? 'cyan' : 'gray';
        const fgColor = activity.isActive ? 'black' : 'black';
        const label = activity.name.toLowerCase();

        return (
          <text
            key={`tool-box-${activity.name}`}
            content={` ${label}${countSuffix} `}
            fg={fgColor}
            bg={bgColor}
            bold={activity.isActive}
            style={{ marginRight: 1 }}
          />
        );
      })}
    </box>
  );
};
