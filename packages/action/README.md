# @signet/action

GitHub composite action: **verify → seal → propose → wait for approvals and the timelock → publish → deploy.**

```yaml
- uses: kenil1710/signet/packages/action@main   # placeholder path until the repo is public
  with:
    build-dir: dist
    proposer-key: ${{ secrets.SIGNET_PROPOSER_KEY }}
    deploy: npx wrangler pages deploy dist       # runs only after the release is published on-chain
```

A full workflow is in [`example-workflow.yml`](./example-workflow.yml). The repo needs `signet.config.json`
(written by `signet init`) and the secret `SIGNET_PROPOSER_KEY`.

What it does on every push to main:

1. `signet verify` and `signet seal` on your build. A build Guard can't check (for example a cross-origin script without SRI) stops here.
2. `signet propose` with the proposer key. The gate computes the risk tier on-chain. **The CI key can only propose: it can never approve.**
3. Runs Diff Guard and puts the report in the job summary (and its JSON path in the `diff-json` output).
4. Polls the chain while approvers run `signet diff <id>` and `signet approve <id>`. When the approvals and the timelock are there, it sends `publish`. Anyone may send that call and the policy circuit decides, so it gives the key no power: without approvals nothing publishes. `publish: false` leaves it to someone else.
5. Writes the release's three manifest files on-chain if they aren't there yet (`upload-manifest: false` turns this off).
6. Runs your `deploy` command. If the proposal is cancelled, expires or goes stale, the job fails and nothing deploys.

**Long timelocks.** A GitHub-hosted job ends after 6 hours, and a new contract address needs 24 hours. The action
gives up after `wait-timeout` seconds (default 5 h 30 min, exit code 3, no deploy). Re-run the job once the release
is published: it finds the same proposal (or sees the build is already current) and deploys. This needs a
reproducible build; a rebuild with different bytes is a new proposal.

| Input | Default | |
|---|---|---|
| `build-dir` | required | the static build output |
| `proposer-key` | required | `secrets.SIGNET_PROPOSER_KEY` |
| `deploy` | empty | your deploy command; or leave empty and deploy in later steps of the job |
| `project-dir` | `.` | where `signet.config.json` is |
| `wait-timeout` / `poll-interval` | `19800` / `30` | seconds |
| `publish` | `true` | send the publish call once approvals and timelock allow it |
| `upload-manifest` | `true` | write the manifest files on-chain after publication |
| `emergency` | `false` | ask for the fast lane (3 of 3, tiers 00 and 10) |
| `strict` | `false` | fail on `signet verify` warnings |

Outputs: `release-id`, `tier`, `manifest-hash`, `diff-json`.

**Status.** Tested on the staging chain through a local stand-in for the GitHub runner
(`pnpm --filter @signet/action test:staging`, needs `pnpm staging:up`). It has not run on GitHub yet, and Signet's
contracts are not on mainnet yet, so today it works only with `"network": "local"`.
