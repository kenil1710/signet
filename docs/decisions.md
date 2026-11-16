# Decisions

- **2026-11-16: Spike A tapes out on an existing processor (#101, `0x73153e…8F22`), not on our own.** Why: `createCPU` has no published ABI semantics; minting 2 NANDs on #101 costs 0.000662 OKB. Anyone can call `eval` on any circuit, so the processor's owner doesn't matter for ReleaseGate.
- **2026-11-16: Spike A circuit is a 2-NAND AND, not a single NAND.** Why: AND has a non-trivial truth table (only 11→1), so a wrong bit order or inverted output shows up in the test. It costs one more transistor (1e12 wei).
- **2026-11-16: ReleaseGate stores the circuit beacon's `implementation()` address at deploy and refuses to publish if it ever changes.** Why: on-chain checks show nobody can upgrade the beacon (owner `0x0`) and the processor proxy hardcodes the beacon (see `docs/tapeout-interfaces.md` §6), but the TapeOut source is unverified. Pinning the address costs one STATICCALL per publish and turns any unexpected change into a refusal instead of a silently different policy.
- **2026-11-16: One `.env` at the repo root; `packages/contracts/.env` is a symlink to it (`pnpm env:link`).** Why: Foundry reads `.env` only from its project folder, not from parent folders (tested).

## 2026-11-16: Spike C (Guard reads executed bytes from the browser cache)

Setup: `packages/extension` (MV3, plain JS for the spike), test server and runner in `packages/extension/spike-c/`, target `packages/demo-dapp` production build. Run: `pnpm --filter @signet/extension spike:c` (headless Chromium 141 via Playwright, fresh profile per scenario). Result: **5/5 scenarios pass**.

**How it works:** the content script, at `document_idle` plus a `PerformanceObserver` for later loads, collects the document URL, every `<script src>`, every script resource-timing entry, and every inline script. For each same-origin URL it calls `fetch(url, { cache: 'only-if-cached', mode: 'same-origin' })`, SHA-256s the bytes and compares them with the sealed manifest. The service worker holds the manifest and returns only the current origin's entry. Badge: green `OK` = all verified; red `!` = a mismatch or an unknown script/origin; grey `?` = nothing failed but something couldn't be read (fail-open, per CLAUDE.md rule 9).

**What works (measured):**
- Vite main bundle (`<script type="module" crossorigin>`), the lazy `import()` chunk (not a `<script>` element; found through resource timing), the inline script (hashed from DOM text), and the HTML document itself served `no-cache`: all read from cache and verified.
- `Cache-Control: no-cache` files are readable: `only-if-cached` returns the stored response without revalidating.
- **Tampered on every request → red. Tampered only on the first request, then clean (Bybit pattern) → red.** In that case a fresh download returns the clean hash `b4d6d3ae…` while the cache holds the executed bytes `3162334a…`. This confirms cache-read beats re-fetching (threat-model row 4).
- **Invisible:** with the extension on, the server saw the same 6 requests and the page's `performance.getEntriesByType('resource')` showed the same 6 entries as with it off (`spike-c/probe-visibility.mjs`). Cache reads cause no network traffic and don't appear in the page's resource timing. Only a DevTools console line (`ERR_CACHE_MISS`) appears for an unreadable file.
- **Unsealed origin:** no badge and no extra requests (privacy rule 8).

**Decisions:**
- **The sealed manifest is not a web-accessible resource.** The service worker sends each content script only its own origin's entry. Why: a web-accessible file would let any page detect Guard (threat 15). Found because the first version (content script fetching the manifest) failed in MV3.
- **Three badge states (`OK` / `!` / `?`), not two.** Why: a file we can't read is not evidence of tampering; turning it red would break observe-mode and fail-open.

**What doesn't work / limits for v1:**
- **`Cache-Control: no-store` files can't be read** (`only-if-cached` → `ERR_CACHE_MISS`), so they get status `not-cached` → grey. The spec fallback (re-fetch and hash) would miss targeted attacks. `chrome.webRequest` can't read bodies in MV3; `chrome.debugger` (`Network.getResponseBody`) can but shows a "debugging this browser" banner. **`signet verify` should warn about `no-store` on JS/HTML.** The signing-time allowlist still protects.
- **Cross-origin scripts can't be read**: `only-if-cached` is only allowed with `mode: 'same-origin'`. An allowed origin → `cross-origin` (grey); an origin not in the manifest → red. Proposed fix, not built: require an `integrity` (SRI) attribute on cross-origin scripts and seal the SRI hash. The browser itself then refuses bytes that don't match, and Guard only checks the attribute.
- **Detection, not prevention:** the check runs after the scripts have executed. Blocking a signature is the job of the signing-time allowlist (not in this spike).
- Not covered yet: scripts that remove themselves before `document_idle` (inline ones then leave no trace; external ones remain in resource timing), iframes (`all_frames` is off), responses served by the page's own service worker, resource-timing buffer overflow on very large apps (default 250 entries), and cache eviction. Next step: run the collector at `document_start` with a `MutationObserver`.
- Tested on `http://localhost` (a secure context, so `crypto.subtle` works). Real sites are https; the behavior should be the same, but that isn't tested yet.

## 2026-11-16: Free-tier projects share Signet's container

- **Decision.** Free-tier projects store their files in Signet's container `0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed` (circuit #5 on processor #101, TapeKit name `5.2.101`), each under `projects/<domain>/`. A **SignetRegistry** contract holds that container's circuit NFT and calls `SiteRegistry.putFile`/`appendChunk`/`removeFile` for a project's path only when that project's ReleaseGate approves (publishes) the release. Pro/Enterprise projects can use their own container.
- **Why.** Opening a container costs a flat 0.08 OKB (Spike B), while storage is ~0.0000048 OKB/KB. Sharing one opened container makes the free tier cost per KB, not per project.
- **Spec updated 2026-11-16** (Product table, Architecture, User journey 1 step 2, pricing, open questions). Before that, the spec said each team's ReleaseGate holds its own container NFT.
- **To verify before building SignetRegistry** (not tested yet):
  1. That a **contract** holder can write: Spike B only wrote from an EOA holder; `canEdit` might check more than `ownerOf`. Fork test: transfer circuit #5 to a contract, then call `putFile` from it.
  2. TapeSend from the shared container: the DeWEB hub's `keyFor` reports `usable = false` unless the holder is a plain account (TAP-10 §13, error `ContractHolder`). So the shared container probably can't use TapeSend messaging while a contract holds it; per-project alerts would need another route.
  3. Path ownership: SignetRegistry must only let ReleaseGate X write under the `projects/<domain>/` that the Domain Registry binds to X, and no `..` or overlapping prefixes.
- **Risk.** SignetRegistry becomes a shared point of failure for every free-tier project. It should be non-upgradeable (or changeable only through a tier-11-style policy), and it can never write outside `projects/<domain>/` for the approving gate's domain.
- **Mainnet step later** (needs the human's yes): transfer circuit #5 from the dev wallet to the deployed SignetRegistry.

## 2026-11-16: Policy circuit (packages/circuit)

34 NAND gates, combinational (read with `eval`), 9 inputs in the order `a0 a1 a2 tS tL r1 r0 f e`, 2 outputs `PUBLISH`, `UNFREEZE`. Netlist sha256 `0x1a2e1987…20db`. Equal to the reference on all inputs, both locally and through `eval` on a mainnet fork.

How the spec text was read (each is pinned by a test in `packages/circuit/test/policy.test.ts`):
- **9 inputs, so 512 combinations, not 1,024.** The spec lists 9 bits but says "10 bits / 1,024 combinations". I did not add an unused 10th input to reach 1,024: a taped-out circuit can't change, so a spare bit could never gain a meaning later. **Decided 2026-11-16: keep 9 inputs**; the spec and CLAUDE.md now say 9 bits / 512 combinations.
- **Fast lane = 3 of 3 + e, with no timelock**, only in tiers 00 and 10 (spec: "Urgent hotfix: Tier 00/10 fast lane: 3 of 3 with no timelock"). Setting `e` never blocks the normal path.
- **Tiers 10 and 11 check only `tL`**, tiers 00 and 01 only `tS`, exactly as the table says. ReleaseGate sets `tL` only after 24 h, which is after `tS` anyway.
- **UNFREEZE = at least 2 approvals**, independent of every other bit. ReleaseGate only acts on it while frozen.
- Design: approvals needed = "at least k" with k = 1 + r1 + r0; timelock = `r1 ? tL : tS`; fast lane = `!r0 & e & 3of3`; then `PUBLISH = !f & ((T & Q) | FAST)`. UNFREEZE is computed twice (1 extra gate) because TAP-02 outputs must be the last signals.

## 2026-11-16: Core contracts (ReleaseGate, SignetRegistry)

**Checked first (fork):** a **contract** holding a circuit NFT can write to SiteRegistry (`test/spike/ContractHolder.fork.t.sol`): after transferring circuit #5 to a contract, `canEdit` is true for it and false for the old EOA, the container stays opened, and `putFile` + read-back + SHA-256 work. So the spec fallback (manifest in our own contract) is not needed.

**How the spec was read where it was silent or ambiguous** (each has a test in `test/ReleaseGate.t.sol` / `test/SignetRegistry.t.sol`):
- **Losing or replacing an approver.** The spec says "replace them with a tier-11 change by the other approvers", but tier 11 is 3 of 3, so two approvers can't pass it. Built as: tier 11 for normal changes; for a lost key or a rogue approver, the **recovery address** proposes a new approver set that executes after **7 days**, even while frozen. **Any 2 current approvers can cancel it** (protects against a stolen recovery key; one rogue approver can't block it). The cancel rule is not in the spec. *Needs your confirmation.*
- **Approvals belong to an approver-set version.** Any approver change (tier 11 or recovery) makes approvals on open proposals stop counting (`StaleApprovers`). Otherwise a removed key's approvals would survive its removal.
- **Stale proposals.** A release proposal stores the release it was compared against; if another release is published first, it can't be published (`StaleBase`). Otherwise a proposal made against an old allowlist could later pass as "code only".
- **Who proposes.** Releases: the proposer key or any approver; the proposer sets `e`. Admin (tier 11): approvers only, never the CI key, never `e`. The proposer can't approve, freeze or unfreeze, and can't be one of the approvers.
- **Tier 11 also covers** the proposer key, recovery address, guardian, grace window and switching back to observe mode (the spec lists approver set, domain binding, timelocks and circuit swap).
- **Timelocks** must satisfy short ≤ long ≤ 30 days, so `tL` always implies `tS`.
- **First release** compares against empty hashes, so it is tier 10 (2 approvals + 24 h, or 3 of 3 + e).
- **Unfreeze approvals** count only for the current freeze; a new freeze resets them. `unfreeze()` gives the circuit only the approval bits and f = 1.
- **Observe mode.** Starts at deploy. After 7 days any approver may switch to enforce (stricter only); going back to observe is tier 11.
- **Domains.** The first claim happens in the gate's constructor (spec: DNS TXT proof at first claim, checked off-chain by Guard and the watchtower; the first-claim race is a known limit). Adding, transferring, unbinding or changing a domain's container is tier 11. A domain's container is either Signet's shared container (free) or the team's own (Pro/Enterprise).
- **Shared container scope (v1).** SignetRegistry writes only `projects/<domain>/manifest.json`, at most one 24,000-byte chunk, and only bytes whose SHA-256 equals the bound gate's current published manifest hash. Anyone may relay the bytes. There is no owner, no upgrade path, and no function that moves the NFT out. Failover copies (full builds) stay in a team's own container.
- **Beacon pin.** Every `eval` (publish and unfreeze) first checks `beacon.implementation()` is the address given and checked at deploy; otherwise `BeaconChanged`. Freezing needs no circuit, so it still works if the beacon ever changes.

**Not done yet:** contracts are not deployed; circuit #5 is still held by the dev wallet on mainnet. The 3 fork tests transfer it only on a local fork.

## 2026-11-16: Security review fixes (H-1 to L-4)

Measured first on a fork (`test/spike/Operator.fork.t.sol`), because the design depends on it:
- A container has **one** SiteRegistry operator, set by the holder, valid for **at most 30 days**. An operator can `putFile`, `appendChunk`, `removeFile` and `setFallback`, but can't appoint another operator. Transferring the circuit NFT clears the operator.
- `setFallback` is **one path per container**.
- Every processor proxy has code hash `0x57aa306f…17d5` (equals TAP-10; the beacon address is a constant inside that code).

**Supersedes earlier entries:** SignetRegistry no longer holds circuit #5 (it is the container's operator instead); a changed beacon no longer blocks publishing (the Solidity mirror decides, M-1); gates are clones made by a factory, not standalone deployments.

| Fix | What was built | Choices made (not dictated by the review) |
|---|---|---|
| **H-1** | `proposeRelease(filesRoot, allowlistHash, originsHash, e)`; `manifestHash = sha256(abi.encode(...))` and the tier come from the same inputs. The registry writes `signet/allowlist.json` / `signet/origins.json` only if `sha256(bytes)` equals the on-chain hash. | **`filesRoot` is a SHA-256 Merkle root** (sorted pairs) over `sha256(abi.encode(path, contentType, sha256(bytes)))`, with `signet/files.json` as one of the leaves. Why: a gate must be able to authorise any single site file on-chain (L-4), and a flat hash of a file list can't do that. The CLI `seal` must build this tree. **Guard, dashboard and watchtower checks are a spec requirement now; that code isn't built yet.** |
| **H-2** | `tS`/`tL` count from `lastApprovalAt`; proposals expire 7 days after `proposedAt` (publish and approve revert `Expired`). | Approving twice reverts (`AlreadyApproved`) so the clock isn't reset by accident. A withdrawn-then-repeated approval does restart it. Max long timelock is 5 days so it always fits inside the 7-day life. |
| **H-3** | Files up to 96,000 bytes: the whole file arrives in one transaction, is hash-checked on-chain, then stored as up to 4 chunks (`putFile` + `appendChunk`). `removeFile` (bound gate, tier 11) inside `projects/<domain>/`. Migration: 2 different ops propose the same successor → `MigrationScheduled` → 7 days → `Migrated`; the old registry then refuses claims and writes. Circuit #5 is not transferred to the registry. | **No per-project fallback in the shared container** (SiteRegistry has one per container; reverts `SharedHasNoFallback`). `setFallback` works for a gate's own container. **Any one op can cancel** a migration (blocking is the safe direction). **Gates follow a migration only by their own tier-11 vote** (`FollowRegistry`), so ops 2-of-3 can't take over gates alone. Files over 96 KB (large JS bundles in a failover copy) need a multi-transaction upload that isn't built. X Layer's per-transaction gas cap is unknown: a 30,000-byte write used 6.7M gas on the fork, so 96 KB needs ~22M. |
| **M-1** | `PolicyMirror.eval`, equal to the circuit on all 512 inputs (truth table, netlist evaluator, and the real circuit #6 on a fork). Used when `beacon.implementation() != pinned`, with `PolicyFallbackActive(impl)`. | |
| **M-2** | `voteRemoveGuardian` (2 approvers, works while frozen); recovery already works while frozen; `unfreezeAndPublish`; one freeze per key per 24 h (guardian included). | "SetGuardian(0) while frozen" is built as a 2-of-3 vote, not as a tier-11 proposal: letting an admin proposal run while frozen would bypass the circuit's `f` rule. Freezing while already frozen reverts and doesn't use up the cooldown. |
| **M-3** | The new processor's code hash must equal the pinned TapeOut proxy hash (which embeds the beacon); `circuitInfo` and `netlist` are read from the processor. | **A swap only accepts another copy of the same netlist** (same SHA-256). Why: the mirror (M-1) must stay equal to the circuit. A different policy means a new gate version. |
| **M-4** | One `_checkRoles` used at setup, after every admin action, and when recovery is proposed and executed. | |
| **M-5** | `cancel(id)` by any approver; `withdrawApproval(id)`. | A rogue approver can therefore stall releases (cancel, or freeze once a day); the answer is removing them through recovery. |
| **M-6** | `SignetFactory.createGate` clones the gate, sets it up, registers it and claims its domains in one transaction. The registry accepts claims only from the factory or from factory-made gates; a domain can only be transferred to a factory-made gate. | **Gates are EIP-1167 clones** of one implementation (a factory that embeds the full gate code would itself exceed 24 KB; clones are also much cheaper per project). `initFactory` is a one-time call by the registry's deployer. The first-claim race on a brand-new domain remains (spec threat 11). |
| **M-7** | `revoke(releaseId)` by one approver, immediate; `voteUnrevoke` needs 2; frozen → previous release not valid. | The registry also refuses to write files of a revoked current release. |
| **L-1** | `proposeRelease` reverts `FastLaneNotAllowed` for `e` + allowlist changed + origins changed. The circuit is unchanged; the gate just never offers it that case. | **The first release is exempt** (nothing to compare with; otherwise onboarding always waits 24 h). *Needs your confirmation.* |
| **L-3** | short ≥ 10 min, long ≥ 6 h, short ≤ long ≤ 5 days, grace ≤ 7 days. | |
| **L-4** | A gate accepts only TapeOut circuit NFTs (sender's code hash), `renewOperator(circuits, id)` (anyone) makes the registry operator for 30 days, and the registry writes release-approved files at the container root, only while the bound gate holds that container's NFT. If that container is the shared one, `projects/` is off limits. `TransferCircuit` (tier 11) is the way out. | The gate doesn't write files itself; it delegates to the registry as operator, which keeps one write path and keeps the gate small. **Operational duty:** someone must call `renewOperator` at least every 30 days (the watchtower should). If it lapses, file writes pause; publishing and validity checks are unaffected. |

**No split was needed.** With the Solidity optimizer on (200 runs), ReleaseGate is 17.7 KB (limit 24.6 KB). The optimizer was off before; nothing had been deployed with either setting.

## 2026-11-16: The shared container is a new container; circuit #5 stays Signet's own site

- **Decision.** SignetRegistry's shared container (free-tier projects under `projects/<domain>/`) is a **new** container, separate from circuit #5's container `0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed`, which stays Signet's own site (dashboard), protected by Signet's own gate.
- **Supersedes** the earlier entries that named `0x8E2E…94Ed` as the shared container.
- **Why.** Keeps free-tier project files and Signet's own site in different containers with different holders, so neither can ever write into the other.
- **Contracts.** No change needed: the shared circuit is a constructor argument of SignetRegistry (`circuits`, `circuitId`). The rule that blocks `projects/` for a gate whose own container equals the shared one stays as a safety net.
- **Tests.** `test/Core.fork.t.sol` now tapes out and opens a fresh container on the fork and uses it as the shared one; circuit #5 is only used as Signet's own site.
- **Not done on mainnet yet (needs the human's yes):** tape out a 1-gate circuit on processor #101 and open its container. Cost about 0.082 OKB (0.08 opening fee + 0.0013 tape-out fee + 0.000661 for 1 NAND + gas); the dev wallet holds about 0.0466 OKB, so it needs funding first.
- **After the hackathon: the shared container's circuit NFT moves to a multisig.** Until then the dev wallet holds it and renews the registry's operator grant (at most 30 days per grant). The holder is the one key that could replace the operator or write to the shared container directly, so it must not stay a single key.
- **First release and the fast lane (confirmed).** The L-1 exemption only lets a first release *ask* for the fast lane; the circuit still requires 3 of 3 for it. With one or two approvals a first release is plain tier 10: 2 approvals + 24 h. Test: `test_L1_firstRelease_fastLaneStillNeedsThreeOfThree`.

## 2026-11-17: Second security review, and the final container decision

**Container (final, supersedes the "new container" entry above).** No new container. Circuit #5's container `0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed` holds both Signet's own site under `signet/` and free-tier projects under `projects/<domain>/`. The dashboard uses hash routing, so no SiteRegistry fallback path is needed (and none can be set for anything in this container). Circuit #5 stays with the dev wallet, then a multisig after the hackathon; SignetRegistry is only the operator.
- Built as: the registry's deployer names **one** factory-made gate as "Signet's site" (`initSignetSite`, one time). That gate's shared-container files get the prefix `signet/`; every other gate's get `projects/<domain>/`. A gate can't bind the shared container as its "own" container (root access is refused even if it held the NFT).
- Note: Signet's own allowlist file therefore sits at `signet/signet/allowlist.json` (site prefix + the fixed `signet/allowlist.json` path).
- Tests that prove the two never mix: `test_container_signetSiteUnderSignet_projectsUnderProjects_neverMix` (unit) and `test_fork_container_signetSiteAndProjects_neverMix` (real SiteRegistry).

| Fix | What was built | Choices made (not dictated by the review) |
|---|---|---|
| **M-1** | The tier is compared with `_baseline()`: the newest release whose manifest isn't revoked (each release stores the one it replaced). Revocation is stored **per manifest hash**; proposing or publishing a revoked hash reverts `RevokedManifest`; only `voteUnrevoke` (2 of 3) clears it. | A pending proposal goes stale (`StaleBase`) if a revoke or un-revoke changes the baseline after it was proposed. If every release is revoked there is nothing to compare with, so the next one is tier 10. |
| **M-2** | Migration removed entirely: no `FollowRegistry`, no ops, no successor, no lock. The registry never stops accepting claims or writes. | **A future v2 registry will import v1 bindings read-only** (`bindingOf`, `isGate` stay readable forever). A gate's registry address is fixed for its lifetime; moving to v2 means the team creating a new gate there. |
| **M-3** | `SignetFactory.commit(keccak256(abi.encode(domain, salt, claimant)))`; the reveal (`createGate`, or `claim` for a gate adding a domain) needs the commit to be ≥ 2 blocks old and ≤ 7 days old, and uses it up. | **"Earliest valid commit wins" is enforced as: a commit made after seeing a reveal is never old enough.** I did *not* add a takeover rule (an earlier committer displacing an existing binding later): it would let a squatter pre-commit known domains and seize them after the real team reveals. *Needs your confirmation.* Limits: commit-reveal stops mempool copying, not squatting by someone who already knows the domain (the DNS TXT check, off-chain, is the answer). A gate adding a domain shows it in the tier-11 proposal for 24 h before the reveal. |
| **M-4** | A release proposal records the proposing approver's slot; `approve` by that slot reverts `OwnProposal`. | Admin (tier-11) proposals are exempt: they need 3 of 3, so excluding the proposer would make them impossible. An approver-proposed release can never use the fast lane (only 2 approvals possible). Remaining risk, now in spec threat 8: one approver key + the CI key can pass a tier-00 release. |
| **L-1** | One `revoke` per approver per 24 h. | |
| **L-2** | Guardian-removal votes are timestamps; a vote counts for 7 days. | |
| **L-3** | `readyAt` is set when the approval count first reaches the tier's need (1 / 2 / 2 / 3), cleared when it drops below, and `tS`/`tL` count from it. Replaces "from the last approval" (first review H-2). | |
| **L-4** | `transfer` only records a pending gate; `acceptTransfer` by that gate (its own tier-11 `AcceptDomain`) completes it. | On acceptance the domain moves to the shared container (the old gate's own container can't be inherited); the new gate can set its own afterwards. |
| **L-5** | `voteRemoveFile(domain, path)`: 2 approvers, only while the gate's current release is revoked. | Scope is "any file of the gate's domains while the current release is revoked", because files are stored by path, not by release. Otherwise removal stays tier 11. |
| **L-6** | After `unbind`, a claim by any other gate reverts `Reserved` for 30 days. | |
| **L-7** | `proposeRelease` rejects a zero `allowlistHash` or `originsHash`. | The canonical empty-list bytes are for the CLI `seal` to define (for example `[]`); the contract only requires non-zero. |
| **Info** | `eval` is called in `try/catch`; on a revert or a wrong-length answer the mirror decides and `PolicyFallbackActive(impl, 2)` is emitted (reason 1 = beacon changed). `BindDomain` no longer hides errors: it only claims a new domain, and `SetContainer` is a separate action. The file leaf is `sha256(abi.encode(domain, path, contentType, sha256(bytes)))`. `MAX_FILE_BYTES` = 48,000. | **Gas limit, measured 2026-11-17:** `eth_estimateGas` on X Layer succeeds up to 196M gas and the block gas limit is 210M, so there is **no per-transaction cap today**; the largest of 20,452 recent transactions used a 11.05M limit. OP-stack chains are adopting the 2^24 = 16,777,216 cap (EIP-7825), so the limit was set to 2 chunks: a 48,000-byte write used 10.5M gas on the fork. `writeFile` now takes one struct argument (the 5 separate arguments no longer fit the EVM stack). |

**Still true from before:** the registry can't write files over 48 KB (was 96 KB); large bundles in a failover copy need a multi-transaction upload that isn't built. The off-chain checks from H-1 (Guard, dashboard, watchtower) aren't built yet.

## 2026-11-17: Local staging chain

- **TapeOut is not on X Layer testnet** (chain 1952): no code at the factory, beacon, circuit implementation, opener, SiteRegistry, DomainBinding or hub addresses (checked on `testrpc.xlayer.tech`). TAP-10 lists only BNB Chain, Base and X Layer mainnet.
- **Decision.** Staging is an anvil fork of X Layer mainnet (`staging/up.sh`, see `staging/README.md`), chain id kept at 196 so container addresses match. Every user journey runs there before any mainnet deployment.
- Test wallets come from a fixed seed, not anvil's default keys: those well-known keys have history on real chains that a fork inherits.
- Every package reads its chain from `@signet/contracts/network` (`SIGNET_NETWORK=mainnet|local`). This adds `@signet/contracts` as a dependency of cli, extension, dashboard and demo-dapp.

## 2026-11-17: Third security review

| Fix | What was built | Choices made (not dictated by the review) |
|---|---|---|
| **M-1** (adding a domain) | A `BindDomain` proposal stores `(commitment, circuits, tokenId)` where `commitment = keccak256(abi.encode(domain, salt, gate))`. `proposeAdmin` makes the factory commit in the same transaction, so the commit is always older than 2 blocks when the 24 h timelock ends. `publishBind(id, domain, salt)` reveals and executes; plain `publish` on it reverts. `commitDomain` is gone. | Approvers must check the real domain off-chain before approving (the dashboard will show it; the CLI must hand them the domain and salt). The commit lasts 7 days, the same as a proposal's life. The container (`circuits`, `tokenId`) is not hidden. |
| **L-1** | `revokeEpoch` goes up on every revoke, completed un-revoke and release publish, and is part of the file-removal vote key. | |
| **L-2** | A transfer offer records its time; `acceptTransfer` reverts `TransferExpired` after 7 days. `cancelTransfer` by the bound gate, as tier-11 `CancelTransfer`. | Starting a new transfer replaces a pending one (as before). |
| **L-3** | The registry's constructor takes the factory and Signet's site gate as **predicted addresses** (the factory is the deployer's next contract; the site gate is the factory's first clone). `initFactory`, `initSignetSite` and the stored deployer are removed: nothing in the registry can be configured after deployment. The site gate may hold one shared-container domain (`SiteGateHasADomain` otherwise, including by transfer). Its prefix is `signet/<domain>/`. | "No bindings at that moment" holds by construction: the constructor refuses a factory or site gate address that already has code, so no gate or binding can exist yet. **The deploy script must create the site gate as the factory's very first gate** and checks both predictions; a wrong prediction means redeploying. Signet's own allowlist now sits at `signet/<domain>/signet/allowlist.json`. |
| **Info** | Revoking an already-revoked manifest reverts before the cooldown is touched. `bindingOf` returns all-empty when an own container isn't valid for its gate (not held, missing, or the shared container); `gateOf(domain)` still shows the binding. Two events instead of one: `PolicyFallbackBeaconChanged(impl)` and `PolicyFallbackEvalFailed()`. | `PolicyFallbackEvalFailed` covers a revert, running out of gas and a wrong-length answer; the contract can't tell these apart. A caller can force it by sending too little gas, which is harmless: the mirror gives the same answer as the circuit on all 512 inputs. |
| **Info (CLI)** | Not code yet: **the CLI must treat `CommitExists` as success** (someone re-sent our commitment, or we are retrying) and go on to the reveal. Added to the spec's build plan. | |
