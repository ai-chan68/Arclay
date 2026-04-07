/**
 * Skill Scanner - 扫描项目 SKILLs/ 目录
 *
 * 从项目 SKILLs/ 目录加载 skill，替代 SDK 默认的 ~/.claude/skills/ 路径
 */

import * as fs from 'fs'
import * as path from 'path'
import { parse as parseYaml } from 'yaml'
import type { SkillInfo, SkillMetadata, SkillSetting } from './types'

/**
 * 扫描指定目录下的所有 skills
 * @param skillsDir SKILLs 目录路径
 * @returns SkillInfo 数组
 */
export function scanSkills(skillsDir: string): SkillInfo[] {
  const skills: SkillInfo[] = []

  if (!fs.existsSync(skillsDir)) {
    return skills
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const skillPath = path.join(skillsDir, entry.name)
    const skillMdPath = path.join(skillPath, 'SKILL.md')

    if (!fs.existsSync(skillMdPath)) continue

    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8')
      const metadata = parseSkillMetadata(content)

      skills.push({
        id: `project:${entry.name}`,
        name: metadata.name || entry.name,
        description: metadata.description || '',
        source: 'project',
        path: skillPath,
        content,
        metadata,
      })
    } catch (err) {
      console.error(`[SkillScanner] Failed to parse skill ${entry.name}:`, err)
      // 继续处理其他 skill
    }
  }

  return skills
}

/**
 * 解析 SKILL.md 文件的元数据（YAML frontmatter）
 * @param content SKILL.md 文件内容
 * @returns SkillMetadata
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
      if (Array.isArray(parsed.tags)) result.tags = parsed.tags.map(String)
      if (Array.isArray(parsed.intents)) result.intents = parsed.intents.map(String)
      if (Array.isArray(parsed.examples)) result.examples = parsed.examples.map(String)
      if (Array.isArray(parsed.providers)) result.providers = parsed.providers.map(String)
      if (Array.isArray(parsed.requiredTools)) result.requiredTools = parsed.requiredTools.map(String)
      if (parsed.version) result.version = String(parsed.version)
      if (parsed.license) result.license = String(parsed.license)
      if (parsed.compatibility) result.compatibility = String(parsed.compatibility)
      if (parsed.official) result.official = Boolean(parsed.official)
      if (parsed.metadata && typeof parsed.metadata === 'object') {
        result.metadata = parsed.metadata as SkillMetadata['metadata']
      }
    } catch (err) {
      console.error('[SkillScanner] Failed to parse YAML frontmatter:', err)
    }
  }

  return result
}

/**
 * 从项目目录加载 skills 并转换为 SDK settings 格式
 * @param projectDir 项目根目录
 * @returns SkillSetting 数组（用于 SDK settings 参数）
 */
export function loadSkillsAsSettings(projectDir: string): SkillSetting[] {
  const skillsDir = path.join(projectDir, 'SKILLs')
  const skills = scanSkills(skillsDir)

  return skills.map((skill) => ({
    name: skill.name,
    content: skill.content,
  }))
}

/**
 * 获取所有 skills（用于 API 返回）
 * @param projectDir 项目根目录
 * @returns SkillInfo 数组
 */
export function getAllSkills(projectDir: string): SkillInfo[] {
  const skillsDir = path.join(projectDir, 'SKILLs')
  return scanSkills(skillsDir)
}

/**
 * 获取 skill 统计信息
 * @param projectDir 项目根目录
 */
export function getSkillsStats(projectDir: string): {
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
 * 同步 skills 到项目 .claude/skills/ 目录
 *
 * 将 SKILLs/ 目录下的 skills 复制到 .claude/skills/，
 * 让 SDK 通过 'project' source 加载
 *
 * @param projectDir 项目根目录
 * @returns 同步的 skill 数量
 */
export function syncSkillsToProjectClaudeDir(projectDir: string): number {
  const sourceDir = path.join(projectDir, 'SKILLs')
  const targetDir = path.join(projectDir, '.claude', 'skills')

  // 如果源目录不存在，清空目标目录
  if (!fs.existsSync(sourceDir)) {
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true })
    }
    return 0
  }

  // 确保目标目录存在
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  // 读取源目录和目标目录的内容
  const sourceSkills = fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)

  const targetSkills = fs.existsSync(targetDir)
    ? fs.readdirSync(targetDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    : []

  // 删除目标目录中不再存在的 skills
  for (const skillName of targetSkills) {
    if (!sourceSkills.includes(skillName)) {
      const skillPath = path.join(targetDir, skillName)
      fs.rmSync(skillPath, { recursive: true, force: true })
      console.log(`[SkillScanner] Removed skill: ${skillName}`)
    }
  }

  // 复制新的或更新的 skills
  let syncedCount = 0
  for (const skillName of sourceSkills) {
    const sourceSkillPath = path.join(sourceDir, skillName)
    const targetSkillPath = path.join(targetDir, skillName)
    const sourceSkillMd = path.join(sourceSkillPath, 'SKILL.md')

    // 确保 SKILL.md 存在
    if (!fs.existsSync(sourceSkillMd)) {
      continue
    }

    // 检查是否需要更新（简单比较修改时间）
    let needUpdate = false
    if (!fs.existsSync(targetSkillPath)) {
      needUpdate = true
    } else {
      const sourceStat = fs.statSync(sourceSkillMd)
      const targetSkillMd = path.join(targetSkillPath, 'SKILL.md')
      if (!fs.existsSync(targetSkillMd)) {
        needUpdate = true
      } else {
        const targetStat = fs.statSync(targetSkillMd)
        if (sourceStat.mtime > targetStat.mtime) {
          needUpdate = true
        }
      }
    }

    if (needUpdate) {
      // 删除旧目录（如果存在）
      if (fs.existsSync(targetSkillPath)) {
        fs.rmSync(targetSkillPath, { recursive: true, force: true })
      }
      // 复制新目录
      fs.cpSync(sourceSkillPath, targetSkillPath, { recursive: true })
      console.log(`[SkillScanner] Synced skill: ${skillName}`)
      syncedCount++
    }
  }

  return syncedCount
}
