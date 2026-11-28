# Threat model

What Signet stops, how, and what it does not stop. "Tested" means the attack suite (`pnpm attacks`, report in
`docs/attack-report.md`) ran it on the staging chain against Guard in enforce mode. Last run: **all 12 attacks
against Guard users blocked, 0 false blocks on 16 clean sessions.**

Two limits are stated, not counted as attacks Guard defends against:
- **A user without Guard is not protected at signing.** The suite runs the same DNS hijack in a browser without Guard: the drainer's request reaches the wallet. The watchtower alerted the team within its one-minute round on the local fork (on mainnet a round runs every 5 minutes).
- **A compromised Guard extension defeats Guard** (threat 17). Not testable from outside; documented below.

## Who is protected

| User | Protected at signing? | What they get |
|---|---|---|
| **Runs the Guard extension** (Chrome) | **Yes** | Page check against the sealed release, signing-time allowlist decided by the Guard circuit, warning page. The verified copy is built and tested on a local fork, not deployed yet (Guard 0.3.7 and earlier say "Verified copy: available with Pro"; 0.3.8 says "Verified copy: coming soon") |
| **Uses a wallet that does the same check** | Would be | No wallet does this yet. A wallet SDK is a plan, not built |
| **Anyone else** (no extension, mobile, WalletConnect to a phone) | **No** | Indirect only: the watchtower alerts the team within about 10 minutes (a round every 5 minutes; a bad load is confirmed by a second one), and the team can freeze, revoke and warn |

That last row is most users today. Signet does not change what they sign.

## Layers

1. **Release policy (on-chain).** CI can propose and call publish but never approve; a TapeOut circuit (#6 on mainnet) decides publication from approvals, timelocks and a risk tier the contract computes. No single key can publish a release: it stops a stolen CI key or laptop from shipping a *sealed* release alone. It does not stop a stolen hosting, CDN or DNS credential from changing what is served; that is detected (watchtower, Guard) and blocked for Guard users in enforce mode.
   - **Fast on purpose, slow on purpose.** Safety actions only stop or remove things, so they are fast: any one approver can freeze or revoke the current release at once; two can unfreeze, un-revoke, remove the guardian, or remove a file from a revoked release. Changes are slow: approvers, the CI key, the recovery address, the guardian, timelocks, the domain binding, the circuit copy and switching back to observe mode take 3 of 3 + 24 h (tier 11). Switching to enforce (stricter) takes one approver, after the gate's first 7 days. One exception: the recovery address alone can replace all three approvers after a public 7-day wait, unless two approvers cancel (it is on-chain for anyone to see; nothing alerts on it yet). (threat 18)
2. **Diff Guard (review).** Shows approvers new addresses, spenders, origins, SRI hashes and approve/permit/transfer calls before they approve.
3. **Page check (Guard).** The bytes the browser ran, read from its cache, against the sealed file hashes. *Detection*, after the code ran.
4. **Signing check (Guard).** Every signature request against the sealed allowlist; the Guard decision circuit says ALLOW, WARN or BLOCK. *Prevention*, before the wallet sees the request.
5. **Watchtower.** Loads every watched site on a schedule (every 5 minutes on GitHub Actions, started by a Cloudflare Worker cron because GitHub's own schedule ran every 4–12 hours; the code supports any interval) and alerts the team on a mismatch confirmed twice.

## Threats

| # | Attack | Answer | Tested | What still gets through |
|---|---|---|---|---|
| 1 | DNS / registrar hijack, whole site replaced | Page check → warning page; signing check refuses | **blocked** for Guard users | **Users without Guard: not protected** (run in the suite's "known limits" section: the drainer reached the wallet; the watchtower alerted the team) |
| 2 | One JS chunk swapped on the CDN / S3 | Per-file hash mismatch | **blocked** (lazy chunk) | — |
| 3a | Script injected into the HTML | HTML hash mismatch + unsealed origin | **blocked** | — |
| 3b | Code that arrives as data: `eval`, `new Function`, XSS, a compromised config API | Page check can't see it (no file changed). The signing check refuses unsealed spenders and recipients | **blocked** (approve and transfer to the attacker) | Calls to sealed contracts with arguments Guard doesn't decode: allowed, because the contract is sealed (Guard doesn't check amounts or unknown arguments) |
| 4 | Bad code served once, then swapped back (Bybit) | Guard hashes the bytes in the user's own cache, not a fresh download | **blocked** | Files served `no-store` can't be read from the cache: they show grey (unverified) |
| 5 | Poisoned npm package in the build | Diff Guard flags the new address, origin and calls; the chain makes it tier 10 (2 approvals + 24 h); the signing check still refuses an unsealed spender and, by default, any transfer not to the user | **blocked** at signing even after approvers published it | A poisoned package that only calls sealed contracts with arguments the policy allows. Approvers who don't read Diff Guard |
| 6 | Allowlisted router, attacker as recipient; permit phishing; blind signing | Calldata and typed data decoded: recipient must be the user (or as the project's sealed `transfers` rule says), spender and verifying contract must be sealed. `eth_sign` and typed data Guard can't read (no verifying contract, not readable): **refused in enforce mode** since Guard 0.3.5 (circuit #7 answers WARN for them; Guard's rule on top can only make that a refusal), warned in observe mode | **blocked** (swap recipient; Permit2; EIP-2612); `eth_sign` and unreadable typed data refused in enforce mode (staging test) | A frozen gate only warns on a readable, sealed call (circuit #7) |
| 7 | Stolen CI key or hacked dev laptop | The CI key can propose and call publish, never approve | Foundry tests (`test_threat7_proposerCanOnlyPropose`) | A tier-00 release if one approver approves without reading the diff |
| 8 | One approver key stolen | Can't reach 2 of 3; can't approve its own proposal | Foundry tests | **That key plus the CI key** can publish a tier-00 (code-only) release after 1 h, unless someone cancels or freezes |
| 9 | Two or three approver keys stolen | Timelocks give 24 h for tier 10/11; the watchtower posts pending tier-10/11 changes | watchtower staging test | Full compromise of the team: out of scope |
| 10 | Malicious insider approver | As 8; can stall releases by cancelling or freezing once a day | Foundry tests | Two colluding insiders |
| 11 | Domain re-bound to an attacker's gate | Binding changes are tier 11 (3 of 3 + 24 h); first claims are commit-reveal | Foundry tests | The first claim of a brand-new domain (someone who knows the domain can claim it first; the DNS TXT proof is checked off-chain) |
| 12 | Look-alike phishing domain | Not sealed → Guard does nothing there | — | **Not covered.** That is Blockaid's territory |
| 13 | RPC lies to Guard | Two RPCs must agree at the same block; manifests must hash to on-chain values | staging tests (disagreeing RPCs, forged manifest) | Both RPCs lying the same way |
| 14 | Malicious service worker left on the domain | Guard checks every registered worker's script against the release | **blocked** | — |
| 15 | Page detects Guard and behaves for it | Guard has no web-accessible files; then Guard users are safe anyway | — | Users without Guard |
| R | Rollback to an older, genuine release | After the 6 h grace window the old release is invalid on-chain; inside it, old files are accepted but the *current* allowlist applies | **blocked** (both cases) | Inside the grace window, code from the previous release runs if it only asks for what the current allowlist allows |
| V | Signing on a revoked release | Revoked = red; every signature refused in enforce mode | **blocked** | Users whose Guard checked less than 60 s ago (see limits) |
| 16 | Freeze or revoke spam by an approver | Unfreeze and un-revoke need 2 of 3; a cooldown limits repeats; remove the approver via recovery | Foundry tests | Up to 24 h of no releases. A revoke turns the site red for Guard users in enforce mode until two approvers un-revoke. Signing is not blocked by a freeze (only warned) |
| 17 | **Compromised Signet: the Guard extension, its build, or our Chrome Web Store account** | Open source; permissions: storage, alarms, six RPC hosts (X Layer: xlayerrpc.okx.com and xlayer.drpc.org; Arc mainnet and testnet: Circle's and dRPC's), and content scripts on every http(s) page (one in the page's own world, to see signature requests; they make no network request on a domain that isn't sealed, R7); the decision rule is a public circuit | **not testable**, documented only | **Everything.** A malicious Guard update can feed the circuit any facts, allow any signature, or report browsing. This is our largest risk. Mitigations: each Guard release zip carries a Sigstore build attestation, and rebuilding it from the repository (`pnpm --filter @signet/extension build` at the release tag) gives the zip's files byte for byte except `manifest.json`'s `version_name` (commit and build time; checked for 0.3.7 on 2026-11-28). Planned, not done: a hardware key on the store account |
| 18 | **Recovery key stolen** | The recovery address alone can propose a new approver set; it takes effect after a public 7-day wait unless any two current approvers cancel (`voteCancelRecovery`). The proposal is on-chain (`RecoveryProposed`, `getPendingRecovery()`) | Foundry tests (`test_recovery_onlyRecoveryAddress`, `test_recovery_cancelNeedsTwoApprovers`, `test_lostKey_twoApproversCannotPassTier11_recoveryCan`, `test_M4_recovery_*`) | **Takeover after 7 days** if no two approvers notice and cancel: nothing alerts on a pending recovery yet (the watchtower, the dashboard and Guard don't read it). On Signet's own gates one person holds the recovery address and the approvers. Keep the recovery key offline; a watchtower alert on `RecoveryProposed` is planned, not built. |

## Server-rendered sites and factory contracts (Signet v2: Guard 0.3.0, CLI 0.2.0)

A server-rendered site (Next.js and similar) can't seal its HTML: every page is built per request. In page mode
`ssr` (sealed in `origins.json`, so turning it on is at least tier 01) Signet seals **the code, not the HTML**:

| What | How Guard checks it | What gets through |
|---|---|---|
| Script files (every `/_next/static` chunk, preloads that were fetched, stylesheets) | Read from the browser cache, SHA-256 against the sealed release, as on a static site | Nothing that isn't a sealed file: a tampered or added chunk is a mismatch |
| Inline `<script>` | Each must be a **sealed hash** (theme and config snippets, React's streaming runtime, collected from the build and from crawling the deployed preview) or a **data template**: `self.__next_f.push(JSON)` (Next.js flight data) or `$RS/$RC/$RX/$RV(JSON strings)` (React reveals). The argument is checked with `JSON.parse`, never evaluated; any extra character fails. Types the browser doesn't run (`application/json`, `ld+json`) are data; `importmap` and `speculationrules` must be sealed | Only sealed snippets and pure data |
| `on*=` attributes, `javascript:` URLs | Injected code | Nothing |
| Service workers | Must be a sealed path listed in `pages.serviceWorkers` (none by default); their bytes are hashed | Nothing else |

**The race.** An injected inline script runs before anything can look at it. Guard records every `<script>` node from
`document_start` (a MutationObserver in the content script), keeps scripts that remove themselves and every text a
script had (so a script can't run and then rewrite itself into an allowed one, or change its type to look inert),
and **before every signature** takes the pending records synchronously and runs a fresh full check. A script that
injects itself and calls `eth_sendTransaction` at once is refused (staging test). It still *ran*: it can do anything
that isn't a signature through the wallet (show a fake address, read the page).

**What `ssr` mode does not seal (honest limits):**
- **The page's text and data.** The HTML and the flight data come from the server. A hijacked server can change what
  is shown (names, amounts, links), and can make sealed code send sealed calls with chosen parameters: an approve
  amount, `setLimits` values on *your own* vault. The signing check (sealed contracts, your own factory vault,
  transfer recipients) is what still protects you; it does not check amounts.
- **Inline scripts the crawl didn't see.** The sealer seals the inline scripts of the crawled pages, including those a
  page creates while it runs (`seal --crawl-browser`: React inserts some during hydration from the flight data). A
  script that only appears on a page type that wasn't crawled is reported as injected: a false warning, not a hole.
  Found on misthos.world: nested 404 pages use a second theme snippet. The team lists one page per layout (and a
  404 inside each nested layout) in `pages.crawl`, and checks reports in observe mode before enforcing.
- `<script nomodule>` and preloads the browser never fetched are not checked: nothing runs from them in Chrome 120+.

**Factory contracts** (`allowlist.json`, per chain: `factories`). A contract that isn't listed passes as a target or
spender only if `factory.predictVaultAddress(X, target.programId()) == target` for X = the signer or the target's
`owner()`, and **the signer is the target's owner or guardian**. Read on two RPCs that must agree (Arc: Circle and
dRPC, fixed in Guard's build). Strict: an RPC error, a disagreement or a revert means "not sealed" (the opposite of
Guard's general fail-open, on purpose: a vault address is exactly what a hijacker would swap).
- Refused: a contract with the vault's interface not created by the factory; a factory vault someone else owns; a
  factory vault an attacker created naming you as owner (its creator isn't you). All three are staging tests.
- **Limit:** a vault whose ownership was transferred (owner ≠ creator) is not recognized unless the signer created it;
  the team lists such a vault explicitly. The rule relies on the factory being immutable: checked for Misthos
  (no proxy slots, no `DELEGATECALL`/`SSTORE`/`SELFDESTRUCT` in its code, immutable implementation), not by Guard.
- **Guard 0.2.0** reads a v2 release as a static site and wrongly reports a server-rendered page as not matching.

## Honest limits

- **Most users are not protected at signing** (see the first table). Guard is not in the Chrome Web Store yet. Guard is tested by hand with Rabby, OKX Wallet and MetaMask on X Layer mainnet, in enforce mode (2026-11-28, Guard 0.3.7; refusals work: an unsealed transaction refused before the wallet opened, a sealed one reached it; for Rabby and OKX also from a same-origin iframe). OKX Wallet 4.26.0 makes its providers impossible to wrap, so Guard (0.3.6 and later) checks its requests where the wallet's page script hands them to its content script; Guard 0.3.5 does not protect OKX Wallet. Tested headless only: Coinbase Wallet, Bitget Wallet and Phantom (copies of the real extensions on a sealed staging site: unsealed requests refused before the wallet saw them, sealed ones reached it, in both load orders and through every provider object each wallet exposes). Not protected yet: Trust Wallet through `window.ethereum` (it talks to its extension over a private message channel Guard can't see, and its provider can't be wrapped; its EIP-6963 provider is checked). The automated suites use mock wallets.
- **Plain message signatures pass.** `personal_sign` (logins such as Sign-In with Ethereum) is allowed on every wallet, in enforce mode too, without a notice; only transactions, `wallet_sendCalls` and typed data are checked, and `eth_sign` is refused in enforce mode. A protocol that treats a `personal_sign` message as an authorization (some off-chain orders or relayers) is not protected by Guard.
- **Observe mode** is the default, and a gate can't leave it in its first 7 days: Guard reports and never blocks. A team that never switches to enforce mode gets alerts, not protection.
- **Fail-open.** When Guard can't read the release (both RPCs down, disagreeing, or no manifest on-chain), it blocks nothing. An attacker who can make the RPCs fail for one user turns Guard off for them. A release verified in the last 24 h is still enforced.
- **60-second lag.** Guard re-reads a sealed domain from the chain at most once a minute, so a revoke or a new release takes up to 60 s to reach a user who has the site open.
- **The page check runs after the code has run.** It can't undo what the code did outside signing (show a fake address to copy, read the screen). Preventing signatures is the signing check's job.
- **Iframes.** Guard 0.3.7 checks signing requests from iframes whose every ancestor has the page's origin (a wallet such as OKX answers those under the sealed site's name); they are decided with the top page's allowlist and page check. A cross-origin iframe is not checked: the wallet shows that frame's own origin, not the sealed site's. Guard 0.3.6 and earlier check the top frame only.
- **What the page check doesn't see:** iframes (the page check is the top frame's), files served `no-store`, cross-origin scripts beyond their SRI attribute, pages served from the site's own service worker cache, more than 250 resource-timing entries, scripts other extensions inject (they show as unsealed).
- **The Guard circuit decides on facts the extension computes.** It makes the rule public and unchangeable; it does not make a compromised extension honest.
- **The watchtower** runs from one place (a GitHub Actions runner), started every 5 minutes by a Cloudflare Worker cron (GitHub's own schedule ran every 4–12 hours in practice, so it is only a fallback), with two loads to confirm. A hijack served once per visitor (the Bybit pattern) passes it; Guard is the answer there.
- **The verified copy** (Signet gateway) is built and tested on staging but not deployed on a public https domain. Visitors must trust its three files; Guard pins them, but Chrome doesn't let an extension read a worker that is already installed. Files over 48,000 bytes are stored in 24,000-byte pieces (`SignetRegistry.writeChunk`, deployed on mainnet; a 300 KB bundle measured on a fork at 13 transactions, ≈ 0.0015 OKB), so a full copy costs storage gas per release.
- **Domain ownership.** Anyone can still *bind* an unbound domain on-chain (first come, first served; no on-chain recourse until a registry v2). But since 2026-11-19 Guard, the dashboard, `/prove`, the badge and the watchtower **ignore any gate the domain doesn't confirm** in `/.well-known/signet.json`, so a squatter's gate is never shown as sealed, never turns the real site red and never offers a verified copy (tested). **Limit:** a first-time visitor during a hijack that also removes the file isn't protected (fail-open); returning visitors are (the confirmed gate is pinned). `docs/domain-ownership.md`.
- **TapeOut trust.** TapeOut's contracts have no verified source. Signet relies on: the circuit beacon's owner being `0x0` and its implementation pinned (checked by `pnpm verify:claims`, C5); SiteRegistry, which stores the manifests, is **upgradeable by its owner** `0xE4fc…283d`. If it changed what it returns, Guard would reject the files (they must hash to the on-chain values) and fail open.
- **Signet's own keys.** Since 2026-11-21 Signet's site gate holds circuits #5, #6 and #7, so moving any of them out needs 3 of 3 approvers + 24 h (`TransferCircuit`). Holding #6 or #7 never changed what they compute (a holder can only transfer them or open a file container under their names). The dev wallet (`signet-dev`) is no longer the guardian (two approvers removed it on 2026-11-20); signet-ops became the guardian (tier-11 `SetGuardian`, proposal #6, 2026-11-23), but its keystore password turned out to be lost, so approvers A and B removed it from both gates on 2026-11-24 (`voteRemoveGuardian()`, 2 of 3; its 0.043 OKB is lost): **both gates have no guardian now**. A guardian is optional (any approver can freeze); naming a new one is tier 11 (3 of 3 + 24 h). Approvers A, B and C on both gates are three separate wallets on three separate devices, held by one person (Signet is built by a solo founder), as is the recovery address. No single key can publish a release, but one person holds every key. The design is meant for three different people, and a real team should use three. So today the 3-of-3 rules protect against a stolen key or a lost device, not against that person. signet-dev holds no OKB, no circuit and no role. It no longer holds circuit #5: since 2026-11-19 the site gate does, so anyone can renew the registry's 30-day operator grant (`renewOperator`), and moving the container or changing its operator needs 3 of 3 approvers + 24 h. It should be a multisig; it isn't yet. Approver A is used from a browser wallet (Rabby) in the founder's everyday browser profile, also for the hand tests of Guard (2026-11-28); it alone approved releases #15–#18 (tier 00 needs one approval). A stolen approver A key can approve, not publish alone: a release still needs a proposal from the CI key and the timelock, and the other two can freeze.
- **On mainnet since 2026-11-18** (`docs/mainnet.md`): circuits #6 and #7, SignetRegistry, SignetFactory, the ReleaseGate implementation and Signet's site gate. Signet's own site has published releases #3 onward through its gate (#6 was the guardian change; the current release is on `/prove`), and its gate is in **enforce** mode since 2026-11-25 12:25 UTC (`enforce()` by one approver, tx `0x00de5449…2dd0`). A second domain, misthos.world (the founder's own app on Arc, the first real site sealed with Signet; not an outside customer), published release #1 on 2026-11-25 and is in **observe** mode (enforce possible from 2026-12-01 08:14 UTC). **Not yet:** a release by a project outside Signet's founder, approvers held by three different people, Guard in the Chrome Web Store (a pre-release zip with a Sigstore build attestation is on GitHub), the gateway on a public domain, an alert on a pending recovery (threat 18). The watchtower checks signetguard.xyz (not misthos.world yet) every 5 minutes (a Cloudflare Worker cron starts it). Telegram alerts to the team's chat are set up (a test alert was accepted by Telegram on 2026-11-20, watchtower run 44746304914).
