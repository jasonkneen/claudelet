/**
 * Debug logging utilities
 */

import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { sanitizeText } from '../../../src/env-sanitizer.js';

// Debug logging configuration
export const DEBUG = process.env.CLAUDELET_DEBUG === 'true';
export const DEBUG_DIR = path.join(os.homedir(), '.claudelet');
export const DEBUG_LOG = path.join(DEBUG_DIR, 'debug.log');

/**
 * Ensure debug directory exists (call once during init)
 */
export const ensureDebugDir = async (): Promise<void> => {
  try {
    await fsp.mkdir(DEBUG_DIR, { recursive: true, mode: 0o700 });
  } catch (error) {
    // Fail silently to avoid disrupting the app
  }
};

/**
 * Debug logger that writes to file with proper permissions and sanitization (non-blocking)
 */
export const debugLog = (msg: string): void => {
  if (!DEBUG) return;

  try {
    // Sanitize the message before writing to prevent leaking secrets
    const sanitized = sanitizeText(msg);
    const timestamp = new Date().toISOString();

    // Fire-and-forget: don't block on file writes
    fsp.appendFile(DEBUG_LOG, `[${timestamp}] ${sanitized}\n`)
      .then(() => fsp.chmod(DEBUG_LOG, 0o600))
      .catch(() => {
        // Fail silently to avoid disrupting the app
      });
  } catch (error) {
    // Fail silently to avoid disrupting the app
  }
};
