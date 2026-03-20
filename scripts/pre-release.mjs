#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function runStep(label, command, args) {
  return new Promise((resolveStep) => {
    console.log(`[pre-release] START ${label}`);
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: false,
      env: process.env,
    });

    child.on('close', (code) => {
      const exitCode = code ?? 1;
      if (exitCode === 0) {
        console.log(`[pre-release] PASS ${label}`);
      } else {
        console.error(`[pre-release] FAIL ${label} exitCode=${exitCode}`);
      }
      resolveStep(exitCode);
    });
    child.on('error', () => {
      console.error(`[pre-release] FAIL ${label} error=spawn_failed`);
      resolveStep(1);
    });
  });
}

async function main() {
  const steps = [
    { label: 'lint', command: 'pnpm', args: ['lint'] },
    { label: 'typecheck', command: 'pnpm', args: ['typecheck'] },
    { label: 'test', command: 'pnpm', args: ['test'] },
    { label: 'smoke:desktop', command: 'pnpm', args: ['smoke:desktop:with-api'] },
  ];

  for (const step of steps) {
    const exitCode = await runStep(step.label, step.command, step.args);
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }

  console.log('[pre-release] COMPLETE all quality gates passed');
}

main().catch((error) => {
  console.error(
    `QUALITY_GATE_PRE_RELEASE_ERROR: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
