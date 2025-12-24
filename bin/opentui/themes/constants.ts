/**
 * Theme system constants
 */

import * as os from 'os';
import * as path from 'path';

// Theme persistence path
export const THEME_CONFIG_FILE = path.join(os.homedir(), '.claudelet', 'theme.json');
