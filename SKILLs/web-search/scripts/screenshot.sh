#!/bin/bash
# Web Screenshot Script - 网页截图

set -e

URL="${1:-}"
OUTPUT="${2:-screenshot.png}"

if [ -z "$URL" ]; then
  echo "Usage: $0 <url> [output-file]"
  exit 1
fi

echo "📸 Taking screenshot of: $URL"
echo "Output: $OUTPUT"
echo "This is a placeholder script. Implement actual screenshot logic with Playwright."
