#!/bin/bash

# Build script for API sidecar binary
# This script bundles the Hono API into a standalone executable using pkg

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$ROOT_DIR/dist"
BINARIES_DIR="$ROOT_DIR/apps/desktop/binaries"
RESOURCES_DIR="$ROOT_DIR/apps/desktop/resources"
CLAUDE_SDK_RESOURCE_DIR="$RESOURCES_DIR/claude-agent-sdk"

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
mkdir -p "$RESOURCES_DIR"

# Step 1: Bundle with esbuild
echo "Bundling API with esbuild..."
cd "$ROOT_DIR"

# Bundle the API entry point
npx esbuild apps/agent-service/src/index.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=cjs \
  --outfile="$DIST_DIR/api.cjs" \
  --external:deasync \
  --tree-shaking=true

# Step 1.5: Copy Claude Agent SDK assets so installed desktop builds can
# resolve cli.js outside the pkg snapshot runtime.
echo "Copying Claude Agent SDK resources..."
SDK_PACKAGE_JSON="$(node -e 'process.stdout.write(require.resolve("@anthropic-ai/claude-agent-sdk/package.json", { paths: ["./apps/agent-service"] }))')"
SDK_DIR="${SDK_PACKAGE_JSON%/package.json}"
rm -rf "$CLAUDE_SDK_RESOURCE_DIR"
cp -R "$SDK_DIR" "$CLAUDE_SDK_RESOURCE_DIR"
echo "Copied Claude Agent SDK to: $CLAUDE_SDK_RESOURCE_DIR"

# Step 1.6: Trim resources by platform (if single target specified)
if [ ${#TARGETS[@]} -eq 1 ]; then
  TARGET="${TARGETS[0]}"
  case $TARGET in
    *macos-arm64)
      PLATFORM_TARGET="macos-arm64"
      ;;
    *macos-x64)
      PLATFORM_TARGET="macos-intel"
      ;;
    *win-x64)
      PLATFORM_TARGET="windows"
      ;;
    *linux-x64)
      PLATFORM_TARGET="linux"
      ;;
    *)
      PLATFORM_TARGET=""
      ;;
  esac

  if [ -n "$PLATFORM_TARGET" ]; then
    echo "Trimming resources for platform: $PLATFORM_TARGET"
    node "$SCRIPT_DIR/trim-resources-by-platform.mjs" --target "$PLATFORM_TARGET"
  fi
fi

# Step 2: Package with pkg
echo "Packaging with @yao-pkg/pkg..."

for TARGET in "${TARGETS[@]}"; do
  echo "Building for $TARGET..."

  # Map target to output name (Tauri sidecar naming convention)
  case $TARGET in
    *macos-arm64)
      OUTPUT_NAME="arclay-api-aarch64-apple-darwin"
      ;;
    *macos-x64)
      OUTPUT_NAME="arclay-api-x86_64-apple-darwin"
      ;;
    *win-x64)
      OUTPUT_NAME="arclay-api-x86_64-pc-windows-msvc.exe"
      ;;
    *linux-x64)
      OUTPUT_NAME="arclay-api-x86_64-unknown-linux-gnu"
      ;;
    *)
      OUTPUT_NAME="arclay-api-$TARGET"
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
