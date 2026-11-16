# Overnight log

Work is on the branch `overnight-phases` (one commit per phase; fast-forward `main` to it when you've looked).
Staging only. Nothing was sent to mainnet and ReleaseGate is unchanged.

## Phase 1: CLI change + Action + Diff Guard (2026-11-17)

**Done**
- **SRI hashes are in `originsHash`.** `signet/origins.json` is now `{"origins":[…],"scripts":[{url, integrity}]}`. A changed SRI hash is tier 01 on-chain (staging test), and so is a new or removed cross-origin script on an already-allowed origin.
- **Diff Guard: `signet diff <id> [buildDir] [--base dir] [--json]`.** Files changed, new/removed contracts, spenders and EIP-712 verifiers, new/removed origins, changed SRI hashes, new approve/permit/transfer calls with the file and code around them, and the on-chain tier with the reason and what it needs to publish. Output for the poisoned-npm-package build: `docs/demo/diff-guard-poisoned.txt` (+ `.json`).
- **GitHub Action** (`packages/action`): verify → seal → propose → Diff Guard in the job summary → poll until published on-chain → write manifest files → deploy. Example workflow: `packages/action/example-workflow.yml` (5 lines for the team). New CLI commands behind it: `signet wait <buildDir>`, `signet propose --reuse --json`.
- Tests: 29 CLI unit, 3 action static, 182 Foundry, and on staging 9 CLI end-to-end + 5 action end-to-end (first release, re-run, 1 h timelock with a timed-out job and its re-run, poisoned build cancelled → no deploy, rejected build / missing key). `pnpm staging:demo` still passes.

**Not done / limits**
- The action has **not run on GitHub**. It was run on staging through a local stand-in for the runner (`packages/action/test/runner.ts`). The `uses: kenil1710/signet/packages/action@main` path is a guess (the repo has no remote).
- The call detection is a text scan: calls assembled at runtime aren't found, and swapping one existing approve site for a malicious one shows no "new call" (the new address still shows).
- `signet diff` needs the proposed build's bytes locally; the dashboard will need them too (CI artifact or rebuild).

**Decisions I made (details in `docs/decisions.md`; the first two need your yes/no)**
1. The action **never calls `publish`**; it only waits. The spec said "the Action does it"; your instruction said wait, and rule 4 says the CI key only proposes. Someone runs `signet publish <id>` after the timelock.
2. The action **writes the three manifest files on-chain after publication**, paid by the proposer key (`upload-manifest`, default on). Without it the site would deploy while the chain still holds the old lists. The registry takes these bytes from anyone and only if they hash to the current release.
3. `files.json` now carries `calls` (signing-call counts) so Diff Guard can compare with a release whose code isn't on-chain; `loadSealed` refuses a summary that doesn't match the code.
4. A job can't wait 24 h on GitHub: the wait times out after 5 h 30 min without deploying, and a re-run picks up the same proposal (`--reuse`).
5. I also updated the tier-01 row in `CLAUDE.md` and the spec to mention SRI hashes.

**Seen while testing:** the staging suites failed once when started right after the Foundry fork tests with another suite still on the chain (3 publish tests failed, one `init` hung waiting for a receipt). Each suite passes when run on its own; I could not reproduce it alone, so the cause is not confirmed. Run staging suites one at a time.
