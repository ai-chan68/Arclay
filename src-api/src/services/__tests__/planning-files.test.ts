import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bootstrapPlanningFiles } from '../planning-files'

describe('planning-files bootstrap', () => {
  let tmpDir = ''

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easywork-planning-files-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('bootstraps only workspace directories after markdown retirement', async () => {
    const result = await bootstrapPlanningFiles({
      workDir: tmpDir,
      taskId: 'task_history_only',
      goal: 'collect history',
      steps: ['write turn history'],
    })

    expect(result.error).toBeUndefined()
    expect(result.createdFiles).toEqual([])
    expect(result.sessionDir).toBe(path.join(tmpDir, 'sessions', 'task_history_only'))

    expect(fs.existsSync(path.join(result.sessionDir, 'task_plan.md'))).toBe(false)
    expect(fs.existsSync(path.join(result.sessionDir, 'progress.md'))).toBe(false)
    expect(fs.existsSync(path.join(result.sessionDir, 'findings.md'))).toBe(false)
    expect(fs.existsSync(path.join(result.sessionDir, 'turns'))).toBe(true)
    expect(fs.existsSync(path.join(result.sessionDir, 'runs'))).toBe(true)
    expect(fs.existsSync(path.join(result.sessionDir, 'inputs'))).toBe(true)
  })

  it('is idempotent on resume runs without markdown files', async () => {
    const result1 = await bootstrapPlanningFiles({
      workDir: tmpDir,
      taskId: 'task_resume',
      goal: 'Resume order management design',
      steps: ['Continue architecture review'],
      originalPrompt: 'Resume the previous task',
    })
    const result2 = await bootstrapPlanningFiles({
      workDir: tmpDir,
      taskId: 'task_resume',
      goal: 'Resume order management design',
      steps: ['Continue architecture review'],
      originalPrompt: 'Resume the previous task',
    })

    expect(result1.error).toBeUndefined()
    expect(result2.error).toBeUndefined()
    expect(result2.createdFiles).toEqual([])
  })
})
