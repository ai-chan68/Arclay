import { getDefaultSkillRoutingSettings, normalizeSkillSettings, type SkillRoutingSettings, type SkillSettings } from '../settings-store'
import { getAllSkills } from './skill-scanner'
import { getSkillRuntimeEntry, loadSkillRuntime, refreshSkillIndex } from './index-store'

interface RouteSkillCandidate {
  skillId: string
  name: string
  path: string
  score: number
  keywordIntentScore: number
  metadataMatchScore: number
  historicalSuccessScore: number
  recencyScore: number
  reasons: string[]
}

export interface RoutedSkill extends RouteSkillCandidate {}

export interface RouteSkillsInput {
  prompt: string
  provider: string
  projectRoot: string
  skillsSettings?: SkillSettings
  includeExplain?: boolean
}

export interface RouteSkillsResult {
  routing: SkillRoutingSettings
  selected: RoutedSkill[]
  fallbackUsed: boolean
  candidateCount: number
  elapsedMs: number
  shouldApply: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

function normalizeText(input: string): string {
  return input.toLowerCase().trim()
}

function extractKeywords(prompt: string): string[] {
  const text = normalizeText(prompt)
  const parts = text.match(/[\p{L}\p{N}_-]+/gu) || []
  const keywords = new Set<string>()

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    if (trimmed.length >= 2) {
      keywords.add(trimmed)
      continue
    }
    if (/[\u4e00-\u9fff]/.test(trimmed)) {
      keywords.add(trimmed)
    }
  }

  return Array.from(keywords).slice(0, 16)
}

function keywordCoverage(keywords: string[], corpus: string[]): { score: number; matched: string[] } {
  if (keywords.length === 0 || corpus.length === 0) {
    return { score: 0, matched: [] }
  }
  const normalizedCorpus = corpus.map((item) => normalizeText(item)).filter(Boolean)
  if (normalizedCorpus.length === 0) {
    return { score: 0, matched: [] }
  }

  const matched: string[] = []
  for (const keyword of keywords) {
    if (normalizedCorpus.some((item) => item.includes(keyword))) {
      matched.push(keyword)
    }
  }

  return {
    score: matched.length / keywords.length,
    matched,
  }
}

function clampScore(score: number): number {
  if (score < 0) return 0
  if (score > 1) return 1
  return score
}

function isInteractiveInternalWebTask(prompt: string): boolean {
  const normalized = normalizeText(prompt)
  const hasInternalUrl = /https?:\/\/[^\s]*workspace\.example\.test/.test(normalized)
  const hasInteractiveVerb = /(点击|输入|填写|查询|按钮|表单|click|fill|type|submit|form|search)/.test(normalized)
  return hasInternalUrl && hasInteractiveVerb
}

function applyInteractiveWebSkillBias(
  prompt: string,
  candidate: RouteSkillCandidate
): RouteSkillCandidate {
  if (!isInteractiveInternalWebTask(prompt)) {
    return candidate
  }

  const normalizedName = normalizeText(candidate.name)
  const normalizedSkillId = normalizeText(candidate.skillId)
  const browserAutomation = /(playwright|browser|chrome-devtools|devtools)/.test(normalizedName) ||
    /(playwright|browser|chrome-devtools|devtools)/.test(normalizedSkillId)
  const genericWebSearch = normalizedName.includes('web-search') || normalizedSkillId.includes('web-search')

  if (browserAutomation) {
    return {
      ...candidate,
      score: clampScore(candidate.score + 0.35),
      reasons: [...candidate.reasons, '内部交互网页任务优先浏览器自动化'],
    }
  }

  if (genericWebSearch) {
    return {
      ...candidate,
      score: clampScore(candidate.score * 0.2),
      reasons: [...candidate.reasons, '内部交互网页任务不应优先使用通用 web-search'],
    }
  }

  return candidate
}

function resolveProviderSwitchKey(provider: string): 'claude' | 'codex' | 'gemini' {
  if (provider === 'claude') return 'claude'
  if (provider === 'gemini') return 'gemini'
  return 'codex'
}

function isSkillEnabled(
  skillId: string,
  provider: string,
  settings: SkillSettings
): boolean {
  if (!settings.enabled) return false
  const config = settings.skills?.[skillId]
  if (config?.enabled === false) {
    return false
  }
  const providerSwitch = resolveProviderSwitchKey(provider)
  const providerEnabled = config?.providers?.[providerSwitch]
  return providerEnabled !== false
}

export function filterEnabledSkills<T extends { id: string }>(
  skills: T[],
  provider: string,
  settings?: SkillSettings
): T[] {
  const normalizedSettings = normalizeSkillSettings(settings)
  return skills.filter((skill) => isSkillEnabled(skill.id, provider.toLowerCase(), normalizedSettings))
}

function getHistoricalSuccessScore(successCount: number, failureCount: number): number {
  const total = successCount + failureCount
  if (total === 0) {
    return 0.5
  }
  return successCount / total
}

function getRecencyScore(lastUsedAt: number): number {
  if (!lastUsedAt) return 0
  const ageDays = (Date.now() - lastUsedAt) / DAY_MS
  return clampScore(1 - (ageDays / 30))
}

export function routeSkillsForPrompt(input: RouteSkillsInput): RouteSkillsResult {
  const startTime = Date.now()
  const normalizedSettings = normalizeSkillSettings(input.skillsSettings)
  const provider = input.provider.toLowerCase()
  const routing = {
    ...getDefaultSkillRoutingSettings(),
    ...(normalizedSettings.routing || {}),
  }

  if (routing.mode === 'off') {
    return {
      routing,
      selected: [],
      fallbackUsed: false,
      candidateCount: 0,
      elapsedMs: Date.now() - startTime,
      shouldApply: false,
    }
  }

  const skills = getAllSkills(input.projectRoot)
  if (skills.length === 0) {
    return {
      routing,
      selected: [],
      fallbackUsed: false,
      candidateCount: 0,
      elapsedMs: Date.now() - startTime,
      shouldApply: routing.mode === 'auto',
    }
  }

  const enabledSkills = filterEnabledSkills(skills, provider, normalizedSettings)
  const enabledSkillIds = new Set(enabledSkills.map((skill) => skill.id))
  const skillMap = new Map(enabledSkills.map((skill) => [skill.id, skill]))
  const index = refreshSkillIndex(input.projectRoot)
  const runtime = loadSkillRuntime(input.projectRoot)
  const keywords = extractKeywords(input.prompt)

  const candidates: RouteSkillCandidate[] = []

  for (const entry of index.skills) {
    if (!enabledSkillIds.has(entry.skillId)) {
      continue
    }

    const skill = skillMap.get(entry.skillId)
    if (!skill) continue

    const keywordIntentCorpus = [
      entry.name,
      entry.description,
      ...entry.intents,
      ...entry.examples,
    ]
    const metadataCorpus = [
      entry.name,
      entry.description,
      ...entry.tags,
      ...entry.providerCompatibility,
    ]

    const keywordIntentMatch = keywordCoverage(keywords, keywordIntentCorpus)
    const metadataMatch = keywordCoverage(keywords, metadataCorpus)

    const runtimeEntry = getSkillRuntimeEntry(runtime, entry.skillId)
    const historicalSuccessScore = getHistoricalSuccessScore(
      runtimeEntry.successCount,
      runtimeEntry.failureCount
    )
    const recencyScore = getRecencyScore(runtimeEntry.lastUsedAt)

    let metadataMatchScore = metadataMatch.score
    const compatibility = entry.providerCompatibility.map((item) => item.toLowerCase())
    const providerDeclared = compatibility.length > 0
    const providerCompatible = !providerDeclared || compatibility.includes(provider)
    if (providerDeclared && providerCompatible) {
      metadataMatchScore = clampScore(metadataMatchScore + 0.2)
    } else if (providerDeclared && !providerCompatible) {
      metadataMatchScore = metadataMatchScore * 0.3
    }

    const finalScore = (
      keywordIntentMatch.score * 0.45 +
      metadataMatchScore * 0.25 +
      historicalSuccessScore * 0.2 +
      recencyScore * 0.1
    )

    const reasons: string[] = []
    if (keywordIntentMatch.matched.length > 0) {
      reasons.push(`关键词命中: ${keywordIntentMatch.matched.slice(0, 4).join(', ')}`)
    }
    if (entry.intents.length > 0) {
      reasons.push(`意图词: ${entry.intents.slice(0, 3).join(', ')}`)
    }
    const totalExec = runtimeEntry.successCount + runtimeEntry.failureCount
    if (totalExec > 0) {
      const successRate = Math.round((runtimeEntry.successCount / totalExec) * 100)
      reasons.push(`历史成功率: ${successRate}% (${totalExec} 次)`)
    }
    if (providerDeclared) {
      reasons.push(providerCompatible ? `兼容 Provider: ${provider}` : `未声明兼容 Provider: ${provider}`)
    }

    candidates.push(applyInteractiveWebSkillBias(input.prompt, {
      skillId: entry.skillId,
      name: entry.name,
      path: skill.path,
      score: clampScore(finalScore),
      keywordIntentScore: clampScore(keywordIntentMatch.score),
      metadataMatchScore: clampScore(metadataMatchScore),
      historicalSuccessScore: clampScore(historicalSuccessScore),
      recencyScore: clampScore(recencyScore),
      reasons,
    }))
  }

  candidates.sort((a, b) => b.score - a.score)
  const topN = Math.max(1, routing.topN || 3)
  const minScore = Math.max(0, Math.min(1, routing.minScore))

  let selected = candidates
    .filter((candidate) => candidate.score >= minScore)
    .slice(0, topN)

  let fallbackUsed = false
  if (selected.length === 0 && routing.fallback === 'all_enabled') {
    selected = candidates
    fallbackUsed = true
  }

  if (input.includeExplain === false || routing.includeExplain === false) {
    selected = selected.map((item) => ({ ...item, reasons: [] }))
  }

  return {
    routing,
    selected,
    fallbackUsed,
    candidateCount: candidates.length,
    elapsedMs: Date.now() - startTime,
    shouldApply: routing.mode === 'auto',
  }
}
