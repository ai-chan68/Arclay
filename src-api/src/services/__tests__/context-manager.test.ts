import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ContextManager } from '../context-manager'

describe('ContextManager', () => {
  let mgr: ContextManager
  let tempDir: string
  let sessionId: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-test-'))
    sessionId = 'session-test'
    mgr = new ContextManager(tempDir)
  })

  describe('load()', () => {
    it('initializes fresh context when no file exists', async () => {
      const ctx = await mgr.load(sessionId)
      expect(ctx.sessionId).toBe(sessionId)
      expect(ctx.activeFiles).toEqual([])
      expect(ctx.conversationSummary).toBe('')
    })

    it('loads existing context from disk', async () => {
      const saved = {
        sessionId: 'test-id',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastActiveAt: '2026-01-01T00:00:00.000Z',
        conversationSummary: 'prior summary',
        activeFiles: ['/tmp/foo.ts'],
        taskHistory: ['task-1'],
      }
      const sessionDir = path.join(tempDir, 'sessions', sessionId)
      fs.mkdirSync(sessionDir, { recursive: true })
      fs.writeFileSync(path.join(sessionDir, 'context.json'), JSON.stringify(saved))
      const ctx = await mgr.load(sessionId)
      expect(ctx.conversationSummary).toBe('prior summary')
      expect(ctx.activeFiles).toEqual(['/tmp/foo.ts'])
    })
  })

  describe('save()', () => {
    it('writes context.json to session dir', async () => {
      await mgr.load(sessionId)
      await mgr.save(sessionId)
      const filePath = path.join(tempDir, 'sessions', sessionId, 'context.json')
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it('trims activeFiles to 20 entries', async () => {
      await mgr.load(sessionId)
      for (let i = 0; i < 25; i++) {
        mgr.trackFile(`/tmp/file${i}.ts`)
      }
      await mgr.save(sessionId)
      const raw = JSON.parse(
        fs.readFileSync(path.join(tempDir, 'sessions', sessionId, 'context.json'), 'utf8')
      )
      expect(raw.activeFiles.length).toBe(20)
      expect(raw.activeFiles[0]).toBe('/tmp/file5.ts')
    })

    it('trims oversized conversation summary before save', async () => {
      const ctx = await mgr.load(sessionId)
      ctx.conversationSummary = 'x'.repeat(60_000)

      await mgr.save(sessionId)

      const raw = JSON.parse(
        fs.readFileSync(path.join(tempDir, 'sessions', sessionId, 'context.json'), 'utf8')
      )
      expect(raw.conversationSummary.length).toBeLessThan(60_000)
    })
  })

  describe('onToolResult() / step variables', () => {
    it('stores tool result as step variable', () => {
      mgr.onToolResult('tool-1', 'result content')
      expect(mgr.resolve('tool-1')).toBe('result content')
    })

    it('clears step variables between requests', () => {
      mgr.onToolResult('tool-1', 'result')
      mgr.clearStepVariables()
      expect(mgr.resolve('tool-1')).toBeUndefined()
    })
  })

  describe('resolve()', () => {
    it('step variable shadows task and session variables', async () => {
      const ctx = await mgr.load(sessionId)
      ctx.conversationSummary = 'session-value'
      mgr.setTaskVariable('key', 'task-value')
      mgr.onToolResult('key', 'step-value')
      expect(mgr.resolve('key')).toBe('step-value')
    })

    it('returns undefined for missing key', () => {
      expect(mgr.resolve('nonexistent')).toBeUndefined()
    })
  })

  describe('buildContextPrompt()', () => {
    it('returns empty string when no context loaded', async () => {
      expect(await mgr.buildContextPrompt()).toBe('')
    })

    it('includes active files in prompt', async () => {
      await mgr.load(sessionId)
      mgr.trackFile('/tmp/foo.ts')
      const prompt = await mgr.buildContextPrompt()
      expect(prompt).toContain('/tmp/foo.ts')
    })

    it('includes prior summary in prompt', async () => {
      const ctx = await mgr.load(sessionId)
      ctx.conversationSummary = 'summary from prior request'

      const prompt = await mgr.buildContextPrompt()

      expect(prompt).toContain('summary from prior request')
    })
  })
})
