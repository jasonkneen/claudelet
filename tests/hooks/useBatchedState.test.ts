import { describe, it, expect } from 'vitest'
import { applyBatchedStateUpdate } from '../../src/hooks/useBatchedState'

describe('useBatchedState helpers', () => {
  it('applies object partial updates', () => {
    const prev = { count: 0, name: 'test' }
    const next = applyBatchedStateUpdate(prev, { count: 1 })
    expect(next).toEqual({ count: 1, name: 'test' })
    expect(next).not.toBe(prev)
  })

  it('applies functional updates', () => {
    const prev = { count: 0 }
    const next = applyBatchedStateUpdate(prev, (p) => ({ count: p.count + 1 }))
    expect(next).toEqual({ count: 1 })
  })

  it('supports multi-field updates', () => {
    const prev = { count: 0, name: 'a', active: false }
    const next = applyBatchedStateUpdate(prev, { count: 5, name: 'b', active: true })
    expect(next).toEqual({ count: 5, name: 'b', active: true })
  })

  it('does not mutate previous state', () => {
    const prev = { count: 0, items: [] as number[] }
    const next = applyBatchedStateUpdate(prev, { count: 1 })
    expect(prev).toEqual({ count: 0, items: [] })
    expect(next).toEqual({ count: 1, items: [] })
  })
})

