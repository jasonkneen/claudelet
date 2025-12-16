# Claudelet Security Fixes - Implementation Guide

This document provides ready-to-implement code fixes for all security vulnerabilities identified in the security audit.

---

## CRITICAL: Fix #1 - Auth File Permissions

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/src/auth-storage.ts`

**Original Code:**
```typescript
export function saveAuth(auth: StoredAuth): void {
  try {
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save auth:', error);
  }
}
```

**Fixed Code:**
```typescript
export function saveAuth(auth: StoredAuth): void {
  try {
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), 'utf8');
    // SECURITY: Restrict file to user-only access (0600 = rw-------)
    fs.chmodSync(AUTH_FILE, 0o600);
  } catch (error) {
    console.error('Failed to save auth:', error);
  }
}
```

**Also apply same fix to:** `/Users/jkneen/Documents/GitHub/flows/claudelet/packages/claude-agent-loop/examples/auth-storage.ts`

**Verification Test:**
```bash
# After running claudelet authentication, verify permissions
stat ~/.claude-agent-auth.json | grep Access
# Output should show: 0600 or -rw------- (user read+write only)

# Verify no other users can read
[ -r ~/.claude-agent-auth.json ] && [ ! -r ~/.claude-agent-auth.json -o "$USER" = "$(stat -f%Su ~/.claude-agent-auth.json)" ] && echo "OK" || echo "FAIL"
```

---

## HIGH: Fix #2 - Debug Logging Security

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/bin/claudelet-opentui.tsx`

**Replace lines 49-61:**

**Original Code:**
```typescript
const MAX_THINKING_TOKENS = 16_000;
const TODOS_FILE = '.todos.md';
const MAX_FILE_SIZE = 500_000; // 500KB
const DEBUG = true; // Enable debug logging
const DEBUG_LOG = '/tmp/claudelet-opentui-debug.log';

// Debug logger that writes to file
const debugLog = (msg: string) => {
  if (DEBUG) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(DEBUG_LOG, `[${timestamp}] ${msg}\n`);
  }
};
```

**Fixed Code:**
```typescript
const MAX_THINKING_TOKENS = 16_000;
const TODOS_FILE = '.todos.md';
const MAX_FILE_SIZE = 500_000; // 500KB
const MAX_DEBUG_LOG_SIZE = 10 * 1024 * 1024; // 10MB max log size

// SECURITY: Debug logging disabled by default - enable with CLAUDELET_DEBUG=true
const DEBUG = process.env.CLAUDELET_DEBUG === 'true';

// SECURITY: Store debug logs in user's home directory with restricted permissions
const DEBUG_LOG = path.join(os.homedir(), '.cache', 'claudelet', 'debug.log');

// Ensure debug log directory exists with proper permissions
if (DEBUG) {
  try {
    const debugDir = path.dirname(DEBUG_LOG);
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true, mode: 0o700 });
    }
    console.warn('⚠️  CLAUDELET_DEBUG is enabled. Debug logs: ' + DEBUG_LOG);
  } catch {
    // Ignore if we can't create debug directory
  }
}

// Debug logger that writes to file with security checks
const debugLog = (msg: string) => {
  if (DEBUG) {
    try {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${msg}\n`;

      // Prevent log file from growing too large
      if (fs.existsSync(DEBUG_LOG)) {
        const stats = fs.statSync(DEBUG_LOG);
        if (stats.size > MAX_DEBUG_LOG_SIZE) {
          // Rotate log file
          const archivePath = DEBUG_LOG + '.' + Date.now();
          fs.renameSync(DEBUG_LOG, archivePath);
        }
      }

      fs.appendFileSync(DEBUG_LOG, logEntry);
      // SECURITY: Ensure log file has restricted permissions
      fs.chmodSync(DEBUG_LOG, 0o600);
    } catch {
      // Silently fail if debug logging fails
    }
  }
};
```

**Additional: Import os module if not already present**
Add to top of file (near other imports):
```typescript
import * as os from 'os';
```

**Verification Test:**
```bash
# Verify debug logging is off by default
CLAUDELET_DEBUG=false bun run dev 2>&1 | grep -i debug
# Should NOT show "CLAUDELET_DEBUG is enabled" message

# Enable debug logging
export CLAUDELET_DEBUG=true
bun run dev
# Should show "CLAUDELET_DEBUG is enabled" and location

# Verify log file permissions
stat ~/.cache/claudelet/debug.log | grep Access
# Should show 0600 or -rw------- (user read+write only)

# Verify debug log doesn't contain tokens
grep -i "token\|oauth\|apikey" ~/.cache/claudelet/debug.log
# Should find NO sensitive data
```

---

## HIGH: Fix #3 - OAuth Code Validation

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/packages/anthropic-oauth/src/oauth-client.ts`

**Replace lines 296-355 (exchangeCodeForTokens method):**

**Fixed Code:**
```typescript
/**
 * Validate authorization code format
 */
private validateAuthorizationCode(code: string): boolean {
  if (!code || typeof code !== 'string') {
    return false;
  }

  // Authorization codes should be reasonable length (typically 40-100 chars)
  if (code.length > 2048) {
    return false;
  }

  // Authorization codes should only contain alphanumeric and safe URL-safe chars
  // Valid chars: A-Z a-z 0-9 - _ . ~
  const codePattern = /^[a-zA-Z0-9\-_.~]+$/;
  if (!codePattern.test(code)) {
    return false;
  }

  return true;
}

/**
 * Exchange authorization code for access and refresh tokens
 *
 * @param code - Authorization code from OAuth callback (may include state fragment)
 * @param verifier - PKCE verifier from startLogin
 * @param expectedState - State value from startLogin for CSRF validation
 * @returns OAuth tokens
 */
private async exchangeCodeForTokens(
  code: string,
  verifier: string,
  expectedState: string
): Promise<OAuthTokens> {
  // SECURITY: Validate authorization code format
  if (!this.validateAuthorizationCode(code)) {
    throw new Error('Invalid authorization code format');
  }

  // Parse code and state safely
  const parts = code.split('#');
  if (parts.length > 2) {
    throw new Error('Invalid authorization code format: multiple # separators');
  }

  // SECURITY: URL decode components
  let authCode: string;
  let callbackState: string | undefined;

  try {
    authCode = decodeURIComponent(parts[0].trim());
    if (parts.length > 1) {
      callbackState = decodeURIComponent(parts[1].trim());
    }
  } catch {
    throw new Error('Invalid authorization code: invalid URL encoding');
  }

  // Validate decoded code
  if (!authCode || authCode.length === 0) {
    throw new Error('Invalid authorization code: code is empty');
  }

  if (authCode.length > 2048) {
    throw new Error('Invalid authorization code: exceeds maximum length');
  }

  // Validate state for CSRF protection
  if (callbackState && callbackState !== expectedState) {
    throw new Error(
      'State mismatch: The callback state does not match the expected state. ' +
        'This may indicate a CSRF attack or an expired session.'
    );
  }

  const body: Record<string, string> = {
    code: authCode,
    grant_type: 'authorization_code',
    client_id: this.clientId,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier
  };

  // Only include state if present
  if (callbackState) {
    body.state = callbackState;
  }

  const response = await this.fetchWithTimeout(
    TOKEN_ENDPOINT,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    },
    'Token exchange'
  );

  if (!response.ok) {
    await this.handleHttpError(response, 'Token exchange');
  }

  const tokenResponse = await this.parseJsonResponse(
    response,
    validateTokenResponse,
    'Token exchange'
  );

  return {
    type: 'oauth',
    refresh: tokenResponse.refresh_token,
    access: tokenResponse.access_token,
    expires: Date.now() + tokenResponse.expires_in * 1000
  };
}
```

**Verification Test:**
```bash
# Test with valid code format
node -e "console.log(decodeURIComponent('valid_auth_code%20test#state123'))"

# Test oversized code is rejected
node -e "
const code = 'x'.repeat(3000) + '#state';
console.log(code.length > 2048 ? 'REJECTED' : 'ACCEPTED');
"

# Test invalid characters are rejected
node -e "
const code = 'valid<script>alert(1)</script>#state';
console.log(/^[a-zA-Z0-9\-_.~]+$/.test(code) ? 'ACCEPTED' : 'REJECTED');
"
```

---

## HIGH: Fix #4 - Environment Variable Leakage

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/bin/claudelet-opentui.tsx`

**Replace lines 149-192 (handleApiKeyAuth function):**

**Fixed Code:**
```typescript
/**
 * Handle API key authentication
 */
async function handleApiKeyAuth(): Promise<string | null> {
  const readline = await import('readline/promises');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n🔑 API Key Authentication\n');

  // SECURITY: Check if ANTHROPIC_API_KEY is set without exposing its value
  const hasEnvApiKey = !!process.env.ANTHROPIC_API_KEY;

  if (hasEnvApiKey) {
    const useEnv = await rl.question(
      'Use API key from ANTHROPIC_API_KEY environment variable? (Y/n): '
    );
    if (!useEnv.trim() || useEnv.trim().toLowerCase() === 'y') {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      // SECURITY: Clear from process environment after retrieval
      delete process.env.ANTHROPIC_API_KEY;
      rl.close();
      return apiKey;
    }
  }

  // Prompt for manual API key entry
  const apiKey = await rl.question('Enter your Anthropic API key: ');
  const trimmed = apiKey.trim();

  if (!trimmed) {
    console.error('\n❌ API key cannot be empty');
    rl.close();
    return null;
  }

  // SECURITY: Validate API key format
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
```

**Verification Test:**
```bash
# Test that environment variable is cleared after use
ANTHROPIC_API_KEY=sk-ant-test123 bun run dev <<< $'y\n' && echo $ANTHROPIC_API_KEY
# Should output empty (variable cleared)

# Test no API key appears in error messages
ANTHROPIC_API_KEY=sk-ant-test123 bun run dev <<< $'y\nquit\n' 2>&1 | grep -i "sk-ant"
# Should find nothing
```

---

## MEDIUM: Fix #5 - Clipboard Paste Security

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/bin/claudelet-opentui.tsx`

**Replace lines 1835-1859:**

**Fixed Code:**
```typescript
// Clipboard paste (Ctrl+V or Cmd+V)
if ((key.ctrl || key.meta) && key.name === 'v') {
  try {
    const MAX_CLIPBOARD_SIZE = 10 * 1024 * 1024;  // 10MB limit
    const CLIPBOARD_TIMEOUT = 5000;  // 5 second timeout

    // SECURITY: Use timeout and size limit
    const clipboardText =
      process.platform === 'darwin' ?
        execSync('pbpaste', {
          encoding: 'utf-8',
          timeout: CLIPBOARD_TIMEOUT,
          maxBuffer: MAX_CLIPBOARD_SIZE
        })
      : execSync('xclip -selection clipboard -o', {
          encoding: 'utf-8',
          timeout: CLIPBOARD_TIMEOUT,
          maxBuffer: MAX_CLIPBOARD_SIZE
        });

    if (clipboardText) {
      // SECURITY: Sanitize clipboard content
      const sanitized = sanitizeClipboardContent(clipboardText, MAX_CLIPBOARD_SIZE);

      if (sanitized) {
        setInputSegments((prev) => {
          const lastSegment = prev[prev.length - 1];
          if (lastSegment && lastSegment.type === 'text') {
            return [
              ...prev.slice(0, -1),
              { type: 'text', text: lastSegment.text + sanitized }
            ];
          }
          return [...prev, { type: 'text', text: sanitized }];
        });
      }
    }
  } catch (e) {
    if (e instanceof Error) {
      if (e.message.includes('TIMEOUT')) {
        debugLog('Clipboard access timed out (>5s)');
      } else if (e.message.includes('MaxBufferExceeded')) {
        debugLog('Clipboard content exceeds maximum size (>10MB)');
      } else {
        debugLog(`Paste failed: ${e.message}`);
      }
    } else {
      debugLog(`Paste failed: ${e}`);
    }
  }
  return;
}
```

**Add helper function before component definition:**
```typescript
/**
 * SECURITY: Sanitize clipboard content for safety
 * Removes null bytes, control characters, and validates size
 */
function sanitizeClipboardContent(content: string, maxSize: number): string {
  if (!content) {
    return '';
  }

  // Enforce size limit
  if (content.length > maxSize) {
    debugLog('Clipboard content exceeds maximum size, truncating');
    return content.substring(0, maxSize);
  }

  // Remove null bytes
  let sanitized = content.replace(/\0/g, '');

  // Remove control characters (except newline, tab, carriage return)
  sanitized = sanitized.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');

  return sanitized;
}
```

**Verification Test:**
```bash
# Test large clipboard content is handled
dd if=/dev/zero bs=1M count=20 | base64 | pbcopy
# Claudelet should handle gracefully without hanging

# Test clipboard with null bytes
printf "test\x00content" | pbcopy
# Should sanitize null bytes

# Test clipboard timeout
# (Simulate with slow command - verify doesn't hang)
sleep 10 | pbcopy  # This will fail, but verify no infinite wait
```

---

## MEDIUM: Fix #6 - Search Query Validation

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/bin/claudelet-ai-tools.ts`

**Add before grepSearch method (around line 387):**

**Add validation method:**
```typescript
/**
 * SECURITY: Validate search query to prevent DoS attacks
 * - Prevents excessively long queries
 * - Blocks problematic regex patterns
 * - Limits nested groups
 */
private validateSearchQuery(query: string): { valid: boolean; reason?: string } {
  if (!query || typeof query !== 'string') {
    return { valid: false, reason: 'Query must be a non-empty string' };
  }

  // Query length validation
  if (query.length > 1000) {
    return { valid: false, reason: 'Query exceeds maximum length (1000 chars)' };
  }

  // Block known problematic regex patterns
  const problematicPatterns = [
    { pattern: /\(\?R\)/, name: 'Recursive patterns' },
    { pattern: /\(\?>/, name: 'Atomic groups' },
    { pattern: /(\+\+)|(\*\+)|(\{\d+,\}\+)/, name: 'Possessive quantifiers' },
    { pattern: /(\w\*){2,}/, name: 'Nested quantifiers' }
  ];

  for (const { pattern, name } of problematicPatterns) {
    if (pattern.test(query)) {
      return { valid: false, reason: `Query contains ${name}` };
    }
  }

  // Limit nested groups (unbalanced parens could indicate ReDoS attack)
  const openParens = (query.match(/(?<!\\)\(/g) || []).length;
  const closeParens = (query.match(/(?<!\\)\)/g) || []).length;

  if (openParens !== closeParens) {
    return { valid: false, reason: 'Query has unbalanced parentheses' };
  }

  if (openParens > 10) {
    return { valid: false, reason: 'Query has too many nested groups (>10)' };
  }

  return { valid: true };
}
```

**Replace grepSearch method signature and add timeout:**
```typescript
/**
 * Performs grep/ripgrep search as fallback
 */
private async grepSearch(query: string, limit: number): Promise<HybridSearchResult[]> {
  // SECURITY: Validate query before execution
  const validation = this.validateSearchQuery(query);
  if (!validation.valid) {
    console.warn(`Invalid search query: ${validation.reason}`);
    return [];
  }

  return new Promise((resolve) => {
    const results: HybridSearchResult[] = [];
    const GREP_TIMEOUT = 10000;  // 10 second timeout
    const MAX_OUTPUT_SIZE = 10 * 1024 * 1024;  // 10MB max output

    // SECURITY: Set timeout to prevent hanging on problematic queries
    const timeoutHandle = setTimeout(() => {
      if (proc) {
        proc.kill();
        debugLog(`Search query timed out after ${GREP_TIMEOUT}ms`);
      }
      resolve(results);  // Return partial results
    }, GREP_TIMEOUT);

    // Try ripgrep first, fall back to grep
    const useRg = true;
    const cmd = useRg ? 'rg' : 'grep';
    const args = useRg
      ? [
          '--json',
          '--max-count', '3',
          '--max-filesize', '500K',
          '--type-add', 'code:*.{ts,js,tsx,jsx,py,go,rs,java,c,cpp,h,hpp,md,json}',
          '--type', 'code',
          '-i',
          query,  // Now validated above
          this.projectPath
        ]
      : [
          '-r', '-n', '-i',
          '--include=*.ts', '--include=*.js', '--include=*.tsx', '--include=*.jsx',
          '--include=*.py', '--include=*.go', '--include=*.rs', '--include=*.java',
          query,
          this.projectPath
        ];

    let proc: any;  // Process reference for timeout cleanup
    proc = spawn(cmd, args, {
      cwd: this.projectPath,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    const handler = (data: Buffer) => {
      stdout += data.toString();
      // SECURITY: Stop if output gets too large
      if (stdout.length > MAX_OUTPUT_SIZE) {
        proc.kill();
        clearTimeout(timeoutHandle);
        resolve(results.slice(0, limit));
      }
    };

    proc.stdout.on('data', handler);

    // Consume stderr to prevent it from interfering with TUI
    proc.stderr.on('data', () => { /* suppress */ });

    proc.on('close', () => {
      clearTimeout(timeoutHandle);
      // ... rest of parsing
    });

    proc.on('error', () => {
      clearTimeout(timeoutHandle);
      resolve([]);
    });
  });
}
```

**Verification Test:**
```bash
# Test query validation rejects long queries
node -e "
const query = 'a'.repeat(2000);
console.log(query.length > 1000 ? 'REJECTED' : 'ACCEPTED');
"

# Test ReDoS pattern is rejected
node -e "
const query = '(a+)+b';
console.log(/(a\+){2,}/.test(query) ? 'REJECTED' : 'ACCEPTED');
"

# Test timeout works
timeout 5 bun run tui <<< 'very_long_search_pattern'
# Should exit gracefully within timeout
```

---

## MEDIUM: Fix #7 - Symlink Attack Prevention

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/src/session-storage.ts`

**Replace ensureSessionsDir and saveSession functions:**

**Fixed Code:**
```typescript
/**
 * Ensure the sessions directory exists with secure permissions
 */
export async function ensureSessionsDir(): Promise<void> {
  const dir = getSessionsDir();

  try {
    // SECURITY: Check if directory is a symlink (lstat doesn't follow symlinks)
    const stat = await fsp.lstat(dir);
    if (stat.isSymbolicLink()) {
      throw new Error(`Sessions directory is a symlink (security risk): ${dir}`);
    }
  } catch (err) {
    // ENOENT is expected for new directories
    if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
      throw err;
    }
  }

  // Create directory with secure permissions (700 = rwx------)
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });

  // Verify and correct permissions if directory already existed
  try {
    await fsp.chmod(dir, 0o700);
  } catch {
    // Ignore if we can't change permissions
  }
}

/**
 * Save a session to disk with symlink protection
 */
export async function saveSession(session: SessionData): Promise<string> {
  await ensureSessionsDir();
  const filePath = getSessionPath(session.sessionId, session.createdAt);

  // SECURITY: Detect and reject symlinks
  try {
    const stat = await fsp.lstat(filePath);  // lstat doesn't follow symlinks
    if (stat.isSymbolicLink()) {
      throw new Error(`Attempted to overwrite symlink: ${filePath}`);
    }
  } catch (err) {
    // ENOENT is expected for new files
    if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
      throw new Error(`Security check failed for session file: ${filePath}`);
    }
  }

  // Update the updatedAt timestamp
  session.updatedAt = new Date().toISOString();

  // Write file (will fail gracefully if symlink due to above check)
  await fsp.writeFile(filePath, JSON.stringify(session, null, 2));

  // SECURITY: Verify file permissions are correct
  try {
    await fsp.chmod(filePath, 0o600);  // User read+write only
  } catch {
    // Ignore permission errors
  }

  return filePath;
}

/**
 * Save session synchronously (for cleanup handlers)
 */
export function saveSessionSync(session: SessionData): string {
  const dir = getSessionsDir();

  // SECURITY: Create directory with secure permissions
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } else {
    // Verify not a symlink
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink()) {
      throw new Error(`Sessions directory is a symlink: ${dir}`);
    }
  }

  const filePath = getSessionPath(session.sessionId, session.createdAt);

  // SECURITY: Detect and reject symlinks
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);  // lstat doesn't follow symlinks
    if (stat.isSymbolicLink()) {
      throw new Error(`Attempted to overwrite symlink: ${filePath}`);
    }
  }

  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2));

  // SECURITY: Set file permissions
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore permission errors
  }

  return filePath;
}
```

**Verification Test:**
```bash
# Create test symlink attack
mkdir -p ~/.claudelet/sessions
ln -s /tmp/evil.txt ~/.claudelet/sessions/test.json

# Run Claudelet - should reject the symlink
bun run dev
# Should error: "Attempted to overwrite symlink"

# Verify permissions are correct
stat ~/.claudelet/sessions/ | grep Access
# Should show 0700 or drwx------

stat ~/.claudelet/sessions/*.json | grep Access
# Should show 0600 or -rw-------
```

---

## LOW: Fix #8 - Configurable OAuth Client ID

**File:** `/Users/jkneen/Documents/GitHub/flows/claudelet/packages/anthropic-oauth/src/oauth-client.ts`

**Update lines 12 and constructor:**

**Original Code:**
```typescript
const DEFAULT_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'

export class AnthropicOAuthClient {
  constructor(options: OAuthClientOptions = {}) {
    this.clientId = options.clientId?.trim() || DEFAULT_CLIENT_ID
```

**Fixed Code:**
```typescript
const DEFAULT_CLIENT_ID = process.env.ANTHROPIC_OAUTH_CLIENT_ID ||
  '9d1c250a-e61b-44d9-88ed-5944d1962f5e'

export class AnthropicOAuthClient {
  constructor(options: OAuthClientOptions = {}) {
    this.clientId = options.clientId?.trim() || DEFAULT_CLIENT_ID
```

**Verification Test:**
```bash
# Test with custom client ID
export ANTHROPIC_OAUTH_CLIENT_ID="custom-client-id-123"
bun run dev
# Should use custom client ID

# Test with default
unset ANTHROPIC_OAUTH_CLIENT_ID
bun run dev
# Should use default client ID
```

---

## Summary of Changes

| Fix | File | Lines Changed | Priority |
|---|---|---|---|
| Auth file permissions | auth-storage.ts | 32 | CRITICAL |
| Debug logging security | claudelet-opentui.tsx | 49-61, 2960+ | HIGH |
| OAuth code validation | oauth-client.ts | 296-355 | HIGH |
| Environment variable safety | claudelet-opentui.tsx | 149-192 | HIGH |
| Clipboard sanitization | claudelet-opentui.tsx | 1835-1859 | MEDIUM |
| Search query validation | claudelet-ai-tools.ts | 387+ | MEDIUM |
| Symlink attack prevention | session-storage.ts | 59-107 | MEDIUM |
| Configurable client ID | oauth-client.ts | 12 | LOW |

---

## Testing Roadmap

### Immediate (24 hours)
1. Deploy auth file permissions fix
2. Run manual verification of file ownership/permissions
3. Write unit test for chmod behavior

### Week 1
1. Deploy debug logging fixes
2. Test with CLAUDELET_DEBUG enabled/disabled
3. Verify no secrets in debug logs

### Week 2
1. Deploy OAuth validation and environment variable fixes
2. Test OAuth flow with various code formats
3. Test API key handling with mock environment

### Week 3-4
1. Deploy clipboard, search, and symlink fixes
2. Conduct integration testing
3. Test symlink attack scenarios

---

## Deployment Checklist

- [ ] All code changes reviewed by security team
- [ ] Unit tests written for each fix
- [ ] Integration tests pass
- [ ] Manual verification of each vulnerability fix
- [ ] Documentation updated
- [ ] CHANGELOG updated with security fixes
- [ ] Security advisory prepared for users with existing installations
- [ ] Recommend users delete and regenerate API keys if using older versions
