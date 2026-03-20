import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnSyncMock = vi.fn()
const getSettingsMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}))

vi.mock('../../settings-store', () => ({
  getSettings: () => getSettingsMock(),
}))

describe('Health dependencies readiness', () => {
  beforeEach(() => {
    vi.resetModules()
    spawnSyncMock.mockReset()
    getSettingsMock.mockReset()
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: '/usr/local/bin/claude\n',
    })
  })

  it('marks activeProvider false when the selected provider has no apiKey', async () => {
    getSettingsMock.mockReturnValue({
      activeProviderId: 'provider-empty',
      providers: [
        {
          id: 'provider-empty',
          provider: 'claude',
          apiKey: '',
        },
        {
          id: 'provider-other',
          provider: 'openai',
          apiKey: 'sk-live',
        },
      ],
    })

    const { healthRoutes } = await import('../health')
    const res = await healthRoutes.request('/dependencies')

    expect(res.status).toBe(200)

    const body = await res.json() as {
      providerConfigured: boolean
      activeProvider: boolean
    }

    expect(body.providerConfigured).toBe(true)
    expect(body.activeProvider).toBe(false)
  })
})
