/**
 * Startup banner generation
 */

import * as os from 'os';

import { getModelDisplayFromPreference } from 'claude-agent-loop';

// Claudelet logo
export const LOGO = `
     ,gggg,
   ,88"""Y8b,,dPYb,                                 8I           ,dPYb,           I8
  d8"     \`Y8IP'\`Yb                                 8I           IP'\`Yb           I8
 d8'   8b  d8I8  8I                                 8I           I8  8I        88888888
,8I    "Y88P'I8  8'                                 8I           I8  8'           I8
I8'          I8 dP    ,gggg,gg  gg      gg    ,gggg,8I   ,ggg,   I8 dP   ,ggg,    I8
d8           I8dP    dP"  "Y8I  I8      8I   dP"  "Y8I  i8" "8i  I8dP   i8" "8i   I8
Y8,          I8P    i8'    ,8I  I8,    ,8I  i8'    ,8I  I8, ,8I  I8P    I8, ,8I  ,I8,
\`Yba,,_____,,d8b,_ ,d8,   ,d8b,,d8b,  ,d8b,,d8,   ,d8b, \`YbadP' ,d8b,_  \`YbadP' ,d88b,
  \`"Y88888888P'"Y88P"Y8888P"\`Y88P'"Y88P"\`Y8P"Y8888P"\`Y8888P"Y8888P'"Y88888P"Y8888P""Y8
`;

export function generateStartupBanner(
  modelPreference: string,
  workingDir: string,
  authType: 'oauth' | 'api-key',
  sessionId?: string
): string {
  const modelDisplay = getModelDisplayFromPreference(modelPreference);
  const accountType = authType === 'oauth' ? 'Claude Max' : 'API Key';
  const shortPath = workingDir.replace(os.homedir(), '~');

  // Get username from environment
  const username = process.env.USER || process.env.USERNAME || 'User';

  const lines = [
    `╭${'─'.repeat(60)}╮`,
    `│${' '.repeat(60)}│`,
    `│  Welcome back ${username}!${' '.repeat(Math.max(0, 44 - username.length))}│`,
    `│${' '.repeat(60)}│`,
    `│  ${modelDisplay}${' '.repeat(Math.max(0, 58 - modelDisplay.length))}│`,
    `│  ${accountType}${' '.repeat(Math.max(0, 58 - accountType.length))}│`,
    `│  ${shortPath}${' '.repeat(Math.max(0, 58 - shortPath.length))}│`,
    `│${' '.repeat(60)}│`,
    `╰${'─'.repeat(60)}╯`
  ];

  return lines.join('\n');
}
