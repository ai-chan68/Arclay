import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('config runtime paths', () => {
  let originalArclayHome: string | undefined
  let originalPkg: unknown
  let tempArclayHome = ''

  beforeEach(() => {
    originalArclayHome = process.env.ARCLAY_HOME
    originalPkg = (process as NodeJS.Process & { pkg?: unknown }).pkg
    tempArclayHome = fs.mkdtempSync(path.join(os.tmpdir(), 'arclay-config-home-'))
    process.env.ARCLAY_HOME = tempArclayHome
    vi.resetModules()
  })

  afterEach(() => {
    if (originalArclayHome === undefined) {
      delete process.env.ARCLAY_HOME
    } else {
      process.env.ARCLAY_HOME = originalArclayHome
    }

    if (originalPkg === undefined) {
      delete (process as NodeJS.Process & { pkg?: unknown }).pkg
    } else {
      ;(process as NodeJS.Process & { pkg?: unknown }).pkg = originalPkg
    }

    vi.restoreAllMocks()

    if (tempArclayHome) {
      fs.rmSync(tempArclayHome, { recursive: true, force: true })
    }
  })

  it('uses ARCLAY_HOME/workspace for packaged runtimes without relying on cwd', async () => {
    ;(process as NodeJS.Process & { pkg?: unknown }).pkg = {}
    vi.spyOn(process, 'cwd').mockReturnValue('/')

    const { getWorkDir } = await import('../config')

    expect(getWorkDir()).toBe(path.join(tempArclayHome, 'workspace'))
  })

  it('uses ARCLAY_HOME as packaged project root when cwd is not meaningful', async () => {
    ;(process as NodeJS.Process & { pkg?: unknown }).pkg = {}
    vi.spyOn(process, 'cwd').mockReturnValue('/')

    const { getProjectRoot } = await import('../config')

    expect(getProjectRoot()).toBe(tempArclayHome)
  })
})
