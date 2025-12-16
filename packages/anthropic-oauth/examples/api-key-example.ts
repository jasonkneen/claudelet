/**
 * Example: Get API Key via OAuth
 *
 * This example shows how to use OAuth to get an API key instead of tokens.
 * Run with: bun run examples/api-key-example.ts
 */

import readline from 'readline/promises'

import { AnthropicOAuthClient } from '../src/index'

async function main(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  console.log('\n🔑 Anthropic API Key via OAuth Example\n')

  // Create the OAuth client
  const client = new AnthropicOAuthClient()

  // Start the OAuth flow
  const { authUrl, verifier, state } = await client.startLogin('console')

  console.log('🔐 Authentication Required\n')
  console.log('Please visit this URL to authorize:\n')
  console.log(`  ${authUrl}\n`)

  const callbackUrl = await rl.question('Paste the callback URL: ')

  try {
    const url = new URL(callbackUrl)
    const code = url.searchParams.get('code')

    if (!code) {
      console.error('\n❌ Error: No authorization code found in URL')
      rl.close()
      return
    }

    // Complete login with createKey=true to get an API key
    // Note: now requires state parameter for CSRF protection
    console.log('\n⏳ Creating API key...')
    const result = await client.completeLogin(code, verifier, state, true)

    if (result.apiKey) {
      console.log('\n✅ API Key created successfully!\n')
      console.log('API Key:', result.apiKey)
      console.log('\nYou can now use this API key with the Anthropic SDK:')
      console.log(`\nimport Anthropic from '@anthropic-ai/sdk'`)
      console.log(`\nconst anthropic = new Anthropic({`)
      console.log(`  apiKey: '${result.apiKey}'`)
      console.log(`})`)
    }
  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error))
  }

  rl.close()
}

main().catch(console.error)
