import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useBatchedState } from '../../src/hooks/useBatchedState'

describe('useBatchedState', () => {
  it('should initialize with the given state', () => {
    const initialState = { count: 0, name: 'test' }
    const { result } = renderHook(() => useBatchedState(initialState))

    const [state] = result.current
    expect(state).toEqual(initialState)
  })

  it('should update partial state with object', () => {
    const initialState = { count: 0, name: 'test' }
    const { result } = renderHook(() => useBatchedState(initialState))

    act(() => {
      const [, updateState] = result.current
      updateState({ count: 1 })
    })

    const [state] = result.current
    expect(state).toEqual({ count: 1, name: 'test' })
  })

  it('should update multiple fields at once', () => {
    const initialState = { count: 0, name: 'test', active: false }
    const { result } = renderHook(() => useBatchedState(initialState))

    act(() => {
      const [, updateState] = result.current
      updateState({ count: 5, name: 'updated', active: true })
    })

    const [state] = result.current
    expect(state).toEqual({ count: 5, name: 'updated', active: true })
  })

  it('should update with function that receives previous state', () => {
    const initialState = { count: 0 }
    const { result } = renderHook(() => useBatchedState(initialState))

    act(() => {
      const [, updateState] = result.current
      updateState((prev) => ({ count: prev.count + 1 }))
    })

    const [state] = result.current
    expect(state).toEqual({ count: 1 })
  })

  it('should support chained updates', () => {
    const initialState = { count: 0, items: [] as number[] }
    const { result } = renderHook(() => useBatchedState(initialState))

    act(() => {
      const [, updateState] = result.current
      updateState({ count: 1 })
      updateState({ items: [1, 2, 3] })
    })

    const [state] = result.current
    expect(state).toEqual({ count: 1, items: [1, 2, 3] })
  })

  it('should handle nested object updates correctly', () => {
    const initialState = { data: { nested: 'value' }, count: 0 }
    const { result } = renderHook(() => useBatchedState(initialState))

    act(() => {
      const [, updateState] = result.current
      updateState({ data: { nested: 'updated' } })
    })

    const [state] = result.current
    expect(state).toEqual({ data: { nested: 'updated' }, count: 0 })
  })

  it('should merge arrays correctly', () => {
    const initialState = { messages: [] as string[] }
    const { result } = renderHook(() => useBatchedState(initialState))

    act(() => {
      const [, updateState] = result.current
      updateState((prev) => ({ messages: [...prev.messages, 'new'] }))
    })

    const [state] = result.current
    expect(state).toEqual({ messages: ['new'] })
  })

  it('should work with complex state objects', () => {
    const initialState = {
      messages: [],
      isResponding: false,
      currentModel: 'fast',
      sessionId: 'session-1',
      showThinking: false,
      thinkingContent: '',
      currentTool: undefined
    }
    const { result } = renderHook(() => useBatchedState(initialState))

    act(() => {
      const [, updateState] = result.current
      updateState({
        isResponding: true,
        showThinking: true,
        thinkingContent: 'Processing...'
      })
    })

    const [state] = result.current
    expect(state).toEqual({
      messages: [],
      isResponding: true,
      currentModel: 'fast',
      sessionId: 'session-1',
      showThinking: true,
      thinkingContent: 'Processing...',
      currentTool: undefined
    })
  })

  it('should not mutate initial state', () => {
    const initialState = { count: 0, items: [] as number[] }
    const { result } = renderHook(() => useBatchedState(initialState))

    act(() => {
      const [, updateState] = result.current
      updateState({ count: 1 })
    })

    expect(initialState).toEqual({ count: 0, items: [] })
  })

  it('updateState should be stable across renders', () => {
    const { result, rerender } = renderHook(() => useBatchedState({ count: 0 }))

    const firstUpdateFn = result.current[1]

    rerender()

    const secondUpdateFn = result.current[1]
    expect(firstUpdateFn).toBe(secondUpdateFn)
  })
})
