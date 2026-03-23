/**
 * Native sandbox provider implementation
 *
 * Executes commands directly on the local system.
 * WARNING: This provides no isolation - use only for trusted code.
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import type { SandboxResult, ExecuteOptions, SandboxFileInfo } from '@shared-types'
import type { ISandboxProvider } from '../interface'
import type { ProviderState } from '../../../shared/provider/types'
import type { SandboxCapabilities } from '../types'

/**
 * Native sandbox provider - executes directly on local system
 * All file operations are restricted to the workspace directory
 */
export class NativeSandboxProvider implements ISandboxProvider {
  readonly type = 'native' as const
  readonly name = 'native'
  private _state: ProviderState = 'uninitialized'
  private cwd: string

  constructor(workDir: string = process.cwd()) {
    this.cwd = path.resolve(workDir)
  }

  get state(): ProviderState {
    return this._state
  }

  async isAvailable(): Promise<boolean> {
    return true
  }

  async init(config?: Record<string, unknown>): Promise<void> {
    this._state = 'initializing'
    const workDir = typeof config?.workDir === 'string' ? config.workDir : undefined
    if (workDir) {
      this.cwd = path.resolve(workDir)
    }
    this._state = 'ready'
  }

  async stop(): Promise<void> {
    this._state = 'stopped'
  }

  async shutdown(): Promise<void> {
    this._state = 'stopped'
  }

  getCapabilities(): SandboxCapabilities {
    return {
      supportsStreaming: false,
      supportsToolCalling: false,
      supportsVision: false,
      supportsSystemPrompt: false,
      supportsSession: false,
      supportsFilesystem: true,
      supportsProcessIsolation: false,
      supportsFallback: true,
    }
  }

  /**
   * Validate that a path is within the sandbox directory
   * @param targetPath - The path to validate
   * @returns The resolved absolute path
   * @throws Error if path is outside the sandbox
   */
  private validatePath(targetPath: string): string {
    // Resolve the path relative to cwd
    const absolutePath = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(this.cwd, targetPath)

    // Ensure the path is within the sandbox directory
    const relativePath = path.relative(this.cwd, absolutePath)

    // Check for path traversal (..)
    if (relativePath.startsWith('..') || relativePath === '..') {
      throw new Error(
        `Access denied: Path "${targetPath}" is outside the workspace directory. ` +
        `All file operations must be within: ${this.cwd}`
      )
    }

    return absolutePath
  }

  /**
   * Execute a shell command
   */
  async execute(command: string, options?: ExecuteOptions): Promise<SandboxResult> {
    const cwd = options?.cwd ? path.resolve(this.cwd, options.cwd) : this.cwd
    const timeout = options?.timeout || 60000

    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let timedOut = false

      const proc = spawn('/bin/sh', ['-c', command], {
        cwd,
        env: { ...process.env, ...options?.env },
        detached: process.platform !== 'win32'
      })

      const timeoutId = setTimeout(() => {
        timedOut = true
        try {
          if (process.platform !== 'win32' && typeof proc.pid === 'number') {
            // Kill the whole process group so child processes (e.g. vite) do not keep stdio open.
            process.kill(-proc.pid, 'SIGKILL')
          } else {
            proc.kill('SIGKILL')
          }
        } catch {
          // Ignore kill race
        }
      }, timeout)

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code: number | null) => {
        clearTimeout(timeoutId)
        resolve({
          stdout,
          stderr: timedOut ? stderr + '\nExecution timed out' : stderr,
          exitCode: code ?? (timedOut ? 137 : 1),
          timedOut
        })
      })

      proc.on('error', (err: Error) => {
        clearTimeout(timeoutId)
        resolve({
          stdout,
          stderr: err.message,
          exitCode: 1,
          timedOut: false
        })
      })

      // Send input if provided
      if (options?.input) {
        proc.stdin?.write(options.input)
        proc.stdin?.end()
      }
    })
  }

  /**
   * Run a script file
   */
  async runScript(scriptPath: string, options?: ExecuteOptions): Promise<SandboxResult> {
    const absolutePath = path.resolve(this.cwd, scriptPath)
    return this.execute(`sh "${absolutePath}"`, options)
  }

  /**
   * Read a file
   */
  async readFile(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    const absolutePath = this.validatePath(filePath)
    return fs.readFile(absolutePath, encoding)
  }

  /**
   * Write a file
   */
  async writeFile(filePath: string, content: string, options?: { mode?: number }): Promise<void> {
    const absolutePath = this.validatePath(filePath)
    const dir = path.dirname(absolutePath)

    // Ensure directory exists (also validate the dir path)
    const validatedDir = this.validatePath(dir)
    await fs.mkdir(validatedDir, { recursive: true })

    await fs.writeFile(absolutePath, content, { mode: options?.mode })
  }

  /**
   * Append content to a file (creates file if it does not exist)
   */
  async appendFile(filePath: string, content: string): Promise<void> {
    const absolutePath = this.validatePath(filePath)
    const dir = path.dirname(absolutePath)
    const validatedDir = this.validatePath(dir)
    await fs.mkdir(validatedDir, { recursive: true })
    await fs.appendFile(absolutePath, content)
  }

  /**
   * List directory contents
   */
  async listDir(dirPath: string): Promise<SandboxFileInfo[]> {
    const absolutePath = this.validatePath(dirPath)
    const entries = await fs.readdir(absolutePath, { withFileTypes: true })

    const results: SandboxFileInfo[] = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(absolutePath, entry.name)
        let size: number | undefined
        let modifiedAt: number | undefined

        try {
          const stat = await fs.stat(fullPath)
          size = stat.size
          modifiedAt = stat.mtimeMs
        } catch {
          // Ignore stat errors
        }

        return {
          name: entry.name,
          path: path.relative(this.cwd, fullPath),
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
          size,
          modifiedAt
        }
      })
    )

    return results
  }

  /**
   * Check if file exists
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      const absolutePath = this.validatePath(filePath)
      await fs.access(absolutePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(filePath: string): Promise<void> {
    const absolutePath = this.validatePath(filePath)
    await fs.unlink(absolutePath)
  }

  /**
   * Create a directory
   */
  async createDir(dirPath: string, recursive: boolean = true): Promise<void> {
    const absolutePath = this.validatePath(dirPath)
    await fs.mkdir(absolutePath, { recursive })
  }

  /**
   * Get current working directory
   */
  async getCwd(): Promise<string> {
    return this.cwd
  }

  /**
   * Set working directory
   */
  async setCwd(dirPath: string): Promise<void> {
    const absolutePath = this.validatePath(dirPath)
    const stat = await fs.stat(absolutePath)
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${absolutePath}`)
    }
    this.cwd = absolutePath
  }

  /**
   * Get the sandbox root directory
   */
  getSandboxRoot(): string {
    return this.cwd
  }
}
