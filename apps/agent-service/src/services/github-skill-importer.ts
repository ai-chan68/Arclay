/**
 * GitHub Skill Importer - 从 GitHub URL 导入 skill
 *
 * 支持的 URL 格式：
 * 1. https://github.com/user/repo - 仓库根目录（默认 main 分支）
 * 2. https://github.com/user/repo/tree/branch - 指定分支的根目录
 * 3. https://github.com/user/repo/tree/branch/path/to/skill - 子目录中的 skill
 * 4. https://github.com/user/repo/blob/branch/path/to/SKILL.md - 直接链接到 SKILL.md
 *
 * 示例：
 * - https://github.com/JimLiu/baoyu-skills
 * - https://github.com/user/repo/tree/main/skills/my-skill
 */

import * as fs from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { parseSkillMetadata } from './skills-service'

const execAsync = promisify(exec)

interface GitHubUrlInfo {
  owner: string
  repo: string
  branch: string
  skillPath: string
  branchExplicit: boolean
}

export interface GitHubSkillCandidate {
  name: string
  description: string
  path: string
  selected: boolean
}

export interface GitHubSkillAnalysis {
  owner: string
  repo: string
  branch: string
  mode: 'single' | 'multiple'
  skills: GitHubSkillCandidate[]
  analysisKey?: string
}

export interface DownloadedGitHubSkills {
  tempRoot: string
  skillDirs: string[]
}

interface GitHubTreeEntry {
  path: string
  type: 'blob' | 'tree'
}

interface CachedGitHubAnalysis {
  tempRoot: string
  expiresAt: number
}

const GITHUB_API_BASE = 'https://api.github.com'
const ANALYSIS_CACHE_TTL_MS = 10 * 60 * 1000
const analysisCache = new Map<string, CachedGitHubAnalysis>()

/**
 * 解析 GitHub URL
 *
 * 支持的格式：
 * 1. https://github.com/user/repo - 仓库根目录
 * 2. https://github.com/user/repo/tree/branch - 指定分支的根目录
 * 3. https://github.com/user/repo/tree/branch/path/to/skill - 子目录
 * 4. https://github.com/user/repo/blob/branch/path/to/SKILL.md - 单个文件
 */
export function parseGitHubUrl(url: string): GitHubUrlInfo | null {
  try {
    const urlObj = new URL(url)

    if (urlObj.hostname !== 'github.com') {
      return null
    }

    // 格式: /owner/repo[/tree|blob/branch[/path/to/skill]]
    const parts = urlObj.pathname.split('/').filter(Boolean)

    if (parts.length < 2) {
      return null
    }

    const [owner, repo, type, ...rest] = parts

    // Case 1: https://github.com/user/repo (仓库根目录，默认 main 分支)
    if (!type) {
      return {
        owner,
        repo,
        branch: 'main',
        skillPath: '',
        branchExplicit: false,
      }
    }

    // Case 2: https://github.com/user/repo/tree/branch[/path]
    // Case 3: https://github.com/user/repo/blob/branch/path/to/SKILL.md
    if (type === 'tree' || type === 'blob') {
      if (rest.length === 0) {
        return null // tree/blob 后面必须有 branch
      }

      const [branch, ...pathParts] = rest

      // 如果是 blob (单个文件)，去掉 SKILL.md，取目录路径
      let skillPath = pathParts.join('/')
      if (type === 'blob' && skillPath.endsWith('SKILL.md')) {
        skillPath = skillPath.replace(/\/SKILL\.md$/, '')
      }

      return {
        owner,
        repo,
        branch,
        skillPath,
        branchExplicit: true,
      }
    }

    // 不支持的 URL 格式
    return null
  } catch (err) {
    return null
  }
}

/**
 * 基于已下载的 GitHub 仓库内容识别 skill。
 */
export function inspectDownloadedGitHubRepo(repoDir: string, requestedPath: string): GitHubSkillAnalysis {
  const normalizedRequestedPath = normalizeRelativeRepoPath(requestedPath)
  const requestedDir = resolveRepoPath(repoDir, normalizedRequestedPath)

  if (!fs.existsSync(requestedDir) || !fs.statSync(requestedDir).isDirectory()) {
    throw new Error('Requested GitHub path does not exist')
  }

  const directSkillMdPath = path.join(requestedDir, 'SKILL.md')
  if (fs.existsSync(directSkillMdPath)) {
    return {
      owner: '',
      repo: '',
      branch: '',
      mode: 'single',
      skills: [readSkillCandidate(repoDir, normalizedRequestedPath || '.')],
    }
  }

  let skillCandidates: GitHubSkillCandidate[] = []

  if (!normalizedRequestedPath) {
    const rootSkillMdPath = path.join(repoDir, 'SKILL.md')
    if (fs.existsSync(rootSkillMdPath)) {
      skillCandidates = [readSkillCandidate(repoDir, '.')]
    } else {
      for (const skillRoot of ['skills', 'SKILLs']) {
        const skillRootDir = path.join(repoDir, skillRoot)
        if (!fs.existsSync(skillRootDir) || !fs.statSync(skillRootDir).isDirectory()) {
          continue
        }
        skillCandidates = collectSkillCandidates(repoDir, skillRoot)
        if (skillCandidates.length > 0) {
          break
        }
      }
    }
  } else {
    skillCandidates = collectSkillCandidates(repoDir, normalizedRequestedPath)
  }

  if (skillCandidates.length === 0) {
    throw new Error('No skills found in the GitHub repository')
  }

  return {
    owner: '',
    repo: '',
    branch: '',
    mode: skillCandidates.length === 1 ? 'single' : 'multiple',
    skills: skillCandidates,
  }
}

export function inspectGitHubTreeEntries(treeEntries: GitHubTreeEntry[], requestedPath: string): GitHubSkillAnalysis {
  const normalizedRequestedPath = normalizeRelativeRepoPath(requestedPath)
  const skillPaths = collectSkillPathsFromTree(treeEntries, normalizedRequestedPath)

  if (skillPaths.length === 0) {
    throw new Error('No skills found in the GitHub repository')
  }

  return {
    owner: '',
    repo: '',
    branch: '',
    mode: skillPaths.length === 1 ? 'single' : 'multiple',
    skills: skillPaths.map((skillPath) => ({
      name: skillPath === '.' ? 'root' : path.posix.basename(skillPath),
      description: '',
      path: skillPath,
      selected: true,
    })),
  }
}

export async function analyzeGitHubSkillSource(url: string): Promise<GitHubSkillAnalysis> {
  const urlInfo = parseGitHubUrl(url)

  if (!urlInfo) {
    throw new Error('Invalid GitHub URL format')
  }

  try {
    const branch = urlInfo.branchExplicit
      ? urlInfo.branch
      : await resolveGitHubDefaultBranch(urlInfo.owner, urlInfo.repo)
    const treeEntries = await fetchGitHubTreeEntries(urlInfo.owner, urlInfo.repo, branch)
    const treeAnalysis = inspectGitHubTreeEntries(treeEntries, urlInfo.skillPath)
    const skills = await hydrateGitHubSkillCandidates(urlInfo.owner, urlInfo.repo, branch, treeAnalysis.skills)

    return {
      owner: urlInfo.owner,
      repo: urlInfo.repo,
      branch,
      mode: treeAnalysis.mode,
      skills,
    }
  } catch (error) {
    const branch = urlInfo.branchExplicit
      ? urlInfo.branch
      : 'main'
    const tmpDir = await cloneGitHubRepo({ ...urlInfo, branch })

    try {
      const result = inspectDownloadedGitHubRepo(tmpDir, urlInfo.skillPath)
      const analysisKey = cacheDownloadedAnalysis(tmpDir)
      return {
        owner: urlInfo.owner,
        repo: urlInfo.repo,
        branch,
        mode: result.mode,
        skills: result.skills,
        analysisKey,
      }
    } catch (innerError) {
      cleanupTempDir(tmpDir)
      throw innerError
    }
  }
}

/**
 * 从 GitHub 下载选中的 skill 到临时目录。
 */
export async function downloadSkillsFromGitHub(
  url: string,
  selectedSkillPaths?: string[],
  analysisKey?: string,
): Promise<DownloadedGitHubSkills> {
  const urlInfo = parseGitHubUrl(url)

  if (!urlInfo) {
    throw new Error('Invalid GitHub URL format')
  }

  const cachedTempRoot = takeCachedAnalysisTempRoot(analysisKey)
  const tmpDir = cachedTempRoot ?? await cloneGitHubRepo(urlInfo)

  try {
    const analysis = inspectDownloadedGitHubRepo(tmpDir, urlInfo.skillPath)
    const requestedSkillPaths = selectedSkillPaths && selectedSkillPaths.length > 0
      ? selectedSkillPaths.map(normalizeRelativeRepoPath)
      : analysis.mode === 'single'
        ? analysis.skills.map((skill) => skill.path)
        : []

    if (requestedSkillPaths.length === 0) {
      throw new Error('Multiple skills found. Analyze the repository and choose which skills to import.')
    }

    const skillDirs = requestedSkillPaths.map((skillPath) => {
      const normalizedPath = normalizeRelativeRepoPath(skillPath)
      const skillDir = resolveRepoPath(tmpDir, normalizedPath)
      const skillMdPath = path.join(skillDir, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) {
        throw new Error(`SKILL.md not found in ${normalizedPath}`)
      }
      return skillDir
    })

    return {
      tempRoot: tmpDir,
      skillDirs,
    }
  } catch (err) {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
    throw err
  }
}

/**
 * 向后兼容：下载单个 skill。
 */
export async function downloadSkillFromGitHub(url: string): Promise<string> {
  const result = await downloadSkillsFromGitHub(url)
  return result.skillDirs[0]
}

/**
 * 清理临时目录
 */
export function cleanupTempDir(tmpPath: string): void {
  try {
    if (fs.existsSync(tmpPath)) {
      // 找到包含 .git 的根目录
      let currentPath = tmpPath
      while (currentPath !== '/' && currentPath !== '.') {
        const gitPath = path.join(currentPath, '.git')
        if (fs.existsSync(gitPath)) {
          fs.rmSync(currentPath, { recursive: true, force: true })
          return
        }
        currentPath = path.dirname(currentPath)
      }

      // 如果没找到 .git，直接删除指定路径
      fs.rmSync(tmpPath, { recursive: true, force: true })
    }
  } catch (err) {
    console.error('[GitHubSkillImporter] Failed to cleanup temp dir:', err)
  }
}

async function cloneGitHubRepo(urlInfo: GitHubUrlInfo): Promise<string> {
  const tmpDir = path.join('/tmp', `skill-${Date.now()}`)
  fs.mkdirSync(tmpDir, { recursive: true })
  const repoUrl = `https://github.com/${urlInfo.owner}/${urlInfo.repo}.git`
  const branchArg = urlInfo.branchExplicit ? ` --branch ${urlInfo.branch}` : ''
  await execAsync(`git clone --depth=1${branchArg} ${repoUrl} ${tmpDir}`)
  return tmpDir
}

function collectSkillCandidates(repoDir: string, baseRelativePath: string): GitHubSkillCandidate[] {
  const baseDir = resolveRepoPath(repoDir, baseRelativePath)
  if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) {
    return []
  }

  const directSkillMdPath = path.join(baseDir, 'SKILL.md')
  if (fs.existsSync(directSkillMdPath)) {
    return [readSkillCandidate(repoDir, baseRelativePath)]
  }

  const candidates: GitHubSkillCandidate[] = []
  const entries = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of entries) {
    const childRelativePath = normalizeRelativeRepoPath(path.posix.join(baseRelativePath.replace(/\\/g, '/'), entry.name))
    candidates.push(...collectSkillCandidates(repoDir, childRelativePath))
  }

  return candidates
}

function readSkillCandidate(repoDir: string, relativePath: string): GitHubSkillCandidate {
  const normalizedPath = normalizeRelativeRepoPath(relativePath)
  const skillDir = resolveRepoPath(repoDir, normalizedPath)
  const skillMdPath = path.join(skillDir, 'SKILL.md')
  const content = fs.readFileSync(skillMdPath, 'utf-8')
  const metadata = parseSkillMetadata(content)

  return {
    name: metadata.name || path.basename(skillDir),
    description: metadata.description || '',
    path: normalizedPath || '.',
    selected: true,
  }
}

function normalizeRelativeRepoPath(relativePath: string): string {
  if (!relativePath || relativePath === '.') {
    return ''
  }

  return relativePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

function resolveRepoPath(repoDir: string, relativePath: string): string {
  const resolvedPath = path.resolve(repoDir, relativePath || '.')
  if (resolvedPath !== repoDir && !resolvedPath.startsWith(`${repoDir}${path.sep}`)) {
    throw new Error('Invalid GitHub path')
  }
  return resolvedPath
}

function collectSkillPathsFromTree(treeEntries: GitHubTreeEntry[], requestedPath: string): string[] {
  const blobPaths = treeEntries
    .filter((entry) => entry.type === 'blob')
    .map((entry) => normalizeRelativeRepoPath(entry.path))

  const hasSkillFile = (relativePath: string) => blobPaths.includes(relativePath)
  const requestedSkillMd = normalizeRelativeRepoPath(path.posix.join(requestedPath || '.', 'SKILL.md'))

  if (requestedPath && hasSkillFile(requestedSkillMd)) {
    return [requestedPath]
  }

  if (!requestedPath && hasSkillFile('SKILL.md')) {
    return ['.']
  }

  const prefixes = requestedPath
    ? [normalizeTreePrefix(requestedPath)]
    : ['skills/', 'SKILLs/']

  const paths = new Set<string>()
  for (const blobPath of blobPaths) {
    if (!blobPath.endsWith('/SKILL.md')) {
      continue
    }
    if (!prefixes.some((prefix) => blobPath.startsWith(prefix))) {
      continue
    }
    paths.add(blobPath.replace(/\/SKILL\.md$/, ''))
  }

  return Array.from(paths).sort((left, right) => left.localeCompare(right))
}

function normalizeTreePrefix(relativePath: string): string {
  const normalizedPath = normalizeRelativeRepoPath(relativePath)
  return normalizedPath ? `${normalizedPath}/` : ''
}

async function resolveGitHubDefaultBranch(owner: string, repo: string): Promise<string> {
  const response = await githubFetchJson<{ default_branch?: string }>(`${GITHUB_API_BASE}/repos/${owner}/${repo}`)
  return response.default_branch || 'main'
}

async function fetchGitHubTreeEntries(owner: string, repo: string, branch: string): Promise<GitHubTreeEntry[]> {
  const response = await githubFetchJson<{ tree?: Array<{ path: string; type: 'blob' | 'tree' }> }>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  )
  return Array.isArray(response.tree)
    ? response.tree
      .filter((entry) => entry.type === 'blob' || entry.type === 'tree')
      .map((entry) => ({ path: entry.path, type: entry.type }))
    : []
}

async function hydrateGitHubSkillCandidates(
  owner: string,
  repo: string,
  branch: string,
  candidates: GitHubSkillCandidate[],
): Promise<GitHubSkillCandidate[]> {
  const hydrated = await Promise.all(candidates.map(async (candidate) => {
    const skillMdPath = candidate.path === '.'
      ? 'SKILL.md'
      : `${candidate.path}/SKILL.md`

    try {
      const content = await githubFetchText(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${skillMdPath}?ref=${encodeURIComponent(branch)}`
      )
      const metadata = parseSkillMetadata(content)
      return {
        ...candidate,
        name: metadata.name || candidate.name,
        description: metadata.description || candidate.description,
      }
    } catch {
      return candidate
    }
  }))

  return hydrated
}

async function githubFetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: buildGitHubHeaders(),
  })

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

async function githubFetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      ...buildGitHubHeaders(),
      Accept: 'application/vnd.github.raw+json',
    },
  })

  if (!response.ok) {
    throw new Error(`GitHub content request failed: ${response.status}`)
  }

  return response.text()
}

function buildGitHubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'arclay-skill-importer',
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

function cacheDownloadedAnalysis(tempRoot: string): string {
  clearExpiredAnalysisCache()
  const analysisKey = `analysis-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  analysisCache.set(analysisKey, {
    tempRoot,
    expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS,
  })
  return analysisKey
}

function takeCachedAnalysisTempRoot(analysisKey?: string): string | null {
  if (!analysisKey) {
    return null
  }

  clearExpiredAnalysisCache()
  const cached = analysisCache.get(analysisKey)
  if (!cached) {
    return null
  }

  analysisCache.delete(analysisKey)
  return cached.tempRoot
}

function clearExpiredAnalysisCache(): void {
  const now = Date.now()
  for (const [key, cached] of analysisCache.entries()) {
    if (cached.expiresAt <= now) {
      cleanupTempDir(cached.tempRoot)
      analysisCache.delete(key)
    }
  }
}
