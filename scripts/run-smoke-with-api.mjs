#!/usr/bin/env node

import { appendFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logDir = resolve(rootDir, '.quality-gates');
const apiLogFile = resolve(logDir, 'api.log');
const smokeLogFile = resolve(logDir, 'smoke.log');
const apiBaseUrl = process.env.EASYWORK_API_BASE_URL || 'http://localhost:2026';

async function waitForApiReady(timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return;
    } catch {
      // Wait and retry.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`QUALITY_GATE_SMOKE_API_TIMEOUT: api did not become ready within ${timeoutMs}ms`);
}

function spawnDetached(command, args, file) {
  const child = spawn(command, args, {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  child.stdout?.on('data', (chunk) => appendFile(file, `[stdout] ${chunk}`));
  child.stderr?.on('data', (chunk) => appendFile(file, `[stderr] ${chunk}`));
  return child;
}

function run(command, args, logFile) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: process.env,
    });
    child.stdout?.on('data', (chunk) => {
      process.stdout.write(chunk);
      appendFile(logFile, `[stdout] ${chunk}`);
    });
    child.stderr?.on('data', (chunk) => {
      process.stderr.write(chunk);
      appendFile(logFile, `[stderr] ${chunk}`);
    });
    child.on('close', (code) => resolveRun(code ?? 1));
    child.on('error', () => resolveRun(1));
  });
}

async function main() {
  await mkdir(dirname(apiLogFile), { recursive: true });
  await appendFile(apiLogFile, `\n=== smoke api start ${new Date().toISOString()} ===\n`);
  await appendFile(smokeLogFile, `\n=== smoke run start ${new Date().toISOString()} ===\n`);

  console.log(`[quality-gate] START smoke with API at ${apiBaseUrl}`);
  const apiProcess = spawnDetached('pnpm', ['dev:api'], apiLogFile);

  try {
    await waitForApiReady();
    const exitCode = await run('node', ['./scripts/smoke-desktop.mjs'], smokeLogFile);
    if (exitCode !== 0) {
      console.error(`QUALITY_GATE_SMOKE_FAILED: exitCode=${exitCode}`);
      process.exit(exitCode);
    }
    console.log('[quality-gate] PASS smoke with API');
  } finally {
    apiProcess.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(
    `QUALITY_GATE_SMOKE_ERROR: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
