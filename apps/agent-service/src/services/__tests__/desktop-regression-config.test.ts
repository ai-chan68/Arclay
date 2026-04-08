import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '../../../../..')

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(path.join(repoRoot, relativePath), 'utf8')
  ) as T
}

function readText(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('desktop regression tooling', () => {
  it('defines root and agent-service test coverage/e2e scripts', () => {
    const rootPackage = readJson<{ scripts?: Record<string, string> }>('package.json')
    const apiPackage = readJson<{ scripts?: Record<string, string> }>('apps/agent-service/package.json')

    expect(rootPackage.scripts?.['test:e2e']).toBeTruthy()
    expect(rootPackage.scripts?.['test:coverage']).toBeTruthy()
    expect(apiPackage.scripts?.['test:coverage']).toBeTruthy()
  })

  it('commits Playwright desktop regression files', () => {
    expect(existsSync(path.join(repoRoot, 'e2e/playwright.config.ts'))).toBe(true)
    expect(existsSync(path.join(repoRoot, 'e2e/tests/app-startup.spec.ts'))).toBe(true)
    expect(existsSync(path.join(repoRoot, 'e2e/tests/task-lifecycle.spec.ts'))).toBe(true)
  })

  it('runs coverage and e2e stages from CI workflows', () => {
    const qualityWorkflow = readText('.github/workflows/quality-gates.yml')
    const buildWorkflow = readText('.github/workflows/build.yml')

    expect(qualityWorkflow).toContain('pnpm test:coverage')
    expect(qualityWorkflow).toContain('pnpm test:e2e')
    expect(qualityWorkflow).toContain('coverage')
    expect(buildWorkflow).toContain('uses: ./.github/workflows/quality-gates.yml')
  })
})
