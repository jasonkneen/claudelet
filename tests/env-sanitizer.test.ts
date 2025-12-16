/**
 * Tests for environment variable sanitization
 *
 * Verifies that sensitive data is properly redacted from logs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isSensitiveKey,
  sanitizeEnv,
  sanitizeText,
  sanitizedEnv,
  createSanitizingLogger
} from '../src/env-sanitizer';

describe('env-sanitizer', () => {
  describe('isSensitiveKey', () => {
    it('detects explicit sensitive keys', () => {
      expect(isSensitiveKey('ANTHROPIC_API_KEY')).toBe(true);
      expect(isSensitiveKey('CLAUDELET_AUTH_TOKEN')).toBe(true);
    });

    it('detects sensitive keys by pattern', () => {
      expect(isSensitiveKey('MY_API_KEY')).toBe(true);
      expect(isSensitiveKey('DATABASE_SECRET')).toBe(true);
      expect(isSensitiveKey('GITHUB_TOKEN')).toBe(true);
      expect(isSensitiveKey('DB_PASSWORD')).toBe(true);
      expect(isSensitiveKey('PRIVATE_KEY')).toBe(true);
      expect(isSensitiveKey('SECRET_SAUCE')).toBe(true);
      expect(isSensitiveKey('AUTH_BEARER')).toBe(true);
    });

    it('detects keys with variable case patterns', () => {
      expect(isSensitiveKey('api_key')).toBe(true);
      expect(isSensitiveKey('API_KEY')).toBe(true);
      expect(isSensitiveKey('Api_Key')).toBe(true);
      expect(isSensitiveKey('secret')).toBe(true);
      expect(isSensitiveKey('SECRET')).toBe(true);
    });

    it('does not flag public configuration', () => {
      expect(isSensitiveKey('NODE_ENV')).toBe(false);
      expect(isSensitiveKey('PORT')).toBe(false);
      expect(isSensitiveKey('DEBUG')).toBe(false);
      expect(isSensitiveKey('LOG_LEVEL')).toBe(false);
    });
  });

  describe('sanitizeEnv', () => {
    it('redacts sensitive environment variables', () => {
      const env = {
        NODE_ENV: 'production',
        ANTHROPIC_API_KEY: 'sk-ant-super-secret-key',
        CLAUDELET_AUTH_TOKEN: 'bearer-token-12345',
        PORT: '3000'
      };

      const sanitized = sanitizeEnv(env);

      expect(sanitized.NODE_ENV).toBe('production');
      expect(sanitized.PORT).toBe('3000');
      expect(sanitized.ANTHROPIC_API_KEY).toBe('[REDACTED]');
      expect(sanitized.CLAUDELET_AUTH_TOKEN).toBe('[REDACTED]');
    });

    it('handles empty environment variables', () => {
      const env = {
        EMPTY_VAR: '',
        SENSITIVE_VAR: ''
      };

      const sanitized = sanitizeEnv(env);

      expect(sanitized.EMPTY_VAR).toBe('');
      expect(sanitized.SENSITIVE_VAR).toBe('[REDACTED]');
    });

    it('handles undefined environment variables', () => {
      const env = {
        UNDEFINED_VAR: undefined,
        ANOTHER_UNDEFINED: undefined
      };

      const sanitized = sanitizeEnv(env);

      expect(sanitized.UNDEFINED_VAR).toBe('');
      expect(sanitized.ANOTHER_UNDEFINED).toBe('');
    });
  });

  describe('sanitizeText', () => {
    it('redacts API keys', () => {
      const text = 'Failed to authenticate with API key sk-ant-abcd1234efgh5678';
      const sanitized = sanitizeText(text);
      expect(sanitized).toContain('[REDACTED]');
      expect(sanitized).not.toContain('sk-ant-abcd1234efgh5678');
    });

    it('redacts Bearer tokens', () => {
      const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const sanitized = sanitizeText(text);
      expect(sanitized).toContain('Bearer [REDACTED]');
      expect(sanitized).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    });

    it('redacts JSON access tokens', () => {
      const json = '{"access_token": "secret-token-12345", "expires_in": 3600}';
      const sanitized = sanitizeText(json);
      expect(sanitized).toContain('[REDACTED]');
      expect(sanitized).not.toContain('secret-token-12345');
    });

    it('redacts JSON refresh tokens', () => {
      const json = '{"refresh_token": "refresh-secret-xyz", "access_token": "access-secret"}';
      const sanitized = sanitizeText(json);
      expect(sanitized).not.toContain('refresh-secret-xyz');
      expect(sanitized).not.toContain('access-secret');
    });

    it('redacts generic key=value patterns', () => {
      const text = 'ERROR: ANTHROPIC_API_KEY=sk-ant-12345, DATABASE_SECRET=mysql://pass@host';
      const sanitized = sanitizeText(text);
      expect(sanitized).not.toContain('sk-ant-12345');
      expect(sanitized).toContain('ANTHROPIC_API_KEY=[REDACTED]');
      expect(sanitized).toContain('DATABASE_SECRET=[REDACTED]');
    });

    it('leaves public information intact', () => {
      const text = 'Server running on port 3000 with node_env=production';
      const sanitized = sanitizeText(text);
      expect(sanitized).toBe(text); // Nothing should change
    });

    it('handles non-string input', () => {
      expect(sanitizeText(null as any)).toBe('null');
      expect(sanitizeText(undefined as any)).toBe('undefined');
      expect(sanitizeText(123 as any)).toBe('123');
    });
  });

  describe('sanitizedEnv proxy', () => {
    it('allows reading actual values when accessed directly', () => {
      process.env.TEST_VARIABLE = 'test-value';
      expect(sanitizedEnv.TEST_VARIABLE).toBe('test-value');
      delete process.env.TEST_VARIABLE;
    });

    it('hides sensitive keys from enumeration', () => {
      process.env.ANTHROPIC_API_KEY = 'secret-key';
      process.env.NODE_ENV = 'test';

      const keys = Object.keys(sanitizedEnv);

      expect(keys).toContain('NODE_ENV');
      expect(keys).not.toContain('ANTHROPIC_API_KEY');

      delete process.env.ANTHROPIC_API_KEY;
    });

    it('hides sensitive keys from JSON.stringify', () => {
      process.env.MY_API_KEY = 'secret-key';
      process.env.DEBUG = 'true';

      const stringified = JSON.stringify(sanitizedEnv);

      expect(stringified).toContain('DEBUG');
      expect(stringified).not.toContain('MY_API_KEY');
      expect(stringified).not.toContain('secret-key');

      delete process.env.MY_API_KEY;
    });
  });

  describe('createSanitizingLogger', () => {
    beforeEach(() => {
      vi.spyOn(console, 'debug').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('creates a logger that sanitizes output', () => {
      const logger = createSanitizingLogger('TestModule');

      logger('Processing with token: secret-token-abc123');

      expect(console.debug).toHaveBeenCalled();
      const call = (console.debug as any).mock.calls[0];
      const output = call.join(' ');

      expect(output).toContain('[TestModule]');
      expect(output).not.toContain('secret-token-abc123');
    });

    it('includes timestamp and module name', () => {
      const logger = createSanitizingLogger('MyApp');

      logger('test message');

      expect(console.debug).toHaveBeenCalled();
      const call = (console.debug as any).mock.calls[0];
      const output = call.join(' ');

      expect(output).toMatch(/\[[\d\-:T.Z]+\]/); // ISO timestamp
      expect(output).toContain('[MyApp]');
    });

    it('handles Error objects', () => {
      const logger = createSanitizingLogger('ErrorHandler');
      const error = new Error('Failed with token sk-ant-secret123');

      logger(error);

      expect(console.debug).toHaveBeenCalled();
      const call = (console.debug as any).mock.calls[0];
      const output = call.join(' ');

      expect(output).not.toContain('sk-ant-secret123');
    });

    it('handles object input', () => {
      const logger = createSanitizingLogger('ObjLogger');
      const obj = {
        status: 'error',
        token: 'Bearer secret-token-xyz'
      };

      logger(obj);

      expect(console.debug).toHaveBeenCalled();
      const call = (console.debug as any).mock.calls[0];
      const output = call.join(' ');

      expect(output).not.toContain('secret-token-xyz');
    });
  });

  describe('integration tests', () => {
    it('prevents secrets from appearing in logs via multiple paths', () => {
      const apiKey = 'sk-ant-very-secret-key-12345';
      const token = 'oauth-token-secret-xyz';

      const env = {
        ANTHROPIC_API_KEY: apiKey,
        BEARER_TOKEN: token,
        NODE_ENV: 'production'
      };

      // All these methods should redact the secrets
      const sanitized = sanitizeEnv(env);
      expect(sanitized.ANTHROPIC_API_KEY).not.toBe(apiKey);

      const text = `Error with ${apiKey} and ${token}`;
      const sanitizedText = sanitizeText(text);
      expect(sanitizedText).not.toContain(apiKey);

      // Even if accidentally logged with a format string
      const errorMsg = `Bearer ${token}`;
      const sanitizedMsg = sanitizeText(errorMsg);
      expect(sanitizedMsg).not.toContain(token);
    });
  });
});
