import { BaseProviderRegistry } from '../../shared/provider/registry';
import type { SandboxConfig, SandboxProviderType, ISandboxProvider } from './interface';
import type { SandboxPlugin, SandboxSelection } from './types';

const DEFAULT_FALLBACK: SandboxProviderType = 'native';

class SandboxProviderRegistry extends BaseProviderRegistry<ISandboxProvider, SandboxConfig> {
  list(): SandboxProviderType[] {
    return this.getRegisteredTypes() as SandboxProviderType[];
  }

  async create(type: SandboxProviderType, config: SandboxConfig): Promise<ISandboxProvider> {
    return this.getInstance(type, config);
  }

  getMetadata(type: SandboxProviderType): SandboxPlugin['metadata'] | undefined {
    return this.getPlugin(type)?.metadata as SandboxPlugin['metadata'] | undefined;
  }

  getAllMetadata(): Map<SandboxProviderType, SandboxPlugin['metadata']> {
    const result = new Map<SandboxProviderType, SandboxPlugin['metadata']>();
    for (const [type, plugin] of this.plugins) {
      result.set(type as SandboxProviderType, plugin.metadata as SandboxPlugin['metadata']);
    }
    return result;
  }

  async resolveWithFallback(
    requested: SandboxProviderType,
    explicitFallbacks: SandboxProviderType[] = []
  ): Promise<SandboxSelection> {
    const requestedPlugin = this.getPlugin(requested) as SandboxPlugin | undefined;
    if (!requestedPlugin) {
      return {
        requested,
        selected: DEFAULT_FALLBACK,
        fallbackFrom: requested,
        reason: `requested provider "${requested}" is not registered`,
      };
    }

    const requestedProvider = requestedPlugin.factory();
    if (await requestedProvider.isAvailable()) {
      return { requested, selected: requested };
    }

    const metadataFallbacks = (requestedPlugin.metadata.fallbackTypes || []) as SandboxProviderType[];
    const fallbackCandidates = [...explicitFallbacks, ...metadataFallbacks, DEFAULT_FALLBACK];
    for (const candidate of fallbackCandidates) {
      const plugin = this.getPlugin(candidate) as SandboxPlugin | undefined;
      if (!plugin) continue;
      const provider = plugin.factory();
      if (await provider.isAvailable()) {
        return {
          requested,
          selected: candidate,
          fallbackFrom: requested,
          reason: `requested provider "${requested}" unavailable`,
        };
      }
    }

    return {
      requested,
      selected: requested,
      reason: `no fallback available for "${requested}"`,
    };
  }
}

export const sandboxRegistry = new SandboxProviderRegistry();

export function registerSandboxPlugin(plugin: SandboxPlugin): void {
  sandboxRegistry.register(plugin);
}

export function unregisterSandboxPlugin(type: SandboxProviderType): void {
  sandboxRegistry.unregister(type);
}
