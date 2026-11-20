# Threat model

What Signet stops, how, and what it does not stop. "Tested" means the attack suite (`pnpm attacks`, report in
`docs/attack-report.md`) ran it on the staging chain against Guard in enforce mode. Last run: **all 12 attacks
against Guard users blocked, 0 false blocks on 16 clean sessions.**

Two limits are stated, not counted as attacks Guard defends against:
- **A user without Guard is not protected at signing.** The suite runs the same DNS hijack in a browser without Guard: the drainer's request reaches the wallet. The watchtower alerted the team within its one-minute round.
- **A compromised Guard extension defeats Guard** (threat 17). Not testable from outside; documented below.

## Who is protected

| User | Protected at signing? | What they get |
|---|---|---|
| **Runs the Guard extension** (Chrome) | **Yes** | Page check against the sealed release, signing-time allowlist decided by the Guard circuit, warning page, verified copy |
| **Uses a wallet that does the same check** | Would be | No wallet does this yet. A wallet SDK is a plan, not built |
| **Anyone else** (no extension, mobile, WalletConnect to a phone) | **No** | Indirect only: the watchtower alerts the team within about a minute, and the team can freeze, revoke and warn |

That last row is most users today. Signet does not change what they sign.

## Layers

1. **Release policy (on-chain).** CI can propose and call publish but never approve; a TapeOut circuit (#6 on mainnet) decides publication from approvals, timelocks and a risk tier the contract computes. Stops a stolen CI key or laptop from shipping alone.
2. **Diff Guard (review).** Shows approvers new addresses, spenders, origins, SRI hashes and approve/permit/transfer calls before they approve.
3. **Page check (Guard).** The bytes the browser ran, read from its cache, against the sealed file hashes. *Detection*, after the code ran.
4. **Signing check (Guard).** Every signature request against the sealed allowlist; the Guard decision circuit says ALLOW, WARN or BLOCK. *Prevention*, before the wallet sees the request.
5. **Watchtower.** Loads every sealed site each minute and alerts the team on a mismatch confirmed twice.

## Threats

| # | Attack | Answer | Tested | What still gets through |
|---|---|---|---|---|
| 1 | DNS / registrar hijack, whole site replaced | Page check → warning page; signing check refuses | **blocked** for Guard users | **Users without Guard: not protected** (run in the suite's "known limits" section: the drainer reached the wallet; the watchtower alerted the team) |
| 2 | One JS chunk swapped on the CDN / S3 | Per-file hash mismatch | **blocked** (lazy chunk) | — |
| 3a | Script injected into the HTML | HTML hash mismatch + unsealed origin | **blocked** | — |
| 3b | Code that arrives as data: `eval`, `new Function`, XSS, a compromised config API | Page check can't see it (no file changed). The signing check refuses unsealed spenders and recipients | **blocked** (approve and transfer to the attacker) | Calls to sealed contracts with arguments Guard doesn't decode (shown as "unverified call", not blocked) |
| 4 | Bad code served once, then swapped back (Bybit) | Guard hashes the bytes in the user's own cache, not a fresh download | **blocked** | Files served `no-store` can't be read from the cache: they show grey (unverified) |
| 5 | Poisoned npm package in the build | Diff Guard flags the new address, origin and calls; the chain makes it tier 10 (2 approvals + 24 h); the signing check still refuses an unsealed spender and, by default, any transfer not to the user | **blocked** at signing even after approvers published it | A poisoned package that only calls sealed contracts with arguments the policy allows. Approvers who don't read Diff Guard |
| 6 | Allowlisted router, attacker as recipient; permit phishing | Calldata and typed data decoded: recipient must be the user (or as the project's sealed `transfers` rule says), spender and verifying contract must be sealed | **blocked** (swap recipient; Permit2; EIP-2612) | Unknown calldata formats: warned, not blocked |
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
| 16 | Freeze spam by an approver | Unfreeze needs 2 of 3; remove the approver via recovery | Foundry tests | Up to 24 h of no releases. Signing is not blocked by a freeze (only warned) |
| 17 | **Compromised Signet: the Guard extension, its build, or our Chrome Web Store account** | Open source; minimal permissions (storage, alarms, two RPC hosts); the decision rule is a public circuit | **not testable**, documented only | **Everything.** A malicious Guard update can feed the circuit any facts, allow any signature, or report browsing. This is our largest risk. Mitigations planned, not done: reproducible extension builds, a hardware key on the store account |

## Honest limits

- **Most users are not protected at signing** (see the first table). Guard is not in the Chrome Web Store yet, and it has been tested with a mock wallet, not with MetaMask or OKX Wallet.
- **Observe mode** is the default for 7 days: Guard reports and never blocks. A team that never switches to enforce mode gets alerts, not protection.
- **Fail-open.** When Guard can't read the release (both RPCs down, disagreeing, or no manifest on-chain), it blocks nothing. An attacker who can make the RPCs fail for one user turns Guard off for them. A release verified in the last 24 h is still enforced.
- **60-second lag.** Guard re-reads a sealed domain from the chain at most once a minute, so a revoke or a new release takes up to 60 s to reach a user who has the site open.
- **The page check runs after the code has run.** It can't undo what the code did outside signing (show a fake address to copy, read the screen). Preventing signatures is the signing check's job.
- **What the page check doesn't see:** iframes (top frame only), files served `no-store`, cross-origin scripts beyond their SRI attribute, pages served from the site's own service worker cache, more than 250 resource-timing entries, scripts other extensions inject (they show as unsealed).
- **The Guard circuit decides on facts the extension computes.** It makes the rule public and unchangeable; it does not make a compromised extension honest.
- **The watchtower** runs from one place, every minute, with two loads to confirm. A hijack served once per visitor (the Bybit pattern) passes it; Guard is the answer there.
- **The verified copy** (Signet gateway) is built and tested on staging but not deployed on a public https domain. Visitors must trust its three files; Guard pins them, but Chrome doesn't let an extension read a worker that is already installed. Files over 48,000 bytes are stored in 24,000-byte pieces (`SignetRegistry.writeChunk`, deployed on mainnet; a 300 KB bundle measured on a fork at 13 transactions, ≈ 0.0015 OKB), so a full copy costs storage gas per release.
- **Domain ownership.** Anyone can still *bind* an unbound domain on-chain (first come, first served; no on-chain recourse until a registry v2). But since 2026-11-19 Guard, the dashboard, `/prove`, the badge and the watchtower **ignore any gate the domain doesn't confirm** in `/.well-known/signet.json`, so a squatter's gate is never shown as sealed, never turns the real site red and never offers a verified copy (tested). **Limit:** a first-time visitor during a hijack that also removes the file isn't protected (fail-open); returning visitors are (the confirmed gate is pinned). `docs/domain-ownership.md`.
- **TapeOut trust.** TapeOut's contracts have no verified source. Signet relies on: the circuit beacon's owner being `0x0` and its implementation pinned (checked by `pnpm verify:claims`, C5); SiteRegistry, which stores the manifests, is **upgradeable by its owner** `0xE4fc…283d`. If it changed what it returns, Guard would reject the files (they must hash to the on-chain values) and fail open.
- **Signet's own keys.** The dev wallet (`signet-dev`) holds circuits #6 and #7, and is the guardian (freeze only) of Signet's site gate. It no longer holds circuit #5: since 2026-11-19 the site gate does, so anyone can renew the registry's 30-day operator grant (`renewOperator`), and moving the container or changing its operator needs 3 of 3 approvers + 24 h. It should be a multisig; it isn't yet.
- **On mainnet since 2026-11-18** (`docs/mainnet.md`): circuits #6 and #7, SignetRegistry, SignetFactory, the ReleaseGate implementation and Signet's site gate. **Not yet:** any published release (not even Signet's own site), Guard in the Chrome Web Store or tested with a real wallet, the gateway on a public domain, the watchtower outside staging.
