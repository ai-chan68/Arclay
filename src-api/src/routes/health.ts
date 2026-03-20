import { Hono } from 'hono'
import { spawnSync } from 'node:child_process'
import { platform } from 'node:os'
import { getSettings } from '../settings-store'

export const healthRoutes = new Hono()

healthRoutes.get('/', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  })
})

/**
 * GET /api/health/dependencies
 * Frontend startup check endpoint.
 */
healthRoutes.get('/dependencies', (c) => {
  const os = platform()
  const checkCmd = os === 'win32' ? 'where' : 'which'
  const checkArg = 'claude'

  const checkResult = spawnSync(checkCmd, [checkArg], {
    encoding: 'utf8',
    timeout: 3000,
  })

  const claudeCode = checkResult.status === 0 && Boolean(checkResult.stdout?.trim())

  const settings = getSettings()
  const providers = settings?.providers || []
  const hasConfiguredProvider = providers.some((p) => Boolean(p.apiKey))
  const activeProvider = settings?.activeProviderId
    ? providers.find((provider) => provider.id === settings.activeProviderId)
    : null
  const hasActiveProvider = Boolean(activeProvider?.apiKey)

  return c.json({
    success: true,
    claudeCode,
    providers: providers.length,
    providerConfigured: hasConfiguredProvider,
    activeProvider: hasActiveProvider,
  })
})
