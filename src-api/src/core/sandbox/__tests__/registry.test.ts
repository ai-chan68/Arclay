import { afterEach, describe, expect, it } from 'vitest';
import type { ExecuteOptions, SandboxFileInfo, SandboxResult } from '@shared-types';
import type { ISandboxProvider, SandboxConfig } from '../interface';
import type { ProviderState } from '../../../shared/provider/types';
import { registerSandboxPlugin, sandboxRegistry, unregisterSandboxPlugin } from '../registry';
import type { SandboxCapabilities, SandboxPlugin } from '../types';

class MockSandboxProvider implements ISandboxProvider {
  readonly type: 'docker' | 'e2b';
  readonly name: string;
  private _state: ProviderState = 'uninitialized';
  private available: boolean;

  constructor(type: 'docker' | 'e2b', available: boolean) {
    this.type = type;
    this.name = type;
    this.available = available;
  }

  get state(): ProviderState {
    return this._state;
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async init(): Promise<void> {
    this._state = 'ready';
  }

  async stop(): Promise<void> {
    this._state = 'stopped';
  }

  async shutdown(): Promise<void> {
    this._state = 'stopped';
  }

  getCapabilities(): SandboxCapabilities {
    return {
      supportsStreaming: false,
      supportsToolCalling: false,
      supportsVision: false,
      supportsSystemPrompt: false,
      supportsSession: false,
      supportsFilesystem: true,
      supportsProcessIsolation: true,
      supportsFallback: true,
    };
  }

  async execute(_command: string, _options?: ExecuteOptions): Promise<SandboxResult> {
    return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
  }

  async runScript(_scriptPath: string, _options?: ExecuteOptions): Promise<SandboxResult> {
    return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
  }

  async readFile(): Promise<string> {
    return '';
  }

  async writeFile(): Promise<void> {}

  async listDir(): Promise<SandboxFileInfo[]> {
    return [];
  }

  async exists(): Promise<boolean> {
    return false;
  }

  async deleteFile(): Promise<void> {}

  async createDir(): Promise<void> {}

  async getCwd(): Promise<string> {
    return process.cwd();
  }

  async setCwd(): Promise<void> {}
}

const unavailableDockerPlugin: SandboxPlugin = {
  metadata: {
    type: 'docker',
    runtime: 'sandbox',
    name: 'Docker Sandbox',
    fallbackTypes: ['e2b', 'native'],
    capabilities: {
      supportsStreaming: false,
      supportsToolCalling: false,
      supportsVision: false,
      supportsSystemPrompt: false,
      supportsSession: false,
      supportsFilesystem: true,
      supportsProcessIsolation: true,
      supportsFallback: true,
    },
  },
  factory: () => new MockSandboxProvider('docker', false),
};

const availableE2bPlugin: SandboxPlugin = {
  metadata: {
    type: 'e2b',
    runtime: 'sandbox',
    name: 'E2B Sandbox',
    capabilities: {
      supportsStreaming: false,
      supportsToolCalling: false,
      supportsVision: false,
      supportsSystemPrompt: false,
      supportsSession: false,
      supportsFilesystem: true,
      supportsProcessIsolation: true,
      supportsFallback: true,
    },
  },
  factory: () => new MockSandboxProvider('e2b', true),
};

describe('SandboxRegistry', () => {
  afterEach(() => {
    unregisterSandboxPlugin('docker');
    unregisterSandboxPlugin('e2b');
  });

  it('supports registration and provider creation lifecycle', async () => {
    registerSandboxPlugin(availableE2bPlugin);
    const provider = await sandboxRegistry.create('e2b', {
      provider: 'e2b',
      workDir: process.cwd(),
    } as SandboxConfig);
    expect(provider.state).toBe('ready');
    expect(await provider.isAvailable()).toBe(true);
  });

  it('selects fallback provider when requested provider is unavailable', async () => {
    registerSandboxPlugin(unavailableDockerPlugin);
    registerSandboxPlugin(availableE2bPlugin);

    const selection = await sandboxRegistry.resolveWithFallback('docker');
    expect(selection.requested).toBe('docker');
    expect(selection.selected).toBe('e2b');
    expect(selection.fallbackFrom).toBe('docker');
  });
});
