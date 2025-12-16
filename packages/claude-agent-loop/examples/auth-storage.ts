/**
 * Simple file-based auth storage for the CLI example
 */
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import type { OAuthTokens } from '@anthropic-ai/anthropic-oauth';

const AUTH_FILE = path.join(os.homedir(), '.claude-agent-auth.json');

export interface StoredAuth {
  type: 'api-key' | 'oauth';
  apiKey?: string;
  oauthTokens?: OAuthTokens;
}

export async function loadAuth(): Promise<StoredAuth | null> {
  try {
    const data = await fsp.readFile(AUTH_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Failed to load auth:', error);
    }
  }
  return null;
}

export async function saveAuth(auth: StoredAuth): Promise<void> {
  try {
    await fsp.writeFile(AUTH_FILE, JSON.stringify(auth, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save auth:', error);
  }
}

export async function clearAuth(): Promise<void> {
  try {
    await fsp.unlink(AUTH_FILE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Failed to clear auth:', error);
    }
  }
}
