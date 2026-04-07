#!/usr/bin/env node

import { rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for argument: --${key}`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function getPlatformKeep(target) {
  switch (target) {
    case 'macos-intel':
      return ['x64-darwin'];
    case 'macos-arm64':
      return ['arm64-darwin'];
    case 'linux':
      return ['x64-linux'];
    case 'windows':
      return ['x64-win32'];
    default:
      throw new Error(`Unknown target: ${target}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args.target;

  if (!target) {
    throw new Error('Usage: node scripts/trim-resources-by-platform.mjs --target <target>');
  }

  const keepPlatforms = getPlatformKeep(target);
  const ripgrepDir = resolve(rootDir, 'apps/desktop/resources/claude-agent-sdk/vendor/ripgrep');

  const allPlatforms = ['x64-darwin', 'arm64-darwin', 'x64-win32', 'arm64-win32', 'x64-linux', 'arm64-linux'];
  const toRemove = allPlatforms.filter(p => !keepPlatforms.includes(p));

  console.log(`[trim-resources] target=${target} keep=${keepPlatforms.join(',')} remove=${toRemove.join(',')}`);

  for (const platform of toRemove) {
    const platformDir = resolve(ripgrepDir, platform);
    try {
      await rm(platformDir, { recursive: true, force: true });
      console.log(`[trim-resources] removed ${platformDir}`);
    } catch (err) {
      console.warn(`[trim-resources] failed to remove ${platformDir}: ${err.message}`);
    }
  }

  console.log('[trim-resources] done');
}

main().catch((error) => {
  console.error(`TRIM_RESOURCES_ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
