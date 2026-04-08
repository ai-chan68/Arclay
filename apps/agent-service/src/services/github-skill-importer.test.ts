/**
 * GitHub Skill Importer Tests
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, it, expect } from 'vitest'
import { inspectDownloadedGitHubRepo, inspectGitHubTreeEntries, parseGitHubUrl } from './github-skill-importer'

describe('GitHub Skill Importer', () => {
  describe('parseGitHubUrl', () => {
    it('should parse repository root URL (defaults to main branch)', () => {
      const url = 'https://github.com/JimLiu/baoyu-skills'
      const result = parseGitHubUrl(url)

      expect(result).toEqual({
        owner: 'JimLiu',
        repo: 'baoyu-skills',
        branch: 'main',
        skillPath: '',
        branchExplicit: false,
      })
    })

    it('should parse tree URL with branch only', () => {
      const url = 'https://github.com/user/repo/tree/develop'
      const result = parseGitHubUrl(url)

      expect(result).toEqual({
        owner: 'user',
        repo: 'repo',
        branch: 'develop',
        skillPath: '',
        branchExplicit: true,
      })
    })

    it('should parse tree URL with path correctly', () => {
      const url = 'https://github.com/user/repo/tree/main/skills/my-skill'
      const result = parseGitHubUrl(url)

      expect(result).toEqual({
        owner: 'user',
        repo: 'repo',
        branch: 'main',
        skillPath: 'skills/my-skill',
        branchExplicit: true,
      })
    })

    it('should parse blob URL correctly', () => {
      const url = 'https://github.com/user/repo/blob/main/skills/my-skill/SKILL.md'
      const result = parseGitHubUrl(url)

      expect(result).toEqual({
        owner: 'user',
        repo: 'repo',
        branch: 'main',
        skillPath: 'skills/my-skill',
        branchExplicit: true,
      })
    })

    it('should return null for non-GitHub URL', () => {
      const url = 'https://gitlab.com/user/repo/tree/main/skills/my-skill'
      const result = parseGitHubUrl(url)

      expect(result).toBeNull()
    })

    it('should return null for invalid GitHub URL (missing repo)', () => {
      const url = 'https://github.com/user'
      const result = parseGitHubUrl(url)

      expect(result).toBeNull()
    })

    it('should return null for malformed URL', () => {
      const url = 'not-a-url'
      const result = parseGitHubUrl(url)

      expect(result).toBeNull()
    })

    it('should handle nested skill paths', () => {
      const url = 'https://github.com/user/repo/tree/main/path/to/nested/skills/my-skill'
      const result = parseGitHubUrl(url)

      expect(result).toEqual({
        owner: 'user',
        repo: 'repo',
        branch: 'main',
        skillPath: 'path/to/nested/skills/my-skill',
        branchExplicit: true,
      })
    })

    it('should return null for tree/blob without branch', () => {
      const url = 'https://github.com/user/repo/tree'
      const result = parseGitHubUrl(url)

      expect(result).toBeNull()
    })
  })

  describe('inspectDownloadedGitHubRepo', () => {
    function createRepo(structure: Record<string, string>): string {
      const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-skill-importer-'))
      for (const [relativePath, content] of Object.entries(structure)) {
        const filePath = path.join(repoDir, relativePath)
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        fs.writeFileSync(filePath, content)
      }
      return repoDir
    }

    it('returns a single skill when repository root contains SKILL.md', () => {
      const repoDir = createRepo({
        'SKILL.md': '---\nname: root-skill\ndescription: Root skill\n---\n',
      })

      const result = inspectDownloadedGitHubRepo(repoDir, '')

      expect(result.mode).toBe('single')
      expect(result.skills).toEqual([
        {
          name: 'root-skill',
          description: 'Root skill',
          path: '.',
          selected: true,
        },
      ])
    })

    it('returns multiple skills when repository root exposes a skills directory', () => {
      const repoDir = createRepo({
        'skills/alpha/SKILL.md': '---\nname: alpha\ndescription: Alpha skill\n---\n',
        'skills/beta/SKILL.md': '---\nname: beta\ndescription: Beta skill\n---\n',
      })

      const result = inspectDownloadedGitHubRepo(repoDir, '')

      expect(result.mode).toBe('multiple')
      expect(result.skills).toEqual([
        {
          name: 'alpha',
          description: 'Alpha skill',
          path: 'skills/alpha',
          selected: true,
        },
        {
          name: 'beta',
          description: 'Beta skill',
          path: 'skills/beta',
          selected: true,
        },
      ])
    })

    it('returns a single skill when the requested path points to a specific skill', () => {
      const repoDir = createRepo({
        'skills/alpha/SKILL.md': '---\nname: alpha\ndescription: Alpha skill\n---\n',
        'skills/beta/SKILL.md': '---\nname: beta\ndescription: Beta skill\n---\n',
      })

      const result = inspectDownloadedGitHubRepo(repoDir, 'skills/beta')

      expect(result.mode).toBe('single')
      expect(result.skills).toEqual([
        {
          name: 'beta',
          description: 'Beta skill',
          path: 'skills/beta',
          selected: true,
        },
      ])
    })

    it('returns multiple skills when the requested path points to a skill collection directory', () => {
      const repoDir = createRepo({
        'skills/alpha/SKILL.md': '---\nname: alpha\ndescription: Alpha skill\n---\n',
        'skills/beta/SKILL.md': '---\nname: beta\ndescription: Beta skill\n---\n',
      })

      const result = inspectDownloadedGitHubRepo(repoDir, 'skills')

      expect(result.mode).toBe('multiple')
      expect(result.skills.map((skill) => skill.path)).toEqual(['skills/alpha', 'skills/beta'])
    })

    it('throws when no skill can be discovered from the repository', () => {
      const repoDir = createRepo({
        'README.md': '# demo\n',
      })

      expect(() => inspectDownloadedGitHubRepo(repoDir, '')).toThrow(/no skills found/i)
    })
  })

  describe('inspectGitHubTreeEntries', () => {
    it('returns multiple skills from a repository tree without cloning', () => {
      const result = inspectGitHubTreeEntries([
        { path: 'README.md', type: 'blob' },
        { path: 'skills/alpha/SKILL.md', type: 'blob' },
        { path: 'skills/beta/SKILL.md', type: 'blob' },
      ], '')

      expect(result.mode).toBe('multiple')
      expect(result.skills.map((skill) => skill.path)).toEqual(['skills/alpha', 'skills/beta'])
    })

    it('returns a single skill when the requested tree path points at one skill', () => {
      const result = inspectGitHubTreeEntries([
        { path: 'skills/alpha/SKILL.md', type: 'blob' },
        { path: 'skills/beta/SKILL.md', type: 'blob' },
      ], 'skills/beta')

      expect(result.mode).toBe('single')
      expect(result.skills).toEqual([
        {
          name: 'beta',
          description: '',
          path: 'skills/beta',
          selected: true,
        },
      ])
    })

    it('returns the repository root skill when the tree contains root SKILL.md', () => {
      const result = inspectGitHubTreeEntries([
        { path: 'SKILL.md', type: 'blob' },
        { path: 'README.md', type: 'blob' },
      ], '')

      expect(result.mode).toBe('single')
      expect(result.skills).toEqual([
        {
          name: 'root',
          description: '',
          path: '.',
          selected: true,
        },
      ])
    })
  })
})
