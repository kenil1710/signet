#!/usr/bin/env bash
# The whole mainnet deploy, rehearsed on a throwaway anvil fork of X Layer mainnet (port 8555), with the REAL inputs
# from .env (SIGNET_SITE_*), then every staging suite run against that deployment. Nothing is sent to mainnet: the
# fork only reads it. The staging chain on :8545 and its local.json are left as they were (local.json is pointed at
# the fork only while the suites run, and restored on exit).
#   1. preflight-mainnet (reads mainnet)          4. record-mainnet in rehearsal mode (writes deployments/rehearsal.json)
#   2. MainnetDeploy step1, 2 blocks, step2         5. every staging suite + the attack suite on the fork, then the smoke test
#   3. GuardTapeout (the Guard decision circuit)    6. the real site gate with the real roles: propose, 3 approvals, publish, freeze, unfreeze
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; . "$ROOT/.env"; set +a
: "${SIGNET_SITE_DOMAIN:?}" "${SIGNET_SITE_SALT:?}" "${SIGNET_SITE_APPROVERS:?}" "${SIGNET_SITE_PROPOSER:?}" "${SIGNET_SITE_RECOVERY:?}" "${SIGNET_SITE_GUARDIAN:?}"
PORT=8555; LOCAL="http://127.0.0.1:$PORT"; RUN="$ROOT/staging/.run/rehearsal"; rm -rf "$RUN"; mkdir -p "$RUN"
C="$ROOT/packages/contracts"; NETS="$C/deployments"
DEV=0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE
log() { echo "[rehearsal] $*" | tee -a "$RUN/summary.txt"; }

echo "== 1. preflight (read-only, mainnet)"; node "$C/script/preflight-mainnet.mjs" | tee "$RUN/preflight.txt"
GASPRICE=$( { cast gas-price --rpc-url "$XLAYER_RPC_URL"; cast gas-price --rpc-url "$XLAYER_RPC_URL_2"; } | sort -n | tail -1)

# the fork, with the same seeded test wallets as staging (the suites need them); the real role addresses are impersonated
anvil --fork-url "$XLAYER_RPC_URL" --chain-id 196 --port $PORT --accounts 10 --balance 1000 --mnemonic-seed-unsafe 196196 --silent > "$RUN/anvil.log" 2>&1 &
ANVIL=$!
cp "$NETS/local.json" "$RUN/local.json.bak"
restore() {
  cp "$RUN/local.json.bak" "$NETS/local.json"
  # the suites rewrite these reports; keep the rehearsal's copies in $RUN and put the repo's back
  for f in docs/attack-report.md docs/demo/attack-report.json docs/demo/chunked-upload.json; do
    [ -f "$ROOT/$f" ] && cp "$ROOT/$f" "$RUN/$(basename "$f")" 2>/dev/null || true
    git -C "$ROOT" checkout -- "$f" 2>/dev/null || true
  done
  kill $ANVIL 2>/dev/null || true
}
trap restore EXIT
for _ in $(seq 60); do cast block-number --rpc-url "$LOCAL" >/dev/null 2>&1 && break; sleep 0.5; done
FORK_BLOCK=$(cast block-number --rpc-url "$LOCAL")
BAL0=$(cast balance $DEV --rpc-url "$LOCAL"); NONCE0=$(cast nonce $DEV --rpc-url "$LOCAL")
log "fork of mainnet at block $FORK_BLOCK; dev wallet $(cast to-unit $BAL0 ether) OKB, nonce $NONCE0 (real mainnet values); gas price $GASPRICE wei"

cd "$C"
cast rpc anvil_impersonateAccount $DEV --rpc-url "$LOCAL" >/dev/null
export SIGNET_DEPLOY_OUT=deployments/rehearsal-deploy.json SIGNET_GUARD_OUT=deployments/rehearsal-guard.json
rm -f "$C/$SIGNET_DEPLOY_OUT" "$C/$SIGNET_GUARD_OUT"
fs() { forge script "$1" --sig "$2" --rpc-url "$LOCAL" --sender $DEV --unlocked --broadcast --slow --with-gas-price "$GASPRICE" > "$RUN/$3.log" 2>&1 || { tail -30 "$RUN/$3.log"; exit 1; }; }
echo "== 2. MainnetDeploy step1 / step2"
fs script/MainnetDeploy.s.sol "step1()" step1
cast rpc anvil_mine 0x2 --rpc-url "$LOCAL" >/dev/null
fs script/MainnetDeploy.s.sol "step2()" step2
echo "== 3. GuardTapeout"
fs script/GuardTapeout.s.sol "run()" guard
cast rpc anvil_stopImpersonatingAccount $DEV --rpc-url "$LOCAL" >/dev/null
BAL1=$(cast balance $DEV --rpc-url "$LOCAL")

# every transaction the dev wallet sent, in order, with its gas and value: the list shown before the real deploy
{
  printf '#\tscript\tcontract\tfunction\tgas\tvalue_wei\n'
  n=0
  for b in MainnetDeploy.s.sol/196/step1-latest.json MainnetDeploy.s.sol/196/step2-latest.json GuardTapeout.s.sol/196/run-latest.json; do
    jq -r --arg s "${b%%/*}:$(basename "$b" -latest.json)" '.transactions as $t | .receipts | to_entries[] | [$s, ($t[.key].contractName // "-"), ($t[.key].function // "create"), (.value.gasUsed | tostring), ($t[.key].transaction.value // "0x0")] | @tsv' "$C/broadcast/$b"
  done | while IFS=$'\t' read -r s c f g v; do n=$((n+1)); printf '%s\t%s\t%s\t%s\t%d\t%d\n' "$n" "$s" "$c" "$f" "$g" "$v"; done
} > "$RUN/transactions.tsv"
log "dev wallet spent on the fork: $(cast to-unit $((BAL0 - BAL1)) ether) OKB (gas + mint/tape-out fees); nonce now $(cast nonce $DEV --rpc-url "$LOCAL")"

echo "== 4. record-mainnet (rehearsal mode: writes deployments/rehearsal.json only)"
SIGNET_RECORD_REHEARSAL="$LOCAL" node script/record-mainnet.mjs all | tee "$RUN/record.txt"
SITE_GATE=$(jq -r .gates.site.address "$NETS/rehearsal.json"); GUARD_ID=$(jq -r .tapeout.guardCircuitId "$NETS/rehearsal.json")
log "registry $(jq -r .contracts.registry "$NETS/rehearsal.json"), factory $(jq -r .contracts.factory "$NETS/rehearsal.json"), gate implementation $(jq -r .contracts.gateImplementation "$NETS/rehearsal.json"), site gate $SITE_GATE ($(jq -r .gates.site.domain "$NETS/rehearsal.json")), Guard circuit #$GUARD_ID"

echo "== 6. smoke + every staging suite + the attack suite, against this deployment"
ACCOUNTS_JSON=$(cast rpc eth_accounts --rpc-url "$LOCAL")
jq --arg rpc "$LOCAL" --argjson block "$FORK_BLOCK" --argjson a "$ACCOUNTS_JSON" '
  .name = "local" | .rpcUrl = $rpc | del(.rpcUrl2) | .forkOf = "X Layer mainnet (mainnet-deploy rehearsal)" | .forkBlock = $block
  | .gates = {site: .gates.site, demo: {}}
  | .accounts = {deployer: $a[0], approvers: [$a[1], $a[2], $a[3]], proposer: $a[4], recovery: $a[5], guardian: $a[6], users: [$a[7], $a[8], $a[9]]}' \
  "$NETS/rehearsal.json" > "$NETS/local.json"
export STAGING_ACCOUNTS=$(echo "$ACCOUNTS_JSON" | jq -r 'join(",")') STAGING_PORT=$PORT
forge script script/Staging.s.sol --sig "demoCommit()" --rpc-url "$LOCAL" --broadcast --unlocked --sender "$(echo "$ACCOUNTS_JSON" | jq -r '.[0]')" > "$RUN/demo-commit.log" 2>&1 || { tail -20 "$RUN/demo-commit.log"; exit 1; }
cast rpc anvil_mine 0x2 --rpc-url "$LOCAL" >/dev/null
forge script script/Staging.s.sol --sig "demoGate()" --rpc-url "$LOCAL" --broadcast --unlocked --sender "$(echo "$ACCOUNTS_JSON" | jq -r '.[0]')" > "$RUN/demo-gate.log" 2>&1 || { tail -20 "$RUN/demo-gate.log"; exit 1; }
cd "$ROOT"
fails=0
for pk in cli action extension gateway watchtower dashboard attacks; do
  pnpm --filter @signet/$pk test:staging > "$RUN/suite-$pk.txt" 2>&1 || true
  r=$(grep -E "^# (pass|fail)" "$RUN/suite-$pk.txt" | tr '\n' ' ')
  log "suite $pk: $r$(grep -o 'Blocked [0-9]*/12[^.]*\.[^.]*' "$RUN/suite-$pk.txt" | head -1)"
  grep -q "^# fail 0" "$RUN/suite-$pk.txt" || fails=$((fails+1))
done
[ $fails -eq 0 ] || { log "$fails suite(s) FAILED: see $RUN/suite-*.txt"; exit 1; }
# last, because each publishes a release with no files.json (which /prove rightly reports): the smoke test, then the real roles
"$ROOT/staging/smoke.sh" | tee "$RUN/smoke.txt"
echo "== 7. the real site gate with the real roles"
IFS=, read -r A1 A2 A3 <<< "$SIGNET_SITE_APPROVERS"
as() { cast rpc anvil_setBalance "$1" 0x16345785d8a0000 --rpc-url "$LOCAL" >/dev/null; cast send "$SITE_GATE" "${@:2}" --from "$1" --unlocked --rpc-url "$LOCAL" > /dev/null; }
for w in $A1 $A2 $A3 $SIGNET_SITE_PROPOSER $SIGNET_SITE_RECOVERY $SIGNET_SITE_GUARDIAN; do cast rpc anvil_impersonateAccount $w --rpc-url "$LOCAL" >/dev/null; done
[ "$(cast call "$SITE_GATE" "getApprovers()(address[3])" --rpc-url "$LOCAL" | tr -d '[] ' )" = "$A1,$A2,$A3" ] || { echo "approvers on the site gate are not the inputs"; exit 1; }
H=$(cast keccak rehearsal)
as $SIGNET_SITE_PROPOSER "proposeRelease(bytes32,bytes32,bytes32,bool)" $H $H $H true
ID=$(cast call "$SITE_GATE" "proposalCount()(uint64)" --rpc-url "$LOCAL" 2>/dev/null || echo 1)
if cast send "$SITE_GATE" "approve(uint64)" 1 --from $SIGNET_SITE_PROPOSER --unlocked --rpc-url "$LOCAL" >/dev/null 2>&1; then echo "the CI proposer could approve: STOP"; exit 1; fi
log "CI proposer $SIGNET_SITE_PROPOSER proposed release 1 and was refused when it tried to approve"
for a in $A1 $A2 $A3; do as $a "approve(uint64)" 1; done
as $SIGNET_SITE_PROPOSER "publish(uint64)" 1
[ "$(cast call "$SITE_GATE" "currentRelease()(uint64)" --rpc-url "$LOCAL")" = "1" ] || { echo "the release did not publish"; exit 1; }
as $SIGNET_SITE_GUARDIAN "freeze()"
as $A1 "approveUnfreeze()"; as $A2 "approveUnfreeze()"; as $A2 "unfreeze()"
[ "$(cast call "$SITE_GATE" "frozen()(bool)" --rpc-url "$LOCAL")" = "false" ] || { echo "unfreeze failed"; exit 1; }
log "site gate: approvers A, B, C approved; the release published (emergency lane, 3 of 3); the guardian froze it; A and B unfroze it"

log "ALL PASSED"
