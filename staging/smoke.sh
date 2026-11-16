#!/usr/bin/env bash
# Runs one full release on the staging chain's demo gate: propose, 3 approvals, publish, write files, read back.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL="http://127.0.0.1:${STAGING_PORT:-8545}"
cast rpc anvil_nodeInfo --rpc-url "$LOCAL" >/dev/null 2>&1 || { echo "no local anvil at $LOCAL (run: pnpm staging:up)"; exit 1; }
ACCOUNTS_JSON=$(cast rpc eth_accounts --rpc-url "$LOCAL")
export STAGING_ACCOUNTS=$(echo "$ACCOUNTS_JSON" | jq -r 'join(",")')
cd "$ROOT/packages/contracts"
out=$(forge script script/Staging.s.sol --sig "smoke()" --rpc-url "$LOCAL" --broadcast --unlocked --sender "$(echo "$ACCOUNTS_JSON" | jq -r '.[0]')" 2>&1) || { echo "$out" | tail -20; exit 1; }
echo "$out" | grep -E 'smoke OK|Error|revert' || { echo "$out" | tail -20; exit 1; }
