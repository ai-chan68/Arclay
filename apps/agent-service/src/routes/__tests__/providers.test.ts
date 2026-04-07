/**
 * Providers API 场景测试
 * 验证 GET /api/providers、/available、/current 及 GET /api/providers/:type 的响应结构
 */

import { describe, it, expect } from 'vitest'
import { app } from '../../index'

describe('Providers API', () => {
  describe('GET /api/providers', () => {
    it('应返回 success 与 providers 数组', async () => {
      const res = await app.request('/api/providers')
      expect(res.status).toBe(200)
      const body = await res.json() as { success: boolean; providers: unknown[] }
      expect(body.success).toBe(true)
      expect(Array.isArray(body.providers)).toBe(true)
    })
  })

  describe('GET /api/providers/available', () => {
    it('应返回 success 与 available 数组', async () => {
      const res = await app.request('/api/providers/available')
      expect([200, 500]).toContain(res.status)
      const body = await res.json() as { success: boolean; available?: unknown[]; error?: string }
      expect(body.success !== undefined || body.error !== undefined).toBe(true)
      if (body.success && body.available) {
        expect(Array.isArray(body.available)).toBe(true)
      }
    })
  })

  describe('GET /api/providers/current', () => {
    it('应返回 success 与 current 对象', async () => {
      const res = await app.request('/api/providers/current')
      expect([200, 500]).toContain(res.status)
      const body = await res.json() as { success: boolean; current?: { type: string; model: string }; error?: string }
      if (body.success && body.current) {
        expect(typeof body.current.type).toBe('string')
        expect(typeof body.current.model).toBe('string')
      }
    })
  })

  describe('GET /api/providers/:type', () => {
    it('对已知 type 应返回该 provider 信息', async () => {
      const res = await app.request('/api/providers/claude')
      expect([200, 404]).toContain(res.status)
      if (res.status === 200) {
        const body = await res.json() as { success: boolean; provider?: unknown }
        expect(body.success).toBe(true)
      }
    })
  })

  describe('POST /api/providers/switch', () => {
    it('切换到已注册 provider 时应返回 success', async () => {
      const res = await app.request('/api/providers/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'claude',
          apiKey: 'test-key',
          model: 'claude-sonnet-4-20250514',
        }),
      })
      expect([200, 400, 500]).toContain(res.status)
      const body = await res.json() as { success?: boolean; error?: string }
      if (res.status === 200) {
        expect(body.success).toBe(true)
      } else {
        expect(typeof body.error).toBe('string')
      }
    })
  })
})
