export interface ParsedOAuthCallbackInput {
  code: string
  state?: string
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length < 2) return trimmed

  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  const isQuotePair =
    (first === '"' && last === '"') ||
    (first === "'" && last === "'") ||
    (first === '`' && last === '`')

  return isQuotePair ? trimmed.slice(1, -1).trim() : trimmed
}

function parseParams(paramString: string): ParsedOAuthCallbackInput {
  const normalized = paramString.replace(/^[?#]/, '')
  const params = new URLSearchParams(normalized)
  const code = params.get('code')?.trim()
  const state = params.get('state')?.trim() || undefined

  if (!code) {
    throw new Error('No authorization code found in input')
  }

  return { code, state }
}

/**
 * Accepts either:
 * - raw authorization code (e.g. "abc123...")
 * - full callback URL (e.g. "https://.../callback?code=...&state=...")
 * - query string / fragment (e.g. "code=...&state=..." or "?code=...&state=...")
 */
export function parseOAuthCallbackInput(input: string): ParsedOAuthCallbackInput {
  const trimmed = stripWrappingQuotes(input)
  if (!trimmed) {
    throw new Error('Authorization code cannot be empty')
  }

  // If the user pasted extra text, try to recover the URL-ish portion.
  const urlMatch = trimmed.match(/https?:\/\/\S+/i)
  const candidate = urlMatch?.[0] ?? trimmed

  if (/^https?:\/\//i.test(candidate)) {
    try {
      const url = new URL(candidate)

      // Standard: query params
      if (url.searchParams.has('code')) {
        const code = url.searchParams.get('code')?.trim()
        const state = url.searchParams.get('state')?.trim() || undefined
        if (!code) throw new Error('No authorization code found in URL')
        return { code, state }
      }

      // Some providers might use fragments
      if (url.hash && /code=/.test(url.hash)) {
        return parseParams(url.hash)
      }
    } catch {
      // Fall through to heuristic parsing.
    }
  }

  if (candidate.includes('?')) {
    return parseParams(candidate.slice(candidate.indexOf('?') + 1))
  }

  if (candidate.includes('#') && /code=/.test(candidate)) {
    return parseParams(candidate.slice(candidate.indexOf('#') + 1))
  }

  // Handle provider format: "<code>#<state>"
  // (Anthropic Console/Claude may append the state after a # fragment.)
  if (candidate.includes('#') && !/code=/.test(candidate)) {
    const [codePart, statePart] = candidate.split('#', 2).map((s) => s.trim())
    if (codePart && statePart) return { code: codePart, state: statePart }
    if (codePart) return { code: codePart }
  }

  if (/code=/.test(candidate)) {
    return parseParams(candidate)
  }

  // Fallback: treat as a raw authorization code.
  return { code: candidate.trim() }
}
