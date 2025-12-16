#!/usr/bin/env node
/**
 * Ink-based Chat Interface
 *
 * A beautiful CLI chat interface using Ink (React for CLIs)
 * with a fixed input bar at the bottom.
 *
 * Run with:
 *   bun run examples/ink-chat.tsx
 */

import React, { useState, useEffect, useCallback } from 'react'
import { render, Box, Text, useInput, useApp } from 'ink'
import TextInput from 'ink-text-input'
import { createAuthManager, startAgentSession, type AgentSessionHandle } from '../src/index.js'
import { clearAuth, loadAuth, saveAuth } from './auth-storage.js'

const MAX_THINKING_TOKENS = 16_000

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
}

interface AppState {
  messages: Message[]
  isResponding: boolean
  currentModel: string
  sessionId?: string
  showThinking: boolean
  thinkingContent: string
  currentTool?: string
}

const ChatApp: React.FC<{ apiKey?: string; oauthToken?: string }> = ({ apiKey, oauthToken }) => {
  const { exit } = useApp()
  const [state, setState] = useState<AppState>({
    messages: [
      {
        role: 'system',
        content: '🤖 Claude Agent Chat\n\nCommands: /quit /stop /model <name> /logout\n',
        timestamp: new Date()
      }
    ],
    isResponding: false,
    currentModel: 'smart-sonnet',
    showThinking: false,
    thinkingContent: ''
  })
  const [inputValue, setInputValue] = useState('')
  const [session, setSession] = useState<AgentSessionHandle | null>(null)
  const [inputMode, setInputMode] = useState<'chat' | 'blocked'>('chat')

  // Initialize session
  useEffect(() => {
    const initSession = async (): Promise<void> => {
      try {
        const newSession = await startAgentSession(
          {
            ...(oauthToken ? { oauthToken } : { apiKey: apiKey! }),
            workingDirectory: process.cwd(),
            modelPreference: 'smart-sonnet',
            maxThinkingTokens: MAX_THINKING_TOKENS
          },
          {
            onTextChunk: (text: string) => {
              setState((prev) => {
                const lastMsg = prev.messages[prev.messages.length - 1]
                if (lastMsg?.role === 'assistant' && !prev.showThinking) {
                  // Append to existing assistant message
                  return {
                    ...prev,
                    messages: [
                      ...prev.messages.slice(0, -1),
                      { ...lastMsg, content: lastMsg.content + text }
                    ]
                  }
                } else {
                  // Create new assistant message
                  return {
                    ...prev,
                    messages: [
                      ...prev.messages,
                      { role: 'assistant', content: text, timestamp: new Date() }
                    ]
                  }
                }
              })
            },

            onThinkingStart: () => {
              setState((prev) => ({ ...prev, showThinking: true, thinkingContent: '' }))
            },
            onThinkingChunk: (data: { delta: string }) => {
              setState((prev) => ({ ...prev, thinkingContent: prev.thinkingContent + data.delta }))
            },

            onToolUseStart: (tool: { name: string }) => {
              setState((prev) => ({ ...prev, currentTool: tool.name }))
            },
            onToolResultComplete: () => {
              setState((prev) => ({ ...prev, currentTool: undefined }))
            },

            onSessionInit: (data: { sessionId: string; resumed?: boolean }) => {
              setState((prev) => ({
                ...prev,
                sessionId: data.sessionId,
                messages: [
                  ...prev.messages,
                  {
                    role: 'system',
                    content: `✅ Session: ${data.sessionId.slice(0, 8)}${data.resumed ? ' (resumed)' : ''}`,
                    timestamp: new Date()
                  }
                ]
              }))
            },
            onMessageComplete: () => {
              setState((prev) => ({
                ...prev,
                isResponding: false,
                showThinking: false,
                thinkingContent: '',
                currentTool: undefined
              }))
              setInputMode('chat')
            },
            onMessageStopped: () => {
              setState((prev) => ({
                ...prev,
                isResponding: false,
                showThinking: false,
                messages: [
                  ...prev.messages,
                  { role: 'system', content: '⏹️  Response stopped', timestamp: new Date() }
                ]
              }))
              setInputMode('chat')
            },
            onError: (error: string) => {
              setState((prev) => ({
                ...prev,
                isResponding: false,
                showThinking: false,
                messages: [
                  ...prev.messages,
                  { role: 'system', content: `❌ Error: ${error}`, timestamp: new Date() }
                ]
              }))
              setInputMode('chat')
            }
          }
        )
        setSession(newSession)
        setInputMode('chat')
      } catch (error) {
        setState((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              role: 'system',
              content: `❌ Failed to start session: ${error}`,
              timestamp: new Date()
            }
          ]
        }))
        setTimeout(() => exit(), 2000)
      }
    }

    initSession()

    return () => {
      session?.stop()
    }
  }, [apiKey, oauthToken])

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim()
      if (!trimmed) return

      // Add user message
      setState((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          { role: 'user', content: trimmed, timestamp: new Date() }
        ]
      }))
      setInputValue('')

      // Handle commands
      if (trimmed === '/quit' || trimmed === '/exit') {
        setState((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            { role: 'system', content: '👋 Goodbye!', timestamp: new Date() }
          ]
        }))
        setTimeout(() => exit(), 500)
        return
      }

      if (trimmed === '/logout') {
        clearAuth()
        setState((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            { role: 'system', content: '✅ Logged out. Restart to login again.', timestamp: new Date() }
          ]
        }))
        setTimeout(() => exit(), 500)
        return
      }

      if (trimmed === '/stop') {
        if (state.isResponding) {
          await session?.interrupt()
        } else {
          setState((prev) => ({
            ...prev,
            messages: [
              ...prev.messages,
              { role: 'system', content: 'ℹ️  No response in progress', timestamp: new Date() }
            ]
          }))
        }
        return
      }

      if (trimmed.startsWith('/model ')) {
        const modelArg = trimmed.slice(7).trim()
        const modelMap: Record<string, 'fast' | 'smart-sonnet' | 'smart-opus'> = {
          fast: 'fast',
          haiku: 'fast',
          sonnet: 'smart-sonnet',
          opus: 'smart-opus'
        }
        const model = modelMap[modelArg.toLowerCase()]
        if (model) {
          try {
            await session?.setModel(model)
            setState((prev) => ({
              ...prev,
              currentModel: model,
              messages: [
                ...prev.messages,
                { role: 'system', content: `✅ Switched to ${model}`, timestamp: new Date() }
              ]
            }))
          } catch (e) {
            setState((prev) => ({
              ...prev,
              messages: [
                ...prev.messages,
                { role: 'system', content: `❌ Failed to switch model: ${e}`, timestamp: new Date() }
              ]
            }))
          }
        } else {
          setState((prev) => ({
            ...prev,
            messages: [
              ...prev.messages,
              {
                role: 'system',
                content: 'ℹ️  Unknown model. Use: fast, haiku, sonnet, or opus',
                timestamp: new Date()
              }
            ]
          }))
        }
        return
      }

      // Send message to Claude
      try {
        setState((prev) => ({ ...prev, isResponding: true }))
        setInputMode('blocked')
        await session?.sendMessage({ role: 'user', content: trimmed })
      } catch (error) {
        setState((prev) => ({
          ...prev,
          isResponding: false,
          messages: [
            ...prev.messages,
            { role: 'system', content: `❌ Error: ${error}`, timestamp: new Date() }
          ]
        }))
        setInputMode('chat')
      }
    },
    [session, state.isResponding, exit]
  )

  // Handle Ctrl+C
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit()
    }
  })

  // Calculate visible messages (last 15)
  const visibleMessages = state.messages.slice(-15)

  return (
    <Box flexDirection="column" height="100%">
      {/* Messages area */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
        {visibleMessages.map((msg, i) => (
          <Box key={i} marginBottom={0}>
            {msg.role === 'user' && (
              <Text bold color="cyan">
                You: <Text color="white">{msg.content}</Text>
              </Text>
            )}
            {msg.role === 'assistant' && (
              <Text bold color="green">
                Claude: <Text color="white">{msg.content}</Text>
              </Text>
            )}
            {msg.role === 'system' && (
              <Text dimColor italic>
                {msg.content}
              </Text>
            )}
          </Box>
        ))}

        {/* Thinking indicator */}
        {state.showThinking && (
          <Box marginTop={1}>
            <Text color="yellow" italic>
              💭 Thinking...
            </Text>
          </Box>
        )}

        {/* Tool indicator */}
        {state.currentTool && (
          <Box marginTop={0}>
            <Text color="magenta" italic>
              🔧 Using tool: {state.currentTool}
            </Text>
          </Box>
        )}
      </Box>

      {/* Fixed input bar */}
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
        <Box marginBottom={0}>
          <Text dimColor>
            ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
          </Text>
        </Box>
        <Box>
          <Text bold color={inputMode === 'blocked' ? 'red' : 'cyan'}>
            {inputMode === 'blocked' ? '⏳' : '>'}{' '}
          </Text>
          {inputMode === 'chat' ? (
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={handleSubmit}
              placeholder="Type your message... (Ctrl+C to quit)"
            />
          ) : (
            <Text dimColor italic>
              Waiting for response...
            </Text>
          )}
        </Box>
        <Box marginTop={0}>
          <Text dimColor>
            Model: {state.currentModel} | {state.isResponding ? '🔄 Responding...' : '✅ Ready'}
          </Text>
        </Box>
      </Box>
    </Box>
  )
}

// Main entry point
async function main(): Promise<void> {
  let apiKey: string | null = null
  let oauthToken: string | null = null
  const authManager = createAuthManager()

  // Try to load existing auth
  const storedAuth = loadAuth()

  if (storedAuth) {
    if (storedAuth.type === 'api-key' && storedAuth.apiKey) {
      apiKey = storedAuth.apiKey
    } else if (storedAuth.type === 'oauth' && storedAuth.oauthTokens) {
      authManager.loadAuthConfig({ oauthTokens: storedAuth.oauthTokens })
      const accessToken = await authManager.getOAuthAccessToken()
      if (accessToken) {
        oauthToken = accessToken
        const newConfig = authManager.getAuthConfig()
        if (newConfig.oauthTokens) {
          saveAuth({ type: 'oauth', oauthTokens: newConfig.oauthTokens })
        }
      } else {
        console.log('⚠️  Saved tokens expired. Please run basic-chat.ts to re-authenticate.')
        process.exit(1)
      }
    }
  }

  if (!apiKey && !oauthToken) {
    console.log('❌ No authentication found. Please run basic-chat.ts first to authenticate.')
    process.exit(1)
  }

  // Render the Ink app
  render(<ChatApp apiKey={apiKey || undefined} oauthToken={oauthToken || undefined} />)
}

main()
