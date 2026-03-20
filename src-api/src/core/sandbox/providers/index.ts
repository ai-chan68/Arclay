import { registerSandboxPlugin, sandboxRegistry } from '../registry';
import { NativeSandboxProvider } from './native';
import { ClaudeSandboxProvider } from './claude';
import type { SandboxPlugin } from '../types';

const nativePlugin: SandboxPlugin = {
  metadata: {
    type: 'native',
    runtime: 'sandbox',
    name: 'Native Sandbox',
    description: 'Runs commands directly on host (trusted environments only)',
    capabilities: {
      supportsStreaming: false,
      supportsToolCalling: false,
      supportsVision: false,
      supportsSystemPrompt: false,
      supportsSession: false,
      supportsFilesystem: true,
      supportsProcessIsolation: false,
      supportsFallback: true,
    },
  },
  factory: (config) => new NativeSandboxProvider(config?.workDir),
};

const claudePlugin: SandboxPlugin = {
  metadata: {
    type: 'claude',
    runtime: 'sandbox',
    name: 'Claude Sandbox Runtime',
    description: 'Executes commands through Anthropic Sandbox Runtime',
    fallbackTypes: ['native'],
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
  factory: (config) => new ClaudeSandboxProvider(config?.workDir),
};

let initialized = false;

export function initializeSandboxProviders(): void {
  if (initialized) return;
  registerSandboxPlugin(nativePlugin);
  registerSandboxPlugin(claudePlugin);
  initialized = true;
  console.log('[SandboxProviders] Initialized providers:', sandboxRegistry.list());
}
