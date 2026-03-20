import { afterEach, describe, expect, it } from 'vitest';
import { agentRegistry, registerAgentPlugin, unregisterAgentPlugin } from '../registry';
import type { AgentPlugin, AgentProviderConfig, IAgent, IAgentProvider } from '../types';
import type { AgentMessage } from '@shared-types';
import type { AgentRunOptions } from '../types';
import type { ProviderState } from '../../../shared/provider/types';

class MockAgent implements IAgent {
  readonly type = 'openai' as const;

  async run(): Promise<AgentMessage[]> {
    return [];
  }

  async *stream(): AsyncIterable<AgentMessage> {
    yield* [];
  }

  abort(): void {}

  getSession() {
    return null;
  }
}

class MockAgentProvider implements IAgentProvider {
  readonly type = 'openai' as const;
  readonly name = 'Mock OpenAI';
  private _state: ProviderState = 'uninitialized';
  private config?: AgentProviderConfig;

  get state(): ProviderState {
    return this._state;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.config?.apiKey);
  }

  async init(config?: Record<string, unknown>): Promise<void> {
    this._state = 'initializing';
    this.config = config as AgentProviderConfig | undefined;
    this._state = 'ready';
  }

  async stop(): Promise<void> {
    this._state = 'stopped';
  }

  async shutdown(): Promise<void> {
    this._state = 'stopped';
    this.config = undefined;
  }

  getCapabilities() {
    return {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsVision: false,
      supportsSystemPrompt: true,
      supportsSession: true,
      supportsPlanning: false,
      supportsParallelToolCalls: false,
    };
  }

  createAgent(_config: AgentProviderConfig): IAgent {
    return new MockAgent();
  }

  validateConfig(config: AgentProviderConfig): boolean {
    return Boolean(config.apiKey && config.model);
  }

  getDefaultModel(): string {
    return 'mock-model';
  }

  getSupportedModels(): string[] {
    return ['mock-model'];
  }
}

const mockPlugin: AgentPlugin = {
  metadata: {
    type: 'openai',
    runtime: 'agent',
    name: 'Mock OpenAI',
    defaultModel: 'mock-model',
    capabilities: {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsVision: false,
      supportsSystemPrompt: true,
      supportsSession: true,
      supportsPlanning: false,
      supportsParallelToolCalls: false,
    },
  },
  factory: () => new MockAgentProvider(),
};

describe('AgentPluginRegistry', () => {
  afterEach(() => {
    unregisterAgentPlugin('openai');
  });

  it('supports register/get/list semantics for plugins', () => {
    registerAgentPlugin(mockPlugin);
    expect(agentRegistry.getPlugin('openai')).toBeDefined();
    expect(agentRegistry.list()).toContain('openai');
  });

  it('supports create and initializes provider lifecycle', async () => {
    registerAgentPlugin(mockPlugin);
    const provider = await agentRegistry.create('openai', {
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'mock-model',
    });

    expect(provider.state).toBe('ready');
    expect(provider.validateConfig({ provider: 'openai', apiKey: 'x', model: 'm' })).toBe(true);
    expect(provider.createAgent({ provider: 'openai', apiKey: 'x', model: 'm' })).toBeTruthy();
  });

  it('reports availability for plugins', async () => {
    registerAgentPlugin(mockPlugin);
    const provider = await agentRegistry.create('openai', {
      provider: 'openai',
      apiKey: 'sk-live',
      model: 'mock-model',
    });

    expect(await provider.isAvailable()).toBe(true);
  });
});
