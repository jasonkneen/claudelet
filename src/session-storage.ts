/**
 * Session Storage for Claudelet
 * Auto-saves conversations to .claudelet/sessions/ directory
 */

import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { SecurityValidator } from './security-validator';

export interface StoredMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
}

export type SessionStatus = 'active' | 'completed';

export interface StoredSubAgent {
  id: string;
  model: string;
  status: string;
  currentTask?: string;
  liveOutput?: string;
  spawnedAt: string;
  completedAt?: string;
  error?: string;
}

export interface SessionData {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  workingDirectory: string;
  messages: StoredMessage[];
  inputTokens: number;
  outputTokens: number;
  status: SessionStatus;
  subAgents?: StoredSubAgent[]; // Orchestrated sub-agent conversations
}

export interface SessionSummary {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messageCount: number;
  preview: string; // First user message or summary
  filePath: string;
  status: SessionStatus;
  workingDirectory: string;
}

const SESSIONS_DIR = '.claudelet/sessions';

/**
 * Get the sessions directory path
 */
export function getSessionsDir(): string {
  // Store in home directory for global access
  return path.join(os.homedir(), SESSIONS_DIR);
}

/**
 * Ensure the sessions directory exists
 */
export async function ensureSessionsDir(): Promise<void> {
  const dir = getSessionsDir();
  await fsp.mkdir(dir, { recursive: true });
}

/**
 * Generate a session filename from session ID and timestamp
 */
function getSessionFilename(sessionId: string, createdAt: string): string {
  // Format: YYYY-MM-DD_HH-MM_shortId.json
  const date = new Date(createdAt);
  const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
  const timeStr = date.toISOString().slice(11, 16).replace(':', '-'); // HH-MM
  const shortId = sessionId.slice(0, 8);
  return `${dateStr}_${timeStr}_${shortId}.json`;
}

/**
 * Get the full path for a session file
 */
function getSessionPath(sessionId: string, createdAt: string): string {
  return path.join(getSessionsDir(), getSessionFilename(sessionId, createdAt));
}

/**
 * Save a session to disk
 */
export async function saveSession(session: SessionData): Promise<string> {
  await ensureSessionsDir();
  const filePath = getSessionPath(session.sessionId, session.createdAt);

  // Validate file path for safety (prevents symlink attacks, directory traversal)
  const sessionsDir = getSessionsDir();
  const validatedPath = await SecurityValidator.validateFilePathForWrite(filePath, sessionsDir);

  // Update the updatedAt timestamp
  session.updatedAt = new Date().toISOString();

  await fsp.writeFile(validatedPath, JSON.stringify(session, null, 2));
  return validatedPath;
}

/**
 * Load a session from disk by file path
 */
export async function loadSession(filePath: string): Promise<SessionData | null> {
  try {
    // Validate file path for safety
    const sessionsDir = getSessionsDir();
    const validatedPath = await SecurityValidator.validateFilePathForRead(filePath, sessionsDir);

    const content = await fsp.readFile(validatedPath, 'utf-8');
    return JSON.parse(content) as SessionData;
  } catch {
    return null;
  }
}

/**
 * Load a session by session ID (searches for matching file)
 */
export async function loadSessionById(sessionId: string): Promise<SessionData | null> {
  const sessions = await listSessions();
  const match = sessions.find(s => s.sessionId === sessionId || s.sessionId.startsWith(sessionId));
  if (match) {
    return loadSession(match.filePath);
  }
  return null;
}

/**
 * List all saved sessions, sorted by most recent first
 */
export async function listSessions(): Promise<SessionSummary[]> {
  try {
    await ensureSessionsDir();
    const dir = getSessionsDir();
    const files = await fsp.readdir(dir);

    const summaries: SessionSummary[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(dir, file);
      try {
        const content = await fsp.readFile(filePath, 'utf-8');
        const session = JSON.parse(content) as SessionData;

        // Get preview from first user message
        const firstUserMsg = session.messages.find(m => m.role === 'user');
        const preview = firstUserMsg
          ? firstUserMsg.content.slice(0, 60) + (firstUserMsg.content.length > 60 ? '...' : '')
          : '(empty session)';

        summaries.push({
          sessionId: session.sessionId,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          model: session.model,
          messageCount: session.messages.filter(m => m.role === 'user' || m.role === 'assistant').length,
          preview,
          filePath,
          status: session.status || 'completed', // Default old sessions to completed
          workingDirectory: session.workingDirectory
        });
      } catch {
        // Skip invalid files
      }
    }

    // Sort by updatedAt, most recent first
    summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return summaries;
  } catch {
    return [];
  }
}

/**
 * Delete a session by file path
 */
export async function deleteSession(filePath: string): Promise<boolean> {
  try {
    // Validate file path for safety
    const sessionsDir = getSessionsDir();
    const validatedPath = await SecurityValidator.validateFilePath(filePath, sessionsDir);

    await fsp.unlink(validatedPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new session data object
 */
export function createSessionData(sessionId: string, model: string): SessionData {
  const now = new Date().toISOString();
  return {
    sessionId,
    createdAt: now,
    updatedAt: now,
    model,
    workingDirectory: process.cwd(),
    messages: [],
    inputTokens: 0,
    outputTokens: 0,
    status: 'active'
  };
}

/**
 * Get all active sessions (not yet completed)
 * Optionally filter by working directory
 */
export async function getActiveSessions(workingDirectory?: string): Promise<SessionSummary[]> {
  const all = await listSessions();
  return all.filter(s => {
    if (s.status !== 'active') return false;
    if (workingDirectory && s.workingDirectory !== workingDirectory) return false;
    return true;
  });
}

/**
 * Mark a session as completed
 */
export async function completeSession(session: SessionData): Promise<string> {
  session.status = 'completed';
  return saveSession(session);
}
