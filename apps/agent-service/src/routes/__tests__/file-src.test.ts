import { afterEach, describe, expect, it, vi } from 'vitest'

describe('getFileSrc', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unmock('@tauri-apps/api/core')
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__
  })

  it('serves local images through the backend even in tauri', async () => {
    ;(globalThis as { __TAURI__?: object }).__TAURI__ = {}

    vi.doMock('@tauri-apps/api/core', () => ({
      convertFileSrc: vi.fn(() => 'asset://should-not-be-used'),
    }))

    const { getFileSrc } = await import('../../../../web/shared/lib/utils')

    await expect(getFileSrc('/workspace/Arclay/apps/agent-service/workspace/sessions/demo/image.png'))
      .resolves
      .toBe('/api/files/serve?path=%2Fworkspace%2FArclay%2Fapps%2Fagent-service%2Fworkspace%2Fsessions%2Fdemo%2Fimage.png')
  })
})
