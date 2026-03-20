/**
 * Skill Types - Skill 类型定义
 *
 * 用于从项目 SKILLs/ 目录加载 skill
 */

/**
 * Skill 元数据
 */
export interface SkillMetadata {
  name: string
  description: string
  tags?: string[]
  intents?: string[]
  examples?: string[]
  providers?: string[]
  requiredTools?: string[]
  version?: string
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
 * Skill 信息（完整）
 */
export interface SkillInfo {
  id: string
  name: string
  description: string
  source: 'project'
  path: string
  content: string  // SKILL.md 完整内容
  metadata: SkillMetadata
}

/**
 * SDK Settings 格式
 */
export interface SkillSetting {
  name: string
  content: string
}
