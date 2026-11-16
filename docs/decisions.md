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
