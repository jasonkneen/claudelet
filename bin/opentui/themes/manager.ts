/**
 * Theme management functions
 */

import * as fs from 'fs';
import * as path from 'path';

import type { Theme } from '../types/index.js';
import { THEME_CONFIG_FILE } from './constants.js';
import { DEFAULT_THEMES } from './definitions.js';

// Load saved theme name
export function loadSavedThemeName(): string | null {
  try {
    if (fs.existsSync(THEME_CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(THEME_CONFIG_FILE, 'utf-8'));
      return data.theme || null;
    }
  } catch {
    // Ignore errors
  }
  return null;
}

// Save theme name
export function saveThemeName(themeName: string): void {
  try {
    const dir = path.dirname(THEME_CONFIG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(THEME_CONFIG_FILE, JSON.stringify({ theme: themeName }, null, 2), { mode: 0o600 });
  } catch {
    // Ignore errors
  }
}

// Get initial theme from saved preference or default to first theme
export function getInitialTheme(): Theme {
  const savedName = loadSavedThemeName();
  if (savedName) {
    const found = DEFAULT_THEMES.find((t) => t.name === savedName);
    if (found) return found;
  }
  return DEFAULT_THEMES[0];
}
