/**
 * Keyboard input utilities
 */

import type { KeyEvent } from '@opentui/core';

export const SHIFTED_CHAR_MAP: Record<string, string> = {
  '1': '!',
  '2': '@',
  '3': '#',
  '4': '$',
  '5': '%',
  '6': '^',
  '7': '&',
  '8': '*',
  '9': '(',
  '0': ')',
  '-': '_',
  '=': '+',
  '[': '{',
  ']': '}',
  '\\': '|',
  ';': ':',
  "'": '"',
  ',': '<',
  '.': '>',
  '/': '?',
  '`': '~'
};

export function isModifyOtherKeysSequence(sequence: string): boolean {
  // CSI 27 ; modifier ; code ~
  return sequence.startsWith('\x1b[27;') && sequence.endsWith('~');
}

export function getPrintableCharFromKeyEvent(key: KeyEvent): string | null {
  if (key.name === 'space') return ' ';

  const isModifyOtherKeys = isModifyOtherKeysSequence(key.sequence);
  const shouldApplyShiftMap = key.source === 'kitty' || isModifyOtherKeys;

  if (key.name && key.name.length === 1) {
    const base = key.name;

    if (key.shift) {
      if (base >= 'a' && base <= 'z') return base.toUpperCase();
      if (shouldApplyShiftMap && base in SHIFTED_CHAR_MAP) return SHIFTED_CHAR_MAP[base]!;
    }

    return base;
  }

  // Fallback: if `sequence` is a single printable ASCII char, treat it as input.
  if (key.sequence.length === 1) {
    const code = key.sequence.charCodeAt(0);
    if (code >= 32 && code <= 126) return key.sequence;
  }

  return null;
}
