/**
 * Playwright config for integration E2E tests.
 *
 * Uses the REAL API server with Fake Provider instead of mock-api-server.
 * This tests the full chain: Frontend → Hono → AgentService → FakeAgent → SSE
 */
import { defineConfig } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webHost = '127.0.0.1'
const webPort = 1421 // Different port to avoid conflict with mock E2E
const apiHost = '127.0.0.1'
const apiPort = 2027 // Different port to avoid conflict
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default defineConfig({
  testDir: './tests-integration',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../playwright-report-integration' }]],
  use: {
    baseURL: `http://${webHost}:${webPort}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: `node ./e2e/integration-api-server.mjs`,
      cwd: rootDir,
      port: apiPort,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        EASYWORK_E2E_API_HOST: apiHost,
        EASYWORK_E2E_API_PORT: String(apiPort),
        EASYWORK_E2E_WEB_PORT: String(webPort),
      },
    },
    {
      command: `pnpm exec vite --host ${webHost} --port ${webPort}`,
      cwd: path.join(rootDir, 'src'),
      port: webPort,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        VITE_API_PORT: String(apiPort),
      },
    },
  ],
})
