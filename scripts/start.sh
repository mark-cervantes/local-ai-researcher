#!/usr/bin/env bash
set -euo pipefail

# Resolve the package root robustly — works whether invoked as:
#   - node_modules/.bin/local-researcher (npx — .bin entry is a symlink)
#   - scripts/start.sh directly (dev/local use)
#
# readlink -f resolves symlinks, so .bin/local-researcher → scripts/start.sh
# inside the actual package dir. SCRIPT_DIR/.. is then the package root in
# both cases.
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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
