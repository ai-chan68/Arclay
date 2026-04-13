import * as fs from 'fs'
import * as path from 'path'
import { createLogger } from '../shared/logger'

const log = createLogger('skill:source-binding')

const ARCLAY_DIR = '.arclay'
const SKILL_SOURCE_BINDINGS_FILE = 'skill-source-bindings.json'

interface SkillSourceBindingsData {
  version: number
  updatedAt: number
  bindings: Record<string, string>
}

function ensureArclayDir(projectRoot: string): string {
  const arclayDir = path.join(projectRoot, ARCLAY_DIR)
  if (!fs.existsSync(arclayDir)) {
    fs.mkdirSync(arclayDir, { recursive: true })
  }
  return arclayDir
}

function getBindingsFilePath(projectRoot: string): string {
  return path.join(ensureArclayDir(projectRoot), SKILL_SOURCE_BINDINGS_FILE)
}

export function loadSkillSourceBindings(projectRoot: string): Record<string, string> {
  const filePath = getBindingsFilePath(projectRoot)
  if (!fs.existsSync(filePath)) {
    return {}
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(content) as Partial<SkillSourceBindingsData>
    return parsed.bindings && typeof parsed.bindings === 'object'
      ? parsed.bindings as Record<string, string>
      : {}
  } catch (error) {
    log.error({ err: error }, 'Failed to load bindings')
    return {}
  }
}

function saveSkillSourceBindings(projectRoot: string, bindings: Record<string, string>): void {
  const filePath = getBindingsFilePath(projectRoot)
  const data: SkillSourceBindingsData = {
    version: 1,
    updatedAt: Date.now(),
    bindings,
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

export function setSkillSourceBindings(projectRoot: string, nextBindings: Record<string, string>): void {
  saveSkillSourceBindings(projectRoot, nextBindings)
}

export function upsertSkillSourceBindings(projectRoot: string, entries: Record<string, string>): void {
  const current = loadSkillSourceBindings(projectRoot)
  saveSkillSourceBindings(projectRoot, {
    ...current,
    ...entries,
  })
}

export function removeSkillSourceBinding(projectRoot: string, skillId: string): void {
  const current = loadSkillSourceBindings(projectRoot)
  if (!(skillId in current)) {
    return
  }
  delete current[skillId]
  saveSkillSourceBindings(projectRoot, current)
}
