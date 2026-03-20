/**
 * Legacy Agent API 场景测试
 * 验证旧 /api/agent/* 接口已下线并返回迁移指引
 */

import { describe, it, expect } from 'vitest'
import { app } from '../../index'

describe('Legacy Agent API', () => {
  describe('GET /api/agent/tools', () => {
    it('应返回 410 和迁移信息', async () => {
      const res = await app.request('/api/agent/tools')
      expect(res.status).toBe(410)
      expect(res.headers.get('X-API-Deprecated')).toBe('true')
      const body = await res.json() as { error: string; migration: Record<string, unknown> }
      expect(body.error).toContain('sunset')
      expect(body.migration).toBeDefined()
    })
  })

  describe('POST /api/agent/abort', () => {
    it('无 body 时应返回 410 和迁移信息', async () => {
      const res = await app.request('/api/agent/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(410)
      expect(res.headers.get('X-API-Deprecated')).toBe('true')
      const body = await res.json() as { error: string; migration: Record<string, unknown> }
      expect(body.error).toContain('sunset')
      expect(body.migration).toBeDefined()
    })
  })

  describe('POST /api/agent/stream', () => {
    it('缺少 prompt 时也应直接返回 410（接口已下线）', async () => {
      const res = await app.request('/api/agent/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(410)
      expect(res.headers.get('X-API-Deprecated')).toBe('true')
    })

    it('带 prompt 时应返回 410 和迁移信息', async () => {
      const res = await app.request('/api/agent/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'say hi in one word' }),
      })
      expect(res.status).toBe(410)
      expect(res.headers.get('X-API-Deprecated')).toBe('true')
      const body = await res.json() as { error: string; migration: Record<string, unknown> }
      expect(body.error).toContain('sunset')
      expect(body.migration).toBeDefined()
    })
  })
})
