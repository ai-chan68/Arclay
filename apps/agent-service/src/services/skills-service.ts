/**
 * Skills Service - 扫描和管理 Skills
 *
 * Skills 现在只从项目 SKILLs/ 目录加载
 * 不再从 ~/.claude/skills/ 加载
 *
 * 每个 Skill 是一个包含 SKILL.md 文件的目录
 */

import * as fs from 'fs'
import * as path from 'path'
import { parse as parseYaml } from 'yaml'

/**
 * Skill 元数据
 */
export interface SkillMetadata {
  name: string
  description: string
  license?: string
  compatibility?: string
  official?: boolean
  metadata?: {
    author?: string
    version?: string
    generatedBy?: string
  }
  [key: string]: unknown
}

/**
 * Skill 信息
 */
export interface SkillInfo {
  id: string
  name: string
  description: string
  source: 'project'
  path: string
  metadata?: SkillMetadata
  content?: string  // SKILL.md 完整内容
}

/**
 * 扫描指定目录下的所有 skills
 */
function scanSkillsDirectory(dirPath: string): SkillInfo[] {
  const skills: SkillInfo[] = []

  try {
    if (!fs.existsSync(dirPath)) {
      return skills
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const skillDir = path.join(dirPath, entry.name)
      const skillMdPath = path.join(skillDir, 'SKILL.md')

      if (!fs.existsSync(skillMdPath)) continue

      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8')
        const metadata = parseSkillMetadata(content)

        skills.push({
          id: `project:${entry.name}`,
          name: metadata.name || entry.name,
          description: metadata.description || '',
          source: 'project',
          path: skillDir,
          metadata,
          content,
        })
      } catch (err) {
        console.error(`[SkillsService] Failed to parse skill ${entry.name}:`, err)
        // 继续处理其他 skill
      }
    }
  } catch (err) {
    console.error(`[SkillsService] Failed to scan directory ${dirPath}:`, err)
  }

  return skills
}

/**
 * 解析 SKILL.md 文件的元数据
 */
function parseSkillMetadata(content: string): SkillMetadata {
  const result: SkillMetadata = {
    name: '',
    description: '',
  }

  // 检查是否有 YAML frontmatter
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)

  if (frontmatterMatch) {
    try {
      const yamlContent = frontmatterMatch[1]
      const parsed = parseYaml(yamlContent) as Record<string, unknown>

      if (parsed.name) result.name = String(parsed.name)
      if (parsed.description) result.description = String(parsed.description)
      if (parsed.license) result.license = String(parsed.license)
      if (parsed.compatibility) result.compatibility = String(parsed.compatibility)
      if (parsed.official) result.official = Boolean(parsed.official)
      if (parsed.metadata && typeof parsed.metadata === 'object') {
        result.metadata = parsed.metadata as SkillMetadata['metadata']
      }
    } catch (err) {
      console.error('[SkillsService] Failed to parse YAML frontmatter:', err)
    }
  }

  return result
}

/**
 * 获取项目 SKILLs/ 目录路径
 */
function getProjectSkillsDir(projectDir?: string): string {
  const baseDir = projectDir || process.env.EASYWORK_PROJECT_DIR || process.cwd()
  return path.join(baseDir, 'SKILLs')
}

/**
 * 获取所有已安装的 skills
 * 现在只从项目 SKILLs/ 目录加载
 */
export function getAllSkills(projectDir?: string): SkillInfo[] {
  const skillsDir = getProjectSkillsDir(projectDir)
  return scanSkillsDirectory(skillsDir)
}

/**
 * 获取 skills 统计信息
 */
export function getSkillsStats(projectDir?: string): {
  total: number
  project: number
} {
  const skills = getAllSkills(projectDir)
  return {
    total: skills.length,
    project: skills.length,
  }
}

/**
 * 获取 skills 作为 SDK settings 格式
 */
export function getSkillsAsSettings(projectDir?: string): { name: string; content: string }[] {
  const skills = getAllSkills(projectDir)
  return skills.map(skill => ({
    name: skill.name,
    content: skill.content || '',
  }))
}

/**
 * 导入 skill 到项目 SKILLs/ 目录
 */
export function importSkill(sourcePath: string, projectDir?: string): SkillInfo {
  const skillsDir = getProjectSkillsDir(projectDir)

  // 确保目标目录存在
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true })
  }

  // 获取 skill 名称
  const skillName = path.basename(sourcePath)
  const targetPath = path.join(skillsDir, skillName)

  // 检查是否已存在
  if (fs.existsSync(targetPath)) {
    throw new Error(`Skill "${skillName}" already exists`)
  }

  // 复制目录
  fs.cpSync(sourcePath, targetPath, { recursive: true })

  // 读取并返回 skill 信息
  const skillMdPath = path.join(targetPath, 'SKILL.md')
  const content = fs.readFileSync(skillMdPath, 'utf-8')
  const metadata = parseSkillMetadata(content)

  return {
    id: `project:${skillName}`,
    name: metadata.name || skillName,
    description: metadata.description || '',
    source: 'project',
    path: targetPath,
    metadata,
    content,
  }
}

/**
 * 删除 skill
 */
export function deleteSkill(skillId: string, projectDir?: string): void {
  const [source, ...nameParts] = skillId.split(':')
  const name = nameParts.join(':')

  if (!name || source !== 'project') {
    throw new Error('Invalid skill ID or cannot delete non-project skill')
  }

  const skillsDir = getProjectSkillsDir(projectDir)
  const skillPath = path.join(skillsDir, name)

  if (!fs.existsSync(skillPath)) {
    throw new Error('Skill not found')
  }

  fs.rmSync(skillPath, { recursive: true, force: true })
}
