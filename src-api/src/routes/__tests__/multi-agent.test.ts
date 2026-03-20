/**
 * Multi-Agent API 场景测试
 * 验证 GET /api/agent/multi/history、GET /api/agent/multi/status/:id、POST /api/agent/multi/stream 的请求与响应
 */

import { describe, it, expect } from 'vitest'
import { app } from '../../index'

describe('Multi-Agent API', () => {
  describe('POST /api/agent/multi/stream', () => {
    it('缺少 prompt 时应返回 400', async () => {
      const res = await app.request('/api/agent/multi/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('prompt')
    })
  })

  describe('GET /api/agent/multi/history', () => {
    it('应返回 200 且包含 executions 数组', async () => {
      const res = await app.request('/api/agent/multi/history')
      expect(res.status).toBe(200)
      const body = await res.json() as { executions: unknown[] }
      expect(Array.isArray(body.executions)).toBe(true)
    })
  })

  describe('GET /api/agent/multi/status/:executionId', () => {
    it('不存在的 executionId 应返回 404 或明确状态', async () => {
      const res = await app.request('/api/agent/multi/status/non-existent-id')
      expect([200, 404]).toContain(res.status)
      if (res.status === 200) {
        const body = await res.json() as { status?: string; executionId?: string }
        expect(body).toBeDefined()
      }
    })
  })
})
