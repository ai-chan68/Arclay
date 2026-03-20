/**
 * Agent Pool - Manages sub-agent instances for reuse
 *
 * Provides acquire/release semantics for efficient agent management
 */

import type { IAgent, IAgentProvider } from '../interface'
import type { SubAgentInfo, ProviderConfig } from '@shared-types'
import { SubAgent } from './sub-agent'

export interface PoolStats {
  available: number
  inUse: number
  maxAgents: number
}

export interface AgentPoolOptions {
  providerConfig: ProviderConfig
}

export class AgentPool {
  private provider: IAgentProvider
  private providerConfig: ProviderConfig
  private model: string
  private available: SubAgent[] = []
  private inUse: Map<string, SubAgent> = new Map()
  private maxAgents: number
  private nextId = 0

  constructor(
    provider: IAgentProvider,
    model: string,
    maxAgents: number = 5,
    options?: AgentPoolOptions
  ) {
    this.provider = provider
    this.model = model
    this.maxAgents = maxAgents
    this.providerConfig = options?.providerConfig || {
      provider: provider.name as any,
      apiKey: '',
      model
    }
  }

  /**
   * Acquire a sub-agent from the pool
   * Returns existing agent if available, or creates new one
   */
  async acquire(): Promise<SubAgent> {
    // Return available agent if exists
    if (this.available.length > 0) {
      const agent = this.available.pop()!
      this.inUse.set(agent.getInfo().id, agent)
      return agent
    }

    // Create new agent if under limit
    const totalAgents = this.available.length + this.inUse.size
    if (totalAgents < this.maxAgents) {
      const agent = await this.createAgent()
      this.inUse.set(agent.getInfo().id, agent)
      return agent
    }

    // Wait for agent to become available
    return await this.waitForAvailable()
  }

  /**
   * Release a sub-agent back to the pool
   */
  async release(subAgent: SubAgent): Promise<void> {
    const id = subAgent.getInfo().id

    if (!this.inUse.has(id)) {
      console.warn(`Attempting to release unknown agent: ${id}`)
      return
    }

    this.inUse.delete(id)
    this.available.push(subAgent)
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      maxAgents: this.maxAgents
    }
  }

  /**
   * Get info about all agents
   */
  getAllAgents(): SubAgentInfo[] {
    const agents: SubAgentInfo[] = []

    this.inUse.forEach(agent => {
      agents.push(agent.getInfo())
    })

    this.available.forEach(agent => {
      agents.push(agent.getInfo())
    })

    return agents
  }

  /**
   * Destroy all agents and cleanup
   */
  async destroy(): Promise<void> {
    // Abort all running agents
    this.inUse.forEach(agent => {
      agent.abort()
    })

    this.inUse.clear()
    this.available = []
  }

  /**
   * Create a new sub-agent
   */
  private async createAgent(): Promise<SubAgent> {
    const id = `sub-agent-${this.nextId++}`
    const config: ProviderConfig = {
      provider: this.provider.name as any,
      apiKey: this.providerConfig.apiKey,
      model: this.model,
      baseUrl: this.providerConfig.baseUrl
    }

    const baseAgent = this.provider.createAgent(config)

    return new SubAgent(id, baseAgent, this.model)
  }

  /**
   * Wait for an agent to become available
   */
  private async waitForAvailable(): Promise<SubAgent> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.available.length > 0) {
          clearInterval(checkInterval)
          const agent = this.available.pop()!
          this.inUse.set(agent.getInfo().id, agent)
          resolve(agent)
        }
      }, 100)
    })
  }
}
