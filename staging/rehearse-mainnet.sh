#!/usr/bin/env bash
# Rehearses docs/mainnet-plan.md on a throwaway anvil fork of X Layer mainnet (port 8555, separate from staging):
# the exact mainnet scripts, sent from the dev wallet (impersonated on the fork), and the gas each transaction
# used. Nothing is sent to mainnet: the fork only reads it. Prints a cost table at the current mainnet gas price.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" && set +a
PORT=8555; LOCAL="http://127.0.0.1:$PORT"; RUN="$ROOT/staging/.run/rehearsal"; mkdir -p "$RUN"
DEV=0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE
GASPRICE=$( { cast gas-price --rpc-url "$XLAYER_RPC_URL"; cast gas-price --rpc-url "$XLAYER_RPC_URL_2"; } | sort -n | tail -1)
anvil --fork-url "$XLAYER_RPC_URL" --chain-id 196 --port $PORT --auto-impersonate --silent > "$RUN/anvil.log" 2>&1 &
ANVIL=$!; trap 'kill $ANVIL 2>/dev/null || true' EXIT
for _ in $(seq 60); do cast block-number --rpc-url "$LOCAL" >/dev/null 2>&1 && break; sleep 0.5; done
BAL0=$(cast balance $DEV --rpc-url "$LOCAL")
export SIGNET_DEPLOY_OUT="deployments/rehearsal.json"
export SIGNET_SITE_DOMAIN="${SIGNET_SITE_DOMAIN:-signet.example}" SIGNET_SITE_SALT=$(cast keccak "rehearsal-$(date +%s)")
# rehearsal-only role addresses (anvil's well-known test accounts: never use them for real)
export SIGNET_SITE_APPROVERS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8,0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC,0x90F79bf6EB2c4f870365E785982E1f101E93b906
export SIGNET_SITE_PROPOSER=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 SIGNET_SITE_RECOVERY=0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc SIGNET_SITE_GUARDIAN=${REHEARSE_GUARDIAN:-0x976EA74026E726554dB657fA54763abd0C3a0aa9}
cd "$ROOT/packages/contracts"
run() { forge script script/MainnetDeploy.s.sol --sig "$1" --rpc-url "$LOCAL" --sender $DEV --unlocked --broadcast --slow --with-gas-price "$GASPRICE" 2>&1; }
run "step1()" > "$RUN/step1.log" || { tail -30 "$RUN/step1.log"; exit 1; }
cast rpc anvil_mine 0x2 --rpc-url "$LOCAL" >/dev/null
run "step2()" > "$RUN/step2.log" || { tail -30 "$RUN/step2.log"; exit 1; }
BAL1=$(cast balance $DEV --rpc-url "$LOCAL")
echo "gas price used: $GASPRICE wei (the higher of the two mainnet RPCs right now)"
for b in "$ROOT"/packages/contracts/broadcast/MainnetDeploy.s.sol/196/step1-latest.json "$ROOT"/packages/contracts/broadcast/MainnetDeploy.s.sol/196/step2-latest.json; do
  jq -r '.transactions as $t | .receipts | to_entries[] | "\($t[.key].contractName // "-")\t\($t[.key].function // "create")\t\(.value.gasUsed)"' "$b"
done | while IFS=$'\t' read -r c f g; do printf '%-16s %-58s gas %9d  %s OKB\n' "$c" "$f" "$((g))" "$(cast to-unit $(( $(printf '%d' $g) * GASPRICE )) ether)"; done
echo "dev wallet spent on the fork: $(cast to-unit $((BAL0 - BAL1)) ether) OKB (balance $(cast to-unit $BAL0 ether) -> $(cast to-unit $BAL1 ether))"
grep -E "registry:|factory:|gate implementation:|Signet site gate" "$RUN/step1.log" "$RUN/step2.log" | sed 's/.*log://'
