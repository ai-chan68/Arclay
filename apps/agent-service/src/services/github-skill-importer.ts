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

const execAsync = promisify(exec)

interface GitHubUrlInfo {
  owner: string
  repo: string
  branch: string
  skillPath: string
}

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
      }
    }

    // 不支持的 URL 格式
    return null
  } catch (err) {
    return null
  }
}

/**
 * 从 GitHub 下载 skill 到临时目录
 */
export async function downloadSkillFromGitHub(url: string): Promise<string> {
  const urlInfo = parseGitHubUrl(url)

  if (!urlInfo) {
    throw new Error('Invalid GitHub URL format')
  }

  const { owner, repo, branch, skillPath } = urlInfo

  // 创建临时目录
  const tmpDir = path.join('/tmp', `skill-${Date.now()}`)
  fs.mkdirSync(tmpDir, { recursive: true })

  try {
    const repoUrl = `https://github.com/${owner}/${repo}.git`

    if (skillPath === '') {
      // 仓库根目录 - 克隆整个仓库
      await execAsync(`git clone --depth=1 --branch ${branch} ${repoUrl} ${tmpDir}`)

      // 验证 SKILL.md 存在
      const skillMdPath = path.join(tmpDir, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) {
        throw new Error('SKILL.md not found in repository root')
      }

      return tmpDir
    } else {
      // 子目录 - 使用 sparse-checkout
      await execAsync(`git init`, { cwd: tmpDir })
      await execAsync(`git remote add origin ${repoUrl}`, { cwd: tmpDir })
      await execAsync(`git config core.sparseCheckout true`, { cwd: tmpDir })

      // 配置 sparse-checkout
      const sparseCheckoutPath = path.join(tmpDir, '.git', 'info', 'sparse-checkout')
      fs.writeFileSync(sparseCheckoutPath, `${skillPath}/*\n`)

      // 拉取指定分支
      await execAsync(`git pull --depth=1 origin ${branch}`, { cwd: tmpDir })

      // 验证 SKILL.md 存在
      const skillDir = path.join(tmpDir, skillPath)
      const skillMdPath = path.join(skillDir, 'SKILL.md')

      if (!fs.existsSync(skillMdPath)) {
        throw new Error('SKILL.md not found in the specified path')
      }

      return skillDir
    }
  } catch (err) {
    // 清理临时目录
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
    throw err
  }
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
