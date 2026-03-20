/**
 * Sandbox provider interface definitions
 */

import type { SandboxResult, ExecuteOptions, SandboxFileInfo } from '@shared-types'
import type { IProvider } from '../../shared/provider/types'
import type { SandboxCapabilities } from './types'

/**
 * Interface for sandbox provider implementations
 */
export interface ISandboxProvider extends IProvider {
  /**
   * Provider name identifier
   */
  readonly name: string

  /**
   * Execute a shell command
   */
  execute(command: string, options?: ExecuteOptions): Promise<SandboxResult>

  /**
   * Run a script file
   */
  runScript(scriptPath: string, options?: ExecuteOptions): Promise<SandboxResult>

  /**
   * Read a file
   */
  readFile(path: string, encoding?: BufferEncoding): Promise<string>

  /**
   * Write a file
   */
  writeFile(path: string, content: string, options?: { mode?: number }): Promise<void>

  /**
   * List directory contents
   */
  listDir(path: string): Promise<SandboxFileInfo[]>

  /**
   * Check if file exists
   */
  exists(path: string): Promise<boolean>

  /**
   * Delete a file
   */
  deleteFile(path: string): Promise<void>

  /**
   * Create a directory
   */
  createDir(path: string, recursive?: boolean): Promise<void>

  /**
   * Get current working directory
   */
  getCwd(): Promise<string>

  /**
   * Set working directory
   */
  setCwd(path: string): Promise<void>

  /**
   * Get sandbox capabilities
   */
  getCapabilities(): SandboxCapabilities
}

/**
 * Sandbox provider type
 */
export type SandboxProviderType = 'native' | 'claude' | 'docker' | 'e2b'

/**
 * Configuration for sandbox service
 */
export interface SandboxConfig {
  provider: SandboxProviderType
  workDir: string
  timeout?: number
  env?: Record<string, string>
}
