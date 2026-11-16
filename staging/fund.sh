#!/usr/bin/env bash
# Gives any address OKB on the local staging chain (for example your browser wallet).
#   pnpm staging:fund 0xYourAddress [amount in OKB, default 10]
set -euo pipefail
LOCAL="http://127.0.0.1:${STAGING_PORT:-8545}"
cast rpc anvil_nodeInfo --rpc-url "$LOCAL" >/dev/null 2>&1 || { echo "no local anvil at $LOCAL (run: pnpm staging:up)"; exit 1; }
ADDR="${1:?usage: fund.sh <address> [OKB]}"; AMOUNT="${2:-10}"
cast rpc anvil_setBalance "$ADDR" "$(cast to-hex "$(cast to-wei "$AMOUNT")")" --rpc-url "$LOCAL" >/dev/null
echo "$ADDR now has $(cast balance "$ADDR" --ether --rpc-url "$LOCAL") OKB on the staging chain"
