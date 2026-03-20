import type { RuntimePlugin, RuntimePluginMetadata } from '../runtime/plugin-types';
import type { ISandboxProvider, SandboxConfig, SandboxProviderType } from './interface';
import type { ProviderCapabilities } from '../../shared/provider/types';

export interface SandboxCapabilities extends ProviderCapabilities {
  supportsFilesystem: boolean;
  supportsProcessIsolation: boolean;
  supportsFallback: boolean;
}

export interface SandboxProviderMetadata extends RuntimePluginMetadata {
  type: SandboxProviderType;
  runtime: 'sandbox';
  capabilities: SandboxCapabilities;
  fallbackTypes?: SandboxProviderType[];
}

export interface SandboxPlugin extends RuntimePlugin<ISandboxProvider, SandboxConfig> {
  metadata: SandboxProviderMetadata;
  factory: (config?: SandboxConfig) => ISandboxProvider;
}

export interface SandboxSelection {
  requested: SandboxProviderType;
  selected: SandboxProviderType;
  fallbackFrom?: SandboxProviderType;
  reason?: string;
}
