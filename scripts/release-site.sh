#!/usr/bin/env bash
# Deploy a sealed release of signetguard.xyz and publish it on X Layer back to back, so the live site and the published
# seal differ for seconds, not minutes (release #8: deployed 12:28, published 12:36 UTC; every Guard user saw a
# mismatch in between).
#
#   scripts/release-site.sh <release id>          e.g. scripts/release-site.sh 9
#
# Order: 1. refuse unless the chain says the release can publish NOW (approvals + timelock) and release/<id> is exactly
# the proposed build; 2. deploy release/<id> (without its manifest folder) to Cloudflare Pages; 3. publish at once
# (the CI key from packages/dashboard/.signet/proposer.key; the policy circuit decides) and store the manifest files;
# 4. check every live file byte for byte with a browser user agent. Guard 0.3.2 re-reads the chain before reporting a
# mismatch, which covers a visitor inside the seconds between 2 and 3.
# Sends one mainnet transaction set (publish + manifest writes): run it only after the team said yes to the publish.
set -euo pipefail
ID="${1:?usage: scripts/release-site.sh <release id>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DASH="$ROOT/packages/dashboard"
REL="$DASH/release/$ID"
CLI=(node "$ROOT/packages/cli/src/cli.ts" -C "$DASH")
export SIGNET_NETWORK=mainnet
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

[ -f "$REL/signet-manifest.json" ] || { echo "no sealed build at $REL"; exit 1; }

echo "1/4 the proposal and the build"
# `wait` refuses a folder that isn't the build proposed for that release, and says whether it can publish now
STATUS="$("${CLI[@]}" wait "$REL" --timeout 1 --interval 1 2>&1 || true)"
if echo "$STATUS" | grep -q "is not the build that was proposed"; then echo "$STATUS" | head -3; exit 1; fi
echo "   $(echo "$STATUS" | grep -m1 -E 'waiting for|Published|current release' || echo "$STATUS" | tail -1)"
echo "$STATUS" | grep -q "can publish now" || { echo "   not publishable now: nothing deployed, nothing sent"; exit 1; }

echo "2/4 deploy release/$ID to Cloudflare Pages"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
cp -R "$REL/." "$STAGE/"; rm -rf "$STAGE/signet" "$STAGE/signet-manifest.json"
# from packages/dashboard: wrangler takes the Pages Functions (/api/check, /api/watchtower) from ./functions in the
# directory it runs in. Releases #7-#9 were deployed from elsewhere and went out without them (found 2026-11-25).
(cd "$DASH" && npx -y wrangler@4 pages deploy "$STAGE" --project-name signet --branch main --commit-dirty=true 2>&1 | grep -E 'Deployment complete|Success|Compiled Worker|functions|error' || true)

echo "3/4 publish #$ID now (seconds after the deploy)"
"${CLI[@]}" wait "$REL" --publish --timeout 300 --interval 2

echo "4/4 every live file against release/$ID (browser user agent)"
sleep 5
n=0; bad=0
while IFS= read -r f; do
  n=$((n + 1))
  case "$f" in index.html) u="https://signetguard.xyz/" ;; *.html) u="https://signetguard.xyz/${f%.html}" ;; *) u="https://signetguard.xyz/$f" ;; esac
  live="$(curl -s -A "$UA" "$u" | shasum -a 256 | cut -c1-64)"
  sealed="$(shasum -a 256 "$REL/$f" | cut -c1-64)"
  [ "$live" = "$sealed" ] || { bad=$((bad + 1)); echo "   DIFF $f"; }
done < <(cd "$REL" && find . -type f ! -name signet-manifest.json ! -path './signet/*' ! -name _headers | sed 's#^\./##' | sort)
echo "   $n files, $bad differ"
# the server-side endpoints (not sealed files): they must answer JSON, not the landing page
for api in "api/check?domain=example.com" "api/watchtower"; do
  ct="$(curl -s -o /dev/null -w '%{content_type}' -A "$UA" "https://signetguard.xyz/$api")"
  case "$ct" in application/json*) echo "   /$api: JSON" ;; *) bad=$((bad + 1)); echo "   /$api: NOT JSON ($ct): the Pages Functions were not deployed" ;; esac
done
[ "$bad" -eq 0 ]
