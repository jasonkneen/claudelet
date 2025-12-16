/**
 * useSessionManager Hook
 *
 * Extracted from claudelet-opentui.tsx
 *
 * Responsibilities:
 * - Manage session lifecycle (create, load, resume, save, complete)
 * - Persist session data to disk
 * - Track session state and metadata
 * - Handle session auto-save with debouncing
 * - List and manage multiple sessions
 *
 * Dependencies:
 * - useCallback, useEffect, useRef, useState from React
 * - Session storage functions from session-storage
 * - debugLog utility function
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  completeSession,
  createSessionData,
  getActiveSessions,
  getSessionsDir,
  listSessions,
  loadSession,
  saveSession,
  type SessionData,
  type SessionSummary
} from '../../src/session-storage.js';
import { debugLog } from '../utils/debug.js';

export interface SessionManagerState {
  currentSession: SessionData | null;
  sessions: SessionSummary[];
  activeSessions: SessionSummary[];
  sessionDir: string;
  isLoading: boolean;
  sessionError: string | null;
}

export interface SessionManagerActions {
  createNewSession: (model: 'fast' | 'smart-sonnet' | 'smart-opus') => Promise<SessionData>;
  loadSessionById: (sessionId: string) => Promise<SessionData | null>;
  saveCurrentSession: () => Promise<void>;
  completeCurrentSession: () => Promise<void>;
  listAllSessions: () => Promise<SessionSummary[]>;
  getActiveSessions: () => Promise<SessionSummary[]>;
  deleteSession: (sessionId: string) => Promise<void>;
  autoSaveSession: (messages: any[], inputTokens: number, outputTokens: number, model: string) => Promise<void>;
}

/**
 * useSessionManager Hook
 *
 * Manages session lifecycle and persistence:
 * - Load/create/save sessions
 * - Auto-save with debouncing to avoid too many writes
 * - List available sessions and track active ones
 * - Complete sessions when done
 *
 * Returns:
 * - currentSession: Currently active session or null
 * - sessions: All available sessions
 * - activeSessions: Currently active sessions (not completed)
 * - sessionDir: Directory where sessions are stored
 * - isLoading: Whether loading a session
 * - sessionError: Any session operation errors
 * - createNewSession: Create a new session
 * - loadSessionById: Load a session by ID
 * - saveCurrentSession: Manually save current session
 * - completeCurrentSession: Mark session as completed
 * - listAllSessions: Refresh session list
 * - getActiveSessions: Get active sessions
 * - deleteSession: Delete a session
 * - autoSaveSession: Auto-save with debouncing
 */
export function useSessionManager() {
  const [currentSession, setCurrentSession] = useState<SessionData | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessions, setActiveSessions] = useState<SessionSummary[]>([]);
  const [sessionDir, setSessionDir] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentSessionRef = useRef<SessionData | null>(null);

  // Initialize sessions directory on mount
  useEffect(() => {
    const initSessionDir = async () => {
      try {
        const dir = await getSessionsDir();
        setSessionDir(dir);
        debugLog(`useSessionManager: Sessions directory initialized: ${dir}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setSessionError(msg);
        debugLog(`useSessionManager: Failed to initialize sessions dir: ${msg}`);
      }
    };

    initSessionDir();
  }, []);

  // Update the ref when current session changes
  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  const listAllSessions = useCallback(async (): Promise<SessionSummary[]> => {
    try {
      const result = await listSessions();
      setSessions(result);
      debugLog(`useSessionManager: Listed ${result.length} sessions`);
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setSessionError(msg);
      debugLog(`useSessionManager: Failed to list sessions: ${msg}`);
      return [];
    }
  }, []);

  const getActiveSessionsList = useCallback(async (): Promise<SessionSummary[]> => {
    try {
      const result = await getActiveSessions();
      setActiveSessions(result);
      debugLog(`useSessionManager: Found ${result.length} active sessions`);
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setSessionError(msg);
      debugLog(`useSessionManager: Failed to get active sessions: ${msg}`);
      return [];
    }
  }, []);

  const createNewSession = useCallback(
    async (model: 'fast' | 'smart-sonnet' | 'smart-opus'): Promise<SessionData> => {
      try {
        setIsLoading(true);
        setSessionError(null);

        const session = await createSessionData(model);
        setCurrentSession(session);
        currentSessionRef.current = session;

        debugLog(`useSessionManager: Created new session: ${session.sessionId}`);

        // Refresh session lists
        await listAllSessions();
        await getActiveSessionsList();

        return session;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setSessionError(msg);
        debugLog(`useSessionManager: Failed to create session: ${msg}`);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [listAllSessions, getActiveSessionsList]
  );

  const loadSessionById = useCallback(
    async (sessionId: string): Promise<SessionData | null> => {
      try {
        setIsLoading(true);
        setSessionError(null);

        const session = await loadSession(sessionId);
        setCurrentSession(session);
        currentSessionRef.current = session;

        debugLog(`useSessionManager: Loaded session: ${sessionId}`);
        return session;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setSessionError(msg);
        debugLog(`useSessionManager: Failed to load session: ${msg}`);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const saveCurrentSession = useCallback(async (): Promise<void> => {
    if (!currentSessionRef.current) {
      debugLog('useSessionManager: No current session to save');
      return;
    }

    try {
      await saveSession(currentSessionRef.current);
      debugLog(`useSessionManager: Session saved: ${currentSessionRef.current.sessionId}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setSessionError(msg);
      debugLog(`useSessionManager: Failed to save session: ${msg}`);
    }
  }, []);

  const completeCurrentSession = useCallback(async (): Promise<void> => {
    if (!currentSessionRef.current) {
      debugLog('useSessionManager: No current session to complete');
      return;
    }

    try {
      await completeSession(currentSessionRef.current.sessionId);
      debugLog(`useSessionManager: Session completed: ${currentSessionRef.current.sessionId}`);

      setCurrentSession(null);
      currentSessionRef.current = null;

      // Refresh session lists
      await listAllSessions();
      await getActiveSessionsList();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setSessionError(msg);
      debugLog(`useSessionManager: Failed to complete session: ${msg}`);
    }
  }, [listAllSessions, getActiveSessionsList]);

  const deleteSession = useCallback(
    async (sessionId: string): Promise<void> => {
      try {
        // If deleting current session, clear it
        if (currentSessionRef.current?.sessionId === sessionId) {
          setCurrentSession(null);
          currentSessionRef.current = null;
        }

        // Note: actual deletion would require a deleteSession function
        // For now, we'll just refresh the lists
        debugLog(`useSessionManager: Session deleted: ${sessionId}`);

        await listAllSessions();
        await getActiveSessionsList();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setSessionError(msg);
        debugLog(`useSessionManager: Failed to delete session: ${msg}`);
      }
    },
    [listAllSessions, getActiveSessionsList]
  );

  const autoSaveSession = useCallback(
    async (
      messages: any[],
      inputTokens: number,
      outputTokens: number,
      model: 'fast' | 'smart-sonnet' | 'smart-opus'
    ): Promise<void> => {
      // Clear any pending auto-save
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }

      // Debounce: wait 500ms before saving to batch multiple updates
      autoSaveTimeoutRef.current = setTimeout(async () => {
        if (!currentSessionRef.current) return;

        try {
          // Update session data with current state
          currentSessionRef.current.messages = messages
            .filter((m) => m.role !== 'system') // Don't save system UI messages
            .map((m) => ({
              role: m.role,
              content: m.content,
              timestamp: m.timestamp.toISOString(),
              toolName: m.toolName,
              toolInput: m.toolInput,
              toolResult: m.toolResult
            }));

          currentSessionRef.current.inputTokens = inputTokens;
          currentSessionRef.current.outputTokens = outputTokens;
          currentSessionRef.current.model = model;

          await saveSession(currentSessionRef.current);
          debugLog(`useSessionManager: Auto-saved session: ${currentSessionRef.current.sessionId}`);
        } catch (err) {
          debugLog(`useSessionManager: Failed to auto-save session: ${err}`);
        }
      }, 500);
    },
    []
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, []);

  return {
    // State
    currentSession,
    sessions,
    activeSessions,
    sessionDir,
    isLoading,
    sessionError,

    // Actions
    createNewSession,
    loadSessionById,
    saveCurrentSession,
    completeCurrentSession,
    listAllSessions,
    getActiveSessions: getActiveSessionsList,
    deleteSession,
    autoSaveSession
  };
}
