#!/usr/bin/env bash
# Installs the CLI's dependencies inside the action's own checkout (the CLI runs from TypeScript source).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [ -n "${SIGNET_CLI:-}" ] || [ -d "$ROOT/packages/cli/node_modules/viem" ]; then
  echo "Signet CLI is ready"
  exit 0
fi
cd "$ROOT"
corepack enable
pnpm install --frozen-lockfile --prod --filter "@signet/cli..."
