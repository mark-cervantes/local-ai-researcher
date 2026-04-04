#!/usr/bin/env bash
set -euo pipefail

# Resolve the package root robustly — works whether invoked as:
#   - node_modules/.bin/local-researcher (npx, symlink/copy in .bin/)
#   - scripts/start.sh directly (dev/local use)
#
# Strategy: walk up from this script's real location until we find a
# package.json with "name": "local-ai-researcher", or fall back to the
# classic SCRIPT_DIR/.. heuristic for direct invocation.

_SCRIPT_REAL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
_DIR="$(dirname "$_SCRIPT_REAL")"

PROJECT_ROOT=""
while [ "$_DIR" != "/" ]; do
  if [ -f "$_DIR/package.json" ] && grep -q '"local-ai-researcher"' "$_DIR/package.json" 2>/dev/null; then
    PROJECT_ROOT="$_DIR"
    break
  fi
  _DIR="$(dirname "$_DIR")"
done

# Fallback: classic SCRIPT_DIR/.. (direct invocation from scripts/)
if [ -z "$PROJECT_ROOT" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

# Guard: build dist/ if missing (e.g. npx github: install where prepare was blocked)
# Always use npm here — pnpm blocks prepare scripts for git-hosted deps
# (ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED) so pnpm is not a safe fallback.
if [ ! -f "$PROJECT_ROOT/dist/index.js" ]; then
  echo "dist/index.js not found — running build..." >&2
  cd "$PROJECT_ROOT"
  npm install --ignore-scripts && npm run build
fi

# Start MCP server (no Docker — remote fallbacks are used when configured)
# --no-warnings suppresses Node.js experimental API warnings (e.g. node:sqlite)
# that would otherwise pollute stderr and confuse MCP host tools/get initialization.
exec node --no-warnings "$PROJECT_ROOT/dist/index.js"
