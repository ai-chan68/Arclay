import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { TaskPlan } from '../../types/agent-new'
import type { TurnRecord } from '../../types/turn-runtime'
import { TurnDetailStore } from '../turn-detail-store'

describe('TurnDetailStore', () => {
  let tmpDir = ''
  let store: TurnDetailStore

  const turn: TurnRecord = {
    id: 'turn_1',
    taskId: 'task_1',
    runId: 'run_1',
    prompt: '分析项目',
    state: 'completed',
    readVersion: 0,
    writeVersion: 1,
    blockedByTurnIds: [],
    reason: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  const plan: TaskPlan = {
    goal: '分析项目并生成报告',
    steps: [
      { id: 'step_1', description: '读取代码', status: 'completed' },
      { id: 'step_2', description: '输出结论', status: 'completed' },
    ],
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-detail-store-'))
    store = new TurnDetailStore(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('persists a turn snapshot under the task turn directory', async () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-detail-artifacts-'))
    const pdfPath = path.join(sourceDir, 'report.pdf')
    fs.writeFileSync(pdfPath, 'pdf-bytes', 'utf-8')

    await store.saveTurnDetail({
      taskId: 'task_1',
      turn,
      summaryText: '输出了最终 PDF',
      planSnapshot: plan,
      outputText: '最终结论',
      artifacts: [
        {
          id: 'artifact_1',
          name: 'report.pdf',
          path: pdfPath,
          type: 'pdf',
          mimeType: 'application/pdf',
        },
      ],
    })

    const turnDir = path.join(tmpDir, 'sessions', 'task_1', 'turns', 'turn_1')
    expect(fs.existsSync(path.join(turnDir, 'turn.json'))).toBe(true)
    expect(fs.existsSync(path.join(turnDir, 'output.md'))).toBe(true)

    const saved = await store.loadTurnDetail('task_1', 'turn_1')
    expect(saved?.turn.id).toBe('turn_1')
    expect(saved?.summaryText).toBe('输出了最终 PDF')
    expect(saved?.output.text).toBe('最终结论')
    expect(saved?.output.artifacts.some((artifact) => artifact.name === 'evaluation.md')).toBe(true)
    expect(saved?.output.primaryArtifactId).toBe('artifact_1')
    const primaryArtifact = saved?.output.artifacts.find((artifact) => artifact.id === 'artifact_1')
    expect(primaryArtifact?.path).toBe(path.join(turnDir, 'artifacts', 'final', 'report.pdf'))
    expect(fs.existsSync(path.join(turnDir, 'artifacts', 'final', 'report.pdf'))).toBe(true)
    expect(fs.existsSync(path.join(turnDir, 'evaluation.md'))).toBe(true)
    expect(saved?.planSnapshot?.goal).toBe('分析项目并生成报告')

    fs.rmSync(sourceDir, { recursive: true, force: true })
  })

  it('promotes output-text final files over helper scripts and buckets helper files into scratch', async () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-detail-buckets-'))
    const finalPath = path.join(sourceDir, 'translated_all.md')
    const helperPath = path.join(sourceDir, 'merge_files.py')
    fs.writeFileSync(finalPath, '# translated', 'utf-8')
    fs.writeFileSync(helperPath, 'print("merge")', 'utf-8')

    await store.saveTurnDetail({
      taskId: 'task_1',
      turn,
      summaryText: '翻译完成',
      planSnapshot: plan,
      outputText: `最终文件已生成：${finalPath}`,
      artifacts: [
        {
          id: 'artifact_helper',
          name: 'merge_files.py',
          path: helperPath,
          type: 'text',
        },
      ],
    })

    const turnDir = path.join(tmpDir, 'sessions', 'task_1', 'turns', 'turn_1')
    const saved = await store.loadTurnDetail('task_1', 'turn_1')
    const finalArtifact = saved?.output.artifacts.find((artifact) => artifact.name === 'translated_all.md')
    const helperArtifact = saved?.output.artifacts.find((artifact) => artifact.id === 'artifact_helper')

    expect(saved?.output.primaryArtifactId).toBe('artifact-' + finalPath.replace(/[^a-zA-Z0-9]/g, '-'))
    expect(finalArtifact?.path).toBe(path.join(turnDir, 'artifacts', 'final', 'translated_all.md'))
    expect(helperArtifact?.path).toBe(path.join(turnDir, 'artifacts', 'scratch', 'merge_files.py'))
    expect(fs.existsSync(path.join(turnDir, 'artifacts', 'final', 'translated_all.md'))).toBe(true)
    expect(fs.existsSync(path.join(turnDir, 'artifacts', 'scratch', 'merge_files.py'))).toBe(true)

    fs.rmSync(sourceDir, { recursive: true, force: true })
  })

  it('returns null when the turn detail does not exist', async () => {
    await expect(store.loadTurnDetail('task_1', 'missing_turn')).resolves.toBeNull()
  })
})
