#!/bin/bash

# Build script for API sidecar binary
# This script bundles the Hono API into a standalone executable using pkg

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$ROOT_DIR/dist"
BINARIES_DIR="$ROOT_DIR/src-tauri/binaries"

# Detect current platform for default target
detect_platform() {
  case "$(uname -s)" in
    Darwin*) echo "node18-macos-arm64" ;;
    Linux*) echo "node18-linux-x64" ;;
    MINGW*|MSYS*|CYGWIN*) echo "node18-win-x64" ;;
    *) echo "unknown" ;;
  esac
}

# Parse arguments
TARGETS=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --target|-t)
      TARGETS+=("$2")
      shift 2
      ;;
    --all|-a)
      TARGETS=("node18-macos-arm64" "node18-macos-x64" "node18-win-x64" "node18-linux-x64")
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Default to current platform if no targets specified
if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS+=("$(detect_platform)")
fi

echo "Building API sidecar for targets: ${TARGETS[*]}"

# Ensure dist directory exists
mkdir -p "$DIST_DIR"
mkdir -p "$BINARIES_DIR"

# Step 1: Bundle with esbuild
echo "Bundling API with esbuild..."
cd "$ROOT_DIR"

# Bundle the API entry point
npx esbuild src-api/src/index.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=cjs \
  --outfile="$DIST_DIR/api.cjs" \
  --external:deasync \
  --tree-shaking=true

# Step 2: Package with pkg
echo "Packaging with @yao-pkg/pkg..."

for TARGET in "${TARGETS[@]}"; do
  echo "Building for $TARGET..."

  # Map target to output name
  case $TARGET in
    *macos-arm64)
      OUTPUT_NAME="easywork-api-aarch64-apple-darwin"
      ;;
    *macos-x64)
      OUTPUT_NAME="easywork-api-x86_64-apple-darwin"
      ;;
    *win-x64)
      OUTPUT_NAME="easywork-api-x86_64-pc-windows-msvc.exe"
      ;;
    *linux-x64)
      OUTPUT_NAME="easywork-api-x86_64-unknown-linux-gnu"
      ;;
    *)
      OUTPUT_NAME="easywork-api-$TARGET"
      ;;
  esac

  npx pkg "$DIST_DIR/api.cjs" \
    --target "$TARGET" \
    --output "$BINARIES_DIR/$OUTPUT_NAME" \
    --no-bytecode \
    --public-packages "*" \
    --public

  echo "Created: $BINARIES_DIR/$OUTPUT_NAME"
done

echo "Build complete!"
echo "Binaries are in: $BINARIES_DIR"
