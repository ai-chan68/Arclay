/**
 * Health API 场景测试
 * 验证 GET /api/health 返回正常状态
 */

import { describe, it, expect } from 'vitest'
import { app } from '../../index'

describe('Health API', () => {
  it('GET /api/health 应返回 status ok、时间戳与 sidecar 兼容协议版本', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)

    const body = await res.json() as {
      status: string
      timestamp: string
      desktopSidecarProtocol: number
    }
    expect(body.status).toBe('ok')
    expect(body.timestamp).toBeDefined()
    expect(() => new Date(body.timestamp)).not.toThrow()
    expect(body.desktopSidecarProtocol).toBe(1)
  })

  it('GET /api/health/dependencies 应返回依赖检查状态', async () => {
    const res = await app.request('/api/health/dependencies')
    expect(res.status).toBe(200)

    const body = await res.json() as {
      success: boolean
      claudeCode: boolean
      providers: number
      providerConfigured: boolean
      activeProvider: boolean
    }

    expect(body.success).toBe(true)
    expect(typeof body.claudeCode).toBe('boolean')
    expect(typeof body.providers).toBe('number')
    expect(typeof body.providerConfigured).toBe('boolean')
    expect(typeof body.activeProvider).toBe('boolean')
  })

  it('允许 Tauri WebView origin 访问设置接口', async () => {
    const origin = 'http://tauri.localhost'
    const res = await app.request('/api/settings', {
      headers: {
        origin,
      },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(origin)
  })
})
