/**
 * Agent Provider 注册表
 * 管理 Agent Provider 的注册和实例化
 */

import { BaseProviderRegistry } from '../../shared/provider/registry';
import type { IAgentProvider, AgentPlugin, AgentProviderConfig, AgentCapabilities } from './types';

/**
 * Agent Provider 注册表类
 */
class AgentProviderRegistry extends BaseProviderRegistry<IAgentProvider, AgentProviderConfig> {
  /**
   * 通过类型创建 Provider 实例（语义化别名）
   */
  async create(type: string, config?: AgentProviderConfig): Promise<IAgentProvider> {
    return this.getInstance(type, config);
  }

  /**
   * 列出已注册 Provider 类型（语义化别名）
   */
  list(): string[] {
    return this.getRegisteredTypes();
  }

  /**
   * 获取支持 planning 的 providers
   */
  getWithPlanning(): string[] {
    return this.getRegisteredTypes().filter((type) => {
      const plugin = this.getPlugin(type);
      const caps = plugin?.metadata.capabilities as AgentCapabilities | undefined;
      return caps?.supportsPlanning;
    });
  }

  /**
   * 获取支持 streaming 的 providers
   */
  getWithStreaming(): string[] {
    return this.getRegisteredTypes().filter((type) => {
      const plugin = this.getPlugin(type);
      const caps = plugin?.metadata.capabilities as AgentCapabilities | undefined;
      return caps?.supportsStreaming;
    });
  }

  /**
   * 获取支持 vision 的 providers
   */
  getWithVision(): string[] {
    return this.getRegisteredTypes().filter((type) => {
      const plugin = this.getPlugin(type);
      const caps = plugin?.metadata.capabilities as AgentCapabilities | undefined;
      return caps?.supportsVision;
    });
  }

  /**
   * 获取默认 provider
   * 优先级: claude > glm > openai > 其他
   */
  async getDefaultProvider(): Promise<string | undefined> {
    const priority = ['claude', 'glm', 'openai', 'deepseek', 'kimi'];

    for (const type of priority) {
      const plugin = this.getPlugin(type);
      if (plugin) {
        try {
          const provider = plugin.factory();
          if (await provider.isAvailable()) {
            return type;
          }
        } catch {
          // 忽略错误，继续检查下一个
        }
      }
    }

    // 如果优先级中没有可用的，返回第一个可用的
    const available = await this.getAvailable();
    return available[0];
  }

  /**
   * 获取 Provider 元数据
   */
  getMetadata(type: string): AgentPlugin['metadata'] | undefined {
    return this.getPlugin(type)?.metadata as AgentPlugin['metadata'] | undefined;
  }

  /**
   * 获取所有 Provider 元数据
   */
  getAllMetadata(): Map<string, AgentPlugin['metadata']> {
    const result = new Map<string, AgentPlugin['metadata']>();
    for (const [type, plugin] of this.plugins) {
      result.set(type, plugin.metadata as AgentPlugin['metadata']);
    }
    return result;
  }
}

// 导出单例实例
export const agentRegistry = new AgentProviderRegistry();

// 导出类型
export type { AgentProviderRegistry };

/**
 * 注册 Agent Provider 插件的便捷函数
 */
export function registerAgentPlugin(plugin: AgentPlugin): void {
  agentRegistry.register(plugin);
}

/**
 * 注销 Agent Provider 插件
 */
export function unregisterAgentPlugin(type: string): void {
  agentRegistry.unregister(type);
}
