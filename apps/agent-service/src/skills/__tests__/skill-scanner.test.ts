import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { tmpdir } from 'os'
import {
  scanSkills,
  loadSkillsAsSettings,
  getAllSkills,
  getSkillsStats,
  syncSkillsToProjectClaudeDir,
} from '../skill-scanner'

describe('skill-scanner', () => {
  let testDir: string

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(tmpdir(), 'skill-scanner-test-'))
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('scanSkills', () => {
    it('should return empty array if directory does not exist', () => {
      const result = scanSkills(path.join(testDir, 'nonexistent'))
      expect(result).toEqual([])
    })

    it('should scan skills with SKILL.md files', () => {
      const skillsDir = path.join(testDir, 'SKILLs')
      const skill1Dir = path.join(skillsDir, 'test-skill-1')
      fs.mkdirSync(skill1Dir, { recursive: true })
      fs.writeFileSync(
        path.join(skill1Dir, 'SKILL.md'),
        '---\nname: Test Skill 1\ndescription: A test skill\n---\n\nSkill content'
      )

      const result = scanSkills(skillsDir)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('project:test-skill-1')
      expect(result[0].name).toBe('Test Skill 1')
      expect(result[0].description).toBe('A test skill')
      expect(result[0].source).toBe('project')
    })

    it('should skip directories without SKILL.md', () => {
      const skillsDir = path.join(testDir, 'SKILLs')
      const skill1Dir = path.join(skillsDir, 'with-skill')
      const skill2Dir = path.join(skillsDir, 'without-skill')
      fs.mkdirSync(skill1Dir, { recursive: true })
      fs.mkdirSync(skill2Dir, { recursive: true })
      fs.writeFileSync(path.join(skill1Dir, 'SKILL.md'), 'Content')

      const result = scanSkills(skillsDir)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('project:with-skill')
    })

    it('should parse YAML frontmatter with all fields', () => {
      const skillsDir = path.join(testDir, 'SKILLs')
      const skillDir = path.join(skillsDir, 'full-skill')
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        `---
name: Full Skill
description: Complete skill
tags: [tag1, tag2]
intents: [intent1]
examples: [example1]
providers: [claude]
requiredTools: [bash]
version: 1.0.0
license: MIT
compatibility: all
official: true
metadata:
  key: value
---

Content`
      )

      const result = scanSkills(skillsDir)
      expect(result).toHaveLength(1)
      expect(result[0].metadata.tags).toEqual(['tag1', 'tag2'])
      expect(result[0].metadata.intents).toEqual(['intent1'])
      expect(result[0].metadata.version).toBe('1.0.0')
      expect(result[0].metadata.official).toBe(true)
    })

    it('should handle skills without frontmatter', () => {
      const skillsDir = path.join(testDir, 'SKILLs')
      const skillDir = path.join(skillsDir, 'no-frontmatter')
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'Just content')

      const result = scanSkills(skillsDir)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('no-frontmatter')
      expect(result[0].description).toBe('')
    })

    it('should skip non-directory entries', () => {
      const skillsDir = path.join(testDir, 'SKILLs')
      fs.mkdirSync(skillsDir, { recursive: true })
      fs.writeFileSync(path.join(skillsDir, 'README.md'), 'Not a skill')

      const result = scanSkills(skillsDir)
      expect(result).toEqual([])
    })

    it('should handle invalid YAML gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const skillsDir = path.join(testDir, 'SKILLs')
      const skillDir = path.join(skillsDir, 'bad-yaml')
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\ninvalid: yaml: content:\n---\nContent'
      )

      const result = scanSkills(skillsDir)
      expect(result).toHaveLength(1)
      expect(consoleErrorSpy).toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })
  })

  describe('loadSkillsAsSettings', () => {
    it('should return empty array if no skills', () => {
      const result = loadSkillsAsSettings(testDir)
      expect(result).toEqual([])
    })

    it('should convert skills to settings format', () => {
      const skillsDir = path.join(testDir, 'SKILLs')
      const skillDir = path.join(skillsDir, 'test-skill')
      fs.mkdirSync(skillDir, { recursive: true })
      const content = '---\nname: Test\n---\nContent'
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content)

      const result = loadSkillsAsSettings(testDir)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Test')
      expect(result[0].content).toBe(content)
    })
  })

  describe('getAllSkills', () => {
    it('should return all skills from project', () => {
      const skillsDir = path.join(testDir, 'SKILLs')
      const skill1Dir = path.join(skillsDir, 'skill1')
      const skill2Dir = path.join(skillsDir, 'skill2')
      fs.mkdirSync(skill1Dir, { recursive: true })
      fs.mkdirSync(skill2Dir, { recursive: true })
      fs.writeFileSync(path.join(skill1Dir, 'SKILL.md'), 'Skill 1')
      fs.writeFileSync(path.join(skill2Dir, 'SKILL.md'), 'Skill 2')

      const result = getAllSkills(testDir)
      expect(result).toHaveLength(2)
    })
  })

  describe('getSkillsStats', () => {
    it('should return correct stats', () => {
      const skillsDir = path.join(testDir, 'SKILLs')
      const skillDir = path.join(skillsDir, 'test-skill')
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'Content')

      const result = getSkillsStats(testDir)
      expect(result.total).toBe(1)
      expect(result.project).toBe(1)
    })
  })

  describe('syncSkillsToProjectClaudeDir', () => {
    it('should return 0 if source directory does not exist', () => {
      const result = syncSkillsToProjectClaudeDir(testDir)
      expect(result).toBe(0)
    })

    it('should sync skills to .claude/skills directory', () => {
      const skillsDir = path.join(testDir, 'SKILLs')
      const skillDir = path.join(skillsDir, 'test-skill')
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'Content')

      const result = syncSkillsToProjectClaudeDir(testDir)
      expect(result).toBe(1)

      const targetPath = path.join(testDir, '.claude', 'skills', 'test-skill', 'SKILL.md')
      expect(fs.existsSync(targetPath)).toBe(true)
    })

    it('should remove skills that no longer exist in source', () => {
      // First sync
      const skillsDir = path.join(testDir, 'SKILLs')
      const skillDir = path.join(skillsDir, 'test-skill')
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'Content')
      syncSkillsToProjectClaudeDir(testDir)

      // Remove source skill
      fs.rmSync(skillDir, { recursive: true })

      // Sync again
      syncSkillsToProjectClaudeDir(testDir)

      const targetPath = path.join(testDir, '.claude', 'skills', 'test-skill')
      expect(fs.existsSync(targetPath)).toBe(false)
    })

    it('should update skills when source is newer', async () => {
      const skillsDir = path.join(testDir, 'SKILLs')
      const skillDir = path.join(skillsDir, 'test-skill')
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'Old content')

      // First sync
      syncSkillsToProjectClaudeDir(testDir)

      // Wait a bit to ensure different mtime
      await new Promise(resolve => setTimeout(resolve, 100))

      // Update source
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'New content')

      // Sync again
      const result = syncSkillsToProjectClaudeDir(testDir)
      expect(result).toBe(1)

      const targetPath = path.join(testDir, '.claude', 'skills', 'test-skill', 'SKILL.md')
      const content = fs.readFileSync(targetPath, 'utf-8')
      expect(content).toBe('New content')
    })

    it('should skip directories without SKILL.md', () => {
      const skillsDir = path.join(testDir, 'SKILLs')
      const skillDir = path.join(skillsDir, 'no-skill-md')
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(path.join(skillDir, 'README.md'), 'Not a skill')

      const result = syncSkillsToProjectClaudeDir(testDir)
      expect(result).toBe(0)

      const targetPath = path.join(testDir, '.claude', 'skills', 'no-skill-md')
      expect(fs.existsSync(targetPath)).toBe(false)
    })
  })
})
