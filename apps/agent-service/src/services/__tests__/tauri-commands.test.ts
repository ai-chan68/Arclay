import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('getDesktopApiPort', () => {
  afterEach(() => {
    delete (globalThis as typeof globalThis & { __TAURI__?: unknown }).__TAURI__
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns 0 outside Tauri', async () => {
    const { getDesktopApiPort } = await import('../../../../web/shared/tauri/commands')

    await expect(getDesktopApiPort()).resolves.toBe(0)
  })

  it('returns 0 when get_api_port returns 0', async () => {
    ;(globalThis as typeof globalThis & { __TAURI__?: unknown }).__TAURI__ = {}

    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue(0)

    const { getDesktopApiPort } = await import('../../../../web/shared/tauri/commands')

    await expect(getDesktopApiPort()).resolves.toBe(0)
  })
})
