/**
 * Configuration types for application settings
 */

export type LLMProvider = 'glm' | 'claude' | 'openai' | 'deepseek' | 'openrouter' | 'kimi';

export interface ProviderConfig {
  provider: LLMProvider;
  apiKey: string;
  baseUrl?: string;
  model: string;
}

export type SandboxProviderType = 'native' | 'claude' | 'codex' | 'docker' | 'e2b';

export interface SandboxConfig {
  enabled: boolean;
  provider?: SandboxProviderType;
  image?: string;
  providerConfig?: Record<string, unknown>;
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

export interface MCPServerConfig {
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface SkillsConfig {
  enabled: boolean;
  userDirEnabled: boolean;
  appDirEnabled: boolean;
  skillsPath?: string;
}

export interface AppConfig {
  provider: ProviderConfig;
  sandbox: SandboxConfig;
  mcp: MCPConfig;
  skills: SkillsConfig;
  workDir: string;
  locale: 'en' | 'zh';
  theme: 'light' | 'dark' | 'system';
}
