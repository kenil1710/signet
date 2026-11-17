#!/usr/bin/env bash
# Renews SignetRegistry's operator grant on the shared container (staging only).
# SiteRegistry grants last at most 30 days. Tests jump the staging clock by days at a time, so the grant made by
# `staging:up` runs out and file writes start to revert with NotOwner() (0x30cd7471). On the fork the holder of
# circuit #5 is impersonated; on mainnet this is a real transaction from that wallet, at least every 30 days.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL="http://127.0.0.1:${STAGING_PORT:-8545}"
OUT="$ROOT/packages/contracts/deployments/local.json"
cast rpc anvil_nodeInfo --rpc-url "$LOCAL" >/dev/null 2>&1 || { echo "no local anvil at $LOCAL (run: pnpm staging:up)"; exit 1; }
REG=$(jq -r '.contracts.registry' "$OUT"); SITES=$(jq -r '.tapeout.siteRegistry' "$OUT"); SHARED=$(jq -r '.tapeout.sharedContainer' "$OUT")
PROC=$(jq -r '.tapeout.processor' "$OUT"); ID=$(jq -r '.tapeout.sharedCircuitId' "$OUT")
DEV=$(cast call "$PROC" "ownerOf(uint256)(address)" "$ID" --rpc-url "$LOCAL")
cast rpc anvil_setBalance "$DEV" 0x8ac7230489e80000 --rpc-url "$LOCAL" >/dev/null
cast rpc anvil_impersonateAccount "$DEV" --rpc-url "$LOCAL" >/dev/null
cast send "$SITES" "setOperator(address,address,uint256)" "$SHARED" "$REG" 2592000 --from "$DEV" --unlocked --rpc-url "$LOCAL" >/dev/null
cast rpc anvil_stopImpersonatingAccount "$DEV" --rpc-url "$LOCAL" >/dev/null
echo "operator renewed for 30 days: registry $REG on container $SHARED"
