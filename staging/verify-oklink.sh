#!/usr/bin/env bash
# Verifies the source of Signet's mainnet contracts on OKLink (free; no transaction, no OKB). Needs a free OKLink API
# key in .env as OKLINK_API_KEY. The site gate is an EIP-1167 clone of the ReleaseGate implementation: OKLink shows it
# through the implementation once that is verified.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; . "$ROOT/.env"; set +a
: "${OKLINK_API_KEY:?add a free OKLink API key to .env as OKLINK_API_KEY}"
NET="$ROOT/packages/contracts/deployments/mainnet.json"
URL="https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER"
cd "$ROOT/packages/contracts"
v() { forge verify-contract "$1" "$2" --chain-id 196 --verifier oklink --verifier-url "$URL" --verifier-api-key "$OKLINK_API_KEY" \
  --rpc-url "$XLAYER_RPC_URL" --guess-constructor-args --watch; }
v "$(jq -r .contracts.registry "$NET")" src/SignetRegistry.sol:SignetRegistry
v "$(jq -r .contracts.factory "$NET")" src/SignetFactory.sol:SignetFactory
v "$(jq -r .contracts.gateImplementation "$NET")" src/ReleaseGate.sol:ReleaseGate
