import { describe, it, expect } from 'vitest'

import { parseOAuthCallbackInput } from './oauth-callback'

describe('parseOAuthCallbackInput', () => {
  it('parses a raw code', () => {
    expect(parseOAuthCallbackInput('abcDEF_0123-xyz')).toEqual({ code: 'abcDEF_0123-xyz' })
  })

  it('parses a full callback URL with query params', () => {
    const parsed = parseOAuthCallbackInput(
      'https://console.anthropic.com/oauth/code/callback?code=abcDEF_0123-xyz&state=state123'
    )
    expect(parsed).toEqual({ code: 'abcDEF_0123-xyz', state: 'state123' })
  })

  it('parses a query string', () => {
    const parsed = parseOAuthCallbackInput('code=abcDEF_0123-xyz&state=state123')
    expect(parsed).toEqual({ code: 'abcDEF_0123-xyz', state: 'state123' })
  })

  it('parses a hash fragment', () => {
    const parsed = parseOAuthCallbackInput('#code=abcDEF_0123-xyz&state=state123')
    expect(parsed).toEqual({ code: 'abcDEF_0123-xyz', state: 'state123' })
  })

  it('parses code#state shorthand', () => {
    const parsed = parseOAuthCallbackInput('abcDEF_0123-xyz#state123')
    expect(parsed).toEqual({ code: 'abcDEF_0123-xyz', state: 'state123' })
  })

  it('throws when no code is present', () => {
    expect(() => parseOAuthCallbackInput('https://console.anthropic.com/oauth/code/callback?state=x'))
      .toThrow('No authorization code found')
  })
})
