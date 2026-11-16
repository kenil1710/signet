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
