import type { IProvider, ProviderMetadata, ProviderPlugin } from '../../shared/provider/types';

export type RuntimeDomain = 'agent' | 'sandbox';

export interface RuntimeLifecycleHooks {
  onRegister?: () => Promise<void>;
  onInitialize?: () => Promise<void>;
  onShutdown?: () => Promise<void>;
}

export interface RuntimePluginMetadata extends ProviderMetadata {
  runtime: RuntimeDomain;
  fallbackTypes?: string[];
}

export interface RuntimePlugin<
  TProvider extends IProvider = IProvider,
  TConfig = Record<string, unknown>
> extends ProviderPlugin<TProvider, TConfig>, RuntimeLifecycleHooks {
  metadata: RuntimePluginMetadata;
}
