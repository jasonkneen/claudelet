/**
 * Environment Variable Sanitization Module
 *
 * Provides utilities to sanitize environment variables and prevent
 * sensitive data (API keys, tokens, passwords) from being logged.
 *
 * Usage:
 *   import { sanitizeEnv, sanitizedEnv } from './env-sanitizer'
 *
 *   // Option 1: Sanitize before logging
 *   console.log('Config:', sanitizeEnv(process.env))
 *
 *   // Option 2: Use proxy wrapper for all logging
 *   console.log('Config:', sanitizedEnv)
 */

type SensitivePattern = string | RegExp

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  'ANTHROPIC_API_KEY',
  'CLAUDELET_AUTH_TOKEN',
  /API_KEY/i,
  /SECRET/i,
  /TOKEN/i,
  /PASSWORD/i,
  /PRIVATE/i,
  /AUTH/i,
  /KEY/i,
  /CREDENTIAL/i
]

/**
 * Check if an environment variable key should be considered sensitive
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => {
    if (typeof pattern === 'string') {
      return key === pattern
    }
    return pattern.test(key)
  })
}

/**
 * Sanitize environment variables by redacting sensitive keys
 *
 * @param env - Environment object to sanitize (default: process.env)
 * @returns New object with sensitive values redacted
 *
 * @example
 * console.log('Environment:', sanitizeEnv(process.env))
 * // Output: { ANTHROPIC_API_KEY: '[REDACTED]', NODE_ENV: 'production', ... }
 */
export function sanitizeEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const sanitized: Record<string, string> = {}

  for (const [key, value] of Object.entries(env)) {
    if (isSensitiveKey(key)) {
      sanitized[key] = '[REDACTED]'
    } else {
      sanitized[key] = value || ''
    }
  }

  return sanitized
}

/**
 * Create a Proxy wrapper around process.env that prevents sensitive
 * variables from being enumerated or serialized
 *
 * This allows using the proxy object with JSON.stringify and for...in loops
 * without exposing sensitive values.
 *
 * @example
 * console.log('Config:', sanitizedEnv)  // Sensitive keys won't appear
 * JSON.stringify(sanitizedEnv)           // Sensitive values won't be serialized
 */
export const sanitizedEnv = new Proxy(process.env, {
  /**
   * Allow reading the actual value (for internal code that needs the secret)
   */
  get(target, prop) {
    return target[prop as string]
  },

  /**
   * Hide sensitive keys from enumeration (for...in, Object.keys, etc.)
   */
  ownKeys(target) {
    return Object.keys(target).filter(key => !isSensitiveKey(key))
  },

  /**
   * Don't report property descriptors for sensitive keys
   * This prevents them from being enumerated or serialized
   */
  getOwnPropertyDescriptor(target, prop) {
    if (isSensitiveKey(String(prop))) {
      return undefined
    }
    return Object.getOwnPropertyDescriptor(target, prop)
  }
})

/**
 * Sanitize an error message or any string that might contain sensitive data
 *
 * @param text - Text to sanitize
 * @returns Text with potential secrets redacted
 *
 * @example
 * sanitizeText('Failed with API key abc123def456')
 * // Output: 'Failed with API key [REDACTED]'
 */
export function sanitizeText(text: string): string {
  if (!text || typeof text !== 'string') {
    return String(text)
  }

  // Redact common patterns for API keys, tokens, etc.
  return text
    // API key pattern (sk-... or similar)
    .replace(/\bsk-[a-zA-Z0-9_-]+/gi, '[REDACTED]')
    // Bearer tokens
    .replace(/Bearer\s+[a-zA-Z0-9_-]+/gi, 'Bearer [REDACTED]')
    // Generic key=value patterns with sensitive keys
    .replace(/(ANTHROPIC_API_KEY|AUTH_TOKEN|API_KEY|SECRET|PASSWORD|PRIVATE_KEY)\s*=\s*[^\s,]+/gi, '$1=[REDACTED]')
}

/**
 * Wrap console methods to automatically sanitize output
 *
 * Use this to ensure all console output is sanitized
 *
 * @example
 * installConsoleSanitization()
 * console.log(process.env) // Won't expose secrets
 */
export function installConsoleSanitization(): void {
  const originalLog = console.log
  const originalError = console.error
  const originalWarn = console.warn
  const originalDebug = console.debug

  const sanitizeArgs = (args: unknown[]): unknown[] => {
    return args.map(arg => {
      if (arg === process.env) {
        return sanitizeEnv(process.env)
      }
      if (typeof arg === 'object' && arg !== null) {
        try {
          const str = JSON.stringify(arg)
          if (str.includes('ANTHROPIC_API_KEY') || str.includes('AUTH_TOKEN')) {
            return JSON.parse(sanitizeText(str))
          }
        } catch {
          // Ignore JSON parse errors
        }
      }
      if (typeof arg === 'string') {
        return sanitizeText(arg)
      }
      return arg
    })
  }

  console.log = (...args) => originalLog(...sanitizeArgs(args))
  console.error = (...args) => originalError(...sanitizeArgs(args))
  console.warn = (...args) => originalWarn(...sanitizeArgs(args))
  console.debug = (...args) => originalDebug(...sanitizeArgs(args))
}

/**
 * Create a sanitizing logger function that can be used for debug logging
 *
 * @param name - Name/prefix for debug messages
 * @returns Function to log sanitized messages
 *
 * @example
 * const debugLog = createSanitizingLogger('MyComponent')
 * debugLog('Failed to connect:', error)  // Any secrets will be redacted
 */
export function createSanitizingLogger(name: string): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    const timestamp = new Date().toISOString()
    const sanitizedArgs = args.map(arg => {
      if (typeof arg === 'string') {
        return sanitizeText(arg)
      }
      if (arg instanceof Error) {
        return sanitizeText(arg.message)
      }
      if (typeof arg === 'object' && arg !== null) {
        try {
          const str = JSON.stringify(arg)
          return sanitizeText(str)
        } catch {
          return String(arg)
        }
      }
      return arg
    })
    console.debug(`[${timestamp}] [${name}]`, ...sanitizedArgs)
  }
}
