# Final plan: positioning, onboarding, risk check, watchtower (2026-11-19)

Everything below is **built and tested, not deployed**. The site changes ship in the release after #3 (Fri 20 Nov,
after 13:45 IST). No mainnet transaction was sent for this plan.

## 0. The intermittent benchmark failure: cause and fix

| | |
|---|---|
| Symptom | One `pnpm benchmark` run stopped in the hash-only run after 6 attacks with exit 1 and **no message** |
| Why no message | The suite wrote its error with `console.error` and called `process.exit(1)`; on macOS a pipe is written asynchronously, so the message was dropped. **Fixed:** written synchronously, naming the attack it failed in; `ATTACKS_TRACE=1` prints each attack's duration |
| Cause | Each attack starts a browser with Guard and waits for Guard's first sync of the sealed-domain list. A failed first sync (an RPC error or the two RPCs disagreeing for a moment) was swallowed, and Guard waited for its **5-minute** alarm. Reproduced by saturating every CPU core ("timed out waiting for the sealed-domain list to include …"). **A real Guard bug:** a fresh install on a bad network had no sealed list, so no protection, for 5 minutes |
| Fix | Guard retries a failed sync after 2, 5, 10 and 20 s, then by a one-minute alarm (`extension/src/background.ts`). The harness waits up to 45 s for it and up to 90 s for Chromium to start the extension under load |
| Also found | The harness never deleted its temp folders (~200 per run, browser profiles included) and filled the disk; it now removes them at exit (`KEEP_TMP=1` keeps them). `staging:up` assumed signet-dev holds circuit #5; it now impersonates the current holder (the site gate since 2026-11-19) |

**Reruns** (`pnpm staging:down && pnpm staging:up && pnpm benchmark`, a fresh fork each time):

| Runs | Code | Result |
|---|---|---|
| 5 | before the fix | 5/5 passed: SRI 2/12, hash-only 7/12, Signet 12/12, 0 false blocks; 11 min each |
| 5 | after the fix | 5/5 passed, the same numbers; 10–11 min each, ≈ 0.1–0.4 GB of disk per run (was growing without limit) |
| 1 | after the fix, half the CPU cores saturated (the conditions of the original failure) | passed, the same numbers; 11 min |
| — | every core saturated | fails: Chromium can't even start the extension in 90 s. Beyond any realistic load; recorded, not chased |

## 1. Team-first positioning

- Landing (`packages/dashboard/index.html`): hero "Your contracts are audited. Your website isn't." + "Signet
  protects what your users actually load: no single hacked key can change your site, you know within minutes if
  anyone does, and users with Signet Guard can't sign anything your team didn't approve."
- New order: **01 The problem** (a path GitHub → build + packages → hosting / CDN → domain → browser, with Ledger
  Connect Kit, Bybit / Safe{Wallet}, BadgerDAO, Curve and CoW Swap placed where they happened, GitHub clean in every
  case), **02 What your team gets** (approvals + timelock nobody can bypass, watchtower alerts, instant freeze,
  verified copy (live with Pro), public proof + badge, then Guard as the extra layer), **03 Why not just GitHub?**,
  then the Guard demo, how it works, the rule, the benchmark, proof and pricing.
- "Why not just GitHub?" is from GitHub's docs (checked 2026-11-19): environments have required reviewers (up to 6,
  **one approval is enough**) and a wait timer, on Free / Pro / Team plans for **public** repositories;
  **administrators can bypass protection rules by default** ("Allow administrators to bypass configured protection
  rules"), and branch protection likewise unless "Do not allow bypassing the above settings" is set.
- README, JUDGES.md and llms.txt lead with the same pitch; README has the GitHub table with its sources.
- Words checked: "what your users actually load", "no single key", "builds on TapeKit", "blocks the signature"
  are used; "unhackable", "protects everyone" and "install now" don't appear; every Chrome button says "coming soon".

## 2. Onboarding (/start, CLI 0.1.3)

- **`npx signetguard init`**: bare in a terminal, or with `--gate` / `--host`, a setup with no transaction: the CI
  proposer key, `signet.config.json` (via `link`, which checks the registry binding), the domain proof, the
  host's header file (`_headers` for Cloudflare and Netlify, `public/vercel.json`, `.nojekyll` for GitHub Pages),
  and `.github/workflows/signet.yml` for the host. With the role flags, `init` still creates the gate on-chain
  (the staging harness and scripts use that). Unit tests: `packages/cli/test/setup.test.ts`.
- /start: the one-command box, guides for Cloudflare Pages, Netlify, Vercel and GitHub Pages (deploy the exact
  sealed folder; the Cloudflare Email Obfuscation / Rocket Loader warning), an FAQ (contracts unchanged, cost, lost
  approver key: recovery replaces the set after 7 days unless 2 approvers cancel, speed, users without Guard, the
  slow first release) and a "Get free setup help" section.
- CLI **0.1.3** (not published): passes the install-test gate; README shows `npx signetguard init`.
- The build fails on email-like text in any page (the Cloudflare rewrite that broke release 3's seal once).

## 3. Free risk check at /check

- `packages/dashboard/functions/api/check.ts`: a Cloudflare Pages Function (deploys with the site, free tier).
  Read-only: one page load, its headers, `/.well-known/signet.json`, public DNS over HTTPS, the registry's RDAP
  record (via IANA's bootstrap; rdap.org blocks non-browser clients). Only public hostnames (no IPs, ports,
  localhost); results cached 10 min per domain; 10 checks a minute per IP (best effort, per worker instance);
  nothing stored or logged. Says plainly what it can't see (runtime-loaded scripts, what a wallet is asked to sign,
  whether files match what the team reviewed, account security).
- Tested: unit tests (`test/risk-check.test.ts`), and the real function under `wrangler pages dev` (report,
  cache hit, `127.0.0.1` refused, 429 after 10 requests a minute).
- Three public dApps (read-only, 2026-11-19):

| Site | Findings |
|---|---|
| app.uniswap.org | risk: 2 scripts from 2 other origins without SRI (challenges.cloudflare.com, cdn.app.uniswap.org); 723 preloads from cdn.app.uniswap.org without SRI; CSP present but without script-src or default-src; not sealed; registrar lock on (Cloudflare) |
| app.aave.com | the one external script has SRI; no CSP; can be framed; not sealed; no CAA; registrar lock on (Cloudflare) |
| curve.finance | no external scripts; no CSP; can be framed; not sealed; registrar lock on (MarkMonitor) |

## 4. Watchtower live

- `.github/workflows/watchtower.yml`: every 5 minutes, the existing watchtower (a real browser, two-load
  confirmation, "recovered" messages) for `signetguard.xyz`; Telegram alerts; state and a public `status.json` on a
  `watchtower-status` branch (one commit, replaced each round). Needs the repository **public** (free minutes);
  GitHub starts schedules on a best-effort basis.
- **Operator auto-renew** (`packages/watchtower/src/renew.ts`): fewer than 7 days left → simulate, then send
  `siteGate.renewOperator(processor, 5)` from a dedicated renewer wallet; alerts once on renewal, failure and low
  balance. Staging test: "operator grant" in `packages/watchtower/test/staging/watchtower.test.ts`.
- **Renewer wallet:** `0xF7fFeD07bc29271306cBBCb94b4c02F655B0E4b0` (key in `packages/watchtower/.secrets/renewer.key`,
  git-ignored, never printed). Not funded.
- /prove and each project page show the watchtower's last round and result, or "no public status yet". The
  status is served same-origin by a Pages Function (`/api/watchtower`), so the site talks to no new origin: the next
  release stays **tier 00** (allowlist and origins identical to release #3, checked by sealing the build).

## 5. As a stranger

- **From a clean folder, the 0.1.3 tarball** (`npm install -g` into a fresh prefix, a bare PATH, no repo), following
  /start's one-command path on a mainnet fork: `signet init --domain … --gate … --host cloudflare --yes` wrote the
  config, the proof, the `_headers` CORS rule and a workflow pinned to `signetguard@0.1.3`; then verify / seal /
  propose (tier 10, computed on-chain), approvals A and B in the dashboard, 24 h, `signet wait --publish` (manifest
  stored), and the badge "Sealed by Signet". **All steps passed.**
- **/check on 3 public dApps:** the table in section 3.
- **The watchtower catches a tampered file on the fork and alerts:** the watchtower staging suite (10/10): a
  tampered bundle seen on two loads in a row sends one private Telegram alert, "recovered" when fixed, a dead site
  alerted, a squatted domain ignored, and the operator auto-renew (fixed on the way: it used the wall clock instead
  of chain time).
- Also green: Guard staging 16/16, dashboard staging 7/7, CLI staging 9/9, all unit tests, Foundry 189/189
  (three mainnet-fork tests assumed signet-dev still held circuit #5: `Core.fork` now uses the holder at the fork
  block, the two historical spikes are pinned to a block before the move), typecheck 0 errors.

## Needs a decision

1. **Publish CLI 0.1.3** (it supersedes 0.1.2; it passed the install gate): `cd ~/signet/packages/cli/release/pkg && npm publish --access public`. /start's commands pin 0.1.3.
2. **Fund the renewer wallet** `0xF7fFeD07bc29271306cBBCb94b4c02F655B0E4b0` with **0.0001 OKB** (≈ 40 renewals, one every ~23 days). From any wallet; the transfer itself costs ≈ 0.0000004 OKB. Not sent.
3. **Telegram:** create a bot (@BotFather) and a chat; then add the GitHub secrets `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `WATCHTOWER_RENEW_KEY` (the content of `packages/watchtower/.secrets/renewer.key`). Also the public Telegram / X links for "Get free setup help" (shown as "coming soon" until then).
4. **The watchtower needs the repository public** (GitHub's free minutes); it starts on the first push after the flip.
5. Still open from before: the Pro / Enterprise prices, and the commit author email that becomes public with the repo.
