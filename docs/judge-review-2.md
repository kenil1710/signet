# Judge review 2: fixes (2026-11-19)

An independent AI judge reviewed Signet from public evidence only (value 5, innovation 6, ecosystem 6, readiness 4).
Each item below was **verified first**, then fixed. Site changes are **built, not deployed**: they ship in release #4,
after release #3 is published (Fri 20 Nov 2026, from 13:45 IST). No transactions were sent for this review.

## A. What crawlers and AI judges see (raw HTML, no JavaScript)

| # | Verified (live signetguard.xyz, `curl`, text extracted without JS) | Fixed | Evidence |
|---|---|---|---|
| 1 | **True:** `Signet000` (the loader), `$0left Bybit…`, `$0sent…`, `Release#42`, `ChainX Layer`, `Files7 / 7`, `PolicyTapeOut`, and an unfilled `{{ORIGIN}}` on /start. **Not reproduced:** visible front-matter (`---`) or `meta-description` text; the live HTML has neither | The loader's text comes from CSS (`data-t`), its counter from JS. A space between every label and value (all are flex/grid or block children, so nothing moves on screen; the bar values `2/12` are excluded). Static counter values (`~$1.5B`). "Example release" on the hero's illustration. A `<noscript>` summary with the pitch, the four tiers, the benchmark and links. Real `<title>`, description, canonical and Open Graph tags. `{{ORIGIN}}` filled in at build time | `packages/dashboard/index.html`, `vite.config.ts` (`staticSite`). The built pages' no-JS text has none of the bad strings (checked by script) |
| 2 | **True:** `/app` without JS showed only the nav and a hidden "Your wallet is on chain ." | Static content in `#app` (replaced once JS runs): what Projects and Proof show, and the live contracts with OKLink links. The chain bar reads "another network" until JS fills in the chain id | `packages/dashboard/app.html`; with JS, the dashboard still renders (checked in Chromium at 1280 and 390 px) |
| 3 | **True:** GitHub, X, Telegram, Threat model and Claims were `href="#hero"` / `#proof` in the HTML (JS swapped them); the CTA said "Add Guard to Chrome, **free**" | Links are written into the HTML at build time (`applyLinksHtml`): a real URL, or **"coming soon"** with no href. Threat model, Claims and the benchmark are served by the site itself (`/docs/*.md`, built from the repository). Every Chrome button says "Guard for Chrome: coming soon" until the listing exists; "free" is gone. GitHub becomes a real link when built with `SIGNET_REPO_PUBLIC=1` | `src/landing/config.ts`; the built HTML has 0 `data-link` anchors pointing at `#…` |

## B. Honesty and consistency

| # | Verified | Fixed | Evidence |
|---|---|---|---|
| 4 | `ReleaseGate._policy` (`packages/contracts/src/ReleaseGate.sol:636–650`) calls circuit #6 on every publish and unfreeze; the Solidity mirror decides only if the beacon implementation differs from the pinned one or `eval` reverts / doesn't return 1 byte, with an event. `SetPolicyCircuit` (tier 11) only accepts a processor with the pinned code hash and a netlist with the pinned SHA-256 (`_setPolicy`, `:723–730`). Timelocks and approvers **can** change through tier 11 (`SetTimelocks`, bounds 10 min / 6 h–5 days). So "nobody can change the rule" was imprecise | One wording everywhere: "On every publish and unfreeze the gate calls circuit #6 … a Solidity copy of the same 34 gates decides only if that call fails or returns a malformed answer, or the beacon implementation is no longer the pinned one; each fallback emits an event. Its beacon has no owner, so the rule's logic can't be upgraded, and a gate can only switch to a copy of the same netlist. A team can change its approvers and waits only through tier 11." Headline: "A rule nobody can **upgrade**" | Site (rule section, proof facts), `README.md`, `JUDGES.md` ("The rule, exactly"), `llms.txt`, `docs/prior-art.md` |
| 5 | **True:** step 4 said "The user gets the verified copy" (it isn't live on mainnet); the teams section said "two approvals and 24 hours" while the demo showed a 1 h timelock | Step 4: "A verified copy read from X Layer is built and tested; it goes live with Pro." One four-tier table (site, README, JUDGES, npm README) with the first-release rule stated; teams copy: "Your first release is tier 10: two approvals and 24 hours. After that, a code-only release needs one approval and one hour." | Same files |
| 6 | **True:** TapeKit wasn't in the prior art, and the pitch led with hash-checking ("brings DeWEB's trust guarantee…"). WAICT checked: Mozilla Hacks, May 2026, with Cloudflare, Meta and FPF; Firefox Nightly prototype behind a pref | Every pitch (site hero, noscript, README, JUDGES, llms.txt, npm README) now **leads with signature-blocking** and says Signet **builds on TapeKit's file verification** and adds: the signing-time allowlist, risk-tiered approvals + timelocks via circuit #6, CI that can only propose, the domain proof, the verified copy. `docs/prior-art.md`: new TapeKit and WAICT sections and a WAICT column; the site's comparison adds a first row "Refuses a signature to a contract the team didn't seal" and names TapeKit and WAICT | [Mozilla Hacks](https://hacks.mozilla.org/2026/05/trustworthy-javascript-for-the-open-web/) |

## C. Evidence judges can check

| # | Verified | Fixed | Evidence |
|---|---|---|---|
| 7 | `docs/benchmark.md` listed the results but not how to rerun them. **Found while rerunning:** `pnpm staging:up` impersonated signet-dev to set the container's operator; since circuit #5 moved into the site gate (2026-11-19), that reverted on any new fork | `staging/up.sh` now impersonates whoever holds circuit #5 at the fork block. The site lists the 12 attacks, the setup and the one command (`pnpm install && pnpm staging:up && pnpm benchmark`); `docs/benchmark.md` gains a "Rerun it" section | Rerun on a fresh fork (block 76,309,421): see "Rerun" below |
| 8 | npm `signetguard` had no repository, homepage or bugs, and a 3-line README | 0.1.2 (not yet published): `repository` (`packages/cli`), `homepage` (/start), `bugs`, an MIT `LICENSE`, and a README with the tiers, the live contracts (OKLink links), /prove and a link to the source. The bundle is **unminified** (`minify: false`), so the published file is readable; no source map (it would add the dependencies' sources) | `packages/cli/scripts/pack.mjs`; `npm pack`: 4 files; the install-test gate passes |
| 9 | Repository readiness | Full-history scan (67 commits): **no secrets** (no proposer key, salt, keystore ciphertext, private-key assignment, PEM or bot token; the only `.env` values found are the public role addresses). No secret-like file was ever committed. Added `LICENSE` (MIT). README top: the pitch, live site, npm, license. Local home paths removed from two Lighthouse reports (one older commit still has the path, which contains the macOS user name). **Note:** every commit's author email is the maintainer's personal address; it becomes public with the repo | Ready to flip once release #3 is published |

## D. Commercial

| # | Fixed | Evidence |
|---|---|---|
| 10 | `docs/business.md`: who pays (dApp teams, per domain; users never), Pro **$49 / month** for 3 domains, Enterprise from $500 / month (both planned; prices are our proposal), how we reach users (X Layer teams first, the badge, wallets later, npm / GitHub Action), why teams stay, and what would prove it wrong. The site's plans show the prices and say there are no paying customers yet | `docs/business.md`, site "For teams" |

## Rerun (item 7)

`pnpm staging:up && pnpm benchmark` on a fresh fork at block 76,309,421 (2026-11-19), the documented command:
**SRI 2/12, hash-only 7/12, Signet 12/12; 0 false blocks** (14, 16, 16 clean sessions), identical to the published
table. One earlier attempt stopped in the hash-only run after 6 attacks with exit 1 and no error message; run alone
it gave 7/12, and the next full run passed. It is recorded as intermittent in `docs/benchmark.md`.
