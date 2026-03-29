import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listTaskSessionDocuments } from '../session-documents'

describe('session-documents', () => {
  let tmpDir = ''

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easywork-session-docs-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('lists session review and planning docs in stable order when they exist', async () => {
    const sessionDir = path.join(tmpDir, 'sessions', 'task_docs')
    fs.mkdirSync(sessionDir, { recursive: true })
    fs.writeFileSync(path.join(sessionDir, 'progress.md'), '# Progress', 'utf-8')
    fs.writeFileSync(path.join(sessionDir, 'task_plan.md'), '# Plan', 'utf-8')
    fs.writeFileSync(path.join(sessionDir, 'findings.md'), '# Findings', 'utf-8')

    const result = await listTaskSessionDocuments(tmpDir, 'task_docs')

    expect(result).toEqual([
      {
        id: 'session-doc-task-plan-md',
        name: 'task_plan.md',
        path: path.join(sessionDir, 'task_plan.md'),
        type: 'markdown',
      },
      {
        id: 'session-doc-findings-md',
        name: 'findings.md',
        path: path.join(sessionDir, 'findings.md'),
        type: 'markdown',
      },
      {
        id: 'session-doc-progress-md',
        name: 'progress.md',
        path: path.join(sessionDir, 'progress.md'),
        type: 'markdown',
      },
    ])
  })
})
