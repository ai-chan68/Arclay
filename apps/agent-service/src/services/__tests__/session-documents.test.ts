import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listTaskSessionDocuments } from '../session-documents'

describe('session-documents', () => {
  let tmpDir = ''

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arclay-session-docs-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('lists task history as a session document', async () => {
    const sessionDir = path.join(tmpDir, 'sessions', 'task_docs')
    fs.mkdirSync(sessionDir, { recursive: true })
    const historyPath = path.join(sessionDir, 'history.jsonl')
    fs.writeFileSync(historyPath, '{"type":"done"}\n', 'utf-8')

    const result = await listTaskSessionDocuments(tmpDir, 'task_docs')

    expect(result.map((item) => item.name)).toContain('history.jsonl')
    expect(result[0]?.path).toBe(historyPath)
    expect(result[0]?.type).toBe('text')
  })

  it('includes planning documents when they exist in the session directory', async () => {
    const sessionDir = path.join(tmpDir, 'sessions', 'task_planning')
    fs.mkdirSync(sessionDir, { recursive: true })
    const planningFiles = ['task_plan.md', 'progress.md', 'findings.md']

    for (const filename of planningFiles) {
      fs.writeFileSync(path.join(sessionDir, filename), `# ${filename}`)
    }

    const result = await listTaskSessionDocuments(tmpDir, 'task_planning')
    const names = result.map((item) => item.name)

    for (const filename of planningFiles) {
      expect(names).toContain(filename)
    }
  })
})
