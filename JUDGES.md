# Signet in 5 minutes

**What it is.** A dApp team seals each release of its website on X Layer: the hash of every file, the contracts and
spenders the site may ask a wallet to sign for, and the outside origins it may talk to. A TapeOut circuit decides
when a release may go live (CI can propose and publish but never approve; humans approve; risky changes wait). Users who run the **Guard**
extension get their pages checked against the sealed release, and every signature request checked against the
sealed allowlist by a second TapeOut circuit. **Users without Guard are not protected at signing**; for them the
watchtower alerts the team.

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

## Minute 4–5: read the limits

[`THREAT_MODEL.md`](THREAT_MODEL.md), especially "Who is protected" and "Honest limits". In short: protection at
signing needs Guard; Guard starts in observe mode; it fails open when it can't read the chain; a compromised Guard
extension defeats it; Signet's own contracts and the Guard circuit are on staging, with a costed mainnet plan
([`docs/mainnet-plan.md`](docs/mainnet-plan.md), ≈ 0.0022 OKB) waiting for our go-ahead.

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
