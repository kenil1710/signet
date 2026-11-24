# Plan: a DeWEB copy of signetguard.xyz and one TapeSend alert (nothing sent)

Rehearsed 2026-11-24 on a local fork of X Layer mainnet (block ≈ 76,75x,xxx), from a fresh throwaway wallet, with the
release #8 files (`packages/dashboard/release/8`, without the 0.2.1 tarball). Every step succeeded and was read back.
Fees were read from the chain just before; gas is priced at today's 0.020000001 gwei.

## Why a new circuit and container

DeWEB's gateway (`https://<id>-2-101.tapekit.org/`) serves a **container from its root** and displays it only when
`DomainBinding.isLive(name, container)` is true; `bind` may be called **only by the container's holder** (TapeKit
SPEC B.6). Signet's own container (circuit #5) is held by the site gate since 2026-11-19, and the gate has no function
to call `bind` or write files at the root (its registry writes only under `projects/<domain>/`). So the copy needs its
own small circuit and container, held by a plain wallet. (Not a contract: TapeSend's `publishKey` refuses contract
holders, and ERC-1155 transistors can't be minted to a wallet with EIP-7702 code, measured on the fork.)

## Steps and exact cost

| # | Call (holder wallet) | Gas | Value (OKB) | Total (OKB) |
|---|---|---:|---:|---:|
| 1 | `transistors.mint(NAND, 2)` on processor #101's transistor token `0xBf0B…ae54` | 86,399 | 0.000662 (2 × 0.000001 + 0.00066 protocol fee) | 0.0006637 |
| 2 | `processor.tapeout(netlist, 2, 1)`: a 2-gate circuit (a copy of #5's netlist) | 224,682 | 0.0013 (`TAPEOUT_FEE`) | 0.0013045 |
| 3 | `opener.open(#101, id)` | 167,256 | **0.08** (`FEE()`) | 0.0800033 |
| 4 | `SiteRegistry.putFile` + `appendChunk` (24,000-byte pieces): 24 files, 1,045,831 bytes, 58 transactions, each read back and hashed | 239,414,036 | 0 | 0.0047883 |
| 5 | `DomainBinding.bind("<id>.2.101.tape", container, 12)`: `monthlyFee()` = **0** on X Layer (read on mainnet, TapeKit pins this binding and implementation) | 185,482 | 0 | 0.0000037 |
| 6 | One public TapeSend alert: `hub.send(#101, id, to = circuit #5's container, ref, "TS" 0x02 0x00 ‖ JSON)`, 206 bytes | 184,558 | 0 | 0.0000037 |
| | **Total** (63 transactions) | **240,262,413** | **0.081962** | **≈ 0.0868 OKB** |

- Adding the 241 KB CLI tarball: ≈ +55M gas, +0.0011 OKB. Leaving out the 503 KB 3D seal script (the landing page
  has a static fallback): ≈ −0.0023 OKB.
- **Each later release:** only changed files are rewritten, typically 0.0005–0.005 OKB (the JS bundles change every
  build). Alerts: ≈ 0.0000037 OKB each.

## What it gives, and its limits

- A judge-visible TapeOut integration: signetguard.xyz served by DeWEB from X Layer at `https://<id>-2-101.tapekit.org/`,
  every file checked by TapeKit's service worker against SiteRegistry's SHA-256, the same bytes as sealed release #8.
- The copy is **not** governed by Signet's gate (its holder can change it); its files match the sealed release only
  because we write that release. Guard and the verified copy keep reading the sealed release, not this copy.
- TapeSend: the hub's implementation is `0xf6b86f44…9261` since 2026-11-18, which TAP-10 doesn't list and TapeKit's
  config doesn't pin. The contract accepts the send (measured), but a compliant TapeSend client MUST NOT send through an
  unlisted implementation and may not show it. Ask the TapeOut team before relying on it.
- The holder wallet must be a plain wallet (no EIP-7702 delegation), funded with ≈ 0.09 OKB. Not signet-ops (password
  lost). Who holds it is the team's choice.

## Order, if approved

Fund the holder → steps 1–3 (one transaction each; the id is `nextId()` after step 2) → step 4 (the CLI can do it:
the same writes `signet upload` uses) → step 5 → check `https://<id>-2-101.tapekit.org/` in a browser → step 6.
