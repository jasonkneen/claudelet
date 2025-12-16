/**
 * Basic Chat Example
 *
 * This example shows how to use the claude-agent-loop package
 * to create a simple CLI chat interface.
 *
 * Run with:
 *   ANTHROPIC_API_KEY=sk-... bun run examples/basic-chat.ts
 */

import * as readline from 'readline';

import { startAgentSession, type AgentSessionHandle } from '../src';

const MAX_THINKING_TOKENS = 16_000;

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  console.log('Starting Claude Agent Session...\n');
  console.log('Commands:');
  console.log('  /quit           - Exit the chat');
  console.log('  /stop           - Interrupt current response');
  console.log('  /model <name>   - Switch model (fast/haiku/sonnet/opus)');
  console.log();

  let session: AgentSessionHandle | null = null;
  let isResponding = false;
  let rl: readline.Interface | null = null;

  // Graceful shutdown handler
  const shutdown = async (): Promise<void> => {
    console.log('\nShutting down...');
    await session?.stop();
    rl?.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    // Start the agent session
    session = await startAgentSession(
      {
        apiKey,
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
          // process.stdout.write(_data.delta)
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

    // Create readline interface for user input
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const prompt = (): void => {
      rl?.question('You: ', async (input) => {
        const trimmed = input.trim();

        if (!trimmed) {
          prompt();
          return;
        }

        // Handle commands
        if (['/quit', '/exit'].includes(trimmed)) {
          console.log('Goodbye!');
          await shutdown();
          return;
        }

        if (trimmed === '/stop') {
          if (isResponding) {
            await session?.interrupt();
          } else {
            console.log('[No response in progress]\n');
          }
          prompt();
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
          prompt();
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

        // Continue prompting after response completes
        await new Promise<void>((resolve) => {
          const check = (): void => {
            if (!isResponding) {
              resolve();
            } else {
              setTimeout(check, 100);
            }
          };
          check();
        });
        prompt();
      });
    };

    prompt();
  } catch (error) {
    console.error('Failed to start session:', error);
    process.exit(1);
  }
}

main();
