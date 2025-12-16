/**
 * Basic Chat Example with Authentication
 *
 * This example shows how to use the claude-agent-loop package
 * with flexible authentication options (API key or OAuth).
 *
 * Run with:
 *   bun run examples/basic-chat.ts
 */

import * as readline from 'readline/promises';

import { createAuthManager, startAgentSession, type AgentSessionHandle } from '../src';

import { clearAuth, loadAuth, saveAuth } from './auth-storage';

const MAX_THINKING_TOKENS = 16_000;

/**
 * Display authentication menu and get user choice
 */
async function promptAuthMethod(rl: readline.Interface): Promise<'1' | '2' | '3'> {
  console.log('\n🤖 Claude Agent Chat');
  console.log('\nHow would you like to authenticate?\n');
  console.log('  1. Anthropic Account (OAuth)');
  console.log('  2. Claude Max Subscription (OAuth - Recommended)');
  console.log('  3. API Key (Direct)\n');

  const choice = await rl.question('Select authentication method (1/2/3): ');
  const trimmed = choice.trim();

  if (trimmed === '1' || trimmed === '2' || trimmed === '3') {
    return trimmed;
  }

  console.log('Invalid choice. Please select 1, 2, or 3.\n');
  return promptAuthMethod(rl);
}

/**
 * Handle OAuth authentication flow
 */
async function handleOAuthFlow(
  rl: readline.Interface,
  mode: 'console' | 'max',
  authManager: ReturnType<typeof createAuthManager>
): Promise<string | null> {

  console.log(`\n🔐 Starting OAuth flow (${mode === 'max' ? 'Claude Max' : 'Anthropic Account'})...\n`);

  try {
    // Start OAuth flow
    const { authUrl, verifier } = await authManager.startOAuthFlow(mode);

    console.log('Please visit this URL to authorize:\n');
    console.log(`  ${authUrl}\n`);
    console.log('After authorizing, you will see an authorization code.');
    console.log('Copy and paste the authorization code here.\n');

    // Get authorization code from user
    const code = await rl.question('Paste the authorization code: ');
    const trimmedCode = code.trim();

    if (!trimmedCode) {
      console.error('\n❌ Error: Authorization code cannot be empty');
      return null;
    }

    console.log('\n⏳ Getting OAuth access token...');

    // Complete OAuth flow to get tokens
    const result = await authManager.completeOAuthFlow(trimmedCode, verifier, false);

    if (result.tokens) {
      console.log('✅ OAuth authentication successful!');
      // Get the access token - it can be used like an API key
      const accessToken = await authManager.getOAuthAccessToken();
      if (accessToken) {
        return accessToken;
      }
    }

    return null;
  } catch (error) {
    console.error('\n❌ OAuth flow failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Handle API key authentication
 */
async function handleApiKeyAuth(rl: readline.Interface): Promise<string | null> {
  console.log('\n🔑 API Key Authentication\n');

  // Check if ANTHROPIC_API_KEY is set
  if (process.env.ANTHROPIC_API_KEY) {
    const useEnv = await rl.question(
      `Found ANTHROPIC_API_KEY in environment. Use it? (Y/n): `
    );
    if (!useEnv.trim() || useEnv.trim().toLowerCase() === 'y') {
      return process.env.ANTHROPIC_API_KEY;
    }
  }

  const apiKey = await rl.question('Enter your Anthropic API key: ');
  const trimmed = apiKey.trim();

  if (!trimmed) {
    console.error('\n❌ API key cannot be empty');
    return null;
  }

  if (!trimmed.startsWith('sk-ant-')) {
    console.warn('\n⚠️  Warning: API key should start with "sk-ant-"');
    const proceed = await rl.question('Continue anyway? (y/N): ');
    if (proceed.trim().toLowerCase() !== 'y') {
      return null;
    }
  }

  return trimmed;
}

/**
 * Main function
 */
async function main(): Promise<void> {
  let apiKey: string | null = null;
  let oauthToken: string | null = null;
  const authManager = createAuthManager();

  // Try to load existing auth
  const storedAuth = loadAuth();

  if (storedAuth) {
    if (storedAuth.type === 'api-key' && storedAuth.apiKey) {
      console.log('\n✅ Using saved API key');
      apiKey = storedAuth.apiKey;
    } else if (storedAuth.type === 'oauth' && storedAuth.oauthTokens) {
      console.log('\n✅ Using saved OAuth tokens');
      authManager.loadAuthConfig({ oauthTokens: storedAuth.oauthTokens });
      const accessToken = await authManager.getOAuthAccessToken();
      if (accessToken) {
        oauthToken = accessToken;
        // Save refreshed tokens if they changed
        const newConfig = authManager.getAuthConfig();
        if (newConfig.oauthTokens) {
          saveAuth({ type: 'oauth', oauthTokens: newConfig.oauthTokens });
        }
      } else {
        console.log('⚠️  Saved tokens expired, need to re-authenticate');
        clearAuth();
      }
    }
  }

  // If no valid stored auth, prompt for authentication
  if (!apiKey && !oauthToken) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const authMethod = await promptAuthMethod(rl);

    if (authMethod === '1') {
      // Anthropic Account (OAuth - console mode)
      const token = await handleOAuthFlow(rl, 'console', authManager);
      if (token) {
        oauthToken = token;
        const config = authManager.getAuthConfig();
        if (config.oauthTokens) {
          saveAuth({ type: 'oauth', oauthTokens: config.oauthTokens });
        }
      }
    } else if (authMethod === '2') {
      // Claude Max Subscription (OAuth - max mode)
      const token = await handleOAuthFlow(rl, 'max', authManager);
      if (token) {
        oauthToken = token;
        const config = authManager.getAuthConfig();
        if (config.oauthTokens) {
          saveAuth({ type: 'oauth', oauthTokens: config.oauthTokens });
        }
      }
    } else {
      // API Key (direct)
      apiKey = await handleApiKeyAuth(rl);
      if (apiKey) {
        saveAuth({ type: 'api-key', apiKey });
      }
    }

    rl.close();

    if (!apiKey && !oauthToken) {
      console.error('\n❌ Authentication failed. Exiting.');
      process.exit(1);
    }
  }

  console.log('\n✅ Authentication successful!');
  console.log('\nStarting Claude Agent Session...\n');
  console.log('Commands:');
  console.log('  /quit           - Exit the chat');
  console.log('  /stop           - Interrupt current response');
  console.log('  /model <name>   - Switch model (fast/haiku/sonnet/opus)');
  console.log('  /logout         - Clear saved authentication');
  console.log();

  let session: AgentSessionHandle | null = null;
  let isResponding = false;

  // Start the agent session immediately
  try {
    session = await startAgentSession(
      {
        ...(oauthToken ? { oauthToken } : { apiKey: apiKey! }),
        workingDirectory: process.cwd(),
        modelPreference: 'smart-sonnet',
        maxThinkingTokens: MAX_THINKING_TOKENS
      },
      {
        // Handle streaming text
        onTextChunk: (text) => {
          process.stdout.write(text);
        },

        // Handle thinking blocks
        onThinkingStart: () => {
          console.log('\n[Thinking...]');
        },
        onThinkingChunk: (_data) => {
          // Optionally show thinking content
          // process.stdout.write(_data.delta);
        },

        // Handle tool usage
        onToolUseStart: (tool) => {
          console.log(`\n[Using tool: ${tool.name}]`);
        },
        onToolResultComplete: (result) => {
          if (result.isError) {
            const preview =
              result.content.length > 100 ? `${result.content.slice(0, 100)}...` : result.content;
            console.log(`\n[Tool error: ${preview}]`);
          }
        },

        // Handle session events
        onSessionInit: (data) => {
          console.log(`[Session ID: ${data.sessionId}${data.resumed ? ' (resumed)' : ''}]\n`);
        },
        onMessageComplete: () => {
          isResponding = false;
          console.log('\n');
        },
        onMessageStopped: () => {
          isResponding = false;
          console.log('\n[Response stopped]\n');
        },
        onError: (error) => {
          isResponding = false;
          console.error(`\n[Error: ${error}]\n`);
        }
      }
    );
  } catch (error) {
    console.error('Failed to start session:', error);
    process.exit(1);
  }

  // Create readline interface for user input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // Graceful shutdown handler
  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down...');
    await session?.stop();
    rl.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const prompt = async (): Promise<void> => {
    const input = await rl.question('You: ');
    const trimmed = input.trim();

    if (!trimmed) {
      await prompt();
      return;
    }

    // Handle commands
    if (trimmed === '/quit' || trimmed === '/exit') {
      console.log('Goodbye!');
      await shutdown();
      return;
    }

    if (trimmed === '/logout') {
      clearAuth();
      console.log('\n✅ Authentication cleared. Restart to login again.\n');
      await shutdown();
      return;
    }

    if (trimmed === '/stop') {
      if (isResponding) {
        await session?.interrupt();
      } else {
        console.log('[No response in progress]\n');
      }
      await prompt();
      return;
    }

    if (trimmed.startsWith('/model ')) {
      const modelArg = trimmed.slice(7).trim();
      const modelMap: Record<string, 'fast' | 'smart-sonnet' | 'smart-opus'> = {
        fast: 'fast',
        haiku: 'fast',
        sonnet: 'smart-sonnet',
        opus: 'smart-opus'
      };
      const model = modelMap[modelArg.toLowerCase()];
      if (model) {
        try {
          await session?.setModel(model);
          console.log(`[Switched to ${model}]\n`);
        } catch (e) {
          console.error(`[Failed to switch model: ${e}]\n`);
        }
      } else {
        console.log('[Unknown model. Use: fast, haiku, sonnet, or opus]\n');
      }
      await prompt();
      return;
    }

    // Send the message
    try {
      isResponding = true;
      console.log('\nClaude: ');
      await session?.sendMessage({ role: 'user', content: trimmed });
    } catch (error) {
      console.error(`Error sending message: ${error}`);
      isResponding = false;
    }

    // Wait for response to complete
    while (isResponding) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }

    // Continue prompting
    await prompt();
  };

  await prompt();
}

main();
