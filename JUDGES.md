# Signet in 5 minutes

**Your contracts are audited. Your website isn't.** Signet protects what your users actually load: no single key can publish a release of your site, a hacked host or DNS is blocked for users with Signet Guard (and caught within minutes where the watchtower runs), and on a site in enforce mode Guard refuses signatures to contracts and spenders your team didn't seal.
**What teams get:** release approvals with on-chain timelocks (CI only proposes, approvers approve in their own wallets, TapeOut circuit #6 decides), watchtower alerts (running for signetguard.xyz; for other sites with Pro, planned), a freeze any one approver can pull at once, a verified copy read from X Layer (built and tested on a local fork; not deployed yet), and a public proof and badge. **For users:** in enforce mode, Guard **blocks the signature** to any contract or spender the team didn't seal (decided with circuit #7), and in enforce mode refuses `eth_sign` and any signature it can't read (Guard 0.3.5). Signet **builds on TapeKit's** on-chain file verification.

**What it is.** A dApp team seals each release of its website on X Layer: the hash of every file, the contracts and
spenders the site may ask a wallet to sign for, and the outside origins it may talk to. A TapeOut circuit decides
when a release may go live (CI can propose and publish but never approve; humans approve; risky changes wait). Users who run the **Guard**
extension get their pages checked against the sealed release, and every signature request checked against the
sealed allowlist by a second TapeOut circuit. **Users without Guard are not protected at signing**; for them the
watchtower alerts the team.

## The rule, exactly

**Where the publish decision is made.** On every publish and unfreeze, ReleaseGate calls circuit #6 (`processor.eval(6, …)`) and its PUBLISH / UNFREEZE output decides. A Solidity copy of the same 34 gates (equal on all 512 inputs, checked in CI) decides only if that call reverts or returns a malformed answer, or if the circuit's beacon implementation is no longer the one pinned when the gate was made (which can't happen while the beacon has no owner); each fallback emits an event (`PolicyFallbackEvalFailed`, `PolicyFallbackBeaconChanged`). **Why a circuit:** its beacon has no owner, so the rule's logic can't be upgraded by anyone, including us, and a gate can only ever switch to another copy of the same netlist (a tier-11 change). A team can change its approvers and its waits (10 min to 5 days), only through tier 11; nobody can change the rule itself.

| Tier | What changed (computed on-chain from the release's hashes) | To publish |
|---|---|---|
| 00 | Code only | 1 approval + 1 h, or 3 of 3 with the emergency flag |
| 01 | A new external origin, or a changed SRI hash of a cross-origin script | 2 approvals + 1 h |
| 10 | A new contract or spender. **Every team's first release is tier 10** | 2 approvals + 24 h, or 3 of 3 with the emergency flag |
| 11 | Admin: approvers, timelocks, domain binding, circuit copy | 3 of 3 + 24 h, no fast lane |

Frozen: nothing publishes. The 1 h / 24 h waits are defaults.

**Fast on purpose, slow on purpose.** Safety actions only stop or remove things, so they are fast: any one approver
can freeze or revoke the current release at once; two can unfreeze, un-revoke, remove the guardian, or remove a file
from a revoked release. Changes are slow: approvers, the CI key, the recovery address, the guardian, timelocks, the
domain binding, the circuit copy and switching back to observe mode take **3 of 3 + 24 h** (tier 11). Switching to
enforce (stricter) takes one approver, after the gate's first 7 days. One exception: the recovery address alone can replace all three approvers after a public 7-day wait, unless two approvers cancel (it is on-chain for anyone to see; nothing alerts on it yet).

## Minute 1–3: check the claims against mainnet yourself

Needs Node ≥ 22.18 and pnpm. No key, no transaction, about 2 minutes:

```bash
pnpm install
pnpm verify:claims
```

It checks, on two independent RPC operators that must agree, that the release-policy circuit #6 is on processor
#101, is the reviewed netlist, and gives the published truth table on all 512 inputs. It also checks who taped it
out, that it can't be upgraded through its beacon, and that Signet's container stores what we say. Signet's contracts and the Guard
decision circuit #7 are on mainnet too (C8, C9; `docs/mainnet.md`); a claim about something not deployed would print **PENDING**. Every claim and its evidence: [`CLAIMS.md`](CLAIMS.md).

Two rows by hand, from [`docs/policy-truth-table.md`](docs/policy-truth-table.md). Row 0x00b (approvers 1 and 2,
short timelock passed, code-only tier) publishes: `0x03`. Row 0x1a9 (one approval, frozen) does not: `0x00`.

```bash
cast call 0x73153e5fd2Acac604D49d6ca9fea27b750718F22 "eval(uint256,bytes)(bytes)" 6 0x0b00 --rpc-url https://xlayerrpc.okx.com   # 0x03
cast call 0x73153e5fd2Acac604D49d6ca9fea27b750718F22 "eval(uint256,bytes)(bytes)" 6 0xa901 --rpc-url https://xlayerrpc.okx.com   # 0x00
```

No terminal? Open **[/prove](https://signetguard.xyz/app#/prove)**: the same circuit checks, run by your
browser against mainnet, with no wallet (about 6–15 seconds, depending on the public RPCs).

## What runs on TapeOut (X Layer mainnet)

- **Two circuits on processor #101** ([`0x73153e5f…8F22`](https://web3.okx.com/explorer/x-layer/evm/address/0x73153e5fd2Acac604D49d6ca9fea27b750718F22)):
  - **#6**, the release policy. ReleaseGate calls `eval(6, …)` inside every publish and unfreeze transaction, and the
    circuit's output decides.
  - **#7**, Guard's ALLOW / WARN / BLOCK decision at signing.
  - Both are checked on all 512 inputs by `verify:claims` (C1–C3, C9).
- **Circuit Container + SiteRegistry** (DeWEB's storage): the container of circuit #5
  ([`0x8E2E…94Ed`](https://web3.okx.com/explorer/x-layer/evm/address/0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed)) in SiteRegistry
  ([`0xd6EF…ADB6`](https://web3.okx.com/explorer/x-layer/evm/address/0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6)) holds each release's sealed manifest and
  the files of the verified copy.
  - [SignetRegistry](https://web3.okx.com/explorer/x-layer/evm/address/0x98dB5B6B1545D0fb374da40a02045B93398E0589) writes there, as the container's 30-day
    operator, and only files an approved release lists.
  - Files over 48 KB go in 24 KB pieces (`writeChunk` → `appendChunk`).
  - Release #8's 29 files are stored there in full (2026-11-24, `docs/mainnet.md`); each later release stores its manifest files.
- **TapeKit / TAP-10 reading rules:** every file is checked for size and SHA-256 against the chain, on two RPCs that
  must agree. The gateway uses TapeKit's service-worker design (staging only).
- **Not used yet:** TapeSend (alerts are planned; waiting on TapeOut to confirm a hub upgrade made on 2026-11-18),
  TapeCode (sealing design ready), and hosting the site on DeWEB. Details:
  [`docs/ecosystem-integration.md`](docs/ecosystem-integration.md).

## Minute 3–4: see what it stops

[`docs/attack-report.md`](docs/attack-report.md): **all 12 attacks against Guard users blocked, 0 false blocks
on 16 clean sessions**, run on a fork of X Layer with Guard in enforce mode. Shown separately, as a limit: the same
hijack against a user **without** Guard is not stopped (the drainer reaches the wallet; the watchtower alerts the
team). Against the same attacks (12 we wrote, run on our own local fork of X Layer), SRI alone blocks 2 and Signet Guard with its signature checks switched off ("hash-only") 7 ([`docs/benchmark.md`](docs/benchmark.md)). Screenshots in [`docs/demo/`](docs/demo/):

| | |
|---|---|
| `guard-blocked.png` | a hijacked page, replaced by Guard's warning page |
| `guard-signature-refused.png` | a clean page asking to approve an unsealed spender: refused before the wallet sees it |
| `guard-verified-copy.png` | the verified copy (served from the chain, every file hash-checked) signing normally |
| `diff-guard-poisoned.txt` | what approvers see for a build with a poisoned npm package |
| `watchtower-hijack.txt` | the team's alert |

## How is this different from Code Verify / WEBCAT, or a scam detector?

- **Code Verify** (Meta) compares WhatsApp Web's code with a hash Meta publishes. **WEBCAT** (Freedom of the Press
  Foundation, Firefox, developer preview) blocks pages that don't match a Sigstore-signed manifest.
  - **TapeKit** already checks DeWEB files on X Layer; Signet builds on that verification for sites on their own
    domain. **WAICT** (Mozilla and partners, May 2026, Firefox Nightly prototype) binds JavaScript to a manifest in a
    transparency log.
  - Signet adds: a **signing-time allowlist** (refused before the wallet opens), **no single key can publish a
    release** (CI proposes, humans approve, a TapeOut circuit whose rule nobody can upgrade decides, with on-chain
    risk tiers and timelocks), a domain proof, and a public on-chain record. A stolen hosting or DNS credential can
    still change what visitors load; Signet detects it and refuses Guard users, it doesn't prevent it.
  - They do better: WEBCAT blocks before any script runs and proves domain enrollment, which Signet doesn't yet.
  - Details: [`docs/prior-art.md`](docs/prior-art.md).
- **Scam detectors** (Blockaid in MetaMask, Wallet Guard, Pocket Universe, Scam Sniffer) flag *known-bad* sites and
  addresses on every site. Signet *allowlists* what a team sealed, so it catches a hijacked **legitimate** site
  sending to a fresh address. They're complementary: [`docs/vs-scam-detectors.md`](docs/vs-scam-detectors.md).

## Minute 4–5: read the limits

[`THREAT_MODEL.md`](THREAT_MODEL.md), especially "Who is protected" and "Honest limits". In short: protection at
signing needs Guard; a gate starts in observe mode; Guard fails open when it can't read the chain; a compromised Guard
extension defeats it.

**Where it stands on mainnet** ([`docs/mainnet.md`](docs/mainnet.md); C8–C11 in `CLAIMS.md`):
- **signetguard.xyz** (Signet's own site) is in **enforce** mode since 2026-11-25 12:25 UTC (`enforce()` by approver A,
  tx `0x00de5449…2dd0`): Guard users get the red page and refused signatures if it stops matching its seal. Releases
  #3 onward went through its gate (release numbers are the gate's proposal ids: #1 and #2 expired, #6 was the tier-11 guardian change, so #18 is the 15th published site release); #8's files are stored in full in DeWEB's
  SiteRegistry. Each release is deployed and published seconds apart by `scripts/release-site.sh`; Guard 0.3.4+
  holds the page for up to 60 s while a release can publish, so a rollout doesn't turn it red.
- **misthos.world** (the founder's own app on Arc, the first real site sealed with Signet; not an outside customer) published release #1 on 2026-11-25 (tier 10:
  2 approvals + 24 h) and is in **observe** mode; enforce is possible from 2026-12-01 08:14 UTC.
- **No guardian on either gate.** The guardian (signet-ops, a freeze-only key) lost its keystore password, so
  approvers A and B removed it from both gates on 2026-11-24 (`voteRemoveGuardian()`, 2 of 3). A guardian is
  optional: any approver can still freeze. Naming a new one is tier 11 (3 of 3 + 24 h).
- **One person holds the keys.** Approvers A, B and C on both gates are three separate wallets on three separate devices, held by one person (Signet is built by a solo founder), as is the recovery address. No single key can publish a release, but one person holds every key. The design is meant for three different people, and a real team should use three.

Guard isn't in the Chrome Web Store (a pre-release zip with a Sigstore build attestation is on GitHub). Guard is tested by hand with Rabby, OKX Wallet and MetaMask on X Layer mainnet
(enforce mode, 2026-11-28, Guard 0.3.7; refusals work: an unsealed transaction refused before the wallet opened, a sealed one reached it; OKX needs Guard 0.3.6 or later, and in Guard 0.3.6–0.3.7 its protection is not guaranteed: it depends on Chrome running Guard's message listener before OKX's; Guard 0.3.8, not released yet, holds OKX's requests in the page instead; see THREAT_MODEL).
Tested headless only: Coinbase Wallet, Bitget Wallet and Phantom (copies of the real extensions; refused before the wallet, sealed reached it).
Not protected yet: Trust Wallet through `window.ethereum` (private channel; its EIP-6963 provider is checked). The automated suites use mock wallets. The gateway runs on staging.
The watchtower checks signetguard.xyz (not misthos.world yet) every 5 minutes, started by a Cloudflare Worker cron
(GitHub's own schedule, which ran every 4–12 hours, is only a fallback), and publishes its result, including its last
run of `/prove`. Telegram alerts to the team's chat are set up (a test alert was accepted by Telegram on 2026-11-20,
watchtower run 44746304914).

## Run it yourself (optional, ~15 minutes)

Needs Foundry and an X Layer RPC URL in `.env` (`XLAYER_RPC_URL`, read-only):

```bash
pnpm test                # what CI runs: 173 Foundry tests, both circuits on all 512 inputs, unit tests
(cd packages/contracts && XLAYER_RPC_URL=https://xlayerrpc.okx.com forge test)   # + the 17 fork tests: 190
pnpm staging:up          # an anvil fork of X Layer with Signet deployed and the Guard circuit taped out
pnpm attacks             # the attack suite (not in CI); rewrites docs/attack-report.md
```

CI skips the 17 Foundry fork tests (they need an X Layer RPC; they include the 512-row check of the Solidity mirror
against the real circuit #6, and an end-to-end publish against the real circuit and SiteRegistry). The staging and
attack suites run locally only.

| Where | What |
|---|---|
| `packages/circuit` | both circuits, their reference functions and the exhaustive tests |
| `packages/contracts` | ReleaseGate, SignetRegistry, SignetFactory (Foundry) |
| `packages/extension` | Guard |
| `packages/cli`, `packages/action` | `signet` CLI with Diff Guard; the GitHub Action |
| `packages/gateway`, `packages/watchtower` | the verified copy; the site checker |
| `docs/signet-spec.md`, `docs/decisions.md` | the plan, and every decision with its reason |
