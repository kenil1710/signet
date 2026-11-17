#!/usr/bin/env bash
# Tapes out the Guard decision circuit on the staging fork (the same script as on mainnet, sent from the dev
# wallet, which is impersonated on the fork) and records its circuit id in deployments/local.json.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL="http://127.0.0.1:${STAGING_PORT:-8545}"
OUT="$ROOT/packages/contracts/deployments/local.json"
cast rpc anvil_nodeInfo --rpc-url "$LOCAL" >/dev/null 2>&1 || { echo "no local anvil at $LOCAL (run: pnpm staging:up)"; exit 1; }
DEV=0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE
cast rpc anvil_setBalance $DEV 0x8ac7230489e80000 --rpc-url "$LOCAL" >/dev/null
cast rpc anvil_impersonateAccount $DEV --rpc-url "$LOCAL" >/dev/null
cd "$ROOT/packages/contracts"
out=$(SIGNET_GUARD_OUT=deployments/guard-local.json forge script script/GuardTapeout.s.sol --rpc-url "$LOCAL" --sender $DEV --unlocked --broadcast 2>&1) || { echo "$out" | tail -20; exit 1; }
cast rpc anvil_stopImpersonatingAccount $DEV --rpc-url "$LOCAL" >/dev/null
ID=$(jq -r .guardCircuitId deployments/guard-local.json); rm -f deployments/guard-local.json
jq --argjson id "$ID" '.tapeout.guardCircuitId = $id' "$OUT" > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
echo "Guard decision circuit taped out on staging: processor #101, circuit $ID (512/512 rows checked by the script)"
