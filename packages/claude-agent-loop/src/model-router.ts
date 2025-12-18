/**
 * Model Router - Simple model selection for claudelet
 *
 * Routes tasks to appropriate models based on task complexity:
 * - Opus: Planning, architecture, security reviews
 * - Haiku: Quick searches, reads, simple tasks
 * - Sonnet: Everything else (safe default)
 */

export type ModelChoice = 'haiku' | 'sonnet' | 'opus'

/**
 * Model ID mapping to actual Claude model identifiers
 */
export const MODEL_IDS: Record<ModelChoice, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-5-20250929',
  opus: 'claude-opus-4-5-20251101'
}

/**
 * Human-readable model display names
 */
export const MODEL_DISPLAY: Record<ModelChoice, string> = {
  haiku: 'Haiku 4.5',
  sonnet: 'Sonnet 4.5',
  opus: 'Opus 4.5'
}

/**
 * Pick the appropriate model based on task content.
 * Simple pattern matching - no complexity scoring.
 */
export function pickModel(task: string): ModelChoice {
  // Opus for planning/architecture/critical work
  if (/plan|architect|design|critical|complex|security review|refactor/i.test(task)) {
    return 'opus'
  }

  // Haiku for quick tasks
  if (/search|read|list|quick|simple|typo|fetch|find|grep|check/i.test(task)) {
    return 'haiku'
  }

  // Sonnet for everything else (safe default)
  return 'sonnet'
}

/**
 * Parse user model override from input.
 * Supports @opus, @sonnet, @haiku prefix syntax.
 *
 * @example
 * parseModelOverride('@opus review this code')
 * // { model: 'opus', task: 'review this code' }
 *
 * parseModelOverride('just a normal message')
 * // { task: 'just a normal message' }
 */
export function parseModelOverride(input: string): { model?: ModelChoice; task: string } {
  const prefixMatch = input.match(/^@(opus|sonnet|haiku)\s+(.+)/i)
  if (prefixMatch) {
    return {
      model: prefixMatch[1].toLowerCase() as ModelChoice,
      task: prefixMatch[2]
    }
  }
  return { task: input }
}

/**
 * Get model choice from ModelPreference type used in agent-session.
 */
export function modelChoiceFromPreference(preference: string): ModelChoice {
  if (preference === 'fast') return 'haiku'
  if (preference === 'smart-sonnet') return 'sonnet'
  if (preference === 'smart-opus') return 'opus'
  return 'sonnet' // default
}

/**
 * Get display name from ModelPreference type used in agent-session.
 */
export function getModelDisplayFromPreference(preference: string): string {
  if (preference === 'auto') return 'Auto'
  const choice = modelChoiceFromPreference(preference)
  return MODEL_DISPLAY[choice]
}
