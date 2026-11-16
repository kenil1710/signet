#!/usr/bin/env bash
# The whole CLI flow on the staging chain, as a transcript: set up a project, check and seal a build, publish
# the first release, publish a code-only release after its 1 h timelock, see a riskier change get a higher tier,
# freeze and unfreeze. Needs `pnpm staging:up`. Every run uses a new domain, so it can be repeated.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL="http://127.0.0.1:${STAGING_PORT:-8545}"
cast rpc anvil_nodeInfo --rpc-url "$LOCAL" >/dev/null 2>&1 || { echo "no local anvil at $LOCAL (run: pnpm staging:up)"; exit 1; }
export SIGNET_NETWORK=local
unset SIGNET_PRIVATE_KEY SIGNET_PROPOSER_KEY
DOMAIN="${1:-swap-$(date +%s | tail -c 6).signet.test}"
PROJECT="$ROOT/staging/.run/demo-project"
PORT="${DEMO_PORT:-4179}"
rm -rf "$PROJECT" && mkdir -p "$PROJECT" && cd "$PROJECT"

signet() { node "$ROOT/packages/cli/src/cli.ts" "$@"; }
build() { node "$ROOT/packages/cli/test/fixtures.ts" dist "$1" >/dev/null; }
say() { printf '\n\033[1m# %s\033[0m\n' "$*"; }
run() { printf '$ %s\n' "$*"; "$@"; }
refused() { printf '$ %s\n' "$*"; if "$@"; then echo "!! expected this to be refused"; exit 1; else echo "(exit $?)"; fi; }
staging() { printf '$ pnpm staging:%s\n' "$*"; "$ROOT/staging/$1.sh" "${@:2}"; }

say "1. signet init: create the gate (3 approvers, CI proposer, recovery, guardian) and bind $DOMAIN"
run signet --as user1 init --domain "$DOMAIN" --approvers approver1,approver2,approver3 --recovery recovery --guardian guardian --no-wait
staging time blocks 2
run signet --as user1 init
PROPOSER=$(jq -r .proposer .signet/init.json)
staging fund "$PROPOSER" 1

say "2. signet verify: is the build something Guard can check?"
build v1
run signet verify dist
echo "(the same build behind a CDN that sends no-store and injects Rocket Loader)"
node "$ROOT/packages/cli/test/serve.ts" dist "$PORT" --no-store --rocket >/dev/null &
SERVER=$!; trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.1; done
refused signet verify "http://127.0.0.1:$PORT/" --build dist
kill $SERVER 2>/dev/null || true; wait $SERVER 2>/dev/null || true

say "3. signet seal: hash every file, extract the allowlist and the origins"
run signet seal dist
run cat dist/signet-manifest.json

say "4. First release: CI proposes, 3 approvers approve, anyone publishes"
run signet propose dist --emergency
run signet --as approver1 approve 1
refused signet --as user2 publish 1 dist
run signet --as approver2 approve 1
run signet --as approver3 approve 1
run signet --as user2 publish 1 dist --full

say "5. A code-only release: 1 approval + 1 h timelock"
build v2
printf '$ signet seal dist | head -5\n'; signet seal dist | head -5
run signet propose dist
run signet --as approver2 approve 2
refused signet --as user2 publish 2 dist
staging time 1h
run signet --as user2 publish 2 dist
run signet status dist

say "6. A new contract address in the build: the chain, not CI, raises the tier"
build v3
printf '$ signet seal dist | sed -n 6,12p\n'; signet seal dist | sed -n 6,12p
run signet propose dist
run signet --as approver1 approve 3
run signet status
run signet --as approver3 cancel 3

say "7. Freeze: the guardian stops everything; 2 approvers unfreeze"
run signet --as guardian freeze
run signet status
run signet --as approver1 unfreeze
run signet --as approver2 unfreeze
echo
echo "demo OK: $DOMAIN"
