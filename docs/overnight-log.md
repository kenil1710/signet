# Overnight log

## Summary (updated 2026-11-17, after the follow-up fixes)

Everything below is merged into `main`: the three overnight phases plus the four follow-up fixes (section at the
end). Nothing touched mainnet and no funds were spent. **One contract changed:** SignetRegistry gained an
enumerable domain list (not deployed anywhere but staging). ReleaseGate and SignetFactory are unchanged.

| Part | State |
|---|---|
| SRI in `originsHash`, Diff Guard | Done. |
| GitHub Action | Done; it now publishes itself once the circuit allows it. Not yet run on GitHub. |
| Guard extension | Done; per-project transfer rule; opens the gateway for the verified copy. Not tried with a real wallet. |
| Failover gateway (new, `packages/gateway`) | Done on staging: the verified copy is a normal page where the wallet works. **Not deployed on a public https domain.** |
| Watchtower | Done for one region, console + Telegram (Telegram tested against a local stand-in). |

Last full run on `main`: 185 Foundry tests, 53 unit tests, 40 staging end-to-end tests (9 CLI, 6 action, 11 Guard,
6 gateway, 8 watchtower), all passing; typecheck clean. Run the staging suites one at a time
(`pnpm --filter @signet/<cli|action|extension|gateway|watchtower> test:staging`). The staging chain was
restarted once to deploy the new registry.

**Look at these first** (`docs/demo/`): `diff-guard-poisoned.txt`, `guard-blocked.png`, `guard-signature-refused.png`,
`guard-verified-copy.png` (the gateway copy, opened from the red page, signing an approve), `watchtower-hijack.txt`.

**Decisions still waiting for your yes or no**
1. The action writes the three manifest files on-chain after publication, paid by the proposer key.
2. A revoked current release turns Guard red and refuses every signature in enforce mode.
3. Hard rule 4 in `CLAUDE.md` says "never give it approve or publish rights". The action now *sends* the permissionless `publish` call. Suggested wording is in `docs/decisions.md`; I did not edit `CLAUDE.md`.
4. The default transfer rule is now stricter than overnight: `"user"` refuses a transfer to a sealed staking contract. Projects that need it seal `"allowlist"`.

**What is not done, in order of how much it matters**
1. **The gateway isn't deployed.** It needs a domain with wildcard DNS and a wildcard certificate, and Guard built with its URL. Until then "Open verified copy" works only on staging.
2. **Large apps can't be fully copied on-chain**: one file is at most 48,000 bytes; the multi-transaction upload isn't built. The gateway can only show what is stored.
3. Guard and the gateway are untested with MetaMask / OKX Wallet; Guard is not submitted to the Chrome Web Store (due Nov 27).
4. The action is untested on GitHub; its `uses:` path is a guess (no remote).
5. Watchtower: one region, no TapeSend, no X posts, no status page; nobody renews the registry's 30-day operator grant on mainnet.
6. Not started: the dashboard, mainnet deployment.

**Found by the tests, fixed:** the registry's 30-day operator grant expiring on staging (`pnpm staging:renew`), and a
CLI wait that could hang on an already-mined transaction.

Details per phase follow; every decision is in `docs/decisions.md`.

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

## Phase 2: Guard extension (2026-11-17)

**Done** (`packages/extension`, TypeScript + Vite, MV3; the Spike C prototype is removed)
- Finds the domain's gate through SignetRegistry, reads the current release from **2 RPCs at the same block that must agree**, caches it (fresh 60 s, usable 24 h if the RPCs are down). Grey badge and no blocking whenever it can't check.
- Fetches `allowlist.json`, `origins.json`, `files.json` from the container and **rejects them unless they hash to the on-chain values** (tested with RPCs that serve a forged allowlist).
- Page check from the browser cache, as in Spike C, now against the real sealed file list; cross-origin scripts by sealed SRI hash. Green / red / grey badge.
- Wraps `window.ethereum` and every EIP-6963 provider. Refuses `eth_sendTransaction`, typed data and permits for an unsealed target, spender, recipient or verifying contract, or on a tampered page. Decodes approve / transfer / transferFrom / permit / Permit2 / V2-router swaps; recipient ≠ user is refused.
- Observe and enforce mode from the gate. Full red page for a tampered site, full-page notice for a refused signature, "Report wrong block", "Open verified copy", popup.
- Privacy test: on an unsealed domain, zero RPC requests, the site sees only its own requests, nothing stored.
- Demo dApp is now a real swap/stake page (approve, swap, Permit2 signature, stake; `?spender=0x…` simulates a hostile API).
- Tests: 10 unit + 10 headless scenarios on staging (clean = green; tampered JS = red, blocked, drainer never reaches the wallet; unsealed spender = refused; observe mode = reported, never blocked; RPCs disagreeing or down = grey, nothing blocked; 24 h cache; forged manifest rejected; unsealed domain untouched). Screenshots: `docs/demo/guard-*.png`.

**Not done / limits**
- **The verified copy is a preview without a wallet.** It reads the release's files from the container, checks each against its sealed hash and renders them in a sandboxed frame. A user can't sign from it. I found no documented way to open a container path as a normal web page (rule 1), so "the app keeps working during the attack" is not delivered yet.
- Not tested with a real wallet (MetaMask, OKX Wallet): a mock wallet only. Not submitted to the Chrome Web Store.
- "Report wrong block" copies a report to the clipboard; there is no server to send it to.
- Top frame only; the other limits are listed in `docs/decisions.md`.
- **Before mainnet:** the sealed-domain list is read from event logs, which will take hundreds of requests for a late installer. The registry needs an enumerable list (it is not deployed yet, so it can still get one).

**Decisions I made** (all in `docs/decisions.md`, "Guard extension")
1. Sealed-domain list = union of both RPCs' logs, synced on a timer, never on page load.
2. Tampered page in enforce mode → the tab goes to an extension page (a hostile page can't remove it), with a way back that keeps signing blocked.
3. A revoked current release is red and refuses every signature in enforce mode.
4. A `transfer` to someone who is neither the user nor a sealed contract is refused. Right for a DEX, wrong for a "send tokens" app. Please check this one.
5. Direct `SiteRegistry.read` calls instead of the TapeKit kernel (the kernel can't point at the staging fork).

**Found while testing (both fixed)**
- The registry's 30-day operator grant expired because tests moved the staging clock; writes reverted with `NotOwner()`. New command: `pnpm staging:renew`. On mainnet someone must renew it every 30 days.
- The cause of the Phase 1 hang: viem's `waitForTransactionReceipt` can miss a block on a chain that mines on demand. The CLI now polls the receipt itself.

## Phase 3: Watchtower (2026-11-17)

**Done** (`packages/watchtower`)
- Every minute (`--interval`), each bound domain is loaded in headless Chromium and compared with the sealed release: document, scripts and stylesheets by SHA-256, cross-origin scripts by sealed SRI hash, and every origin the page contacted against the sealed origins.
- A mismatch is loaded a second time in a fresh context; only two bad loads in a row alert. One alert per distinct mismatch, one "Recovered" message. A site that can't be loaded twice is alerted too.
- Alerts go to the console, and to Telegram when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set. The token is never printed.
- Posts every new domain binding and every pending tier-10 / tier-11 proposal, once each (state file survives restarts).
- Staging test with the demo dApp: clean; one bad load not confirmed; hijack → one private alert; recovery; unreachable; tier 00 not posted, tier 10 and 11 posted; a second domain bound later; the command with and without Telegram. Sample output: `docs/demo/watchtower-hijack.txt`.

**Not done / limits**
- One region. "Confirm twice" is two loads from the same place, so a hijack that serves bad code once per visitor is not caught here (Guard catches that one).
- Telegram was exercised against a local stand-in for the Bot API. No message was sent to Telegram: there is no token in `.env`.
- No TapeSend, no X posts, no public status page, no guardian auto-freeze, no operator-grant renewal.

**Decisions I made**
1. Playwright's Chromium instead of Puppeteer (already installed for Guard's tests).
2. The previous release is accepted during its grace window, so a normal deploy right after publish doesn't alert.
3. A release whose manifest isn't on-chain (or doesn't hash to it) isn't compared; the team is told once.
4. Public posts go to `TELEGRAM_PUBLIC_CHAT_ID` if set, else to the same chat as alerts.

## Follow-up fixes (2026-11-17, asked for after the overnight run)

1. **The action publishes.** `signet wait --publish` sends `publish` once approvals and timelock allow it; the action does this by default (`publish: false` turns it off). Tested on staging: published by the action after 3 of 3 on a first release; nothing published during a 1 h timelock, then published when it ended; with no approvals the key publishes nothing; `publish: false` sends nothing. The docs still say the CI key can only propose and can never approve.
2. **Token transfers are per project.** `"transfers": "user" | "allowlist" | "any"` in `signet.config.json`, default `"user"`, sealed into `allowlist.json` (so changing it is tier 10, and Diff Guard flags it). Guard enforces it; approvals and swap recipients are never loosened. Tests: CLI seal, Diff Guard and Guard policy.
3. **SignetRegistry has `domainCount()` and `domainsRange(start, count)`.** Append-only, each domain once. 3 Foundry tests. Guard reads it on its timer from both RPCs, which must agree; the watchtower reads it each round. No event-log scanning left.
4. **Failover.** TapeKit's service-worker gateway is the right approach, but its public gateway can't show sealed projects: it serves a container from the root (free projects live under `projects/<domain>/` in a shared container), checks SiteRegistry's hash rather than the sealed release, and refuses unpaid containers (measured: it refuses Signet's). So I built **`packages/gateway` on the same design**: `https://<domain with dots as dashes>.<gateway>/` is a normal origin; a service worker in the visitor's browser reads the sealed lists, rejects them unless they hash to the gate's release, and serves each file only if its SHA-256 is the sealed one. Wallets inject. Guard opens it from "Open verified copy", treats it as the sealed domain, and pins the gateway's own three files. 6 gateway + 1 Guard staging scenarios (copy works and signs; changed file not shown; forged manifest, disagreeing or dead RPCs show nothing; CSP limits it to sealed origins; a changed gateway worker turns Guard red).
   - **Not possible as asked, in one respect:** an *https* page needs a deployed domain and certificate, which don't exist; it was tested on `http://*.localhost`, which browsers treat as secure. And a gateway always means trusting its three files: Guard's pin check can't read the bytes of an already-registered worker (details and mitigations in `docs/decisions.md`).
   - Research notes: `docs/tapeout-interfaces.md` §11.

## Judge-readiness round (2026-11-17)

1. **`CLAUDE.md` rule 4:** "The CI key can propose and call publish (the circuit decides); it can never approve, unfreeze, revoke or make admin changes." Committed.
2. **Mainnet plan** (`docs/mainnet-plan.md`): `MainnetDeploy.s.sol` rehearsed end to end on a mainnet fork (`staging/rehearse-mainnet.sh`): registry, factory (with the ReleaseGate implementation), commit, operator grant, Signet's site gate = 8,704,008 gas ≈ **0.00018 OKB**. The Guard circuit tape-out, simulated against live mainnet: ≈ **0.0020 OKB** (it would be circuit #7). Total ≈ 0.0022 of the dev wallet's 0.0466 OKB. **Nothing sent.** Needs: Signet's domain, six role addresses, the dev wallet as a Foundry keystore, and your yes.
3. **Guard decision circuit:** 9 inputs (`checked, pageMatches, targetSealed, spenderSealed, recipientOk, decoded, frozen, revoked, enforceMode`), outputs ALLOW/WARN/BLOCK, 22 NAND gates, exhaustive 512-row test and `docs/guard-truth-table.md`. Taped out on staging (512/512 through `eval`). Guard now asks it (`eval` view call on two RPCs, cached per input) before every signature; the local mirror decides only if the circuit can't be read or isn't the reviewed netlist. Two inputs beyond the seven asked for (`checked`, `decoded`), and `recipientOk` instead of `recipientIsUser`: reasons in `docs/decisions.md`.
4. **Attack suite** (`pnpm attacks`): **all 12 attacks against Guard users blocked, 0 false blocks on 16 clean sessions**. Reported separately as a known limit: the user without Guard is not protected. Building it removed one false success (a drainer that never asked for a signature) and one test artifact (a request sent from Guard's own warning page), and led to one defensive fix (refuse when an answer is lost on a known-red page).
5. **`JUDGES.md`, `CLAIMS.md`, `THREAT_MODEL.md`, `README.md`, `pnpm verify:claims`:** 7 mainnet claims pass on both operators, 8 repo claims pass, 2 PENDING (Signet's contracts, the Guard circuit on mainnet). Overclaims removed from the spec, `CLAUDE.md` and the READMEs.

Last full run: 185 Foundry tests, 58 unit tests, 41 staging end-to-end tests, the attack suite and `verify:claims`, all passing; typecheck clean.

## Next phase, item 1: comparison benchmark (2026-11-17)

`pnpm benchmark` runs the whole attack suite against three defenders, each with fresh projects on staging: **SRI only 2/12, a hash-only checker 7/12, Signet 12/12; 0 false blocks for each** (`docs/benchmark.md`).
- **The hash-only column is an ablation**, not TEE Shield itself: Guard built with `GUARD_MODE=hash-only` (page check on, signing-time allowlist off). It isolates what the signing check adds: eval/new Function code, a malicious router recipient, permit phishing, a poisoned package and rollback inside the grace window.
- **SRI gets its best case:** an integrity attribute on every script and stylesheet in the HTML.
- **Two fixes in my own harness before the numbers were right:** in SRI mode the server first dropped the integrity attributes on unmodified pages (SRI then looked like it blocked nothing), and the after-grace rollback never asked for a signature when the page wasn't blocked (SRI got a free "blocked"; corrected 3/12 → 2/12). The other two columns were blocked at the page there, so the fix doesn't change them.
