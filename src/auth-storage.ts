/**
 * Simple file-based auth storage for the CLI example
 */
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import type { OAuthTokens } from '@anthropic-ai/anthropic-oauth';
import { sanitizeText } from './env-sanitizer';
import { SecurityValidator } from './security-validator';

const AUTH_FILE = path.join(os.homedir(), '.claude-agent-auth.json');
const AUTH_BASE_DIR = os.homedir();

export interface StoredAuth {
  type: 'api-key' | 'oauth';
  apiKey?: string;
  oauthTokens?: OAuthTokens;
}

export async function loadAuth(): Promise<StoredAuth | null> {
  try {
    // Validate file path for safety (prevents symlink attacks, directory traversal)
    const validatedPath = await SecurityValidator.validateFilePathForRead(AUTH_FILE, AUTH_BASE_DIR);

    const data = await fsp.readFile(validatedPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      const sanitized = sanitizeText(String(error));
      console.error('Failed to load auth:', sanitized);
    }
  }
  return null;
}

export async function saveAuth(auth: StoredAuth): Promise<void> {
  try {
    // Validate file path for safety (prevents symlink attacks, directory traversal)
    const validatedPath = await SecurityValidator.validateFilePathForWrite(AUTH_FILE, AUTH_BASE_DIR);

    await fsp.writeFile(validatedPath, JSON.stringify(auth, null, 2), 'utf8');
    await fsp.chmod(validatedPath, 0o600);
  } catch (error) {
    const sanitized = sanitizeText(String(error));
    console.error('Failed to save auth:', sanitized);
  }
}

export async function clearAuth(): Promise<void> {
  try {
    // Validate file path for safety
    const validatedPath = await SecurityValidator.validateFilePath(AUTH_FILE, AUTH_BASE_DIR);

    await fsp.unlink(validatedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      const sanitized = sanitizeText(String(error));
      console.error('Failed to clear auth:', sanitized);
    }
  }
}
