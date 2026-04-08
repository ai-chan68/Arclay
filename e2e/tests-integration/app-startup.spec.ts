/**
 * Integration E2E: App startup with real API + Fake Provider
 *
 * Verifies the full chain: Frontend → real Hono API → settings → health check
 */
import { expect, test } from '@playwright/test'

const apiPort = process.env.ARCLAY_E2E_API_PORT || '2027'
const apiBase = `http://127.0.0.1:${apiPort}`

// Integration tests run in WEB mode (no __TAURI__ injection)
// so the frontend connects directly to the real API via VITE_API_PORT.

test('app starts with real API and reaches home page', async ({ page }) => {
  await page.goto('/')

  // SetupGuard checks /api/health/dependencies — with Fake Provider configured,
  // it should pass and render the home page
  await expect(page.getByRole('heading', { name: '有什么可以帮你的？' })).toBeVisible({
    timeout: 15000,
  })
  await expect(page.getByPlaceholder('描述你的任务，AI 将帮你完成...')).toBeVisible()
})

test('health endpoint returns real provider status', async ({ request }) => {
  const response = await request.get(`${apiBase}/api/health`)
  expect(response.ok()).toBeTruthy()

  const body = await response.json()
  expect(body.status).toBe('ok')
})

test('settings endpoint returns fake provider configuration', async ({ request }) => {
  const response = await request.get(`${apiBase}/api/settings`)
  expect(response.ok()).toBeTruthy()

  const settings = await response.json()
  expect(settings.activeProviderId).toBe('provider-fake')
  expect(settings.providers).toHaveLength(1)
  expect(settings.providers[0].provider).toBe('fake')
})
