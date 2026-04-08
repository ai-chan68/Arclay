import { defineConfig } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webHost = 'localhost'
const webPort = 1420
const apiHost = 'localhost'
const apiPort = 2026
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://${webHost}:${webPort}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: `node ./e2e/mock-api-server.mjs`,
      cwd: rootDir,
      port: apiPort,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        ARCLAY_E2E_API_HOST: apiHost,
        ARCLAY_E2E_API_PORT: String(apiPort),
      },
    },
    {
      command: `pnpm exec vite --host ${webHost} --port ${webPort}`,
      cwd: path.join(rootDir, 'apps/web'),
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
