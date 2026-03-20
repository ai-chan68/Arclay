/**
 * Sandbox API 场景测试
 * 验证 execute / read / write / list / exists 在配置的 WORK_DIR 下行为正确
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { app } from '../../index'
import * as path from 'path'
import * as fs from 'fs'

const WORK_DIR = process.env.WORK_DIR || path.join(process.cwd(), 'workspace')
const TEST_DIR = path.join(WORK_DIR, '__sandbox_test__')
const TEST_FILE = path.join(TEST_DIR, 'hello.txt')
const TEST_CONTENT = 'hello sandbox test'

async function ensureTestDir() {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true })
  }
}

async function cleanupTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true })
  }
}

describe('Sandbox API', () => {
  beforeAll(ensureTestDir)
  afterAll(cleanupTestDir)

  describe('POST /api/sandbox/execute', () => {
    it('缺少 command 时应返回 400', async () => {
      const res = await app.request('/api/sandbox/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('command')
    })

    it('执行 echo 命令应返回成功与 stdout', async () => {
      const res = await app.request('/api/sandbox/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'echo ok', cwd: WORK_DIR }),
      })
      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean; stdout: string; exitCode: number }
      expect(body.success).toBe(true)
      expect(body.exitCode).toBe(0)
      expect(body.stdout.trim()).toBe('ok')
    })
  })

  describe('POST /api/sandbox/exec', () => {
    it('兼容路由应支持 command + args', async () => {
      const res = await app.request('/api/sandbox/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'echo', args: ['compat-ok'], cwd: WORK_DIR }),
      })
      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean; stdout: string; exitCode: number }
      expect(body.success).toBe(true)
      expect(body.exitCode).toBe(0)
      expect(body.stdout.trim()).toBe('compat-ok')
    })

    it('命令超时时应返回 timed_out 分类且 success=false', async () => {
      const res = await app.request('/api/sandbox/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: '/bin/sh',
          args: ['-lc', 'echo timeout-case && sleep 1'],
          cwd: WORK_DIR,
          timeout: 100,
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as {
        success: boolean
        timedOut: boolean
        classification: string
      }
      expect(body.success).toBe(false)
      expect(body.timedOut).toBe(true)
      expect(body.classification).toBe('timed_out')
    })
  })

  describe('POST /api/sandbox/run/file', () => {
    it('应能执行脚本文件并返回 runtime', async () => {
      const scriptPath = path.join(TEST_DIR, 'hello.sh')
      fs.writeFileSync(scriptPath, 'echo script-ok\n', 'utf8')
      try {
        const res = await app.request('/api/sandbox/run/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: scriptPath, workDir: WORK_DIR }),
        })
        expect(res.status).toBe(200)
        const body = await res.json() as { success: boolean; stdout: string; runtime: string }
        expect(body.success).toBe(true)
        expect(body.runtime.length).toBeGreaterThan(0)
        expect(body.stdout.trim()).toBe('script-ok')
      } finally {
        if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath)
      }
    })
  })

  describe('POST /api/sandbox/read', () => {
    it('缺少 path 时应返回 400', async () => {
      const res = await app.request('/api/sandbox/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it('读取存在的文件应返回 content', async () => {
      fs.writeFileSync(TEST_FILE, TEST_CONTENT, 'utf8')
      try {
        const res = await app.request('/api/sandbox/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: TEST_FILE }),
        })
        expect(res.status).toBe(200)
        const body = await res.json() as { success: boolean; content: string }
        expect(body.success).toBe(true)
        expect(body.content).toBe(TEST_CONTENT)
      } finally {
        if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE)
      }
    })
  })

  describe('POST /api/sandbox/write', () => {
    it('缺少 path 或 content 时应返回 400', async () => {
      const resNoPath = await app.request('/api/sandbox/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'x' }),
      })
      expect(resNoPath.status).toBe(400)

      const resNoContent = await app.request('/api/sandbox/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: TEST_FILE }),
      })
      expect(resNoContent.status).toBe(400)
    })

    it('写入文件应成功', async () => {
      const res = await app.request('/api/sandbox/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: TEST_FILE, content: TEST_CONTENT }),
      })
      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean }
      expect(body.success).toBe(true)
      expect(fs.readFileSync(TEST_FILE, 'utf8')).toBe(TEST_CONTENT)
      fs.unlinkSync(TEST_FILE)
    })
  })

  describe('POST /api/sandbox/list', () => {
    it('缺少 path 时应返回 400', async () => {
      const res = await app.request('/api/sandbox/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it('列出目录应返回 files 数组', async () => {
      const res = await app.request('/api/sandbox/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: TEST_DIR }),
      })
      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean; files: unknown[] }
      expect(body.success).toBe(true)
      expect(Array.isArray(body.files)).toBe(true)
    })
  })

  describe('POST /api/sandbox/exists', () => {
    it('缺少 path 时应返回 400', async () => {
      const res = await app.request('/api/sandbox/exists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it('存在文件应返回 exists: true', async () => {
      fs.writeFileSync(TEST_FILE, '', 'utf8')
      try {
        const res = await app.request('/api/sandbox/exists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: TEST_FILE }),
        })
        expect(res.status).toBe(200)
        const body = await res.json() as { success: boolean; exists: boolean }
        expect(body.success).toBe(true)
        expect(body.exists).toBe(true)
      } finally {
        fs.unlinkSync(TEST_FILE)
      }
    })

    it('不存在的路径应返回 exists: false', async () => {
      const res = await app.request('/api/sandbox/exists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path.join(TEST_DIR, 'nonexistent') }),
      })
      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean; exists: boolean }
      expect(body.success).toBe(true)
      expect(body.exists).toBe(false)
    })
  })
})
