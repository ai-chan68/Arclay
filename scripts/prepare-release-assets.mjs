#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
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

async function walkFiles(dir) {
  const output = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return output;
  }

  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await walkFiles(fullPath)));
    } else if (entry.isFile()) {
      output.push(fullPath);
    }
  }
  return output;
}

function sanitizeSegment(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function resolveTargetTriple(target) {
  switch (target) {
    case 'linux':
      return 'x86_64-unknown-linux-gnu';
    case 'windows':
      return 'x86_64-pc-windows-msvc';
    case 'macos-intel':
      return 'x86_64-apple-darwin';
    case 'macos-arm64':
      return 'aarch64-apple-darwin';
    default:
      throw new Error(`Unsupported target: ${target}`);
  }
}

function isDesktopArtifactForTarget(file, target) {
  const normalized = file.toLowerCase();
  const byTarget = {
    linux: ['.appimage', '.deb', '.rpm', '.tar.gz', '.sig'],
    windows: ['.msi', '.exe', '.zip', '.sig'],
    'macos-intel': ['.dmg', '.app.tar.gz', '.sig'],
    'macos-arm64': ['.dmg', '.app.tar.gz', '.sig'],
  };
  const extensions = byTarget[target] || [];
  return extensions.some((extension) => normalized.endsWith(extension));
}

function stableSort(paths) {
  return [...paths].sort((a, b) => a.localeCompare(b));
}

async function computeSha256(file) {
  const content = await readFile(file);
  return createHash('sha256').update(content).digest('hex');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args.target;
  const version = args.version;
  const commit = args.commit;
  const timestamp = args.timestamp;

  if (!target || !version || !commit || !timestamp) {
    throw new Error(
      'Usage: node scripts/prepare-release-assets.mjs --target <target> --version <version> --commit <sha> --timestamp <iso>'
    );
  }

  const safeVersion = sanitizeSegment(version);
  const bundleDir = resolve(rootDir, 'src-tauri', 'target', 'release', 'bundle');
  const binariesDir = resolve(rootDir, 'src-tauri', 'binaries');
  const outputDir = resolve(rootDir, 'dist', 'release', target);
  const targetTriple = resolveTargetTriple(target);

  await mkdir(outputDir, { recursive: true });

  const desktopFiles = stableSort(await walkFiles(bundleDir)).filter((file) =>
    isDesktopArtifactForTarget(file, target)
  );
  if (desktopFiles.length === 0) {
    throw new Error(`No desktop artifacts found in ${bundleDir}`);
  }

  const sidecarCandidates = stableSort(await walkFiles(binariesDir)).filter((file) => {
    const name = basename(file);
    return name.includes(targetTriple);
  });
  if (sidecarCandidates.length === 0) {
    throw new Error(`No sidecar binary found for target triple ${targetTriple}`);
  }
  if (sidecarCandidates.length > 1) {
    throw new Error(
      `Expected one sidecar binary for ${targetTriple}, got ${sidecarCandidates.length}`
    );
  }

  const publishedFiles = [];

  for (const source of desktopFiles) {
    const originalName = sanitizeSegment(basename(source));
    const destinationName = `easywork-${safeVersion}-${target}-${originalName}`;
    const destination = resolve(outputDir, destinationName);
    await cp(source, destination);
    publishedFiles.push(destination);
  }

  for (const source of sidecarCandidates) {
    const extension = extname(source).toLowerCase() === '.exe' ? '.exe' : '';
    const destinationName = `easywork-api-${safeVersion}-${target}${extension}`;
    const destination = resolve(outputDir, destinationName);
    await cp(source, destination);
    publishedFiles.push(destination);
  }

  const checksumIndex = [];
  for (const file of stableSort(publishedFiles)) {
    const digest = await computeSha256(file);
    const checksumLine = `${digest}  ${basename(file)}\n`;
    await writeFile(`${file}.sha256`, checksumLine, 'utf8');
    checksumIndex.push({ file: basename(file), sha256: digest });
  }

  const metadata = {
    product: 'easywork',
    version,
    commit,
    buildTimestamp: timestamp,
    target,
    targetTriple,
    generatedAt: new Date().toISOString(),
    checksums: checksumIndex,
  };
  await writeFile(resolve(outputDir, 'build-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

  console.log(`[release-assets] target=${target} outputDir=${outputDir}`);
  for (const item of checksumIndex) {
    console.log(`[release-assets] file=${item.file} sha256=${item.sha256}`);
  }

  // Emit artifact count in CI logs for quick sanity check.
  const outputStat = await stat(outputDir);
  if (!outputStat.isDirectory()) {
    throw new Error(`Expected output dir to be directory: ${outputDir}`);
  }
}

main().catch((error) => {
  console.error(
    `RELEASE_ASSET_PREP_ERROR: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
