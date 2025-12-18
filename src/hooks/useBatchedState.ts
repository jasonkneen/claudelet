import { useCallback, useState } from 'react'

export type BatchedStateUpdate<T extends object> = Partial<T> | ((prev: T) => Partial<T>)

export function applyBatchedStateUpdate<T extends object>(prev: T, updates: BatchedStateUpdate<T>): T {
  return {
    ...prev,
    ...(typeof updates === 'function' ? updates(prev) : updates)
  }
}

/**
 * Custom hook for managing state with batched partial updates.
 *
 * Replaces the repetitive pattern:
 *   setState(prev => ({ ...prev, field: newValue }))
 *
 * With a simpler API:
 *   updateState({ field: newValue })
 *
 * @template T - The state type (must be an object)
 * @param initialState - Initial state value
 * @returns [state, updateState] - State and update function
 *
 * @example
 * const [messages, updateMessages] = useBatchedState({ items: [], count: 0 });
 * updateMessages({ count: newCount });
 * updateMessages(prev => ({ count: prev.count + 1 }));
 */
export function useBatchedState<T extends object>(initialState: T) {
  const [state, setState] = useState<T>(initialState)

  const updateState = useCallback(
    (updates: BatchedStateUpdate<T>) => {
      setState((prev) => applyBatchedStateUpdate(prev, updates))
    },
    []
  )

  return [state, updateState] as const
}
