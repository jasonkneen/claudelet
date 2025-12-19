/**
 * Test Fixtures
 *
 * Shared test data for unit tests
 */

import type { StoredAuth } from '../../src/auth-storage'
import type { SessionData, StoredMessage } from '../../src/session-storage'
import type { Message } from '../../src/message-pagination'

/**
 * Sample OAuth tokens for testing
 */
export const sampleOAuthTokens = {
  access_token: 'test-access-token-12345',
  refresh_token: 'test-refresh-token-67890',
  token_type: 'Bearer',
  expires_in: 3600,
  scope: 'read write'
}

/**
 * Sample auth storage data
 */
export const sampleApiKeyAuth: StoredAuth = {
  type: 'api-key',
  apiKey: 'sk-ant-test-key-12345'
}

export const sampleOAuthAuth: StoredAuth = {
  type: 'oauth',
  oauthTokens: sampleOAuthTokens
}

/**
 * Sample session message
 */
export function createStoredMessage(overrides?: Partial<StoredMessage>): StoredMessage {
  return {
    role: 'user',
    content: 'Hello, Claude!',
    timestamp: new Date().toISOString(),
    ...overrides
  }
}

/**
 * Sample session data
 */
export function createSessionData(overrides?: Partial<SessionData>): SessionData {
  const now = new Date().toISOString()
  return {
    sessionId: 'test-session-' + Math.random().toString(36).slice(2, 10),
    createdAt: now,
    updatedAt: now,
    model: 'claude-sonnet-4-20250514',
    workingDirectory: '/test/project',
    messages: [],
    inputTokens: 0,
    outputTokens: 0,
    status: 'active',
    ...overrides
  }
}

/**
 * Sample message for pagination tests
 */
export function createMessage(overrides?: Partial<Message>): Message {
  return {
    role: 'user',
    content: 'Test message content',
    timestamp: new Date(),
    ...overrides
  }
}

/**
 * Create multiple messages for pagination tests
 */
export function createMessages(count: number, rolePattern: ('user' | 'assistant')[] = ['user', 'assistant']): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    role: rolePattern[i % rolePattern.length],
    content: `Message ${i + 1}: ${'x'.repeat(20 + (i % 50))}`,
    timestamp: new Date(Date.now() - (count - i) * 1000)
  }))
}

/**
 * Sample environment variables for testing
 */
export const sampleEnvVars: Record<string, string> = {
  NODE_ENV: 'test',
  PATH: '/usr/bin',
  HOME: '/home/test',
  ANTHROPIC_API_KEY: 'sk-ant-secret-key',
  AUTH_TOKEN: 'secret-token-12345',
  DATABASE_URL: 'postgres://localhost/test',
  SAFE_VAR: 'safe-value'
}

/**
 * Sample sensitive text patterns for testing
 */
export const sensitiveTextSamples = {
  apiKey: 'Error with API key sk-ant-abc123def456',
  bearer: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.token',
  jsonToken: '{"access_token":"secret-token-value","type":"bearer"}',
  envVar: 'ANTHROPIC_API_KEY=sk-ant-secret-key'
}
