/**
 * Sandbox execution types
 */

/**
 * Result of a sandbox command execution
 */
export interface SandboxResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut?: boolean
}

/**
 * Options for sandbox command execution
 */
export interface ExecuteOptions {
  cwd?: string
  env?: Record<string, string>
  timeout?: number
  input?: string
  signal?: AbortSignal
}

/**
 * File information from sandbox directory listing
 */
export interface FileInfo {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
  size?: number
  modifiedAt?: number
}

/**
 * Options for file read operation
 */
export interface ReadFileOptions {
  encoding?: 'ascii' | 'utf8' | 'utf-8' | 'utf16le' | 'ucs2' | 'ucs-2' | 'base64' | 'base64url' | 'latin1' | 'binary' | 'hex'
  startLine?: number
  endLine?: number
}

/**
 * Options for file write operation
 */
export interface WriteFileOptions {
  encoding?: 'ascii' | 'utf8' | 'utf-8' | 'utf16le' | 'ucs2' | 'ucs-2' | 'base64' | 'base64url' | 'latin1' | 'binary' | 'hex'
  mode?: number
  createDirectories?: boolean
}

/**
 * Options for file edit operation
 */
export interface EditFileOptions {
  createIfNotExists?: boolean
}
