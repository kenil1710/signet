#!/usr/bin/env bash
# Starts the local staging chain: anvil forked from X Layer mainnet, with Signet's contracts deployed on it.
# Nothing here touches mainnet: it only READS mainnet state through the fork.
#   pnpm staging:up        start (or report that it is already running)
#   pnpm staging:down      stop
#   STAGING_FORK_BLOCK=76000000 pnpm staging:up   fork at a fixed block
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$ROOT/staging/.run"; mkdir -p "$RUN"
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" && set +a
PORT="${STAGING_PORT:-8545}"
LOCAL="http://127.0.0.1:$PORT"
FORK_URL="${XLAYER_RPC_URL:?set XLAYER_RPC_URL in .env (the mainnet RPC to fork from)}"
OUT="$ROOT/packages/contracts/deployments/local.json"

DEV=0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE          # holds circuit #5 on mainnet
SITES=0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6
SHARED=0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed

if [ -f "$RUN/anvil.pid" ] && kill -0 "$(cat "$RUN/anvil.pid")" 2>/dev/null; then
  echo "staging chain already running (pid $(cat "$RUN/anvil.pid")) at $LOCAL. Stop it with: pnpm staging:down"; exit 0
fi
if cast block-number --rpc-url "$LOCAL" >/dev/null 2>&1; then
  echo "something else is already listening on $LOCAL; set STAGING_PORT to use another port"; exit 1
fi

# Fresh test wallets from a fixed seed. NOT anvil's default accounts: those well-known keys have history
# (and sometimes code) on real chains, which a fork would inherit.
ARGS=(--fork-url "$FORK_URL" --chain-id 196 --port "$PORT" --accounts 10 --balance 1000 --mnemonic-seed-unsafe 196196)
[ -n "${STAGING_FORK_BLOCK:-}" ] && ARGS+=(--fork-block-number "$STAGING_FORK_BLOCK")
nohup anvil "${ARGS[@]}" > "$RUN/anvil.log" 2>&1 &
echo $! > "$RUN/anvil.pid"
for _ in $(seq 1 60); do cast block-number --rpc-url "$LOCAL" >/dev/null 2>&1 && break; sleep 0.5; done
cast block-number --rpc-url "$LOCAL" >/dev/null 2>&1 || { echo "anvil did not start; see $RUN/anvil.log"; exit 1; }
[ "$(cast chain-id --rpc-url "$LOCAL")" = "196" ] || { echo "unexpected chain id"; exit 1; }
FORK_BLOCK=$(cast block-number --rpc-url "$LOCAL")

ACCOUNTS_JSON=$(cast rpc eth_accounts --rpc-url "$LOCAL")
export STAGING_ACCOUNTS=$(echo "$ACCOUNTS_JSON" | jq -r 'join(",")')
A() { echo "$ACCOUNTS_JSON" | jq -r ".[$1]"; }

# Skeleton that the forge script fills in.
jq -n --arg rpc "$LOCAL" --argjson block "$FORK_BLOCK" --argjson a "$ACCOUNTS_JSON" '{
  name: "local", chainId: 196, rpcUrl: $rpc, forkOf: "X Layer mainnet", forkBlock: $block,
  contracts: {}, gates: {site: {}, demo: {}},
  tapeout: {
    processor: "0x73153e5fd2Acac604D49d6ca9fea27b750718F22", policyCircuitId: 6,
    circuitBeacon: "0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C",
    circuitImplementation: "0x977f217887E085D298Cb3819cDAD5A0ee35F29B2",
    processorCodehash: "0x57aa306fd0be97087da3534e03398f5ff4efd533b5be4e45a405ce86fa6717d5",
    siteRegistry: "0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6",
    containerOpener: "0x536adD8F30f03b69f6fbF29d425A816A0dC50106",
    sharedCircuitId: 5, sharedContainer: "0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed"
  },
  accounts: {deployer: $a[0], approvers: [$a[1], $a[2], $a[3]], proposer: $a[4], recovery: $a[5], guardian: $a[6], users: [$a[7], $a[8], $a[9]]}
}' > "$OUT"

cd "$ROOT/packages/contracts"
run() { forge script script/Staging.s.sol --sig "$1" --rpc-url "$LOCAL" --broadcast --unlocked --sender "$(A 0)" 2>&1 \
  | grep -E '^  |Error|error|revert' || true; }

echo "deploying registry and factory..."
run "deploy()"
REG=$(jq -r '.contracts.registry // empty' "$OUT"); [ -n "$REG" ] || { echo "deploy failed; see output above"; exit 1; }

# The holder of circuit #5 (the dev wallet on mainnet) makes the registry the shared container's operator.
# On the fork we impersonate it; on mainnet this is a real transaction from that wallet (or the multisig).
cast rpc anvil_setBalance $DEV 0x8ac7230489e80000 --rpc-url "$LOCAL" >/dev/null
cast rpc anvil_impersonateAccount $DEV --rpc-url "$LOCAL" >/dev/null
cast send $SITES "setOperator(address,address,uint256)" $SHARED "$REG" 2592000 --from $DEV --unlocked --rpc-url "$LOCAL" >/dev/null
cast rpc anvil_stopImpersonatingAccount $DEV --rpc-url "$LOCAL" >/dev/null

cast rpc anvil_mine 0x2 --rpc-url "$LOCAL" >/dev/null   # commit-reveal: reveals need commits 2 blocks old
echo "creating the Signet site gate and the demo project gate..."
run "gates()"
[ -n "$(jq -r '.gates.demo.address // empty' "$OUT")" ] || { echo "gate creation failed; see output above"; exit 1; }

echo
echo "staging chain is up: $LOCAL (chain id 196, forked at block $FORK_BLOCK)"
jq '{contracts, gates, accounts}' "$OUT"
echo "config for every package: SIGNET_NETWORK=local  (written to $OUT)"
echo "test wallet private keys: $RUN/anvil.log   |  time travel: pnpm staging:time 24h   |  check: pnpm staging:smoke"
