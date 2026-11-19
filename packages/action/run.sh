#!/usr/bin/env bash
# The action's main step: verify -> seal -> propose -> Diff Guard -> wait until published on-chain.
# The proposer key is handed only to the commands that send a transaction: propose, the publish call once the
# approvers and the timelock allow it, and the manifest upload. The key can only propose: it can never approve.
# publish and the upload are open to anyone (the policy circuit and the registry decide), so they add no power.
# Exit code 0 means "this exact build is the gate's current release": only then may the deploy step run.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CLI="${SIGNET_CLI:-$HERE/../cli/src/cli.ts}"
PROJECT="${INPUT_PROJECT_DIR:-.}"
BUILD="${INPUT_BUILD_DIR:?build-dir is required}"
KEY="${INPUT_PROPOSER_KEY:-}"
OUT="${GITHUB_OUTPUT:-/dev/null}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
TMP="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
unset SIGNET_PRIVATE_KEY SIGNET_PROPOSER_KEY # nothing here signs with a key from the outer environment

[ -n "$KEY" ] || { echo "::error::proposer-key is empty. Add the secret SIGNET_PROPOSER_KEY: the last step printed by signet init says how."; exit 1; }
echo "::add-mask::$KEY"
signet() { node "$CLI" -C "$PROJECT" "$@"; }
group() { echo "::group::$1"; }
endgroup() { echo "::endgroup::"; }

group "signet verify $BUILD"
if [ "${INPUT_STRICT:-false}" = "true" ]; then signet verify "$BUILD" --strict; else signet verify "$BUILD"; fi
endgroup

group "signet seal $BUILD"
signet seal "$BUILD"
endgroup

group "signet propose $BUILD"
ARGS=(propose "$BUILD" --reuse --json)
[ "${INPUT_EMERGENCY:-false}" = "true" ] && ARGS+=(--emergency)
RESULT="$(SIGNET_PROPOSER_KEY="$KEY" signet "${ARGS[@]}")"
field() { node -e 'const v = JSON.parse(process.argv[1])[process.argv[2]]; console.log(v === null ? "" : String(v))' "$RESULT" "$1"; }
ID="$(field id)"
CURRENT="$(field current)"
{
  echo "release-id=$ID"
  echo "tier=$(field tier)"
  echo "manifest-hash=$(field manifestHash)"
} >> "$OUT"
endgroup

if [ "$CURRENT" = "true" ]; then
  echo "This build is already the current release: nothing to approve."
  echo "### Signet: this build is already the current release" >> "$SUMMARY"
else
  group "Diff Guard: what release #$ID changes"
  DIFF_JSON="$TMP/signet-diff-$ID.json"
  signet diff "$ID" "$BUILD" --json > "$DIFF_JSON"
  DIFF_TEXT="$(signet diff "$ID" "$BUILD")"
  echo "$DIFF_TEXT"
  echo "diff-json=$DIFF_JSON" >> "$OUT"
  {
    echo "### Signet: release #$ID is waiting for approval"
    echo
    echo '```'
    echo "$DIFF_TEXT"
    echo '```'
    echo
    echo "Approvers: \`signet diff $ID <buildDir>\`, then \`signet approve $ID\`. Deploy starts when the release is published on-chain."
  } >> "$SUMMARY"
  endgroup

  group "Waiting for approvals and the timelock, then publishing release #$ID"
  if [ "${INPUT_PUBLISH:-true}" = "true" ]; then
    # publish is open to anyone and the policy circuit decides; the key adds nothing but the gas
    # --no-upload: the "upload-manifest" step below does it (and can be turned off)
    SIGNET_PROPOSER_KEY="$KEY" signet wait "$BUILD" --publish --no-upload --timeout "${INPUT_WAIT_TIMEOUT:-19800}" --interval "${INPUT_POLL_INTERVAL:-30}"
  else
    signet wait "$BUILD" --timeout "${INPUT_WAIT_TIMEOUT:-19800}" --interval "${INPUT_POLL_INTERVAL:-30}"
  fi
  endgroup
fi

if [ "${INPUT_UPLOAD_MANIFEST:-true}" = "true" ]; then
  group "Manifest files on-chain (so Guard reads this release before the site changes)"
  SIGNET_PROPOSER_KEY="$KEY" signet upload "$BUILD"
  endgroup
fi
echo "Published on-chain. The deploy step may run."
