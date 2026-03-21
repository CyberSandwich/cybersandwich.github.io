#!/bin/bash
# Bump ?v= cache buster for shared/base.css and/or shared/base.js across all sub-projects.
# Usage: ./scripts/bump-shared.sh [css|js|both]  (default: both)

set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-both}"

bump() {
  local file="$1"
  local pattern="$file?v="
  # Find current version from any sub-project HTML
  local cur
  cur=$(grep -roh "$pattern[0-9]*" --include="*.html" | head -1 | grep -o '[0-9]*$')
  if [ -z "$cur" ]; then
    echo "No $pattern references found."
    return
  fi
  local new=$((cur + 1))
  echo "Bumping $file: v=$cur -> v=$new"
  # Replace in all HTML files (excluding main index.html which doesn't use shared files)
  find . -name "index.html" -not -path "./index.html" -exec \
    sed -i '' "s|$pattern$cur|$pattern$new|g" {} +
  echo "  Updated $(grep -rl "$pattern$new" --include="*.html" | wc -l | tr -d ' ') files."
}

case "$TARGET" in
  css)  bump "base.css" ;;
  js)   bump "base.js" ;;
  both) bump "base.css"; bump "base.js" ;;
  *)    echo "Usage: $0 [css|js|both]"; exit 1 ;;
esac
