import { describe, expect, it } from 'vitest'
import {
  buildBundledClaudeCodeRetryOptions,
  getClaudeCodeRuntimeExecutable,
  getBundledClaudeSdkCliCandidatePaths,
  getClaudeSdkResolveBasePath,
  shouldRetryClaudeCodeSelfSpawn,
} from './claude'

describe('ClaudeAgent sidecar compatibility', () => {
  it('uses the current module filename when available', () => {
    expect(getClaudeSdkResolveBasePath('/snapshot/dist/api.cjs', '/tmp/runtime')).toBe(
      '/snapshot/dist/api.cjs'
    )
  })

  it('falls back to a synthetic absolute path when filename is unavailable', () => {
    expect(getClaudeSdkResolveBasePath('', '/repo')).toBe(
      '/repo/__arclay_claude_require__.cjs'
    )
  })

  it('includes the tauri macOS app resources path as a packaged cli candidate', () => {
    expect(
      getBundledClaudeSdkCliCandidatePaths(
        '/Applications/Arclay.app/Contents/MacOS/arclay-api-aarch64-apple-darwin'
      )
    ).toContain('/Applications/Arclay.app/Contents/Resources/resources/claude-agent-sdk/cli.js')
  })

  it('detects self-spawn ENOENT failures from packaged arclay-api binaries', () => {
    expect(
      shouldRetryClaudeCodeSelfSpawn(
        'Failed to spawn Claude Code process: spawn /Applications/Arclay.app/Contents/MacOS/arclay-api ENOENT'
      )
    ).toBe(true)
  })

  it('prefers node over the packaged arclay sidecar binary', () => {
    expect(
      getClaudeCodeRuntimeExecutable({
        currentExecPath: '/Applications/Arclay.app/Contents/MacOS/arclay-api',
        pathEnv: '/usr/bin:/opt/homebrew/bin:/bin',
        homeDir: '/Users/chanyun',
        exists: (candidate) => candidate === '/opt/homebrew/bin/node',
      })
    ).toBe('/opt/homebrew/bin/node')
  })

  it('still prefers node when bun appears earlier in PATH entries', () => {
    expect(
      getClaudeCodeRuntimeExecutable({
        currentExecPath: '/Applications/Arclay.app/Contents/MacOS/arclay-api',
        pathEnv: '/Users/chanyun/.bun/bin:/opt/homebrew/bin:/bin',
        homeDir: '/Users/chanyun',
        exists: (candidate) => [
          '/Users/chanyun/.bun/bin/bun',
          '/opt/homebrew/bin/node',
        ].includes(candidate),
      })
    ).toBe('/opt/homebrew/bin/node')
  })

  it('builds bundled retry options with a custom spawn override for absolute node runtime', () => {
    const result = buildBundledClaudeCodeRetryOptions({
      currentExecPath: '/Applications/Arclay.app/Contents/MacOS/arclay-api',
      pathEnv: '/usr/bin:/opt/homebrew/bin:/bin',
      homeDir: '/Users/chanyun',
      exists: (candidate) => [
        '/Applications/Arclay.app/Contents/Resources/resources/claude-agent-sdk/cli.js',
        '/opt/homebrew/bin/node',
      ].includes(candidate),
    })

    expect(result).toMatchObject({
      pathToClaudeCodeExecutable:
        '/Applications/Arclay.app/Contents/Resources/resources/claude-agent-sdk/cli.js',
      executable: 'node',
    })
    expect(typeof result?.spawnClaudeCodeProcess).toBe('function')
  })
})
