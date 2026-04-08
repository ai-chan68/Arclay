#!/usr/bin/env node

/**
 * Bootstrap script for integration E2E tests.
 *
 * Creates an isolated ARCLAY_HOME with a settings.json that uses
 * the fake provider, then starts the real API server.
 *
 * Playwright's webServer config calls this script instead of mock-api-server.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

const host = process.env.ARCLAY_E2E_API_HOST || '127.0.0.1'
const port = process.env.ARCLAY_E2E_API_PORT || '2027'
const frontendPort = process.env.ARCLAY_E2E_WEB_PORT || '1421'

// Create isolated ARCLAY_HOME
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'arclay-e2e-'))

// Create isolated workspace directory for test files
const tempWorkspace = path.join(tempHome, 'workspace')
fs.mkdirSync(tempWorkspace, { recursive: true })

const settings = {
  activeProviderId: 'provider-fake',
  providers: [
    {
      id: 'provider-fake',
      name: 'Fake (E2E Testing)',
      provider: 'fake',
      apiKey: 'not-needed',
      model: 'fake-model',
      baseUrl: '',
      enabled: true,
    },
  ],
  mcp: { enabled: false, mcpServers: {} },
  skills: { enabled: false, routing: 'manual', skills: {}, sources: [] },
  approval: { enabled: false, autoAllowTools: [], timeoutMs: 300000 },
  sandbox: { enabled: false, provider: 'native', apiEndpoint: '', image: '' },
}

fs.writeFileSync(
  path.join(tempHome, 'settings.json'),
  JSON.stringify(settings, null, 2),
  'utf8'
)

console.log(`[e2e-integration] ARCLAY_HOME: ${tempHome}`)
console.log(`[e2e-integration] WORKSPACE: ${tempWorkspace}`)
console.log(`[e2e-integration] Starting real API on ${host}:${port}`)

// Start the real API server
const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const apiDir = path.join(rootDir, 'apps/agent-service')

const child = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: apiDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: port,
    HOST: host,
    FRONTEND_URL: `http://127.0.0.1:${frontendPort}`,
    ARCLAY_HOME: tempHome,
    ARCLAY_WORKSPACE: tempWorkspace,
    ARCLAY_FAKE_PROVIDER: '1',
    NODE_ENV: 'test',
  },
})

// Cleanup on exit
function cleanup() {
  child.kill()
  try {
    fs.rmSync(tempHome, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(0) })
process.on('SIGTERM', () => { cleanup(); process.exit(0) })
child.on('exit', (code) => { cleanup(); process.exit(code ?? 0) })
