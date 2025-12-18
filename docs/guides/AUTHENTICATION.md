# Authentication

Claudelet supports OAuth (Anthropic Account / Claude Max) and API key auth.

## OAuth (recommended)

1. Start Claudelet and choose:
   - `1` Anthropic Account (OAuth), or
   - `2` Claude Max (OAuth)
2. Open the printed authorization URL in your browser.
3. After you authorize, you’ll be redirected to a callback.
4. When Claudelet prompts you, paste **one** of these:

- Full callback URL:
  - `https://console.anthropic.com/oauth/code/callback?code=...&state=...`
- Just the authorization code:
  - `afzcmRBFJHwyJpY19T3VHF8MdmWQ1w2VYdKfXUtcVOetpKSb`
- Code + state (some flows show it like this):
  - `afzcmRBFJHwyJpY19T3VHF8MdmWQ1w2VYdKfXUtcVOetpKSb#2da95480f059...`

Claudelet will extract the `code` (and validate `state` when present), exchange it for tokens, and store them locally.

## Where auth is stored

- Auth cache file: `~/.claude-agent-auth.json`
- Clear auth: run `/logout` or delete the file above.

## Common issues

### “Invalid authorization code: invalid characters”

This usually means you pasted something other than:
- a raw code,
- a full callback URL, or
- `code#state`.

Try copying the callback URL again and paste the entire line.

### “Invalid state”

You likely completed a different login attempt than the one currently running in Claudelet.
- Restart the OAuth flow and try again.

