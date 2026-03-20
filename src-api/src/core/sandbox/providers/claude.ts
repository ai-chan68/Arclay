/**
 * Claude Sandbox Runtime provider implementation
 *
 * Uses @anthropic-ai/sandbox-runtime for process-level isolation.
 * Provides better security than native execution while maintaining performance.
 */

import { spawn, execSync } from 'node:child_process'
import { platform, homedir } from 'node:os'
import { existsSync } from 'node:fs'
import * as path from 'node:path'
import type { SandboxResult, ExecuteOptions, SandboxFileInfo } from '@shared-types'
import type { ISandboxProvider } from '../interface'
import type { ProviderState } from '../../../shared/provider/types'
import type { SandboxCapabilities } from '../types'

/**
 * Get the path to the srt (sandbox runtime) executable
 */
function getSrtPath(): string | undefined {
  const os = platform()

  try {
    if (os === 'win32') {
      const whereResult = execSync('where srt', {
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim()
      const firstPath = whereResult.split('\n')[0]
      if (firstPath && existsSync(firstPath)) {
        return firstPath
      }
    } else {
      const whichResult = execSync('which srt', {
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim()
      if (whichResult && existsSync(whichResult)) {
        return whichResult
      }
    }
  } catch {
    // Not found via which/where
  }

  // Check common install locations
  const commonPaths =
    os === 'win32'
      ? [path.join(homedir(), 'AppData', 'Roaming', 'npm', 'srt.cmd')]
      : [
          '/usr/local/bin/srt',
          path.join(homedir(), '.local', 'bin', 'srt'),
          path.join(homedir(), '.npm-global', 'bin', 'srt'),
        ]

  for (const p of commonPaths) {
    if (existsSync(p)) {
      return p
    }
  }

  // Check SRT_PATH env var
  if (process.env.SRT_PATH && existsSync(process.env.SRT_PATH)) {
    return process.env.SRT_PATH
  }

  return undefined
}

/**
 * Claude Sandbox Runtime provider
 * Executes commands through srt for process-level isolation
 */
export class ClaudeSandboxProvider implements ISandboxProvider {
  readonly type = 'claude' as const
  readonly name = 'claude'
  private _state: ProviderState = 'uninitialized'
  private srtPath: string | undefined
  private cwd: string

  constructor(workDir: string = process.cwd()) {
    this.cwd = path.resolve(workDir)
    this.srtPath = getSrtPath()

    if (!this.srtPath) {
      console.warn(
        '[ClaudeSandboxProvider] Sandbox Runtime not found. ' +
          'Install with: npm install -g @anthropic-ai/sandbox-runtime'
      )
    } else {
      console.log(`[ClaudeSandboxProvider] Using Sandbox Runtime at: ${this.srtPath}`)
    }
  }

  get state(): ProviderState {
    return this._state
  }

  /**
   * Check if sandbox runtime is available
   */
  async isAvailable(): Promise<boolean> {
    return this.srtPath !== undefined
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
    this._state = 'stopping'
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
      supportsProcessIsolation: true,
      supportsFallback: true,
    }
  }

  /**
   * Validate that a path is within the sandbox directory
   */
  private validatePath(targetPath: string): string {
    const absolutePath = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(this.cwd, targetPath)

    const relativePath = path.relative(this.cwd, absolutePath)

    if (relativePath.startsWith('..') || relativePath === '..') {
      throw new Error(
        `Access denied: Path "${targetPath}" is outside the workspace directory. ` +
          `All file operations must be within: ${this.cwd}`
      )
    }

    return absolutePath
  }

  /**
   * Execute a shell command through sandbox runtime
   */
  async execute(command: string, options?: ExecuteOptions): Promise<SandboxResult> {
    const startTime = Date.now()
    const cwd = options?.cwd ? path.resolve(this.cwd, options.cwd) : this.cwd
    const timeout = options?.timeout || 60000

    if (!this.srtPath) {
      return {
        stdout: '',
        stderr:
          'Sandbox Runtime is not installed. Install with: npm install -g @anthropic-ai/sandbox-runtime',
        exitCode: 1,
        timedOut: false,
      }
    }

    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let timedOut = false
      let forceKillTimer: NodeJS.Timeout | null = null

      // Check if command contains shell operators that need shell interpretation
      const needsShell = /[&|;<>]/.test(command) || command.includes(' ')

      let spawnArgs: string[]
      if (needsShell) {
        // Wrap command in sh -c for shell interpretation
        spawnArgs = ['run', '--', 'sh', '-c', command]
      } else {
        spawnArgs = ['run', '--', command]
      }

      const proc = spawn(this.srtPath!, spawnArgs, {
        cwd,
        env: { ...process.env, ...options?.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      const timeoutId = setTimeout(() => {
        timedOut = true
        proc.kill('SIGTERM')
        // Some child trees may ignore SIGTERM; force kill after a short grace period.
        forceKillTimer = setTimeout(() => {
          try {
            proc.kill('SIGKILL')
          } catch {
            // Ignore kill race
          }
        }, 2000)
      }, timeout)

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code: number | null) => {
        clearTimeout(timeoutId)
        if (forceKillTimer) {
          clearTimeout(forceKillTimer)
          forceKillTimer = null
        }
        resolve({
          stdout,
          stderr: timedOut ? stderr + '\nExecution timed out' : stderr,
          exitCode: code ?? (timedOut ? 137 : 1),
          timedOut,
        })
      })

      proc.on('error', (err: Error) => {
        clearTimeout(timeoutId)
        if (forceKillTimer) {
          clearTimeout(forceKillTimer)
          forceKillTimer = null
        }
        resolve({
          stdout,
          stderr: err.message,
          exitCode: 1,
          timedOut: false,
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
   * Run a script file through sandbox runtime
   */
  async runScript(scriptPath: string, options?: ExecuteOptions): Promise<SandboxResult> {
    const absolutePath = this.validatePath(scriptPath)
    const ext = path.extname(absolutePath).toLowerCase()

    // Determine runtime based on file extension
    let runtime: string
    if (ext === '.py') {
      runtime = 'python'
    } else if (ext === '.js') {
      runtime = 'node'
    } else if (ext === '.ts') {
      runtime = 'npx'
      // For TypeScript, we need to use tsx
      return this.execute(`npx tsx "${absolutePath}"`, options)
    } else {
      // Default to shell script
      runtime = 'sh'
    }

    return this.execute(`${runtime} "${absolutePath}"`, options)
  }

  /**
   * Read a file (direct filesystem access)
   * Note: sandbox-runtime isolates command execution, not file access
   */
  async readFile(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    const { promises: fs } = await import('node:fs')
    const absolutePath = this.validatePath(filePath)
    return fs.readFile(absolutePath, encoding)
  }

  /**
   * Write a file (direct filesystem access)
   */
  async writeFile(
    filePath: string,
    content: string,
    options?: { mode?: number }
  ): Promise<void> {
    const { promises: fs } = await import('node:fs')
    const absolutePath = this.validatePath(filePath)
    const dir = path.dirname(absolutePath)

    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(absolutePath, content, { mode: options?.mode })
  }

  /**
   * List directory contents
   */
  async listDir(dirPath: string): Promise<SandboxFileInfo[]> {
    const { promises: fs } = await import('node:fs')
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
          modifiedAt,
        }
      })
    )

    return results
  }

  /**
   * Check if file exists
   */
  async exists(filePath: string): Promise<boolean> {
    const { promises: fs } = await import('node:fs')
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
    const { promises: fs } = await import('node:fs')
    const absolutePath = this.validatePath(filePath)
    await fs.unlink(absolutePath)
  }

  /**
   * Create a directory
   */
  async createDir(dirPath: string, recursive: boolean = true): Promise<void> {
    const { promises: fs } = await import('node:fs')
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
    const { promises: fs } = await import('node:fs')
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
