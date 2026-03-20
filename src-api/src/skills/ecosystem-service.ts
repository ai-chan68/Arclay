import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { SkillSourceConfig } from '../settings-store'
import { refreshSkillIndex } from './index-store'

const MAX_SKILL_FILES = 5000
const MAX_SKILL_TOTAL_BYTES = 200 * 1024 * 1024
const MAX_ARCHIVE_DOWNLOAD_BYTES = 300 * 1024 * 1024
const execFileAsync = promisify(execFile)

export interface SkillInstallResult {
  skillId: string
  name: string
  path: string
  sourceId: string
  action: 'installed' | 'updated' | 'repaired'
}

interface LocalSkillCandidate {
  name: string
  path: string
}

interface DirectoryStats {
  fileCount: number
  totalBytes: number
}

interface PreparedSource {
  rootPath: string
  cleanup: () => void
}

function getSkillsRoot(projectRoot: string): string {
  return path.resolve(projectRoot, 'SKILLs')
}

function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function assertPathInRoot(targetPath: string, rootPath: string): void {
  const resolvedTarget = path.resolve(targetPath)
  const resolvedRoot = path.resolve(rootPath)
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Path traversal detected')
  }
}

function resolveSourceLocation(location: string, projectRoot: string): string {
  const normalized = location.trim()
  if (!normalized) {
    throw new Error('Invalid source location')
  }
  if (path.isAbsolute(normalized)) {
    return path.resolve(normalized)
  }
  return path.resolve(projectRoot, normalized)
}

function normalizeArchiveEntry(entry: string): string {
  return entry.replace(/\\/g, '/').trim()
}

function assertSafeArchiveEntry(entry: string): void {
  if (!entry) return
  const normalized = normalizeArchiveEntry(entry)
  if (normalized.startsWith('/') || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`Unsafe archive entry detected: ${entry}`)
  }
}

function inferArchiveType(archivePath: string): 'zip' | 'tar' {
  const lower = archivePath.toLowerCase()
  if (lower.endsWith('.zip')) return 'zip'
  if (lower.endsWith('.tar') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar'
  throw new Error('Only .zip/.tar/.tar.gz/.tgz archives are supported for http source')
}

async function listArchiveEntries(archivePath: string, type: 'zip' | 'tar'): Promise<string[]> {
  try {
    if (type === 'zip') {
      const { stdout } = await execFileAsync('unzip', ['-Z1', archivePath], { maxBuffer: 20 * 1024 * 1024 })
      return stdout.split('\n').map((line) => line.trim()).filter(Boolean)
    }
    const { stdout } = await execFileAsync('tar', ['-tf', archivePath], { maxBuffer: 20 * 1024 * 1024 })
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new Error(type === 'zip'
        ? 'unzip command not found, cannot extract http zip source'
        : 'tar command not found, cannot extract http tar source')
    }
    throw error
  }
}

async function extractArchive(archivePath: string, extractDir: string, type: 'zip' | 'tar'): Promise<void> {
  ensureDirectory(extractDir)
  const entries = await listArchiveEntries(archivePath, type)
  for (const entry of entries) {
    assertSafeArchiveEntry(entry)
  }

  try {
    if (type === 'zip') {
      await execFileAsync('unzip', ['-q', archivePath, '-d', extractDir], { maxBuffer: 20 * 1024 * 1024 })
      return
    }
    await execFileAsync('tar', ['-xf', archivePath, '-C', extractDir], { maxBuffer: 20 * 1024 * 1024 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new Error(type === 'zip'
        ? 'unzip command not found, cannot extract http zip source'
        : 'tar command not found, cannot extract http tar source')
    }
    throw error
  }
}

async function downloadFileFromHttp(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download source archive: HTTP ${response.status}`)
  }
  if (!response.body) {
    throw new Error('Downloaded archive has empty body')
  }

  const contentLengthHeader = response.headers.get('content-length')
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0
  if (contentLength > MAX_ARCHIVE_DOWNLOAD_BYTES) {
    throw new Error(`Archive too large: ${contentLength} bytes`)
  }

  const writer = fs.createWriteStream(outputPath)
  let downloaded = 0

  try {
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      downloaded += value.byteLength
      if (downloaded > MAX_ARCHIVE_DOWNLOAD_BYTES) {
        throw new Error(`Archive too large: exceeds ${MAX_ARCHIVE_DOWNLOAD_BYTES} bytes`)
      }
      writer.write(Buffer.from(value))
    }
  } finally {
    writer.end()
  }
}

function resolvePreparedRoot(extractDir: string): string {
  if (!fs.existsSync(extractDir)) {
    throw new Error('Extract directory not found after archive extraction')
  }
  const entries = fs.readdirSync(extractDir, { withFileTypes: true })
    .filter((entry) => entry.name !== '__MACOSX')

  if (entries.length === 1 && entries[0].isDirectory()) {
    return path.join(extractDir, entries[0].name)
  }
  return extractDir
}

async function prepareSource(source: SkillSourceConfig, projectRoot: string): Promise<PreparedSource> {
  if (source.type === 'local') {
    const rootPath = resolveSourceLocation(source.location, projectRoot)
    return {
      rootPath,
      cleanup: () => undefined,
    }
  }

  if (source.type === 'git') {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'easywork-skill-git-'))
    try {
      const args = ['clone', '--depth', '1']
      if (source.branch) {
        args.push('--branch', source.branch)
      }
      args.push(source.location, tempRoot)
      await execFileAsync('git', args, { maxBuffer: 20 * 1024 * 1024 })
    } catch (error) {
      fs.rmSync(tempRoot, { recursive: true, force: true })
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new Error('git command not found, cannot install git source')
      }
      throw error
    }
    return {
      rootPath: tempRoot,
      cleanup: () => {
        fs.rmSync(tempRoot, { recursive: true, force: true })
      },
    }
  }

  if (source.type === 'http') {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'easywork-skill-http-'))
    const url = source.location.trim()
    if (!/^https?:\/\//i.test(url)) {
      fs.rmSync(tempRoot, { recursive: true, force: true })
      throw new Error('http source location must be an http(s) URL')
    }

    const urlPathname = new URL(url).pathname
    const fallbackName = 'skills-source.zip'
    const archiveName = path.basename(urlPathname) || fallbackName
    const archivePath = path.join(tempRoot, archiveName)
    const extractDir = path.join(tempRoot, 'extracted')
    try {
      await downloadFileFromHttp(url, archivePath)
      const type = inferArchiveType(archivePath)
      await extractArchive(archivePath, extractDir, type)
      const rootPath = resolvePreparedRoot(extractDir)
      return {
        rootPath,
        cleanup: () => {
          fs.rmSync(tempRoot, { recursive: true, force: true })
        },
      }
    } catch (error) {
      fs.rmSync(tempRoot, { recursive: true, force: true })
      throw error
    }
  }

  throw new Error(`Unsupported source type: ${source.type}`)
}

function scanDirectoryStats(dirPath: string): DirectoryStats {
  let fileCount = 0
  let totalBytes = 0

  const walk = (currentPath: string): void => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (!entry.isFile()) {
        continue
      }
      const stat = fs.statSync(fullPath)
      fileCount += 1
      totalBytes += stat.size
      if (fileCount > MAX_SKILL_FILES) {
        throw new Error(`Skill package too large: file count exceeds ${MAX_SKILL_FILES}`)
      }
      if (totalBytes > MAX_SKILL_TOTAL_BYTES) {
        throw new Error(`Skill package too large: size exceeds ${MAX_SKILL_TOTAL_BYTES} bytes`)
      }
    }
  }

  walk(dirPath)
  return { fileCount, totalBytes }
}

function collectLocalSkillCandidates(location: string): LocalSkillCandidate[] {
  const candidates: LocalSkillCandidate[] = []
  if (!fs.existsSync(location) || !fs.statSync(location).isDirectory()) {
    throw new Error(`Source location does not exist or is not a directory: ${location}`)
  }

  const directSkillMdPath = path.join(location, 'SKILL.md')
  if (fs.existsSync(directSkillMdPath)) {
    candidates.push({
      name: path.basename(location),
      path: location,
    })
    return candidates
  }

  const entries = fs.readdirSync(location, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const childSkillPath = path.join(location, entry.name)
    const childSkillMdPath = path.join(childSkillPath, 'SKILL.md')
    if (!fs.existsSync(childSkillMdPath)) {
      continue
    }
    candidates.push({
      name: entry.name,
      path: childSkillPath,
    })
  }

  if (candidates.length === 0) {
    throw new Error('No installable skills found in source location')
  }
  return candidates
}

function copySkillDirectory(sourcePath: string, targetPath: string): void {
  scanDirectoryStats(sourcePath)
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true })
  }
  fs.cpSync(sourcePath, targetPath, { recursive: true })
}

function getSkillDirectoryName(skillId: string): string {
  const parts = skillId.split(':')
  if (parts.length <= 1) {
    return skillId
  }
  return parts.slice(1).join(':')
}

function resolveSourceById(sources: SkillSourceConfig[], sourceId: string): SkillSourceConfig {
  const source = sources.find((item) => item.id === sourceId)
  if (!source) {
    throw new Error('Source not found')
  }
  if (!source.enabled) {
    throw new Error('Source is disabled')
  }
  if (!source.trusted) {
    throw new Error('Source is not trusted')
  }
  return source
}

function installCandidatesToProject(
  candidates: LocalSkillCandidate[],
  source: SkillSourceConfig,
  projectRoot: string,
  action: 'installed' | 'updated' | 'repaired'
): SkillInstallResult[] {
  const skillsRoot = getSkillsRoot(projectRoot)
  ensureDirectory(skillsRoot)

  const installed: SkillInstallResult[] = []
  for (const candidate of candidates) {
    const targetPath = path.resolve(skillsRoot, candidate.name)
    assertPathInRoot(targetPath, skillsRoot)
    copySkillDirectory(candidate.path, targetPath)
    installed.push({
      skillId: `project:${candidate.name}`,
      name: candidate.name,
      path: targetPath,
      sourceId: source.id,
      action,
    })
  }

  refreshSkillIndex(projectRoot)
  return installed
}

export async function installSkillFromSource(
  source: SkillSourceConfig,
  projectRoot: string,
  skillName?: string
): Promise<SkillInstallResult[]> {
  const prepared = await prepareSource(source, projectRoot)
  try {
    const candidates = collectLocalSkillCandidates(prepared.rootPath)
    const filtered = skillName
      ? candidates.filter((item) => item.name === skillName)
      : candidates

    if (filtered.length === 0) {
      throw new Error(skillName
        ? `Skill "${skillName}" not found in source`
        : 'No skill found for installation')
    }

    return installCandidatesToProject(filtered, source, projectRoot, 'installed')
  } finally {
    prepared.cleanup()
  }
}

function findCandidateBySkillId(
  source: SkillSourceConfig,
  rootPath: string,
  skillId: string
): LocalSkillCandidate | null {
  if (source.type !== 'local' && source.type !== 'git' && source.type !== 'http') {
    throw new Error(`Unsupported source type: ${source.type}`)
  }
  const skillDirName = getSkillDirectoryName(skillId)
  const candidates = collectLocalSkillCandidates(rootPath)
  return candidates.find((item) => item.name === skillDirName) || null
}

function syncSkillFromSourceCandidate(
  source: SkillSourceConfig,
  projectRoot: string,
  candidate: LocalSkillCandidate,
  action: 'updated' | 'repaired'
): SkillInstallResult {
  const skillsRoot = getSkillsRoot(projectRoot)
  ensureDirectory(skillsRoot)
  const targetPath = path.resolve(skillsRoot, candidate.name)
  assertPathInRoot(targetPath, skillsRoot)
  copySkillDirectory(candidate.path, targetPath)
  refreshSkillIndex(projectRoot)
  return {
    skillId: `project:${candidate.name}`,
    name: candidate.name,
    path: targetPath,
    sourceId: source.id,
    action,
  }
}

export async function updateSkillFromSources(
  skillId: string,
  sources: SkillSourceConfig[],
  projectRoot: string,
  preferredSourceId?: string
): Promise<SkillInstallResult> {
  const trustedSources = sources.filter((source) => source.trusted && source.enabled)
  if (trustedSources.length === 0) {
    throw new Error('No trusted and enabled sources available')
  }

  if (preferredSourceId) {
    const source = resolveSourceById(trustedSources, preferredSourceId)
    const prepared = await prepareSource(source, projectRoot)
    try {
      const candidate = findCandidateBySkillId(source, prepared.rootPath, skillId)
      if (!candidate) {
        throw new Error(`Skill "${skillId}" not found in source "${source.name}"`)
      }
      return syncSkillFromSourceCandidate(source, projectRoot, candidate, 'updated')
    } finally {
      prepared.cleanup()
    }
  }

  for (const source of trustedSources) {
    const prepared = await prepareSource(source, projectRoot)
    try {
      const candidate = findCandidateBySkillId(source, prepared.rootPath, skillId)
      if (!candidate) {
        continue
      }
      return syncSkillFromSourceCandidate(source, projectRoot, candidate, 'updated')
    } catch (error) {
      console.warn('[SkillEcosystem] Skip source for update:', source.id, error)
    } finally {
      prepared.cleanup()
    }
  }

  throw new Error(`No source can provide skill "${skillId}"`)
}

export async function repairSkillFromSources(
  skillId: string,
  sources: SkillSourceConfig[],
  projectRoot: string,
  preferredSourceId?: string
): Promise<SkillInstallResult> {
  const updated = await updateSkillFromSources(skillId, sources, projectRoot, preferredSourceId)
  return {
    ...updated,
    action: 'repaired',
  }
}

export function validateSourceForInstall(
  sources: SkillSourceConfig[],
  sourceId: string
): SkillSourceConfig {
  const source = resolveSourceById(sources, sourceId)
  if (!['local', 'git', 'http'].includes(source.type)) {
    throw new Error(`Unsupported source type: ${source.type}`)
  }
  return source
}
