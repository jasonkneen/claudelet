/**
 * Config Loader
 *
 * Loads configuration from .claudelet and .claude folders with priority:
 * 1. Project-level .claudelet/
 * 2. Project-level .claude/
 * 3. User-level ~/.claudelet/
 * 4. User-level ~/.claude/
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Configuration structure
 */
export interface ClaudeletConfig {
  /** MCP server configurations */
  mcpServers?: Record<string, McpServerConfig>;
  /** Default model preference */
  defaultModel?: 'fast' | 'smart-sonnet' | 'smart-opus';
  /** Custom tools */
  tools?: Record<string, ToolConfig>;
  /** Skills configuration */
  skills?: Record<string, SkillConfig>;
  /** Extension/plugin configuration */
  extensions?: Record<string, unknown>;
}

/**
 * MCP Server configuration
 */
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Tool configuration
 */
export interface ToolConfig {
  description: string;
  inputSchema?: Record<string, unknown>;
  handler?: string;
}

/**
 * Skill configuration
 */
export interface SkillConfig {
  name: string;
  description: string;
  path?: string;
}

/**
 * Default config folder priority
 */
const DEFAULT_CONFIG_FOLDERS = ['.claudelet', '.claude'];

/**
 * Check if a path exists
 */
async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load JSON file safely
 */
async function loadJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Merge configs with later values taking precedence
 */
function mergeConfigs(...configs: (ClaudeletConfig | null)[]): ClaudeletConfig {
  const result: ClaudeletConfig = {};

  for (const config of configs) {
    if (!config) continue;

    // Merge MCP servers
    if (config.mcpServers) {
      result.mcpServers = { ...result.mcpServers, ...config.mcpServers };
    }

    // Override default model
    if (config.defaultModel) {
      result.defaultModel = config.defaultModel;
    }

    // Merge tools
    if (config.tools) {
      result.tools = { ...result.tools, ...config.tools };
    }

    // Merge skills
    if (config.skills) {
      result.skills = { ...result.skills, ...config.skills };
    }

    // Merge extensions
    if (config.extensions) {
      result.extensions = { ...result.extensions, ...config.extensions };
    }
  }

  return result;
}

/**
 * Load config from a single folder
 */
async function loadFromFolder(folderPath: string): Promise<ClaudeletConfig | null> {
  if (!(await exists(folderPath))) {
    return null;
  }

  // Try different config file names
  const configFiles = [
    'config.json',
    'settings.json',
    'claudelet.json',
    'mcp.json'
  ];

  let config: ClaudeletConfig = {};

  for (const fileName of configFiles) {
    const filePath = path.join(folderPath, fileName);
    const fileConfig = await loadJsonFile<ClaudeletConfig>(filePath);
    if (fileConfig) {
      config = mergeConfigs(config, fileConfig);
    }
  }

  // Also check for skills directory
  const skillsDir = path.join(folderPath, 'skills');
  if (await exists(skillsDir)) {
    const skillFiles = await fs.promises.readdir(skillsDir);
    const skills: Record<string, SkillConfig> = {};

    for (const file of skillFiles) {
      if (file.endsWith('.json')) {
        const skillConfig = await loadJsonFile<SkillConfig>(path.join(skillsDir, file));
        if (skillConfig) {
          skills[file.replace('.json', '')] = skillConfig;
        }
      } else if (file.endsWith('.md')) {
        // Markdown skill files
        skills[file.replace('.md', '')] = {
          name: file.replace('.md', ''),
          description: 'Skill from ' + file,
          path: path.join(skillsDir, file)
        };
      }
    }

    if (Object.keys(skills).length > 0) {
      config.skills = { ...config.skills, ...skills };
    }
  }

  return Object.keys(config).length > 0 ? config : null;
}

/**
 * Load configuration with folder priority
 *
 * @param workingDir - The project working directory
 * @param configFolders - Folders to check in priority order (default: ['.claudelet', '.claude'])
 * @returns Merged configuration from all found config files
 */
export async function loadConfig(
  workingDir: string,
  configFolders: string[] = DEFAULT_CONFIG_FOLDERS
): Promise<ClaudeletConfig> {
  const configs: (ClaudeletConfig | null)[] = [];

  // 1. Load from user home directory (lowest priority)
  const homeDir = os.homedir();
  for (const folder of [...configFolders].reverse()) {
    const userConfig = await loadFromFolder(path.join(homeDir, folder));
    configs.push(userConfig);
  }

  // 2. Load from project directory (highest priority)
  for (const folder of [...configFolders].reverse()) {
    const projectConfig = await loadFromFolder(path.join(workingDir, folder));
    configs.push(projectConfig);
  }

  return mergeConfigs(...configs);
}

/**
 * Find the first existing config folder
 */
export async function findConfigFolder(
  workingDir: string,
  configFolders: string[] = DEFAULT_CONFIG_FOLDERS
): Promise<string | null> {
  // Check project first
  for (const folder of configFolders) {
    const projectPath = path.join(workingDir, folder);
    if (await exists(projectPath)) {
      return projectPath;
    }
  }

  // Then check home directory
  const homeDir = os.homedir();
  for (const folder of configFolders) {
    const homePath = path.join(homeDir, folder);
    if (await exists(homePath)) {
      return homePath;
    }
  }

  return null;
}

/**
 * Ensure a config folder exists, preferring .claudelet
 */
export async function ensureConfigFolder(
  workingDir: string,
  configFolders: string[] = DEFAULT_CONFIG_FOLDERS
): Promise<string> {
  // Check if any folder already exists
  const existing = await findConfigFolder(workingDir, configFolders);
  if (existing) {
    return existing;
  }

  // Create the first preference folder (.claudelet)
  const preferredFolder = configFolders[0] || '.claudelet';
  const folderPath = path.join(workingDir, preferredFolder);
  await fs.promises.mkdir(folderPath, { recursive: true });
  return folderPath;
}

/**
 * Get MCP server configs from the loaded config
 */
export function getMcpServers(config: ClaudeletConfig): Record<string, McpServerConfig> {
  return config.mcpServers || {};
}

/**
 * Get skills from the loaded config
 */
export function getSkills(config: ClaudeletConfig): Record<string, SkillConfig> {
  return config.skills || {};
}
