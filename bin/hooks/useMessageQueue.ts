/**
 * useMessageQueue Hook
 *
 * Extracted from claudelet-opentui.tsx
 *
 * Responsibilities:
 * - Manage queued messages (for when AI is responding)
 * - Handle message injection timing
 * - Track pending messages
 * - Manage urgent vs normal priority messages
 * - Clear queue when needed
 *
 * Dependencies:
 * - useCallback, useRef, useState from React
 * - SmartMessageQueue from claude-agent-loop
 */

import { useCallback, useRef, useState } from 'react';
import { SmartMessageQueue } from 'claude-agent-loop';

const TODOS_FILE = '.todos.md';

export interface MessageQueueState {
  pendingCount: number;
  hasUrgent: boolean;
}

export interface MessageQueueActions {
  addMessage: (message: string, isUrgent?: boolean) => boolean;
  getNextMessage: () => string | null;
  clearQueue: () => void;
  getPendingCount: () => number;
  shouldAutoInject: () => boolean;
  hasUrgentMessages: () => boolean;
  injectNext: () => string | null;
}

/**
 * useMessageQueue Hook
 *
 * Manages a smart message queue that:
 * - Buffers messages when AI is responding
 * - Automatically injects queued messages at appropriate times
 * - Handles urgent messages separately
 * - Persists messages to todos file as backup
 *
 * Returns:
 * - pendingCount: Number of messages waiting to be injected
 * - hasUrgent: Whether there are urgent messages
 * - addMessage: Add a message to queue (optionally urgent)
 * - getNextMessage: Get next message to inject
 * - clearQueue: Clear all queued messages
 * - getPendingCount: Get number of pending messages
 * - shouldAutoInject: Check if auto-inject should happen
 * - hasUrgentMessages: Check for urgent messages
 * - injectNext: Inject next message from queue
 */
export function useMessageQueue() {
  const [pendingCount, setPendingCount] = useState(0);
  const [hasUrgent, setHasUrgent] = useState(false);

  // Smart message queue with 30 second timeout and todos file persistence
  const queueRef = useRef<SmartMessageQueue>(new SmartMessageQueue(30_000, TODOS_FILE));

  const addMessage = useCallback((message: string, isUrgent = false): boolean => {
    try {
      const msg = queueRef.current.add(message);

      if (msg) {
        // Update state
        setPendingCount(queueRef.current.getPendingCount());
        setHasUrgent(queueRef.current.hasUrgentMessages());
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error adding message to queue:', error);
      return false;
    }
  }, []);

  const getNextMessage = useCallback((): string | null => {
    try {
      const msg = queueRef.current.getNext();
      setPendingCount(queueRef.current.getPendingCount());
      setHasUrgent(queueRef.current.hasUrgentMessages());
      return msg;
    } catch (error) {
      console.error('Error getting next message:', error);
      return null;
    }
  }, []);

  const clearQueue = useCallback((): void => {
    try {
      queueRef.current.clear();
      setPendingCount(0);
      setHasUrgent(false);
    } catch (error) {
      console.error('Error clearing queue:', error);
    }
  }, []);

  const getPendingCount = useCallback((): number => {
    return queueRef.current.getPendingCount();
  }, []);

  const shouldAutoInject = useCallback((): boolean => {
    return queueRef.current.shouldAutoInject();
  }, []);

  const hasUrgentMessages = useCallback((): boolean => {
    return queueRef.current.hasUrgentMessages();
  }, []);

  const injectNext = useCallback((): string | null => {
    try {
      const msg = queueRef.current.injectNext();
      setPendingCount(queueRef.current.getPendingCount());
      setHasUrgent(queueRef.current.hasUrgentMessages());
      return msg;
    } catch (error) {
      console.error('Error injecting next message:', error);
      return null;
    }
  }, []);

  return {
    // State
    pendingCount,
    hasUrgent,
    queue: queueRef.current,

    // Actions
    addMessage,
    getNextMessage,
    clearQueue,
    getPendingCount,
    shouldAutoInject,
    hasUrgentMessages,
    injectNext
  };
}
