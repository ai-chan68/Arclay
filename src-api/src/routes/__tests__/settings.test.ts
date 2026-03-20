/**
 * Settings API 场景测试
 * 验证当前多 Provider 架构下的 settings 相关端点
 */

import { describe, it, expect } from 'vitest'
import { app } from '../../index'

describe('Settings API', () => {
  describe('GET /api/settings', () => {
    it('应返回 200 且包含 activeProviderId/providers/mcp/skills/approval/sandbox 字段', async () => {
      const res = await app.request('/api/settings')
      expect(res.status).toBe(200)
      const body = await res.json() as {
        activeProviderId: string | null
        providers: unknown[]
        mcp: unknown
        skills: unknown
        approval: unknown
        sandbox: unknown
      }
      expect(Array.isArray(body.providers)).toBe(true)
      expect('activeProviderId' in body).toBe(true)
      expect('mcp' in body).toBe(true)
      expect('skills' in body).toBe(true)
      expect('approval' in body).toBe(true)
      expect('sandbox' in body).toBe(true)
    })
  })

  describe('Approval settings', () => {
    it('GET /api/settings/approval 应返回默认结构', async () => {
      const res = await app.request('/api/settings/approval')
      expect(res.status).toBe(200)
      const body = await res.json() as {
        enabled: boolean
        autoAllowTools: string[]
        timeoutMs: number
      }
      expect(typeof body.enabled).toBe('boolean')
      expect(Array.isArray(body.autoAllowTools)).toBe(true)
      expect(typeof body.timeoutMs).toBe('number')
    })
  })

  describe('Sandbox settings', () => {
    it('GET /api/settings/sandbox 应返回默认结构', async () => {
      const res = await app.request('/api/settings/sandbox')
      expect(res.status).toBe(200)
      const body = await res.json() as {
        enabled: boolean
        provider: string
        apiEndpoint: string
      }
      expect(typeof body.enabled).toBe('boolean')
      expect(typeof body.provider).toBe('string')
      expect(typeof body.apiEndpoint).toBe('string')
    })
  })

  describe('POST /api/settings/providers', () => {
    it('缺少必填字段时应返回 400', async () => {
      const res = await app.request('/api/settings/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toContain('required')
    })
  })

  describe('POST /api/settings/providers/:id/activate', () => {
    it('不存在的 provider id 应返回 404', async () => {
      const res = await app.request('/api/settings/providers/non-existent-id/activate', {
        method: 'POST',
      })
      expect(res.status).toBe(404)
      const body = await res.json() as { error: string }
      expect(body.error).toMatch(/not found/i)
    })
  })
})
