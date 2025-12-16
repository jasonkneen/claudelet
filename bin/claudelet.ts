#!/usr/bin/env bun

/**
 * Claudelet - Interactive CLI Chat with Claude Agent
 *
 * Features:
 * - @ file references: @src/main.ts embeds file content with autocomplete
 * - Smart message queue: Type while Claude responds, messages queue intelligently
 * - Expanded / commands: /help, /clear, /save, /load, /debug, /quit, /stop, /model, /logout
 * - Priority-based injection: Urgent messages inject immediately, normal every 30s
 * - Todo logging: TODO: messages logged to .todos.md without interrupting
 *
 * Run with:
 *   bun run claudelet
 *   claudelet (if installed globally)
 *
 * With debug logging:
 *   DEBUG=1 bun run claudelet
 */

import * as readline from 'readline/promises';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

import {
  createAuthManager,
  startAgentSession,
  SmartMessageQueue,
  type AgentSessionHandle
} from 'claude-agent-loop';

import { clearAuth, loadAuth, saveAuth } from '../src/auth-storage';
import { sanitizeText } from '../src/env-sanitizer';

const MAX_THINKING_TOKENS = 16_000;
const MAX_FILE_SIZE = 500_000; // 500KB
const TODOS_FILE = '.todos.md';

// Session history for /save and /load
interface ConversationHistory {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  timestamp: string;
  model: string;
}

let conversationHistory: Array<{ role: string; content: string }> = [];
let debugMode = process.env.DEBUG === '1' || process.env.DEBUG === 'true';
const debugLogFile = 'debug.log';

/**
 * Log debug message to file and stdout (non-blocking)
 * Automatically sanitizes sensitive data to prevent leaking secrets
 */
function logDebug(message: string): void {
  if (!debugMode) return;
  // Sanitize before logging to prevent leaking secrets
  const sanitized = sanitizeText(message);
  console.error(sanitized);
  // Fire-and-forget: don't block on file write
  fsp.appendFile(debugLogFile, `${new Date().toISOString()} ${sanitized}\n`).catch(() => {
    // Ignore write errors
  });
}

// Create smart message queue instance
const messageQueue = new SmartMessageQueue(30_000, TODOS_FILE);

/**
 * Display authentication menu and get user choice
 */
async function promptAuthMethod(rl: readline.Interface): Promise<'1' | '2' | '3'> {
  console.log('\n🤖 Claude Agent Chat (Enhanced)');
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
    const { authUrl, verifier, state } = await authManager.startOAuthFlow(mode);

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
    const result = await authManager.completeOAuthFlow(trimmedCode, verifier, state, false);

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
 * Show help message
 */
function showHelp(): void {
  console.log('\n📚 Commands:\n');
  console.log('  /help           - Show this help message');
  console.log('  /clear          - Clear conversation history');
  console.log('  /save <name>    - Save conversation to file');
  console.log('  /load <name>    - Load conversation from file');
  console.log('  /debug [on|off] - Toggle debug mode');
  console.log('  /quit           - Exit the chat');
  console.log('  /stop           - Interrupt current response');
  console.log('  /model <name>   - Switch model (fast/haiku/sonnet/opus)');
  console.log('  /logout         - Clear saved authentication\n');
  console.log('📎 File References:\n');
  console.log('  @src/main.ts    - Embed file content in message');
  console.log('  @./ or @./dir   - Reference files relative to cwd\n');
  console.log('📬 Message Queue:\n');
  console.log('  While Claude responds, type new messages to queue them');
  console.log('  Urgent messages (NO, STOP, WAIT, etc) inject immediately');
  console.log('  TODO: prefix logs message to .todos.md without interrupting');
  console.log('  Normal messages auto-inject every 30s or press 0-9 to force\n');
}

/**
 * Clear conversation history
 */
function clearHistory(): void {
  conversationHistory = [];
  console.log('\n✅ Conversation history cleared\n');
}

/**
 * Save conversation to file
 */
async function saveConversation(name: string): Promise<void> {
  if (!name) {
    console.log('[Error: Provide a filename]\n');
    return;
  }

  try {
    const history: ConversationHistory = {
      messages: conversationHistory as Array<{ role: 'user' | 'assistant'; content: string }>,
      timestamp: new Date().toISOString(),
      model: 'smart-sonnet'
    };

    const filePath = path.join(process.cwd(), `.${name}.json`);
    await fsp.writeFile(filePath, JSON.stringify(history, null, 2));
    console.log(`[Conversation saved to ${filePath}]\n`);
  } catch (error) {
    console.error(`[Error saving conversation: ${error}]\n`);
  }
}

/**
 * Load conversation from file
 */
async function loadConversation(name: string): Promise<void> {
  if (!name) {
    console.log('[Error: Provide a filename]\n');
    return;
  }

  try {
    const filePath = path.join(process.cwd(), `.${name}.json`);
    const content = await fsp.readFile(filePath, 'utf-8');
    const history = JSON.parse(content) as ConversationHistory;
    conversationHistory = history.messages;
    console.log(`[Loaded ${history.messages.length} messages from ${filePath}]\n`);
  } catch (error) {
    console.error(`[Error loading conversation: ${error}]\n`);
  }
}

/**
 * Set debug mode
 */
async function setDebugMode(on: boolean): Promise<void> {
  debugMode = on;
  if (on) {
    // Clear log file on enable
    try {
      await fsp.writeFile(debugLogFile, `Debug log started at ${new Date().toISOString()}\n`);
    } catch (_err) {
      // Ignore errors
    }
    console.log(`[Debug mode enabled - logging to ${debugLogFile}]\n`);
  } else {
    console.log(`[Debug mode disabled]\n`);
  }
}

/**
 * Resolve a file reference (e.g., @src/main.ts)
 */
async function resolveFileReference(ref: string): Promise<string | null> {
  try {
    const filePath = path.resolve(process.cwd(), ref);

    // Security: ensure file is within cwd
    const cwd = process.cwd();
    const normalized = path.normalize(filePath);
    if (!normalized.startsWith(path.normalize(cwd))) {
      logDebug(`[Security: file outside cwd: ${ref}]`);
      return null;
    }

    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      logDebug(`[Not a file: ${ref}]`);
      return null;
    }

    if (stat.size > MAX_FILE_SIZE) {
      logDebug(`[File too large: ${ref} (${stat.size} bytes)]`);
      return null;
    }

    const content = await fsp.readFile(filePath, 'utf-8');
    logDebug(`[Loaded: ${ref} (${content.length} chars)]`);
    return content;
  } catch (error) {
    logDebug(`[Error loading ${ref}: ${error}]`);
    return null;
  }
}

/**
 * Process @ file references in input
 */
async function processFileReferences(input: string): Promise<string> {
  const filePattern = /@([\w\-./]+)/g;
  let enrichedInput = input;
  const matches = [...input.matchAll(filePattern)];

  if (matches.length === 0) {
    return input;
  }

  logDebug(`[Found ${matches.length} file reference(s)]`);

  for (const match of matches) {
    const ref = match[1];
    const content = await resolveFileReference(ref);

    if (content) {
      // Replace @ref with code block containing file content
      const replacement = `\`\`\`\n${content}\n\`\`\``;
      enrichedInput = enrichedInput.replace(`@${ref}`, replacement);
    } else {
      // Keep original @ref if file not found, let Claude handle it
      logDebug(`[Skipping unresolved: @${ref}]`);
    }
  }

  return enrichedInput;
}

/**
 * Get completions for / commands
 */
function getCommandCompletions(prefix: string): string[] {
  const commands = [
    '/help',
    '/clear',
    '/save',
    '/load',
    '/debug',
    '/quit',
    '/exit',
    '/logout',
    '/stop',
    '/model'
  ];

  return commands
    .filter((cmd) => cmd.startsWith(prefix))
    .map((cmd) => cmd.slice(prefix.length));
}

/**
 * Get completions for @ file references
 */
function getFileCompletions(prefix: string): string[] {
  logDebug(`[getFileCompletions START: prefix="${prefix}"]`);

  try {
    // Extract the path after @
    const match = prefix.match(/@(.*)$/);
    logDebug(`[Regex match result: ${match ? 'yes' : 'no'}]`);
    if (!match) {
      logDebug(`[No regex match, returning empty]`);
      return [];
    }

    const filePath = match[1];
    logDebug(`[filePath="${filePath}"]`);

    let dirPath = '';
    let filter = '';

    // Determine directory and filter
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash === -1) {
      // No slash, suggest files in current dir matching prefix
      dirPath = '.';
      filter = filePath;
    } else {
      // Has slash, suggest files in that directory
      dirPath = filePath.slice(0, lastSlash);
      filter = filePath.slice(lastSlash + 1);
    }

    logDebug(`[dirPath="${dirPath}", filter="${filter}", cwd="${process.cwd()}"]`);
    const resolvedDir = path.resolve(process.cwd(), dirPath);
    logDebug(`[resolvedDir="${resolvedDir}"]`);

    // Security: ensure we don't escape cwd
    const normalized = path.normalize(resolvedDir);
    const cwd = path.normalize(process.cwd());
    logDebug(`[Security check: normalized="${normalized}", cwd="${cwd}", passes=${normalized.startsWith(cwd)}]`);

    if (!normalized.startsWith(cwd)) {
      logDebug(`[Security blocked path: ${resolvedDir}]`);
      return [];
    }

    // Read directory contents
    try {
      logDebug(`[About to readdir: ${resolvedDir}]`);
      const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
      logDebug(`[readdir success: ${entries.length} entries]`);

      const filtered = entries.filter((entry) => entry.name.startsWith(filter));
      logDebug(`[After filter (prefix="${filter}"): ${filtered.length} entries]`);

      const result = filtered.map((entry) => {
        const name = entry.name;
        const suffix = entry.isDirectory() ? '/' : '';
        const displayName = filePath.includes('/') ? name + suffix : name + suffix;
        return displayName;
      });

      logDebug(`[Final result: ${JSON.stringify(result)}]`);
      return result;
    } catch (_err) {
      logDebug(`[Error reading dir ${resolvedDir}: ${err}]`);
      return [];
    }
  } catch (_err) {
    logDebug(`[Error in getFileCompletions: ${err}]`);
    return [];
  }
}

/**
 * Completer function for readline
 */
function completer(line: string): [completions: string[], prefix: string] {
  logDebug(`[Completer called with: "${line}"]`);

  // Check if we're completing a command or file reference
  if (line.includes('@')) {
    // Last token might be @ file reference
    const lastAtIndex = line.lastIndexOf('@');
    const afterAt = line.slice(lastAtIndex);

    logDebug(`[@ detected at ${lastAtIndex}, afterAt="${afterAt}"]`);

    // Check if this @ is after a space (new token)
    if (lastAtIndex === 0 || line[lastAtIndex - 1] === ' ') {
      const completions = getFileCompletions(afterAt);
      // For readline: we need to return just the part being completed
      // Extract the filename/filter part (last component after final /)
      const filePath = afterAt.slice(1); // Remove @
      const lastSlash = filePath.lastIndexOf('/');
      const filter = lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);
      logDebug(`[Got ${completions.length} completions for @, returning prefix="${filter}"]`);
      return [completions, filter];
    }
  }

  if (line.startsWith('/')) {
    // Complete commands
    const completions = getCommandCompletions(line);
    logDebug(`[Got ${completions.length} completions for /, returning prefix="${line}"]`);
    return [completions, line];
  }

  return [[], ''];
}

/**
 * Main function
 */
async function main(): Promise<void> {
  let apiKey: string | null = null;
  let oauthToken: string | null = null;
  const authManager = createAuthManager();

  // Try to load existing auth
  const storedAuth = await loadAuth();

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
          await saveAuth({ type: 'oauth', oauthTokens: newConfig.oauthTokens });
        }
      } else {
        console.log('⚠️  Saved tokens expired, need to re-authenticate');
        await clearAuth();
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
          await saveAuth({ type: 'oauth', oauthTokens: config.oauthTokens });
        }
      }
    } else if (authMethod === '2') {
      // Claude Max Subscription (OAuth - max mode)
      const token = await handleOAuthFlow(rl, 'max', authManager);
      if (token) {
        oauthToken = token;
        const config = authManager.getAuthConfig();
        if (config.oauthTokens) {
          await saveAuth({ type: 'oauth', oauthTokens: config.oauthTokens });
        }
      }
    } else {
      // API Key (direct)
      apiKey = await handleApiKeyAuth(rl);
      if (apiKey) {
        await saveAuth({ type: 'api-key', apiKey });
      }
    }

    rl.close();

    if (!apiKey && !oauthToken) {
      console.error('\n❌ Authentication failed. Exiting.');
      process.exit(1);
    }
  }

  console.log('\n✅ Authentication successful!');
  console.log('\nStarting Claude Agent Session (Enhanced)...\n');
  showHelp();

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

  // Create readline interface for user input with autocomplete
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: completer
  });

  // Queue for handling async input while Claude responds
  let inputQueue: string[] = [];
  let waitingForInput = true;

  // Graceful shutdown handler
  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down...');
    await session?.stop();
    rl.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Listen for input lines in real-time (non-blocking)
  rl.on('line', (input: string) => {
    const trimmed = input.trim();

    if (!trimmed) {
      // Show prompt again if waiting for input
      if (waitingForInput) {
        process.stdout.write('You: ');
      }
      return;
    }

    // If currently waiting for input, process immediately
    if (waitingForInput) {
      inputQueue.push(trimmed);
    } else {
      // Claude is responding, queue the input
      inputQueue.push(trimmed);
    }
  });

  // Process input from queue
  const processInput = async (input: string): Promise<void> => {
    const trimmed = input.trim();

    if (!trimmed) {
      return;
    }

    // ========================================
    // Handle / commands
    // ========================================
    if (trimmed === '/help') {
      showHelp();
      return;
    }

    if (trimmed === '/clear') {
      clearHistory();
      return;
    }

    if (trimmed.startsWith('/save ')) {
      const name = trimmed.slice(6).trim();
      await saveConversation(name);
      return;
    }

    if (trimmed.startsWith('/load ')) {
      const name = trimmed.slice(6).trim();
      await loadConversation(name);
      return;
    }

    if (trimmed === '/debug' || trimmed.startsWith('/debug ')) {
      const args = trimmed.slice(6).trim();
      const onFlag = args === 'on' || !args;
      await setDebugMode(onFlag);
      return;
    }

    if (trimmed === '/quit' || trimmed === '/exit') {
      console.log('Goodbye!');
      await shutdown();
      return;
    }

    if (trimmed === '/logout') {
      await clearAuth();
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
      return;
    }

    // ========================================
    // Queue handling during response
    // ========================================
    if (isResponding) {
      const msg = messageQueue.add(trimmed);
      console.log(
        `\n[Message queued: "${trimmed.substring(0, 40)}${trimmed.length > 40 ? '...' : ''}" (${msg.priority})]`
      );
      console.log(messageQueue.displayPanel());

      // If urgent message, show alert
      if (msg.priority === 'urgent') {
        console.log('\n🔴 URGENT MESSAGE - Will be injected when ready');
      }

      return;
    }

    // ========================================
    // Process @ file references
    // ========================================
    let messageContent = trimmed;
    try {
      messageContent = await processFileReferences(trimmed);
    } catch (error) {
      console.error(`[Error processing file references: ${error}]\n`);
      return;
    }

    // Send the message
    try {
      isResponding = true;
      waitingForInput = false;
      console.log('\nClaude: ');
      conversationHistory.push({ role: 'user', content: trimmed });
      await session?.sendMessage({ role: 'user', content: messageContent });
    } catch (error) {
      console.error(`Error sending message: ${error}`);
      isResponding = false;
      waitingForInput = true;
      return;
    }

    // Wait for response to complete, with periodic message injection
    const injectionCheckInterval = 1000; // Check every 1 second
    while (isResponding) {
      // Check if we should auto-inject a message
      if (messageQueue.shouldAutoInject()) {
        const nextMsg = messageQueue.injectNext();
        if (nextMsg) {
          console.log(`\n[→ AUTO-INJECTING]: ${nextMsg.text}`);
          conversationHistory.push({ role: 'user', content: nextMsg.text });
          await session?.sendMessage({ role: 'user', content: nextMsg.text });
          console.log('\n');
        }
      }

      // Check for urgent messages and pause to let user handle them
      if (messageQueue.hasUrgentMessages()) {
        console.log(messageQueue.displayPanel());
        console.log('\n⏸️  URGENT messages pending - review with: 0-9=Force, C=Clear, or wait to continue');
      }

      await new Promise<void>((resolve) => setTimeout(resolve, injectionCheckInterval));
    }

    // After response completes, show any remaining messages
    if (messageQueue.pending.length > 0) {
      console.log(messageQueue.displayPanel());
    }

    // Ready for next input
    waitingForInput = true;
    console.log('\nYou: ');
  };

  // Main event loop - process inputs from queue
  const processQueue = async (): Promise<void> => {
    while (true) {
      if (inputQueue.length > 0) {
        const input = inputQueue.shift();
        if (input) {
          await processInput(input);
        }
      }
      // Check queue every 100ms
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
  };

  // Show initial prompt and start processing
  console.log('\nYou: ');
  await processQueue();
}

main();
