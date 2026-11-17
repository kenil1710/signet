# Overnight log

## Final summary (2026-11-17)

All three phases are built and tested on the staging chain. Nothing touched mainnet, no funds were spent, and
`packages/contracts/src` is unchanged (ReleaseGate included). The work is on the branch **`overnight-phases`**,
one commit per phase; `main` is where you left it.

| Phase | State | Tests |
|---|---|---|
| 1. SRI in `originsHash`, Diff Guard, GitHub Action | Done. The action has not run on GitHub itself. | 29 CLI unit, 3 action static; staging: 9 CLI + 5 action |
| 2. Guard extension | Done, except that the verified copy is a preview without a wallet. Not tried with a real wallet. | 10 unit; staging: 10 headless scenarios |
| 3. Watchtower | Done for one region, console + Telegram. Telegram was tested against a local stand-in, not the real API. | 2 unit; staging: 8 scenarios |

Last full run: 182 Foundry tests, 49 unit tests, 32 staging end-to-end tests, all passing; typecheck clean.
Run the staging suites one at a time (`pnpm --filter @signet/<cli|action|extension|watchtower> test:staging`).

**Look at these first** (`docs/demo/`): `diff-guard-poisoned.txt`, `guard-blocked.png`, `guard-signature-refused.png`,
`guard-verified-copy.png`, `watchtower-hijack.txt`.

**Decisions waiting for your yes or no**
1. The action never calls `publish`; it waits for someone else to. (The spec said the action publishes.)
2. The action writes the three manifest files on-chain after publication, paid by the proposer key.
3. Guard refuses a token `transfer` to anyone who is neither the user nor a sealed contract. Right for a DEX, wrong for a "send" app.
4. Guard's list of sealed domains is the union of what the two RPCs report (protection over privacy against a lying RPC).
5. A revoked current release turns Guard red and refuses every signature in enforce mode.

**What is not done, in order of how much it matters**
1. **Failover doesn't let users keep using the app.** "Open verified copy" shows the sealed app read from the chain, hash-checked, in a sandboxed frame with no wallet. I found no documented way to open a container path as a normal page.
2. **The sealed-domain list won't scale on mainnet**: it is read from event logs. The registry needs an enumerable list before it is deployed.
3. Guard is untested with MetaMask / OKX Wallet and is not submitted to the Chrome Web Store (due Nov 27).
4. The action is untested on GitHub; its `uses:` path is a guess because the repo has no remote.
5. Watchtower: one region only, no TapeSend, no X posts, no status page; it does not renew the registry's 30-day operator grant.
6. Not started: the dashboard, mainnet deployment.

**Two things the tests turned up, both fixed**
- The registry's 30-day operator grant expired on staging (tests move the clock) and file writes reverted. `pnpm staging:renew` renews it. On mainnet this is a recurring duty with no owner yet.
- The CLI could wait forever for a transaction that had already been mined (viem's receipt wait on a chain that mines on demand). It now polls the receipt itself.

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
