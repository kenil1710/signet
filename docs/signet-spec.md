# Signet — Full Strategy & Build Plan

As of Nov 16, 2026

## Summary

We build Signet for the X Layer TapeOut Accelerate hackathon (deadline Dec 7, 2026, 23:59 UTC = Dec 8, 5:29 AM IST). Signet decides what a dApp's website is allowed to do, and keeps the app usable even when the website is hacked.

**Pitch line:** Others warn you that a website changed. Signet decides what the website is allowed to do, and keeps your app running when it's hacked.

**Goal for Dec 7:** a team can protect its app in 10 minutes without knowing anything about TapeOut. At least 2 real projects are sealed. Then a 3-minute demo shows a live hijack being stopped.

**Honest position:** "hash on-chain + browser extension" already exists (TEE Shield, Meta Code Verify, Blockaid). We win on what none of them do: a sealed allowlist enforced at signing, behavior-based release review, an immutable TapeOut release-policy circuit, verified failover to DeWEB, and a public watchtower.

## Problem and evidence

Smart contracts get audited, but the website users sign from does not. Attackers swap the website (DNS hijack, CDN/S3 tampering, poisoned npm package) and users sign drainer transactions on a page that looks real.

| Date | Incident | Vector | Loss |
| --- | --- | --- | --- |
| Apr 2026 | [CoW Swap](https://www.kucoin.com/blog/vn-cow-swap-frontend-attack-explained-dns-hijacking-how-it-works-and-how-to-protect-your-wallet-in-defi) | Domain hijack | Connected wallets drained |
| Mar 2026 | [Neutrl, BONKfun](https://dev.to/ohmygod/the-neutrl-dns-hijack-7-domain-defense-layers-every-defi-protocol-must-deploy-today-1mgl) | DNS / domain compromise | Contracts paused; $23K+ (BONKfun) |
| Feb 2026 | [OpenEden, Curvance, Smithii, Avantis, Nerochain](https://blockaid.io/blog/frontend-hijacking-and-the-web2-attack-surface-threatening-web3-protocols) | 5 frontend hijacks in one week | Drainer injected |
| Nov 2025 | [Aerodrome / Velodrome](https://www.halborn.com/blog/post/explained-the-aerodrome-finance-hack-november-2025) | DNS hijack | >$1M in under an hour |
| May 2025 | [Curve](https://www.theblock.co/post/354067/curve-finances-front-end-targeted-in-dns-attack-on-website) | Registrar-level DNS | Users drained |
| Feb 2025 | [Bybit via Safe{Wallet}](https://slowmist.medium.com/bybits-1-5-billion-theft-unveiled-safe-wallet-front-end-code-tampered-84b78f0fa9c2) | Dev machine → S3 JS tampered, removed after 2 min | ~$1.5B |
| Dec 2023 | Ledger Connect Kit | npm supply chain | $600K+ |

Why current fixes fall short:

- **IPFS/ENS, tape:// browsers:** users must change habits; most keep typing the normal domain.
- **SRI:** can't detect a replaced HTML page (the attacker serves new HTML with new SRI tags).
- **Blockaid-style scanning:** guesses from heuristics, sold to wallets; no exact link to the team's real release.
- **Hash-check extensions (TEE Shield, Code Verify):** a hash check alone misses build-time supply-chain attacks, and an admin key can push a bad release.

## Product

Signet has seven parts. Teams touch the CLI, the GitHub Action and the dashboard. Users touch only the extension, or nothing at all.

| Part | What it does | Who uses it | MVP by Dec 7 |
| --- | --- | --- | --- |
| **CLI** (`npx signet`) | `init` sets up the project (a path in Signet's shared container on Free, or the team's own container on Pro/Enterprise), approvers and domain binding. `seal` hashes the build and extracts the allowlist. `verify` checks compatibility. | Team dev | Yes |
| **GitHub Action** | On every build: seal → propose release → wait for approval → deploy | Team CI | Yes |
| **ReleaseGate contract + policy circuit** | One per project. Publishes a release only when the TapeOut circuit says ALLOW. Handles freeze. On Pro/Enterprise it holds the team's own container NFT. | On-chain | Yes |
| **SignetRegistry + SignetFactory contracts** | The factory deploys each project's ReleaseGate and claims its domain in one transaction, using commit-reveal (commit a hash, reveal at least 2 blocks later) so a claim can't be copied from the mempool. The registry binds domains only to factory-made gates. It never holds a circuit NFT: it writes as the SiteRegistry *operator* of a container (a grant of at most 30 days, renewed by the holder). It writes only files the bound gate's current release approves. Signet's container (`0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed`) holds Signet's own site under `signet/<domain>/` and Free projects under `projects/<domain>/`; a Pro/Enterprise gate can instead hold its own container's NFT and get files at that container's root. The registry has no owner, no migration switch and nothing configurable after deployment: its factory and Signet's site gate are fixed in its constructor. | On-chain | Yes |
| **Domain Registry contract** | Maps domain → project (shared container + `projects/<domain>/`, or the team's own container). Changes need M-of-N approval. | On-chain | Yes |
| **Guard extension** | Hashes the loaded page, enforces the sealed allowlist when the wallet signs, blocks the page, opens the verified copy | End users | Yes (Chrome) |
| **Watchtower** | Checks every sealed site every minute from 3 regions. Alerts via TapeSend, Telegram and X. Public status page. | Everyone | Yes (basic) |
| **Dashboard (on DeWEB)** | Diff Guard review, approvals, release history, freeze button, status, "Sealed" badge | Team approvers | Yes |

**What gets sealed per release** (one manifest file):

- SHA-256 of every file in the build (HTML, JS chunks, CSS, service worker, inline scripts)
- **Allowlist:** per chainId, the allowed target contracts, allowed spenders for approve/permit/setApprovalForAll, and allowed EIP-712 verifyingContracts
- **Allowed external origins:** RPCs, APIs and CDNs the app may load from or connect to
- Git commit, build tool versions, and the previous release hash (forming a chain of releases)
- Risk tier computed on-chain (see Release-lock circuit)

Stretch, after the core works: a reproducible-build check (the watchtower rebuilds from the git commit and compares hashes) and a wallet SDK for in-wallet checks.

## Architecture

CI can only propose. A release goes live only when the TapeOut circuit says ALLOW, and users are checked against that sealed release at every page load and every signature.

**Where releases are stored.** One Signet container, circuit #5's container `0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed` on processor #101, holds both Signet's own site under `signet/<domain>/` (the dashboard uses hash routing, so it needs no fallback path) and every free-tier project under `projects/<domain>/`. The two prefixes can't overlap, and tests prove neither side can write into the other. SignetRegistry writes there as the container's SiteRegistry operator, and only files a project's ReleaseGate has published. Circuit #5 stays with Signet (the dev wallet now, a multisig after the hackathon). Pro and Enterprise projects can have their own container, held by their ReleaseGate. Opening a container costs a one-time 0.08 OKB while storage costs about 0.0000048 OKB per KB (Spike B), so sharing keeps the free tier cheap. See `docs/decisions.md`.

**What a release commits to.** `proposeRelease(filesRoot, allowlistHash, originsHash, emergency)`. The contract computes `manifestHash = sha256(abi.encode(filesRoot, allowlistHash, originsHash))` and the risk tier from the same three values, so CI can't ship a new allowlist at a lower tier. `allowlistHash` = SHA-256 of the bytes of `signet/allowlist.json`; `originsHash` = SHA-256 of the bytes of `signet/origins.json`, which lists the external origins **and the SRI hash of every cross-origin script**. Neither may be zero: an empty list is the hash of an explicit empty list file. `filesRoot` = SHA-256 Merkle root (sorted pairs) over `sha256(abi.encode(domain, path, contentType, sha256(bytes)))` for every other file, including the file list `signet/files.json`. One file is at most 48,000 bytes on-chain. **Guard, the dashboard and the watchtower must reject any manifest whose allowlist or origins don't hash to the on-chain values, and any file list that doesn't rebuild the on-chain `filesRoot`.**

```
TEAM                              X LAYER · TAPEOUT                      USERS
GitHub Action ──propose──▶ ReleaseGate contract
(seal + propose)            (computes risk tier on-chain)
                                   │ ask
Approvers (2 of 3) ──approve──▶    ▼
(Diff Guard in DeWEB         Policy circuit (NAND/LATCH, immutable,
 dashboard; approve/freeze)   512-case truth table proof)
        ▲                          │ ALLOW: publish
        │                          ▼
        │                    Container + SiteRegistry ──read via TapeKit──▶ Guard extension
        │                    (sealed manifest, allowlist,                   (hash page, block,
        │                     verified copy on DeWEB)                        open safe copy)
        │                          │                                              │
        │                          └──compare──▶ Watchtower                       ▼
        │ alert                                (every site, every min,      User's wallet
        └──────────────── TapeSend ◀──alert──   3 regions)                  (signs only if target
                          (team inbox)                                       is on sealed list)
```

The watchtower compares live sites with the sealed manifest and alerts the team through TapeSend; Guard reads the same manifest through TapeKit.

## Release-lock circuit and approval tiers

The policy is a TapeOut NAND/LATCH circuit that nobody can change. The ReleaseGate contract supplies facts as input bits, and the circuit decides. Because the input is only 9 bits, we test all 512 combinations and publish the full truth table (`docs/policy-truth-table.md`): a proof of the policy, not a promise.

**No fully automatic tier.** A hacked CI could ship code that only calls allowlisted contracts but swaps to the attacker as recipient. So every release needs at least 1 human approval.

**Input bits (supplied by ReleaseGate, never by CI):**

| Bit | Meaning | Who sets it |
| --- | --- | --- |
| a0, a1, a2 | Approver 1/2/3 signed this release | Contract, from on-chain approvals |
| tS | Short timelock passed (default 1 h) | Contract, block.timestamp |
| tL | Long timelock passed (default 24 h) | Contract, block.timestamp |
| r1 r0 | Risk tier (below) | Contract, by comparing hashes with the current release |
| f | Project is frozen | Contract state |
| e | Emergency fast lane requested | Proposer |

**Risk tier is computed on-chain, so CI cannot lie about it:**

| Tier | When | Rule (output PUBLISH) |
| --- | --- | --- |
| 00 Code only | allowlistHash and originsHash unchanged | ≥1 approval and tS, or 3 of 3 with e |
| 01 New external origin, or a changed SRI hash | originsHash changed (origins, cross-origin scripts and their SRI hashes) | ≥2 approvals and tS |
| 10 New contract / spender | allowlistHash changed | ≥2 approvals and tL, or 3 of 3 with e |
| 11 Admin change | approver set, domain binding, timelocks or circuit swap | 3 of 3 and tL, no fast lane |

If f is set, PUBLISH is always 0. A second output, UNFREEZE, needs ≥2 approvals. Freezing needs no circuit: any one approver (or the watchtower's guardian key, if the team opts in) can freeze directly.

**Why it matters:** a stolen laptop or a stolen CI token can only *propose*. A changed allowlist always waits 24 h with 2 signers, which gives the watchtower and the team time to see it. Swapping the circuit itself is a tier-11 action.

**v1 limits:** 3 approver slots (a 5-slot circuit for enterprise later). Timelock lengths live in the contract config, and changing them is tier 11.

**Rules the contract adds around the circuit** (two security reviews, 2026-11-16/17; details in `docs/decisions.md`). *Timing:* a timelock starts when the tier's required approval count is first reached; extra approvals don't restart it, and dropping below the count resets it. Every proposal expires 7 days after it was made. Minimum timelocks are 10 minutes (short) and 6 hours (long). *Approvals:* an approver who proposed a release can't approve it. Any approver can cancel a proposal or withdraw their own approval. *Tiers:* the tier is compared with the most recent release that isn't revoked. Tier 10's fast lane is refused when the origins also changed. *Revoking:* any approver can revoke a published release at once (one revoke per approver per 24 hours); un-revoking needs 2 of 3, and a revoked manifest can't be proposed again. While the current release is revoked, 2 approvers can remove its files; otherwise removing files is tier 11. *Freezing:* each key can freeze once per 24 hours; two approvers can remove the guardian even while frozen (votes last 7 days); unfreeze and publish can happen in one transaction; while frozen, the previous release's grace window ends. *Keys:* the proposer, the recovery address, the guardian and the approvers are all different keys. *Domains:* a transfer needs the receiving gate to accept within 7 days and can be cancelled (tier 11); after an unbind only the previous gate can re-claim the domain for 30 days. A proposal to add a domain shows only a hash of it on-chain; approvers check the real domain in the dashboard, and it is revealed when the proposal executes. *Circuit:* if the circuit beacon's implementation ever changes, or the circuit call fails, a Solidity mirror of the policy (proven equal to the circuit on all 512 inputs) decides and `PolicyFallbackActive` is emitted.

## Threat model

The truth is the release sealed on X Layer. The signing-time allowlist is the last line of defense, and it holds even when the other checks miss.

| # | Attack | Our answer | What still gets through |
| --- | --- | --- | --- |
| 1 | DNS / registrar hijack, whole site replaced (Curve, Aerodrome, CoW) | HTML hash mismatch → page blocked, signatures refused, verified copy offered. Watchtower alerts in about 1 min. | Users with neither the extension nor a wallet check, until they see the alert |
| 2 | One JS chunk swapped on CDN/S3 (Bybit) | Per-file hashes → mismatch. Even if missed, any non-allowlisted target is blocked at signing. | — |
| 3 | New script injected into the page | Unknown script = not in manifest → block | — |
| 4 | Targeted attack: bad code only for some wallets or only once, then removed after 2 min | The check runs in *the user's own* browser on bytes from the browser cache, so a targeted user sees the mismatch. The signing check doesn't depend on the hash. | v1 cache-read may miss `no-store` files (see Open questions) |
| 5 | Poisoned npm package at build time (Ledger Connect Kit) | Hashes match (it's in the build), but Diff Guard flags new origins and addresses at review, and the signing allowlist blocks unknown targets | A poisoned package that only calls allowlisted contracts with bad calldata (see 6) |
| 6 | Allowlisted router, attacker as recipient | Guard decodes common calls (ERC-20 approve/transfer, Permit/Permit2, top routers) and blocks if recipient ≠ user or spender ≠ allowlist | Unknown calldata formats → shown as "unverified call" warning, not blocked |
| 7 | Stolen CI token / hacked dev laptop | CI can only propose. Every release needs ≥1 human approval, and changed contracts need 2 signers and 24 h. | A tier-00 release with 1 approver who doesn't read the diff |
| 8 | One approver key stolen | Can't reach 2-of-3, and can't self-approve: an approver's approval doesn't count on a release they proposed themselves, so one key can't propose and publish even a tier-00 release. Others see the proposal in Diff Guard and cancel it, freeze, or revoke. | One approver key **plus** the CI proposer key: CI proposes a tier-00 (code-only) release and the stolen approver approves it; it publishes after the 1 h timelock unless someone cancels or freezes. Changed contracts or origins still need a second approver. |
| 9 | M approver keys stolen | Timelock gives watchers 24 h. Watchtower posts every pending tier-10/11 change publicly. | Full compromise of the team = out of scope |
| 10 | Rogue insider approver | Same as 8/9, and Diff Guard makes the change visible to the others | 2 colluding insiders |
| 11 | Attacker re-binds the domain to their own container | Binding changes are tier 11 (3 of 3 + 24 h). DNS TXT proof only at first claim. | First-claim race on a brand-new domain (claim at setup) |
| 12 | Lookalike phishing domain (c0w.fi) | Not sealed → Guard shows "Not protected" on any page asking to sign. Brand lookalike warning is a stretch goal. | Mostly Blockaid's territory; not our core |
| 13 | Fake RPC answers to the extension | 2 independent X Layer RPCs must agree (TapeKit does the same); manifest cached with expiry | Both RPCs lying at once |
| 14 | Malicious service worker left on the domain | The SW script is hashed like any file; unknown SW → block | — |
| 15 | Page detects the extension and behaves well for it | Then extension users are safe anyway; watchtower crawlers look like normal browsers | — |
| 16 | Freeze spam by a malicious approver | Unfreeze needs 2 of 3; remove the bad approver with tier 11 | Up to 24 h of downtime |
| 17 | **Attack on Signet itself** (our extension or Chrome Web Store account) | Open source, minimal permissions, hardware key on the store account, reproducible extension builds | Our biggest reputational risk; say it openly |

## Edge cases

The biggest product risk is not missing an attack. It's **blocking real users by mistake**: one false block and a team uninstalls us. So every edge case below defaults to safe for users and quiet for teams.

**Website and build**

| Case | Handling |
| --- | --- |
| SSR / dynamic HTML (nonces, per-user content) | v1 supports static builds (SPA/SSG: Vite, Next export, CRA). For SSR, seal scripts and a normalized HTML skeleton; `signet verify` warns before setup. |
| CDN rewrites HTML (Cloudflare Rocket Loader, email obfuscation, auto-minify) | `verify` detects these and asks the team to turn them off; hashes use the decoded body, so gzip/brotli is fine |
| A/B tests, per-region or per-language bundles | Each variant is sealed in the same release; the manifest lists all of them |
| Lazy-loaded chunks | All chunks from the build output are sealed, not just the ones on first load |
| Third-party scripts (analytics, chat widgets, WalletConnect modal from CDN) | Recommend self-hosting pinned versions. Otherwise list them as allowed external origins: lower trust, still covered by the signing allowlist. **`signet verify` requires an SRI `integrity` attribute on every cross-origin script, and `seal` stores those SRI hashes in `origins.json`, so a changed SRI hash is a tier-01 change** (Guard can't read cross-origin bytes from the cache; the browser enforces SRI, so Guard checks the attribute against the sealed hash). See `docs/decisions.md`, Spike C. |
| Scripts or HTML served with `Cache-Control: no-store` | Guard can't read them from the cache, so it can only mark them "unverified". **`signet verify` warns about `no-store` on JS and HTML** and prints the header fix. See `docs/decisions.md`, Spike C. |
| Inline scripts | Hashed by content |

**Releases and timing**

| Case | Handling |
| --- | --- |
| Team deploys before approval | The GitHub Action deploys only after the release is published on-chain. A manual deploy shows a mismatch → "observe mode" warns the team first (below). |
| Users with the old version cached after a release | Current + previous release are both valid for a grace window (default 6 h) |
| Urgent hotfix | Tier 00/10 fast lane: 3 of 3 with no timelock |
| Approver lost a key | Replace them with a tier-11 change by the other approvers. If only 1 remains: a recovery address set at `init`, with a 7-day timelock. |
| Team gives up the domain / rebrands | Unbind with tier 11; Guard then shows "Not protected" |
| Many domains / subdomains (app., docs., beta.) | One container can bind several domains; each domain can point to its own manifest |

**Allowlist reality**

| Case | Handling |
| --- | --- |
| DEX with any token | The allowlist checks *targets and spenders* (router, Permit2), not the token being approved. approve(token) is fine if the spender is allowlisted. |
| Factory-created addresses (new pools, user vaults) | v1: "warn" rule for a whole factory. Stretch: verify on-chain that the factory created the address. |
| Multi-chain dApp | Allowlist per chainId |
| Login signatures (SIWE, personal_sign) | Allowed, but shown as "login only" |
| EIP-712 (Permit2, Seaport orders) | verifyingContract and spender must be allowlisted |
| Allowlist extracted wrong | `seal` extracts addresses from the build and ABI configs; the team confirms the list once in the dashboard |

**Users and environment**

| Case | Handling |
| --- | --- |
| Mobile (no Chrome extensions) | Watchtower alerts protect everyone; the wallet SDK is the long-term answer (OKX Wallet in-app browser) |
| WalletConnect / QR signing to a phone wallet | The extension can't stop the phone's signature but still blocks the tampered page before connecting |
| Several wallets installed (EIP-6963) | Guard wraps every announced provider |
| X Layer RPC down | Use the cached manifest (24 h expiry). With no data, show "unverified" and don't block (fail-open by default; teams can choose fail-closed). |
| False positive | Every new project starts in **observe mode** for 7 days: Guard reports mismatches to the team only and never blocks. The team flips to enforce mode when it's clean. Users get a "Report wrong block" button. |

**Watchtower and alerts**

| Case | Handling |
| --- | --- |
| Geo-targeted hijack | Crawl from 3 regions, plus Guard telemetry from real users (opt-in, only for sealed domains) |
| False public alert | Private alert to the team first. A public X post only after 2 regions confirm, or when the team acknowledges. |
| Privacy | Guard downloads the list of sealed domains and checks locally. It never sends browsing history. |

**Cost and storage**

| Case | Handling |
| --- | --- |
| Full build on-chain is costly (a 5 MB app = ~210 chunks of 24 KB) | Default: seal the manifest only (a few KB). Full copy for failover is optional and paid. Only changed files are re-uploaded (content-hashed names). |
| Failover copy calls the team's backend from a tape:// origin (CORS) | `verify` checks it; a "failover-ready" badge only if the team's APIs allow it |

## User journeys

After setup, everything runs on its own. People act only when a new release needs approval or during an incident.

**1. Team setup (target: 10 minutes)**

1. `npx signet init` → connect a wallet, pick 3 approver addresses and a recovery address
2. The CLI commits to the domain (a hash), then two blocks later asks SignetFactory to deploy the project's ReleaseGate and claim the domain in one transaction, linked to the shared policy circuit. Free: the project gets `projects/<domain>/` in Signet's container, written by SignetRegistry. Pro/Enterprise: the CLI can instead mint and open the team's own container (one-time 0.08 OKB opening fee), held by its ReleaseGate
3. Domain proof: add a DNS TXT record, and the CLI binds the domain in the Registry
4. `signet verify` checks for static build, CDN rewrites and third-party scripts (cross-origin scripts must carry SRI), warns about `no-store` on scripts and HTML, then prints fixes
5. Paste the GitHub Action (5 lines) and add a `SIGNET_PROPOSER_KEY` secret (a key that can only propose)
6. First release: confirm the extracted allowlist once in the dashboard → approve → the project is live in **observe mode** for 7 days, then switches to enforce

**2. Daily release**

1. A dev merges to main → the Action builds, seals and proposes
2. ReleaseGate computes the tier on-chain; approvers get a TapeSend and Telegram ping
3. An approver opens Diff Guard: "3 files changed, no new contracts, no new origins → tier 00" → one click
4. After the 1 h timelock, anyone calls `publish` (`signet publish <id>`; the Action never does, it only proposes) → the Action sees the release on-chain, writes the manifest files and deploys to hosting

**3. End user**

1. Has the Guard extension (or not)
2. Opens app.xyz → green badge "Sealed · release #42 · 3 approvers"
3. Signs normally; Guard checks the target against the allowlist silently
4. No extension: still protected by watchtower alerts, X posts and the team's freeze

**4. Incident (DNS hijacked at 02:00)**

1. 02:00 Guard users see a full red page: "This site doesn't match its sealed release. Don't sign." Button: Open verified copy.
2. 02:01 Watchtower confirms from 2 regions → private alert to the team, then a public post on X, Telegram and TapeSend
3. The team (or the opt-in guardian) presses Freeze → no release can be published until 2 of 3 unfreeze
4. Users continue on the verified copy from DeWEB via TapeKit
5. The dashboard shows an incident checklist: lock the registrar account, rotate DNS/API keys, contact the registrar, post an official notice, and a revoke.cash link for users who signed
6. Fixed → 2 of 3 unfreeze → an incident report is generated for the community

## Business model and go-to-market

Users never pay. Teams pay because one hijack costs them users, money and reputation, and a "Sealed" badge builds trust. The prices below are proposals to test, paid in USD₮0 on X Layer.

| Plan | Price (proposal) | Includes |
| --- | --- | --- |
| Free | $0 | 1 domain, manifest sealing in Signet's shared container, Guard protection, community alerts, 5-min watchtower |
| Pro | $49 / month | 3 domains, optional own container, 1-min watchtower from 3 regions, private alerts (TapeSend, Telegram), Diff Guard, badge, failover copy (storage gas passed through) |
| Enterprise | Custom | Own container, setup done for you, allowlist review, incident support, SLA, 5-approver circuit, wallet verification API |

**Other revenue:** wallets and exchanges pay per call for the verification API ("is this page sealed and is this tx allowed?"), and an optional per-release fee covers the on-chain gas.

**Why they keep paying:** releases happen weekly, so Signet sits in their CI. Removing it means removing their security badge in public.

**How we reach teams**

1. TapeOut and X Layer builders first: they already use DeWEB, so pitch in the TapeOut and X Layer Telegram groups and livestreams. Free Pro for the first 50 projects.
2. Incident-driven outreach: every public frontend hijack → a same-day post ("here's how Signet would have stopped it") and a DM to similar protocols.
3. The badge is viral: every sealed site shows "Sealed by Signet" with a link.
4. Partnerships: OKX Wallet (built-in check = zero-install users), launchpads, and audit firms (offer Signet with every audit).

**Target users, in order:** X Layer and TapeOut dApps → DeFi protocols with large TVL → multisig and treasury UIs → launchpads and NFT mint sites → Web2 fintech pages later.

## Competition and differentiation

No competitor combines a sealed allowlist, signing-time blocking, an immutable release policy and failover. That combination is our story; the hash check alone is not.

| Capability | [TEE Shield](https://ethglobal.com/showcase/tee-shield-6fx8p) | [Blockaid](https://blockaid.io/view-on-security) | Meta Code Verify / WEBCAT | IPFS + ENS | **Signet** |
| --- | --- | --- | --- | --- | --- |
| Exact check against the team's real release | Yes | No (heuristics) | Yes | Yes | **Yes** |
| Works on the normal https domain | Yes | Yes | Yes | No | **Yes** |
| Sealed allowlist of contracts and spenders | No | No | No | No | **Yes** |
| Blocks at signing | No | Inside partner wallets | No | No | **Yes** |
| Behavior diff before release | No | No | No | No | **Yes** |
| Release policy that one key can't bypass | No (admin key) | — | Signing key | ENS owner key | **Yes (TapeOut circuit)** |
| App keeps working during an attack | No | No | No | Partly | **Yes (DeWEB copy)** |
| Public watchtower and alerts | No | Private to customers | No | No | **Yes** |

Inside TapeOut: HashPort, TapeNow and Q-Tape publish to DeWEB, and TapeKit verifies tape:// sites. Signet builds on them instead of competing, which also scores on "building on existing ecosystem tools".

**How we talk about competitors:** we credit them openly. The [Ethereum Foundation's call for verifiable frontends](https://notes.ethereum.org/I0oM7rM4TUe-E3EXchCvbg) shows the need is real, and we are the first to ship the full loop on X Layer.

## Judging criteria and submission checklist

Each criterion has one piece of proof we must show, in the product and in the video.

| Criterion | Our proof |
| --- | --- |
| User value and commercial potential | Incident table ($1.5B+), pricing, 2+ real projects sealed, the observe-mode "no false blocks" promise |
| Innovation (circuit design, new use cases) | A release-policy circuit with an exhaustive 512-case truth table (9 input bits); TapeOut used as a security policy engine (a new use case) |
| Ecosystem integration | A circuit on an X Layer Processor, Circuit Container + SiteRegistry (DeWEB) for manifests and failover, TapeKit for reading and verifying, TapeSend for alerts, dashboard hosted on DeWEB |
| Product readiness and UX | 10-minute setup, one-click approvals, live demo dApp, Chrome extension installable |
| Demo video ≤ 3 min | Script below: problem → features → users and business → TapeOut usage |

**Form fields to prepare (registration and final submission)**

- [ ] Register early this week with placeholders (editable later), and join the [Telegram group](https://t.me/+-7ouB60aYig2MmM1)
- [ ] Full name, nationality (Indian, for the Demo Day location), Telegram handle, team email, team size (max 4)
- [ ] Project name: Signet; logo 256×256; project X account
- [ ] Team background and elevator pitch
- [ ] GitHub repo (public)
- [ ] Demo video link, ≤ 3 min (longer may be disqualified)
- [ ] Website link (the DeWEB dashboard + a normal landing page)
- [ ] Description covering: product, target users and how to reach them, revenue model, why users pay and keep using it
- [ ] Circuit info required for circuit projects: **Processor contract address and circuit ID**
- [ ] List of the TapeOut features used (circuit, Processor, Container, SiteRegistry/DeWEB, TapeKit, TapeSend)
- [ ] Answer "What challenges are you solving? How are you different? What are the plans forward?"
- [ ] Follow @XLayerOfficial and @TapeOutWorld; post weekly progress

## 3-week build plan

We submit on Dec 6, keeping Dec 7 as a buffer. The two riskiest items are first: how contracts call a TapeOut circuit, and how the extension reads loaded bytes. The Chrome Web Store submission goes in by Nov 27 because review can take days.

**Week 1 (Nov 16–22): prove the hard parts, then on-chain core**

- [ ] Nov 16: register on the form with placeholders, join Telegram, create the repo (monorepo: contracts / circuit / cli / action / extension / watchtower / dashboard)
- [ ] Nov 17: **Spike A**: on X Layer mainnet, mint elements on a cheap Processor, tape out a tiny test circuit, and call it from a contract. Write down the exact interface, gas and costs. Ask in Telegram if stuck.
- [ ] Nov 17: **Spike B**: write one file to a container via SiteRegistry and read it back with TapeKit; measure cost per KB
- [ ] Nov 18: **Spike C**: extension reads script bytes via cache (`only-if-cached`) and hashes them; test on a Vite app
- [ ] Nov 18–19: design the policy circuit in the TapeOut canvas or as a netlist; exhaustive 512-case test (9 input bits) against a JS reference; tape out → record the Processor address + circuit ID
- [ ] Nov 19–21: Foundry contracts: ReleaseGate (propose, approve, tier calc, publish, freeze/unfreeze, recovery) + Registry (bind/unbind domain); tests for every tier and edge case
- [ ] Nov 22: deploy to X Layer mainnet
- [x] CLI `init` + `seal` (hash build, extract allowlist, store SRI hashes of cross-origin scripts) + `verify`, `propose`, `approve`, `publish`, `status`, `freeze`: built and tested on the staging chain (2026-11-17, `packages/cli`)
- [x] With the CLI: domain claims are commit-reveal; the CLI treats the factory's `CommitExists` error as success and continues to the reveal
- [x] With the CLI: `signet verify` warns about `Cache-Control: no-store` on scripts/HTML and fails on cross-origin scripts without an SRI `integrity` attribute (from Spike C)

**Week 2 (Nov 23–29): the user-facing product**

- [x] GitHub Action (verify → seal → propose → wait until published on-chain → deploy): built and tested on staging with a local runner, not yet run on GitHub (2026-11-17, `packages/action`)
- [x] Diff Guard analyzer, `signet diff <id>` (files, addresses and spenders, origins, SRI hashes, approve/permit/transfer calls, tier and why; text + JSON): tested on staging (2026-11-17, `packages/cli`)
- [x] Guard extension: release read from 2 RPCs that must agree, manifest hash-checked, page hash check, red block page, window.ethereum + EIP-6963 wrap, allowlist + calldata decode, observe/enforce modes, verified-copy button (preview without a wallet): tested headless on staging (2026-11-17, `packages/extension`). Not yet tested with a real wallet.
- [ ] Nov 27: **submit the extension to the Chrome Web Store** (keep an unpacked build for the demo as backup)
- [ ] Nov 28–29: watchtower (3 regions, 1-min checks, 2-region confirm) + alerts via TapeSend, a Telegram bot and X posts

**Week 3 (Nov 30–Dec 7): polish, real users, video**

- [ ] Nov 30–Dec 1: dashboard on DeWEB (approvals, Diff Guard view, history, freeze, status page, badge)
- [ ] Dec 1: demo dApp (a simple X Layer swap/stake page) + attack simulator (local DNS override + JS swap)
- [ ] Dec 2–3: onboard 2–3 real TapeOut/X Layer projects; fix whatever breaks; write docs and a landing page
- [ ] Dec 4: final end-to-end test of every journey; record the screen footage
- [ ] Dec 5: edit the video (≤ 3:00), write the form answers
- [ ] Dec 6: **submit**; post the launch thread on X tagging X Layer and TapeOut
- [ ] Dec 7: buffer only (deadline 23:59 UTC)

**If we fall behind, cut in this order:** reproducible build check → X auto-posts → failover copy (keep the button, use the manifest-only demo) → a third watchtower region. Never cut: circuit, ReleaseGate, signing-time block, observe mode, video.

## Demo video script (2:50)

One story, a live hijack, told in the order the judges score: problem, features, users and business, then TapeOut.

| Time | Screen | Voice-over (short) |
| --- | --- | --- |
| 0:00–0:20 | Headlines: Bybit $1.5B, CoW Swap, Aerodrome | "The contracts were safe. The website wasn't. Users signed on a page that looked real." |
| 0:20–0:45 | `npx signet init` + the Action in GitHub | "A team protects its app in 10 minutes. Every build is sealed on X Layer." |
| 0:45–1:10 | Dashboard: Diff Guard flags "new contract address" → tier 10, needs 2 of 3 + 24 h | "A hacked laptop can only propose. A TapeOut circuit decides, and nobody can change it." Show the truth-table proof. |
| 1:10–1:50 | **Live attack:** DNS override + swapped JS → Guard turns red → user clicks Swap → signature refused | "Signet doesn't just warn. It refuses the signature to an address the team never sealed." |
| 1:50–2:10 | Open verified copy (tape://) → user swaps safely; Telegram + TapeSend alert arrives; Freeze pressed | "The app keeps working during the attack, and the team knows in a minute." |
| 2:10–2:35 | Pricing table + logos of real sealed projects | "Free for users. Teams pay for watchtower, alerts and the badge. Wallets pay for the API." |
| 2:35–2:50 | Architecture: circuit, Container, SiteRegistry, TapeKit, TapeSend on X Layer | "Built on TapeOut on X Layer. Signet: the website can only do what the team sealed." |

Record in 1080p with large fonts and no dead air. Subtitles in English. Do a dry run with a friend who doesn't know crypto: if they get the problem in 20 seconds, it works.

## Open questions and risks

Five facts are not confirmed yet, and the Week 1 spikes exist to answer them. If any answer is "no", the fallback keeps the product intact.

| Open question | Why it matters | Fallback if "no" |
| --- | --- | --- |
| Can a contract call a taped-out circuit and read its output on X Layer, at acceptable gas? | The circuit must enforce the policy on-chain | Contract mirrors the circuit's logic, verified equal over all 512 inputs (9 bits); the circuit stays the published, verifiable policy |
| ~~Can a contract hold the circuit NFT and write via the container to SiteRegistry?~~ **Answered yes** (fork tests, 2026-11-16): a contract holder can write, and can appoint an operator contract that writes | Only the gate should be able to publish | Not needed |
| Cost per KB for SiteRegistry on X Layer | Pricing of the failover copy | Manifest-only by default (already the plan) |
| Can the extension read executed bytes reliably (`only-if-cached`, `no-store` files)? | Targeted-attack detection | Re-fetch + hash, documented as a v1 limit; the signing allowlist still protects |
| Can TapeSend messages be sent by our watchtower service automatically? | Alerts | Telegram + X only; TapeSend for the team inbox in the dashboard |

**Risks**

| Risk | Impact | What we do |
| --- | --- | --- |
| Chrome Web Store review delay | No public install link at judging | Submit Nov 27; unpacked build + GitHub release as backup |
| No real projects onboard in time | Weak commercial proof | Start outreach Week 1 in the TapeOut/X Layer Telegram; offer setup help ourselves |
| False blocks on a real project | Kills trust | Observe mode first, fail-open default, "report wrong block" |
| Scope too big for 3 weeks | Half-finished product | The cut list in the build plan; protect the core |
| Judges see "just another hash checker" | Lower innovation score | Lead with the allowlist + signing block + circuit, not the hash |

## Notes for building with Claude Code

Give Claude Code this doc as the spec, and work one package at a time in the order of the build plan. Start every session with the spike results, so it never guesses TapeOut's interfaces.

**Suggested stack**

| Part | Stack |
| --- | --- |
| Contracts | Solidity 0.8.24 + Foundry, X Layer mainnet (chain id 196) |
| Circuit | Netlist built in the TapeOut canvas or a script; exhaustive test in TypeScript against a reference function |
| CLI + Action | TypeScript, Node 20+, viem, commander; Action as a composite action |
| Extension | Chrome MV3, TypeScript, Vite; content script in MAIN world for the provider wrap, service worker for manifest cache |
| Watchtower | Node workers on 3 regions (e.g. Fly.io), Puppeteer for real-browser loads, Telegram Bot API |
| Dashboard | Static React/Vite build, published to DeWEB via HashPort or SiteRegistry; also a normal web mirror |

**Rules to give Claude Code**

- Never invent TapeOut contract ABIs. Use only what the spikes recorded in `docs/tapeout-interfaces.md`.
- Every ReleaseGate rule gets a Foundry test, including every row of the tier table and the edge cases above.
- The circuit's truth table is generated and checked in CI; any mismatch fails the build.
- The extension never sends browsing history; there is a test that it makes no network calls for unsealed domains.
- Default to observe mode and fail-open; enforcement only when a team turns it on.
- Keep keys out of the repo; the proposer key in CI can only propose.
