/**
 * Sandbox service - orchestrates sandbox providers
 */

import type { SandboxResult, ExecuteOptions, SandboxFileInfo } from '@shared-types'
import type { ISandboxProvider, SandboxConfig } from './interface'
import { getSandboxProvider } from '../../config'
import { initializeSandboxProviders } from './providers'
import { sandboxRegistry } from './registry'
import type { SandboxSelection } from './types'

/**
 * Sandbox service for managing code execution
 */
export class SandboxService {
  private provider: ISandboxProvider
  private config: SandboxConfig
  private selection: SandboxSelection

  private constructor(config: SandboxConfig, provider: ISandboxProvider, selection: SandboxSelection) {
    this.config = config
    this.provider = provider
    this.selection = selection
  }

  static async create(config: SandboxConfig, selection: SandboxSelection): Promise<SandboxService> {
    initializeSandboxProviders()
    const provider = await sandboxRegistry.create(config.provider, config)
    return new SandboxService(config, provider, selection)
  }

  /**
   * Execute a command in the sandbox
   */
  async execute(command: string, options?: ExecuteOptions): Promise<SandboxResult> {
    const mergedOptions: ExecuteOptions = {
      ...options,
      timeout: options?.timeout || this.config.timeout,
      env: { ...this.config.env, ...options?.env }
    }
    return this.provider.execute(command, mergedOptions)
  }

  /**
   * Run a script file
   */
  async runScript(scriptPath: string, options?: ExecuteOptions): Promise<SandboxResult> {
    return this.provider.runScript(scriptPath, options)
  }

  /**
   * Read a file
   */
  async readFile(path: string, encoding?: BufferEncoding | 'base64'): Promise<string> {
    if (encoding === 'base64') {
      // Read as buffer and convert to base64
      const { promises: fs } = await import('node:fs')
      const validatedPath = await this.validatePath(path)
      const fileBuffer = await fs.readFile(validatedPath)
      return fileBuffer.toString('base64')
    }
    return this.provider.readFile(path, encoding)
  }

  /**
   * Validate path is within workspace
   */
  private async validatePath(targetPath: string): Promise<string> {
    const path = await import('node:path')
    const cwd = await this.provider.getCwd()
    const absolutePath = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(cwd, targetPath)

    const relativePath = path.relative(cwd, absolutePath)
    if (relativePath.startsWith('..') || relativePath === '..') {
      throw new Error(`Access denied: Path "${targetPath}" is outside the workspace directory`)
    }
    return absolutePath
  }

  /**
   * Write a file
   */
  async writeFile(path: string, content: string, options?: { mode?: number }): Promise<void> {
    return this.provider.writeFile(path, content, options)
  }

  /**
   * List directory contents
   */
  async listDir(path: string): Promise<SandboxFileInfo[]> {
    return this.provider.listDir(path)
  }

  /**
   * Check if file exists
   */
  async exists(path: string): Promise<boolean> {
    return this.provider.exists(path)
  }

  /**
   * Delete a file
   */
  async deleteFile(path: string): Promise<void> {
    return this.provider.deleteFile(path)
  }

  /**
   * Create a directory
   */
  async createDir(path: string, recursive?: boolean): Promise<void> {
    return this.provider.createDir(path, recursive)
  }

  /**
   * Get current working directory
   */
  async getCwd(): Promise<string> {
    return this.provider.getCwd()
  }

  /**
   * Set working directory
   */
  async setCwd(path: string): Promise<void> {
    return this.provider.setCwd(path)
  }

  /**
   * Get the provider name
   */
  getProviderName(): string {
    return this.provider.name
  }

  /**
   * Get config
   */
  getConfig(): SandboxConfig {
    return { ...this.config }
  }

  getSelection(): SandboxSelection {
    return { ...this.selection }
  }
}

/**
 * Create a default sandbox service
 * Provider can be configured via SANDBOX_PROVIDER env var (native | claude | docker | e2b)
 * Defaults to 'native' if not specified or if the specified provider is not available
 */
export async function createSandboxService(workDir: string): Promise<SandboxService> {
  initializeSandboxProviders()
  const requestedProvider = getSandboxProvider()
  const selection = await sandboxRegistry.resolveWithFallback(requestedProvider, ['native'])
  const config: SandboxConfig = {
    provider: selection.selected,
    workDir,
    timeout: 60000,
  }
  const service = await SandboxService.create(config, selection)

  if (selection.fallbackFrom) {
    console.warn(
      `[SandboxService] Requested "${selection.requested}" unavailable, using "${selection.selected}"`
    )
  } else {
    console.log(`[SandboxService] Created ${selection.selected} sandbox provider`)
  }

  return service
}
