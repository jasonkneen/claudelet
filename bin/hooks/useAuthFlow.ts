/**
 * useAuthFlow Hook
 *
 * Extracted from claudelet-opentui.tsx (lines 804-1302)
 *
 * Responsibilities:
 * - Manage authentication state (apiKey, oauthToken)
 * - Handle OAuth flow initialization and completion
 * - Handle API key authentication
 * - Load and save authentication credentials
 * - Manage auth-related side effects
 *
 * Dependencies:
 * - useCallback, useEffect, useRef, useState from React
 * - createAuthManager from claude-agent-loop
 * - clearAuth, loadAuth, saveAuth from auth-storage
 * - startAgentSession from claude-agent-loop
 * - debugLog utility function
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createAuthManager, type AuthManager } from 'claude-agent-loop';
import { clearAuth, loadAuth, saveAuth } from '../src/auth-storage.js';
import { debugLog } from '../utils/debug.js';

export interface AuthFlowState {
  apiKey: string | null;
  oauthToken: string | null;
  authManager: ReturnType<typeof createAuthManager> | null;
  isAuthenticated: boolean;
  authError: string | null;
}

export interface AuthFlowActions {
  logout: () => Promise<void>;
  ensureAuthenticated: () => Promise<boolean>;
}

/**
 * useAuthFlow Hook
 *
 * Handles all authentication flows including:
 * - Loading existing credentials from storage
 * - OAuth flow with Anthropic Console or Claude Max
 * - API Key authentication
 * - Credential persistence
 *
 * Returns:
 * - apiKey: Current API key (null if using OAuth)
 * - oauthToken: Current OAuth token (null if using API key)
 * - authManager: AuthManager instance for token management
 * - isAuthenticated: Whether authentication is valid
 * - authError: Any authentication errors
 * - logout: Function to clear auth and reset state
 * - ensureAuthenticated: Function to prompt auth if needed
 */
export function useAuthFlow() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [oauthToken, setOAuthToken] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const authManagerRef = useRef<ReturnType<typeof createAuthManager> | null>(null);

  // Initialize auth manager (do this once at hook mount)
  useEffect(() => {
    authManagerRef.current = createAuthManager();
  }, []);

  // Load existing authentication on mount
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        debugLog('useAuthFlow: Loading existing authentication...');

        const storedAuth = await loadAuth();

        if (storedAuth) {
          if (storedAuth.type === 'api-key' && storedAuth.apiKey) {
            setApiKey(storedAuth.apiKey);
            setIsAuthenticated(true);
            debugLog('useAuthFlow: API key loaded from storage');
          } else if (storedAuth.type === 'oauth' && storedAuth.oauthTokens && authManagerRef.current) {
            // Restore OAuth tokens
            authManagerRef.current.loadAuthConfig({ oauthTokens: storedAuth.oauthTokens });

            const accessToken = await authManagerRef.current.getOAuthAccessToken();
            if (accessToken) {
              setOAuthToken(accessToken);
              setIsAuthenticated(true);
              debugLog('useAuthFlow: OAuth token loaded from storage');
            }
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        debugLog(`useAuthFlow: Failed to load existing auth: ${msg}`);
        setAuthError(msg);
      }
    };

    initializeAuth();
  }, []);

  const logout = useCallback(async () => {
    try {
      await clearAuth();
      setApiKey(null);
      setOAuthToken(null);
      setIsAuthenticated(false);
      setAuthError(null);
      debugLog('useAuthFlow: Authentication cleared');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setAuthError(msg);
      debugLog(`useAuthFlow: Logout failed: ${msg}`);
    }
  }, []);

  const ensureAuthenticated = useCallback(async (): Promise<boolean> => {
    if (isAuthenticated && (apiKey || oauthToken)) {
      return true;
    }

    try {
      // Prompt user for authentication
      const authChoice = await promptAuthMethod();

      let token: string | null = null;

      if (authChoice === '1' && authManagerRef.current) {
        // OAuth - Anthropic Console
        token = await handleOAuthFlow('console', authManagerRef.current);
        if (token) {
          setOAuthToken(token);
          if (authManagerRef.current.authConfig?.oauthTokens) {
            await saveAuth({
              type: 'oauth',
              oauthTokens: authManagerRef.current.authConfig.oauthTokens
            });
          }
        }
      } else if (authChoice === '2' && authManagerRef.current) {
        // OAuth - Claude Max
        token = await handleOAuthFlow('max', authManagerRef.current);
        if (token) {
          setOAuthToken(token);
          if (authManagerRef.current.authConfig?.oauthTokens) {
            await saveAuth({
              type: 'oauth',
              oauthTokens: authManagerRef.current.authConfig.oauthTokens
            });
          }
        }
      } else if (authChoice === '3') {
        // API Key
        token = await handleApiKeyAuth();
        if (token) {
          setApiKey(token);
          await saveAuth({ type: 'api-key', apiKey: token });
        }
      }

      if (token) {
        setIsAuthenticated(true);
        setAuthError(null);
        return true;
      } else {
        setAuthError('Authentication cancelled or failed');
        return false;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setAuthError(msg);
      return false;
    }
  }, [isAuthenticated, apiKey, oauthToken]);

  return {
    // State
    apiKey,
    oauthToken,
    authManager: authManagerRef.current,
    isAuthenticated,
    authError,

    // Actions
    logout,
    ensureAuthenticated
  };
}

/**
 * Prompt user to choose authentication method
 * @returns Selected method: '1' (OAuth Console), '2' (OAuth Max), '3' (API Key)
 */
async function promptAuthMethod(): Promise<'1' | '2' | '3'> {
  const readline = await import('readline/promises');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n🔐 Authentication Required\n');
  console.log('Choose authentication method:');
  console.log('  1) OAuth - Anthropic Console');
  console.log('  2) OAuth - Claude Max');
  console.log('  3) API Key\n');

  const choice = await rl.question('Select option (1-3): ');
  rl.close();

  const trimmed = choice.trim();
  if (trimmed === '1' || trimmed === '2' || trimmed === '3') {
    return trimmed as '1' | '2' | '3';
  }

  return await promptAuthMethod(); // Recursive retry for invalid input
}

/**
 * Handle OAuth authentication flow
 * @param mode 'console' for Anthropic Console, 'max' for Claude Max
 * @param authManager Auth manager instance
 * @returns OAuth access token or null if failed
 */
async function handleOAuthFlow(
  mode: 'console' | 'max',
  authManager: ReturnType<typeof createAuthManager>
): Promise<string | null> {
  const readline = await import('readline/promises');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log(`\n🔐 Starting OAuth flow (${mode === 'max' ? 'Claude Max' : 'Anthropic Account'})...\n`);

  try {
    // Start OAuth flow
    const { authUrl, verifier, state } = await authManager.startOAuthFlow(mode);

    console.log('Please visit this URL to authorize:\n');
    console.log(`  ${authUrl}\n`);
    console.log('After authorizing, you will be redirected to a callback URL.');
    console.log('Copy/paste the full callback URL here (or just `code`, or `code#state`).\n');

    // Get authorization code from user
    const code = await rl.question('Paste the callback URL (or code): ');
    const trimmedCode = code.trim();

    if (!trimmedCode) {
      console.error('\n❌ Error: Authorization code cannot be empty');
      rl.close();
      return null;
    }

    console.log('\n⏳ Getting OAuth access token...');

    // Complete OAuth flow to get tokens
    const result = await authManager.completeOAuthFlow(trimmedCode, verifier, state, false);

    if (result.tokens) {
      console.log('✅ OAuth authentication successful!');
      // Get the access token - it can be used like an API key
      const accessToken = await authManager.getOAuthAccessToken();
      rl.close();
      if (accessToken) {
        return accessToken;
      }
    }

    rl.close();
    return null;
  } catch (error) {
    console.error('\n❌ OAuth flow failed:', error instanceof Error ? error.message : String(error));
    rl.close();
    return null;
  }
}

/**
 * Handle API key authentication
 * @returns API key or null if cancelled
 */
async function handleApiKeyAuth(): Promise<string | null> {
  const readline = await import('readline/promises');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n🔑 API Key Authentication\n');

  // Check if ANTHROPIC_API_KEY is set
  if (process.env.ANTHROPIC_API_KEY) {
    const useEnv = await rl.question(`Found ANTHROPIC_API_KEY in environment. Use it? (Y/n): `);
    if (!useEnv.trim() || useEnv.trim().toLowerCase() === 'y') {
      rl.close();
      return process.env.ANTHROPIC_API_KEY;
    }
  }

  const apiKey = await rl.question('Enter your Anthropic API key: ');
  const trimmed = apiKey.trim();

  if (!trimmed) {
    console.error('❌ Error: API key cannot be empty');
    rl.close();
    return null;
  }

  rl.close();
  console.log('✅ API key authentication successful!');
  return trimmed;
}
