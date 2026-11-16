#!/usr/bin/env bash
# Spike B read-back: verify a SiteRegistry file the way TapeKit does (TAP-10 §7.1 step 4):
# read fileInfo, read the bytes, require length == declared size and sha256(bytes) == declared sha256Hash.
# Read-only (eth_call). Usage: spikeB-verify.sh <container> <path> [rpc]
set -euo pipefail
SITES=0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6
C=$1; P=$2; R=${3:-${XLAYER_RPC_URL:-https://xlayerrpc.okx.com}}
info=$(cast call $SITES 'fileInfo(address,string)(uint32,string,bytes32,uint40,uint256)' "$C" "$P" --rpc-url "$R")
size=$(echo "$info" | sed -n 1p | awk '{print $1}'); ctype=$(echo "$info" | sed -n 2p); declared=$(echo "$info" | sed -n 3p)
chunks=$(echo "$info" | sed -n 5p | awk '{print $1}')
[ "$chunks" = "0" ] && { echo "status: no-such-file"; exit 2; }
hex=$(cast call $SITES 'read(address,string)(bytes)' "$C" "$P" --rpc-url "$R")
len=$(( (${#hex} - 2) / 2 ))
actual=0x$(printf '%s' "${hex#0x}" | xxd -r -p | shasum -a 256 | awk '{print $1}')
echo "container: $C"; echo "path: $P  contentType: $ctype  chunks: $chunks"
echo "declared size: $size  read: $len"; echo "declared sha256: $declared"; echo "actual   sha256: $actual"
if [ "$len" != "$size" ]; then echo "status: incomplete (size)"; exit 1; fi
if [ "$declared" = "0x0000000000000000000000000000000000000000000000000000000000000000" ]; then echo "status: no-hash"; exit 1; fi
if [ "$declared" != "$actual" ]; then echo "status: incomplete (sha256)"; exit 1; fi
echo "status: ok (verified)"
