/**
 * Authentication method selection prompt
 */

/**
 * Display authentication menu and get user choice
 */
export async function promptAuthMethod(): Promise<'1' | '2' | '3'> {
  const readline = await import('readline/promises');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n🤖 Claude Agent Chat (Enhanced)');
  console.log('\nHow would you like to authenticate?\n');
  console.log('  1. Anthropic Account (OAuth)');
  console.log('  2. Claude Max Subscription (OAuth - Recommended)');
  console.log('  3. API Key (Direct)\n');

  const choice = await rl.question('Select authentication method (1/2/3): ');
  const trimmed = choice.trim();
  rl.close();

  if (trimmed === '1' || trimmed === '2' || trimmed === '3') {
    return trimmed;
  }

  console.log('Invalid choice. Please select 1, 2, or 3.\n');
  return promptAuthMethod();
}
