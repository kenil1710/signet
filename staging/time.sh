#!/usr/bin/env bash
# Jumps the local staging chain forward.
#   pnpm staging:time 1h      (also: 90s, 10m, 24h, 7d)   moves the clock and mines one block
#   pnpm staging:time blocks 5                            mines 5 blocks (commit-reveal needs 2)
set -euo pipefail
LOCAL="http://127.0.0.1:${STAGING_PORT:-8545}"
cast rpc anvil_nodeInfo --rpc-url "$LOCAL" >/dev/null 2>&1 || { echo "no local anvil at $LOCAL (run: pnpm staging:up)"; exit 1; }
now() { cast block latest --field timestamp --rpc-url "$LOCAL"; }
case "${1:-}" in
  blocks) n="${2:?how many blocks?}"; cast rpc anvil_mine "$(cast to-hex "$n")" --rpc-url "$LOCAL" >/dev/null
          echo "mined $n blocks; now at block $(cast block-number --rpc-url "$LOCAL")";;
  *[smhd]) v="${1%?}"; case "${1: -1}" in s) k=1;; m) k=60;; h) k=3600;; d) k=86400;; esac
          [[ "$v" =~ ^[0-9]+$ ]] || { echo "usage: time.sh <N>s|m|h|d  |  time.sh blocks <N>"; exit 1; }
          before=$(now); cast rpc evm_increaseTime "$(cast to-hex $((v * k)))" --rpc-url "$LOCAL" >/dev/null
          cast rpc anvil_mine 0x1 --rpc-url "$LOCAL" >/dev/null
          echo "clock moved $1: $(date -r "$before" -u '+%Y-%m-%d %H:%M:%S') -> $(date -r "$(now)" -u '+%Y-%m-%d %H:%M:%S') UTC";;
  *) echo "usage: time.sh <N>s|m|h|d  |  time.sh blocks <N>"; exit 1;;
esac
