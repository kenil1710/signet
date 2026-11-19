# Signet in 5 minutes

**Guard refuses any wallet signature your dApp's team didn't seal.** If the website is hacked (a swapped script, a hijacked domain, a poisoned npm package), the page can't get the wallet to approve, permit or transfer to a contract or spender outside the release's sealed allowlist. Signet **builds on TapeKit's on-chain file verification** and adds: that signing-time allowlist (TapeOut circuit #7), risk-tiered approvals with timelocks decided by TapeOut circuit #6, CI that can only propose, a domain proof, and a verified copy read from X Layer (built; goes live with Pro).

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

Frozen: nothing publishes. Any one approver can freeze; unfreezing needs 2 of 3. The 1 h / 24 h waits are defaults.

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

No terminal? Open **[/prove](https://signet-6l4.pages.dev/app#/prove)**: the same circuit checks, run by your
browser against mainnet, with no wallet (about 3 minutes).

## What runs on TapeOut (X Layer mainnet)

- **Two circuits on processor #101** ([`0x73153e5f…8F22`]({O}/address/0x73153e5fd2Acac604D49d6ca9fea27b750718F22)):
  - **#6**, the release policy. ReleaseGate calls `eval(6, …)` inside every publish and unfreeze transaction, and the
    circuit's output decides.
  - **#7**, Guard's ALLOW / WARN / BLOCK decision at signing.
  - Both are checked on all 512 inputs by `verify:claims` (C1–C3, C9).
- **Circuit Container + SiteRegistry** (DeWEB's storage): the container of circuit #5
  ([`0x8E2E…94Ed`]({O}/address/0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed)) in SiteRegistry
  ([`0xd6EF…ADB6`]({O}/address/0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6)) holds each release's sealed manifest and
  the files of the verified copy.
  - [SignetRegistry]({O}/address/0x98dB5B6B1545D0fb374da40a02045B93398E0589) writes there, as the container's 30-day
    operator, and only files an approved release lists.
  - Files over 48 KB go in 24 KB pieces (`writeChunk` → `appendChunk`).
  - So far only a test file is stored (C6); no project files yet.
- **TapeKit / TAP-10 reading rules:** every file is checked for size and SHA-256 against the chain, on two RPCs that
  must agree. The gateway uses TapeKit's service-worker design (staging only).
- **Not used yet:** TapeSend (alerts are planned; waiting on TapeOut to confirm a hub upgrade made on 2026-11-18),
  TapeCode (sealing design ready), and hosting the site on DeWEB. Details:
  [`docs/ecosystem-integration.md`](docs/ecosystem-integration.md).

## Minute 3–4: see what it stops

[`docs/attack-report.md`](docs/attack-report.md): **all 12 attacks against Guard users blocked, 0 false blocks
on 16 clean sessions**, run on a fork of X Layer with Guard in enforce mode. Shown separately, as a limit: the same
hijack against a user **without** Guard is not stopped (the drainer reaches the wallet; the watchtower alerts the
team). Against the same attacks, SRI alone blocks 2 and a hash-only checker 7 ([`docs/benchmark.md`](docs/benchmark.md)). Screenshots in [`docs/demo/`](docs/demo/):

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
  - Signet adds: a **signing-time allowlist** (refused before the wallet opens), **no single key can publish** (CI
    proposes, humans approve, a TapeOut circuit whose rule nobody can upgrade decides, with on-chain risk tiers and
    timelocks), a domain proof, and a public on-chain record.
  - They do better: WEBCAT blocks before any script runs and proves domain enrollment, which Signet doesn't yet.
  - Details: [`docs/prior-art.md`](docs/prior-art.md).
- **Scam detectors** (Blockaid in MetaMask, Wallet Guard, Pocket Universe, Scam Sniffer) flag *known-bad* sites and
  addresses on every site. Signet *allowlists* what a team sealed, so it catches a hijacked **legitimate** site
  sending to a fresh address. They're complementary: [`docs/vs-scam-detectors.md`](docs/vs-scam-detectors.md).

## Minute 4–5: read the limits

[`THREAT_MODEL.md`](THREAT_MODEL.md), especially "Who is protected" and "Honest limits". In short: protection at
signing needs Guard; Guard starts in observe mode; it fails open when it can't read the chain; a compromised Guard
extension defeats it. Signet's contracts and the Guard circuit **are on mainnet** ([`docs/mainnet.md`](docs/mainnet.md)), but
no project, not even Signet's own site, has published a release there yet. Guard isn't in the Chrome Web Store, has
been tested with a mock wallet only, and the gateway and watchtower run on staging.

## Run it yourself (optional, ~15 minutes)

Needs Foundry and an X Layer RPC URL in `.env` (`XLAYER_RPC_URL`, read-only):

```bash
pnpm staging:up          # an anvil fork of X Layer with Signet deployed and the Guard circuit taped out
pnpm attacks             # the attack suite; rewrites docs/attack-report.md
pnpm test                # 189 Foundry tests, 512-row circuit tests, unit tests
```

| Where | What |
|---|---|
| `packages/circuit` | both circuits, their reference functions and the exhaustive tests |
| `packages/contracts` | ReleaseGate, SignetRegistry, SignetFactory (Foundry) |
| `packages/extension` | Guard |
| `packages/cli`, `packages/action` | `signet` CLI with Diff Guard; the GitHub Action |
| `packages/gateway`, `packages/watchtower` | the verified copy; the site checker |
| `docs/signet-spec.md`, `docs/decisions.md` | the plan, and every decision with its reason |
