import { describe, expect, it } from 'vitest'

import viteConfig from '../../../../web/vite.config'

describe('vite dev watch config', () => {
  it('ignores runtime workspace artifacts to avoid dev-page reload loops', () => {
    const ignored = viteConfig.server?.watch?.ignored
    const patterns = Array.isArray(ignored)
      ? ignored
      : ignored
        ? [ignored]
        : []

    expect(patterns).toEqual(expect.arrayContaining([
      '**/apps/agent-service/workspace/**',
      '**/.arclay/**',
    ]))
  })
})
