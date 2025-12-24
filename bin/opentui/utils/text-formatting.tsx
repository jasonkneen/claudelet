/**
 * Text formatting utilities
 */

import React from 'react';

import type { InputSegment } from '../types/index.js';

/**
 * Convert input segments to display string
 */
export function segmentsToDisplayString(segments: InputSegment[]): string {
  return segments
    .map((seg) => {
      if (seg.type === 'text') {
        return seg.text;
      } else if (seg.type === 'chip') {
        return seg.chip.label;
      } else {
        return seg.context.label;
      }
    })
    .join('');
}

/**
 * Render text with multi-line support by splitting on newlines
 * Returns React elements for proper line-by-line display
 * Each line after the first is prefixed with a left bar character (█)
 */
export function renderMultilineText(
  text: string,
  fgColor: string,
  cursorPosOverall: number,
  cursorVisible: boolean,
  beforeText: string = '',
  afterText: string = ''
): React.ReactNode[] {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let charCount = beforeText.length;

  lines.forEach((line, lineIdx) => {
    const lineStart = charCount;
    const lineEnd = charCount + line.length;

    // Check if cursor is on this line
    const cursorOnLine = cursorPosOverall >= lineStart && cursorPosOverall <= lineEnd;
    const cursorOffsetInLine = cursorOnLine ? cursorPosOverall - lineStart : -1;

    // Add left bar for all lines
    const leftBar = '█ ';

    if (cursorOnLine) {
      // Render cursor on this line
      const beforeCursor = line.slice(0, cursorOffsetInLine);
      const afterCursor = line.slice(cursorOffsetInLine);
      elements.push(
        <React.Fragment key={`line-${lineIdx}`}>
          {leftBar && <text content={leftBar} fg={fgColor} />}
          <text content={beforeCursor} fg={fgColor} />
          <text content={cursorVisible ? '█' : ' '} fg="gray" />
          <text content={afterCursor} fg={fgColor} />
          {lineIdx < lines.length - 1 && <text content="" />}
        </React.Fragment>
      );
    } else {
      // Regular line - prepend left bar for wrapped lines
      const lineContent = leftBar + line;
      elements.push(
        <text key={`line-${lineIdx}`} content={lineContent} fg={fgColor} />
      );
    }

    charCount += line.length + 1; // +1 for newline
  });

  return elements;
}
