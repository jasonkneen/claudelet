/**
 * API key authentication handler
 */

/**
 * Handle API key authentication
 */
export async function handleApiKeyAuth(): Promise<string | null> {
  const readline = await import('readline/promises');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n🔑 API Key Authentication\n');

  // Check if ANTHROPIC_API_KEY is set
  if (process.env.ANTHROPIC_API_KEY) {
    const useEnv = await rl.question(
      `Found ANTHROPIC_API_KEY in environment. Use it? (Y/n): `
    );
    if (!useEnv.trim() || useEnv.trim().toLowerCase() === 'y') {
      rl.close();
      return process.env.ANTHROPIC_API_KEY;
    }
  }

  const apiKey = await rl.question('Enter your Anthropic API key: ');
  const trimmed = apiKey.trim();

  if (!trimmed) {
    console.error('\n❌ API key cannot be empty');
    rl.close();
    return null;
  }

  if (!trimmed.startsWith('sk-ant-')) {
    console.warn('\n⚠️  Warning: API key should start with "sk-ant-"');
    const proceed = await rl.question('Continue anyway? (y/N): ');
    if (proceed.trim().toLowerCase() !== 'y') {
      rl.close();
      return null;
    }
  }

  rl.close();
  return trimmed;
}
