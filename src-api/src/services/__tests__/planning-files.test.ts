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

  it('creates planning files in the session work directory', async () => {
    const result = await bootstrapPlanningFiles({
      workDir: tmpDir,
      taskId: 'task_bootstrap',
      goal: 'Design an order management system',
      steps: ['Define domain model', 'Design APIs', 'Define test plan'],
      notes: 'Focus on reliability and auditability',
      originalPrompt: 'Help me design an order management system',
    })

    expect(result.error).toBeUndefined()
    expect(result.createdFiles.sort()).toEqual(['findings.md', 'progress.md', 'task_plan.md'])
    expect(result.sessionDir).toBe(path.join(tmpDir, 'sessions', 'task_bootstrap'))

    expect(fs.existsSync(path.join(result.sessionDir, 'task_plan.md'))).toBe(true)
    expect(fs.existsSync(path.join(result.sessionDir, 'findings.md'))).toBe(true)
    expect(fs.existsSync(path.join(result.sessionDir, 'progress.md'))).toBe(true)
  })

  it('keeps existing planning files unchanged for resume runs', async () => {
    const sessionDir = path.join(tmpDir, 'sessions', 'task_resume')
    fs.mkdirSync(sessionDir, { recursive: true })
    const existingTaskPlan = path.join(sessionDir, 'task_plan.md')
    fs.writeFileSync(existingTaskPlan, '# Existing task plan marker', 'utf-8')

    const result = await bootstrapPlanningFiles({
      workDir: tmpDir,
      taskId: 'task_resume',
      goal: 'Resume order management design',
      steps: ['Continue architecture review'],
      originalPrompt: 'Resume the previous task',
    })

    expect(result.error).toBeUndefined()
    expect(result.createdFiles.sort()).toEqual(['findings.md', 'progress.md'])
    expect(result.skippedFiles).toContain('task_plan.md')
    expect(fs.readFileSync(existingTaskPlan, 'utf-8')).toBe('# Existing task plan marker')
  })
})
