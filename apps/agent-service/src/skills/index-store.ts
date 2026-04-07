import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { getAllSkills } from './skill-scanner'
import type { SkillInfo } from './types'

const EASYWORK_DIR = '.easywork'
const SKILL_INDEX_FILE = 'skill-index.json'
const SKILL_RUNTIME_FILE = 'skill-runtime.json'

export interface SkillIndexEntry {
  skillId: string
  name: string
  description: string
  tags: string[]
  intents: string[]
  examples: string[]
  providerCompatibility: string[]
  version: string
  sourceId: string
  checksum: string
  updatedAt: number
}

export interface SkillIndexData {
  version: number
  generatedAt: number
  skills: SkillIndexEntry[]
}

export interface SkillRuntimeEntry {
  skillId: string
  routeCount: number
  successCount: number
  failureCount: number
  lastUsedAt: number
  avgLatencyMs: number
  lastError?: string
}

export interface SkillRuntimeData {
  version: number
  updatedAt: number
  skills: Record<string, SkillRuntimeEntry>
}

export interface SkillExecutionOutcome {
  success: boolean
  latencyMs?: number
  error?: string
}

function ensureEaseworkDir(projectRoot: string): string {
  const easyworkDir = path.join(projectRoot, EASYWORK_DIR)
  if (!fs.existsSync(easyworkDir)) {
    fs.mkdirSync(easyworkDir, { recursive: true })
  }
  return easyworkDir
}

function getIndexFilePath(projectRoot: string): string {
  return path.join(ensureEaseworkDir(projectRoot), SKILL_INDEX_FILE)
}

function getRuntimeFilePath(projectRoot: string): string {
  return path.join(ensureEaseworkDir(projectRoot), SKILL_RUNTIME_FILE)
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content) as T
  } catch (error) {
    console.error(`[SkillIndexStore] Failed to read ${filePath}:`, error)
    return fallback
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input
    .map((item) => String(item).trim())
    .filter(Boolean)
}

function getSkillNameFromId(skillId: string): string {
  const parts = skillId.split(':')
  return parts.length > 1 ? parts.slice(1).join(':') : skillId
}

function buildIndexEntry(skill: SkillInfo): SkillIndexEntry {
  const checksum = crypto.createHash('sha256').update(skill.content || '').digest('hex')
  const stat = fs.statSync(skill.path)
  return {
    skillId: skill.id,
    name: skill.name,
    description: skill.description || '',
    tags: normalizeStringArray(skill.metadata?.tags),
    intents: normalizeStringArray(skill.metadata?.intents),
    examples: normalizeStringArray(skill.metadata?.examples),
    providerCompatibility: normalizeStringArray(skill.metadata?.providers),
    version: String(skill.metadata?.version || skill.metadata?.metadata?.version || '0.0.0'),
    sourceId: skill.source || 'project',
    checksum,
    updatedAt: Math.floor(stat.mtimeMs),
  }
}

export function refreshSkillIndex(projectRoot: string): SkillIndexData {
  const skills = getAllSkills(projectRoot)
  const data: SkillIndexData = {
    version: 1,
    generatedAt: Date.now(),
    skills: skills.map(buildIndexEntry),
  }
  writeJsonFile(getIndexFilePath(projectRoot), data)
  return data
}

export function loadSkillIndex(projectRoot: string): SkillIndexData {
  const fallback: SkillIndexData = {
    version: 1,
    generatedAt: 0,
    skills: [],
  }
  const filePath = getIndexFilePath(projectRoot)
  const data = readJsonFile<SkillIndexData>(filePath, fallback)
  if (!data.skills || data.skills.length === 0) {
    return refreshSkillIndex(projectRoot)
  }
  return data
}

export function loadSkillRuntime(projectRoot: string): SkillRuntimeData {
  const fallback: SkillRuntimeData = {
    version: 1,
    updatedAt: 0,
    skills: {},
  }
  return readJsonFile<SkillRuntimeData>(getRuntimeFilePath(projectRoot), fallback)
}

export function saveSkillRuntime(projectRoot: string, runtime: SkillRuntimeData): void {
  runtime.updatedAt = Date.now()
  writeJsonFile(getRuntimeFilePath(projectRoot), runtime)
}

function createDefaultRuntime(skillId: string): SkillRuntimeEntry {
  return {
    skillId,
    routeCount: 0,
    successCount: 0,
    failureCount: 0,
    lastUsedAt: 0,
    avgLatencyMs: 0,
  }
}

export function recordSkillRouteOutcomes(
  projectRoot: string,
  skillIds: string[],
  outcome: SkillExecutionOutcome
): void {
  if (!skillIds.length) return

  const runtime = loadSkillRuntime(projectRoot)
  const now = Date.now()

  for (const skillId of skillIds) {
    const existing = runtime.skills[skillId] || createDefaultRuntime(skillId)
    const previousExecCount = existing.successCount + existing.failureCount
    const nextExecCount = previousExecCount + 1
    const latencyMs = Math.max(0, Math.floor(outcome.latencyMs || 0))
    const nextAvgLatency = nextExecCount === 1
      ? latencyMs
      : ((existing.avgLatencyMs * previousExecCount) + latencyMs) / nextExecCount

    existing.routeCount += 1
    existing.lastUsedAt = now
    existing.avgLatencyMs = Math.round(nextAvgLatency)
    if (outcome.success) {
      existing.successCount += 1
      existing.lastError = undefined
    } else {
      existing.failureCount += 1
      existing.lastError = outcome.error || 'unknown_error'
    }

    runtime.skills[skillId] = existing
  }

  saveSkillRuntime(projectRoot, runtime)
}

export function getSkillRuntimeEntry(
  runtime: SkillRuntimeData,
  skillId: string
): SkillRuntimeEntry {
  return runtime.skills[skillId] || createDefaultRuntime(skillId)
}

export function resolveSkillPath(projectRoot: string, skillId: string): string {
  return path.join(projectRoot, 'SKILLs', getSkillNameFromId(skillId))
}
