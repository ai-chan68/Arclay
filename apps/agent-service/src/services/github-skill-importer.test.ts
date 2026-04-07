/**
 * GitHub Skill Importer Tests
 */

import { describe, it, expect } from 'vitest'
import { parseGitHubUrl } from './github-skill-importer'

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
      })
    })

    it('should return null for tree/blob without branch', () => {
      const url = 'https://github.com/user/repo/tree'
      const result = parseGitHubUrl(url)

      expect(result).toBeNull()
    })
  })
})
