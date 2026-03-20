/**
 * Preview API 场景测试
 * 验证 GET /api/preview/node-available、GET /api/preview/list 等端点
 */

import { describe, it, expect } from 'vitest'
import { app } from '../../index'

describe('Preview API', () => {
  describe('GET /api/preview/node-available', () => {
    it('应返回 200 且包含 available 布尔', async () => {
      const res = await app.request('/api/preview/node-available')
      expect(res.status).toBe(200)
      const body = await res.json() as { available: boolean; error?: string }
      expect(typeof body.available).toBe('boolean')
    })
  })

  describe('GET /api/preview/list', () => {
    it('应返回 200 且包含 instances 数组', async () => {
      const res = await app.request('/api/preview/list')
      expect(res.status).toBe(200)
      const body = await res.json() as { instances: unknown[] }
      expect(Array.isArray(body.instances)).toBe(true)
    })
  })

  describe('POST /api/preview/start', () => {
    it('缺少 taskId 或 workDir 时应返回 400', async () => {
      const res = await app.request('/api/preview/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toMatch(/taskId|workDir|required/)
    })
  })

  describe('POST /api/preview/stop', () => {
    it('缺少 taskId 时应返回 400', async () => {
      const res = await app.request('/api/preview/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })
  })
})
