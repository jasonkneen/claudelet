/**
 * Token estimation utilities
 */

/**
 * Estimate token count from text
 * Uses rough approximation: ~4 characters per token
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
