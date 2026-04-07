import { access, copyFile, mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { isSessionDocumentFile } from '../../../src/shared/lib/file-utils'
import type { TaskPlan } from '../types/agent-new'
import type { TurnRecord } from '../types/turn-runtime'
import {
  resolveTurnArtifactsDir,
  resolveTurnHistoryPath,
  resolveTurnWorkspaceDir,
} from './workspace-layout'

export interface TurnDetailArtifactRecord {
  id: string
  name: string
  path: string
  type: string
  mimeType?: string
}

export interface StoredTurnDetail {
  taskId: string
  turn: TurnRecord
  summaryText: string | null
  planSnapshot: TaskPlan | null
  output: {
    textPath: string | null
    text: string | null
    artifacts: TurnDetailArtifactRecord[]
    primaryArtifactId: string | null
  }
  updatedAt: string
}

export interface SaveTurnDetailInput {
  taskId: string
  turn: TurnRecord
  summaryText?: string | null
  planSnapshot?: TaskPlan | null
  outputText?: string | null
  artifacts?: TurnDetailArtifactRecord[]
}

const TURN_DETAIL_FILENAME = 'turn.json'
const TURN_OUTPUT_FILENAME = 'output.md'
const TURN_EVALUATION_FILENAME = 'evaluation.md'

type ArtifactBucket = 'final' | 'intermediate' | 'scratch'

const SCRIPT_EXTENSIONS = new Set([
  '.py',
  '.sh',
  '.bash',
  '.zsh',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.rb',
  '.php',
])

const LOCAL_FILE_PATH_REGEX = /(?:^|[\s"'`:：])((?:\/|~\/|\.\/|\.\.\/|[A-Za-z]:[\\/])[^\s"'`<>]+?\.[a-zA-Z0-9]{1,12})(?=$|[\s"'`<>])/g

function normalizePathCandidate(raw: string): string {
  return raw.trim().replace(/^['"`]+|['"`]+$/g, '').replace(/[),.;:!?]+$/, '')
}

function detectArtifactType(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.webp') || lower.endsWith('.svg')) return 'image'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return 'csv'
  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.js') || lower.endsWith('.jsx')) return 'code'
  return 'text'
}

function dedupeArtifacts(artifacts: TurnDetailArtifactRecord[]): TurnDetailArtifactRecord[] {
  const seen = new Set<string>()
  return artifacts.filter((artifact) => {
    if (!artifact.path) return false
    const key = artifact.path.trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function basenameOf(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

function isSessionDocument(filePath: string): boolean {
  return isSessionDocumentFile(filePath)
}

function extractArtifactPathsFromText(text?: string | null): string[] {
  if (!text) return []
  const paths: string[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null

  while ((match = LOCAL_FILE_PATH_REGEX.exec(text)) !== null) {
    const normalized = normalizePathCandidate(match[1] || '')
    if (!normalized || isSessionDocument(normalized) || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    paths.push(normalized)
  }

  return paths
}

function mergeArtifactsWithOutputPaths(
  artifacts: TurnDetailArtifactRecord[],
  outputText?: string | null
): TurnDetailArtifactRecord[] {
  const merged = [...artifacts]
  const seen = new Set(artifacts.map((artifact) => artifact.path).filter((value): value is string => !!value))

  for (const filePath of extractArtifactPathsFromText(outputText)) {
    if (seen.has(filePath)) continue
    seen.add(filePath)
    merged.push({
      id: `artifact-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`,
      name: basenameOf(filePath),
      path: filePath,
      type: detectArtifactType(filePath),
      mimeType: filePath.toLowerCase().endsWith('.pdf') ? 'application/pdf' : undefined,
    })
  }

  return dedupeArtifacts(merged)
}

function looksLikeScratchArtifact(artifact: TurnDetailArtifactRecord): boolean {
  const name = (artifact.name || basenameOf(artifact.path || '')).toLowerCase()
  const ext = path.extname(name)

  if (SCRIPT_EXTENSIONS.has(ext)) return true
  if (artifact.type === 'code' || artifact.type === 'json' || artifact.type === 'text') {
    return /(?:^|[_-])(test|tmp|temp|helper|script|merge|list|fetch)(?:[_-]|$)/.test(name)
  }

  return false
}

function getPrimaryArtifactScore(
  artifact: TurnDetailArtifactRecord,
  outputText?: string | null
): number {
  const name = (artifact.name || basenameOf(artifact.path || '')).toLowerCase()
  const filePath = artifact.path || ''
  const normalizedOutput = (outputText || '').toLowerCase()
  let score = 0

  if (normalizedOutput) {
    if (filePath && normalizedOutput.includes(filePath.toLowerCase())) {
      score += 1000
    } else if (name && normalizedOutput.includes(name)) {
      score += 300
    }
  }

  if (/(?:^|[_-])(final|merged|export|deliverable|result|translated_all|report)(?:[_-]|\.|$)/.test(name)) {
    score += 250
  }

  switch (artifact.type) {
    case 'pdf':
      score += 220
      break
    case 'presentation':
      score += 200
      break
    case 'html':
      score += 180
      break
    case 'document':
      score += 170
      break
    case 'markdown':
      score += 160
      break
    case 'image':
      score += 140
      break
    case 'spreadsheet':
    case 'csv':
      score += 130
      break
    case 'json':
    case 'code':
      score += 30
      break
    case 'text':
      score += 10
      break
    default:
      break
  }

  if (looksLikeScratchArtifact(artifact)) {
    score -= 300
  }

  return score
}

function selectPrimaryArtifact(
  artifacts: TurnDetailArtifactRecord[],
  outputText?: string | null
): TurnDetailArtifactRecord | null {
  if (artifacts.length === 0) return null

  const candidates = artifacts.filter((artifact) => !isSessionDocument(artifact.path || artifact.name || ''))
  const pool = candidates.length > 0 ? candidates : artifacts

  return pool
    .map((artifact, index) => ({
      artifact,
      index,
      score: getPrimaryArtifactScore(artifact, outputText),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.artifact || null
}

function classifyArtifactBucket(
  artifact: TurnDetailArtifactRecord,
  primaryArtifactId: string | null
): ArtifactBucket {
  if (artifact.id === primaryArtifactId) {
    return 'final'
  }

  if (looksLikeScratchArtifact(artifact)) {
    return 'scratch'
  }

  return 'intermediate'
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function copyArtifactIfPresent(sourcePath: string, destinationPath: string): Promise<boolean> {
  if (!sourcePath || sourcePath === destinationPath) {
    return await pathExists(destinationPath)
  }

  if (!(await pathExists(sourcePath))) {
    return false
  }

  await mkdir(path.dirname(destinationPath), { recursive: true })
  await copyFile(sourcePath, destinationPath)
  return true
}

function renderTurnEvaluationContent(input: {
  taskId: string
  turn: TurnRecord
  planSnapshot?: TaskPlan | null
  outputText?: string | null
  primaryArtifact?: TurnDetailArtifactRecord | null
}): string {
  const promptLine = input.turn.prompt.trim()
  const goal = input.planSnapshot?.goal?.trim() || promptLine || '(unknown)'

  return `# Turn Evaluation

本文件用于评估当前 turn 的执行质量，重点区分执行路径与最终产物。

## Turn Context
- Task ID: ${input.taskId}
- Turn ID: ${input.turn.id}
- Goal: ${goal}
${promptLine ? `- Original request: ${promptLine}` : '- Original request: (none)'}
${input.primaryArtifact?.path ? `- Primary artifact candidate: ${input.primaryArtifact.path}` : '- Primary artifact candidate: (none)'}

## How To Evaluate
- 先分析执行路径，再分析最终产物
- 先抓 \`P0\`，再看 \`P1\`，最后记录 \`P2\`
- 结论要区分“结果完成”与“符合预期”

## Severity Guide

### P0
- 默认下载产物错误
- 最终交付物不存在、为空或不可打开
- turn / artifact / 输出状态互相矛盾
- 用户核心诉求未完成

### P1
- 执行路径长时间偏航，未及时切换策略
- 计划与执行不一致，缺少阶段性检查点
- \`task_plan.md\`、\`findings.md\`、\`progress.md\`、\`turn.json\` 状态不一致
- 单文件交付不自洽，明显依赖原仓库上下文
- 成本、耗时、工具调用数明显高于任务复杂度

### P2
- 残留截图、临时脚本或调试文件
- 最终说明文案略显冗余
- 缺少非核心优化项
- 未做逐条人工内容抽检

## Review Template

\`\`\`md
# Turn 评估

## 基本信息
- Turn: <turn-id>
- 任务目标: <user request>
- 最终结论: 通过 / 通过但低于预期 / 不通过

## 执行路径
### 符合预期
- <填写符合预期的执行点>

### 不符合预期
1. [P0|P1|P2] <问题标题>
   说明：<为什么不符合预期>
   证据：<file:line / artifact / log>

## 产物
### 符合预期
- <填写符合预期的产物点>

### 不符合预期
1. [P0|P1|P2] <问题标题>
   说明：<为什么不符合预期>
   证据：<file:line / artifact / log>

## 总评
- 核心诉求是否完成：是 / 否 / 部分完成
- 执行路径是否符合预期：是 / 否 / 部分符合
- 产物是否符合预期：是 / 否 / 部分符合
- 最终建议：通过 / 通过但低于预期 / 不通过
\`\`\`
`
}

export class TurnDetailStore {
  constructor(private readonly workDir: string) {}

  private turnDir(taskId: string, turnId: string): string {
    return resolveTurnWorkspaceDir(this.workDir, taskId, turnId)
  }

  private turnFilePath(taskId: string, turnId: string): string {
    return path.join(this.turnDir(taskId, turnId), TURN_DETAIL_FILENAME)
  }

  private outputFilePath(taskId: string, turnId: string): string {
    return path.join(this.turnDir(taskId, turnId), TURN_OUTPUT_FILENAME)
  }

  private evaluationFilePath(taskId: string, turnId: string): string {
    return path.join(this.turnDir(taskId, turnId), TURN_EVALUATION_FILENAME)
  }

  private async canonicalizeArtifacts(
    taskId: string,
    turnId: string,
    artifacts: TurnDetailArtifactRecord[],
    outputText?: string | null
  ): Promise<{
    artifacts: TurnDetailArtifactRecord[]
    primaryArtifact: TurnDetailArtifactRecord | null
  }> {
    const mergedArtifacts = mergeArtifactsWithOutputPaths(artifacts, outputText)
    const primarySourceArtifact = selectPrimaryArtifact(mergedArtifacts, outputText)
    const primaryArtifactId = primarySourceArtifact?.id || null
    const artifactsDir = resolveTurnArtifactsDir(this.workDir, taskId, turnId)
    const canonicalArtifacts: TurnDetailArtifactRecord[] = []

    for (const artifact of mergedArtifacts) {
      const bucket = classifyArtifactBucket(artifact, primaryArtifactId)
      const destinationPath = path.join(
        artifactsDir,
        bucket,
        artifact.name || basenameOf(artifact.path || artifact.id)
      )

      const copied = artifact.path
        ? await copyArtifactIfPresent(artifact.path, destinationPath)
        : false

      canonicalArtifacts.push({
        ...artifact,
        path: copied ? destinationPath : artifact.path,
      })
    }

    const canonicalPrimary = primaryArtifactId
      ? canonicalArtifacts.find((artifact) => artifact.id === primaryArtifactId) || null
      : null

    return {
      artifacts: dedupeArtifacts(canonicalArtifacts),
      primaryArtifact: canonicalPrimary,
    }
  }

  async saveTurnDetail(input: SaveTurnDetailInput): Promise<StoredTurnDetail> {
    const taskId = input.taskId.trim()
    const turnId = input.turn.id.trim()
    const turnDir = this.turnDir(taskId, turnId)
    const outputText = input.outputText?.trim() || null
    const artifacts = Array.isArray(input.artifacts) ? input.artifacts : []

    await mkdir(turnDir, { recursive: true })

    if (outputText) {
      await writeFile(this.outputFilePath(taskId, turnId), outputText + '\n', 'utf-8')
    }

    const canonicalized = await this.canonicalizeArtifacts(taskId, turnId, artifacts, outputText)
    const evaluationPath = this.evaluationFilePath(taskId, turnId)
    const evaluationContent = renderTurnEvaluationContent({
      taskId,
      turn: input.turn,
      planSnapshot: input.planSnapshot,
      outputText,
      primaryArtifact: canonicalized.primaryArtifact,
    })
    await writeFile(evaluationPath, evaluationContent, 'utf-8')

    const evaluationArtifact: TurnDetailArtifactRecord = {
      id: `session-doc-${TURN_EVALUATION_FILENAME.replace(/[^a-zA-Z0-9]/g, '-')}`,
      name: TURN_EVALUATION_FILENAME,
      path: evaluationPath,
      type: 'markdown',
    }

    const outputArtifacts: TurnDetailArtifactRecord[] = [
      ...canonicalized.artifacts,
      evaluationArtifact,
    ]

    const historyPath = resolveTurnHistoryPath(this.workDir, taskId, turnId)
    if (await pathExists(historyPath)) {
      outputArtifacts.push({
        id: 'turn-history-jsonl',
        name: 'history.jsonl',
        path: historyPath,
        type: 'text',
      })
    }

    const dedupedOutputArtifacts = dedupeArtifacts(outputArtifacts)

    const detail: StoredTurnDetail = {
      taskId,
      turn: input.turn,
      summaryText: input.summaryText?.trim() || null,
      planSnapshot: input.planSnapshot || null,
      output: {
        textPath: outputText ? this.outputFilePath(taskId, turnId) : null,
        text: outputText,
        artifacts: dedupedOutputArtifacts,
        primaryArtifactId: canonicalized.primaryArtifact?.id || null,
      },
      updatedAt: new Date().toISOString(),
    }

    await writeFile(
      this.turnFilePath(taskId, turnId),
      JSON.stringify(detail, null, 2),
      'utf-8'
    )

    return detail
  }

  async loadTurnDetail(taskId: string, turnId: string): Promise<StoredTurnDetail | null> {
    try {
      const raw = await readFile(this.turnFilePath(taskId, turnId), 'utf-8')
      return JSON.parse(raw) as StoredTurnDetail
    } catch {
      return null
    }
  }
}
