#!/usr/bin/env bash
# Stops the local staging chain. Its state is thrown away; `pnpm staging:up` starts fresh.
set -euo pipefail
RUN="$(cd "$(dirname "$0")" && pwd)/.run"
if [ -f "$RUN/anvil.pid" ] && kill -0 "$(cat "$RUN/anvil.pid")" 2>/dev/null; then
  kill "$(cat "$RUN/anvil.pid")" && echo "staging chain stopped"
else
  echo "staging chain is not running"
fi
[ -f "$RUN/anvil.pid" ] && mv "$RUN/anvil.pid" "$RUN/anvil.pid.stopped" || true
