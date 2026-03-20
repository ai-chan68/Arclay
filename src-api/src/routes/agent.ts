import { Hono } from 'hono'
import type { Context } from 'hono'

export const agentRoutes = new Hono()

const LEGACY_SUNSET_DATE = '2026-03-01'

function addLegacyHeaders(c: Context): void {
  c.header('X-API-Deprecated', 'true')
  c.header('Sunset', LEGACY_SUNSET_DATE)
}

function legacyGoneResponse(c: Context, endpoint: string) {
  addLegacyHeaders(c)
  return c.json(
    {
      success: false,
      error: `Legacy endpoint ${endpoint} has been sunset on ${LEGACY_SUNSET_DATE}`,
      migration: {
        stream: {
          from: '/api/agent/stream',
          to: '/api/v2/agent/plan + /api/v2/agent/execute',
          fallback: '/api/v2/agent',
        },
        abort: {
          from: '/api/agent/abort',
          to: '/api/v2/agent/stop/:sessionId',
        },
        tools: {
          from: '/api/agent/tools',
          to: '/api/providers',
        },
      },
    },
    410
  )
}

// Legacy endpoint - deprecated and disabled
agentRoutes.post('/stream', (c) => legacyGoneResponse(c, '/api/agent/stream'))

// Legacy endpoint - deprecated and disabled
agentRoutes.post('/abort', (c) => legacyGoneResponse(c, '/api/agent/abort'))

// Legacy endpoint - deprecated and disabled
agentRoutes.get('/tools', (c) => legacyGoneResponse(c, '/api/agent/tools'))
