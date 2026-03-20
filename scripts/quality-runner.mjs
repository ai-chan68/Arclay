#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  console.error('QUALITY_GATE_USAGE_ERROR: node scripts/quality-runner.mjs <script> <packageDir...>');
}

async function loadPackageManifest(packageDir) {
  const packageJsonPath = resolve(rootDir, packageDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    throw new Error(`QUALITY_GATE_PACKAGE_NOT_FOUND: packageDir="${packageDir}" path="${packageJsonPath}"`);
  }

  const raw = await readFile(packageJsonPath, 'utf8');
  const manifest = JSON.parse(raw);
  return { manifest, packageJsonPath };
}

function run(command, args, options = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: rootDir,
      shell: false,
      ...options,
    });

    child.on('close', (code) => resolveRun(code ?? 1));
    child.on('error', () => resolveRun(1));
  });
}

async function main() {
  const [, , scriptName, ...packageDirs] = process.argv;
  if (!scriptName || packageDirs.length === 0) {
    usage();
    process.exit(2);
  }

  for (const packageDir of packageDirs) {
    const { manifest } = await loadPackageManifest(packageDir);
    const packageName = manifest.name || packageDir;
    const scripts = manifest.scripts || {};
    if (!Object.prototype.hasOwnProperty.call(scripts, scriptName)) {
      console.error(
        `QUALITY_GATE_MISSING_SCRIPT: package="${packageName}" packageDir="${packageDir}" script="${scriptName}"`
      );
      process.exit(3);
    }

    console.log(`[quality-gate] START package=${packageName} script=${scriptName}`);
    const exitCode = await run('pnpm', ['--filter', packageName, 'run', scriptName]);
    if (exitCode !== 0) {
      console.error(
        `QUALITY_GATE_STEP_FAILED: package="${packageName}" script="${scriptName}" exitCode=${exitCode}`
      );
      process.exit(exitCode);
    }
    console.log(`[quality-gate] PASS package=${packageName} script=${scriptName}`);
  }

  console.log(`[quality-gate] COMPLETE script=${scriptName} packages=${packageDirs.length}`);
}

main().catch((error) => {
  console.error(
    `QUALITY_GATE_UNEXPECTED_ERROR: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
