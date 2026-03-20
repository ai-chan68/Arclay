#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

relative_matches=$(rg -n 'fetch\(\s*["'"'"'`]/api' src --glob '!**/dist/**' || true)
absolute_matches=$(rg -n 'fetch\(\s*["'"'"'`]http://localhost:[^"'"'"'`]*?/api' src --glob '!**/dist/**' || true)

allowed_absolute='^src/shared/initialization/app-initializer.ts:'
violations=""

if [[ -n "$relative_matches" ]]; then
  violations+="$relative_matches"$'\n'
fi

if [[ -n "$absolute_matches" ]]; then
  filtered_absolute=$(printf '%s\n' "$absolute_matches" | rg -v "$allowed_absolute" || true)
  if [[ -n "$filtered_absolute" ]]; then
    violations+="$filtered_absolute"$'\n'
  fi
fi

if [[ -n "$violations" ]]; then
  echo "Found direct API fetch usage that bypasses src/shared/api wrappers:"
  printf '%s' "$violations"
  exit 1
fi

echo "API fetch guard passed."
