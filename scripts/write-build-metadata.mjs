#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for argument --${key}`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function resolveVersion(refName, packageVersion) {
  return /^v\d+\.\d+\.\d+$/.test(refName) ? refName.slice(1) : packageVersion;
}

function appendGithubOutput(key, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  appendFileSync(outputPath, `${key}=${value}\n`);
}

function appendSummary(lines) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  appendFileSync(summaryPath, `${lines.join('\n')}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args.target || 'unknown';

  const packageJson = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')
  );
  const version = resolveVersion(process.env.GITHUB_REF_NAME || '', packageJson.version || '0.0.0');
  const commit = process.env.GITHUB_SHA || 'unknown';
  const buildTimestamp = new Date().toISOString();

  appendGithubOutput('version', version);
  appendGithubOutput('commit', commit);
  appendGithubOutput('build_timestamp', buildTimestamp);
  appendGithubOutput('target', target);

  const summaryLines = [
    `### Build Metadata (${target})`,
    `- Version: \`${version}\``,
    `- Commit: \`${commit}\``,
    `- Timestamp: \`${buildTimestamp}\``,
  ];
  appendSummary(summaryLines);

  process.stdout.write(`${summaryLines.join('\n')}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `BUILD_METADATA_ERROR: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
}
