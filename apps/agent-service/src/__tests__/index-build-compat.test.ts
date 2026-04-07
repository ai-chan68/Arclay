import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

describe('src-api entry build compatibility', () => {
  it('bundles the API entry as commonjs for the sidecar build', () => {
    const repoRoot = path.resolve(__dirname, '../../..')
    const outdir = mkdtempSync(path.join(tmpdir(), 'easywork-esbuild-'))
    const outfile = path.join(outdir, 'api.cjs')

    try {
      const result = spawnSync(
        'pnpm',
        [
          'exec',
          'esbuild',
          'src-api/src/index.ts',
          '--bundle',
          '--platform=node',
          '--target=node18',
          '--format=cjs',
          `--outfile=${outfile}`,
          '--external:deasync',
          '--tree-shaking=true',
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
        }
      )

      expect(result.status, result.stderr || result.stdout).toBe(0)
    } finally {
      rmSync(outdir, { recursive: true, force: true })
    }
  })
})
