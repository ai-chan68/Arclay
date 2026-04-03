import { defineConfig } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webHost = '127.0.0.1'
const webPort = 1420
const apiHost = '127.0.0.1'
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
        EASYWORK_E2E_API_HOST: apiHost,
        EASYWORK_E2E_API_PORT: String(apiPort),
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
