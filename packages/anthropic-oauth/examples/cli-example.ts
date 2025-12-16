/**
 * Example: CLI OAuth flow
 *
 * This example shows how to use the AnthropicOAuthClient in a CLI application.
 * Run with: bun run examples/cli-example.ts
 */

import readline from 'readline/promises'

import { AnthropicOAuthClient } from '../src/index'

async function main(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  console.log('\n🤖 Anthropic OAuth CLI Example\n')

  // Create the OAuth client
  const client = new AnthropicOAuthClient()

  // Start the OAuth flow
  console.log('Starting OAuth flow...\n')
  const { authUrl, verifier, state } = await client.startLogin('console')

  console.log('🔐 Authentication Required\n')
  console.log('Please visit this URL to authorize:\n')
  console.log(`  ${authUrl}\n`)
  console.log('After authorizing, you will be redirected to a URL.')
  console.log('Copy and paste that entire URL here.\n')

  // Get the callback URL from the user
  const callbackUrl = await rl.question('Paste the callback URL: ')

  try {
    // Extract the code from the URL
    const url = new URL(callbackUrl)
    const code = url.searchParams.get('code')

    if (!code) {
      console.error('\n❌ Error: No authorization code found in URL')
      rl.close()
      return
    }

    // Complete the login (note: now requires state parameter)
    console.log('\n⏳ Exchanging code for tokens...')
    const result = await client.completeLogin(code, verifier, state)

    console.log('\n✅ Authentication successful!\n')
    console.log('Access Token:', result.tokens.access)
    console.log('Refresh Token:', result.tokens.refresh)
    console.log('Expires at:', new Date(result.tokens.expires).toLocaleString())

    // Demonstrate token refresh
    console.log('\n⏳ Testing token refresh...')
    const newTokens = await client.refreshAccessToken(result.tokens.refresh)
    console.log('✅ Token refresh successful!')
    console.log('New Access Token:', newTokens.access)
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error))
  }

  rl.close()
}

main().catch(console.error)
