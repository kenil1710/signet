# Signet: the website can only ask your wallet for what its team sealed on X Layer

**What it is.** A dApp team seals each release of its website on X Layer; a TapeOut circuit decides when it may go live, and users who run the **Guard** extension get every page and every signature checked against it by a second TapeOut circuit.
**Benchmark (staging):** against the same 12 attacks, SRI alone blocks 2, a hash-only checker 7, **Signet 12**, with **0 false blocks** ([`docs/benchmark.md`](docs/benchmark.md)).
**Verify it yourself:** `pnpm install && pnpm verify:claims` (read-only, about 2 minutes, checks [`CLAIMS.md`](CLAIMS.md) against X Layer mainnet).
**Live site:** https://signet-6l4.pages.dev (landing page, dashboard, [`/prove`](https://signet-6l4.pages.dev/app#/prove) against mainnet, no wallet); `signetguard.xyz` is being connected ([`docs/cloudflare-pages.md`](docs/cloudflare-pages.md)). Run it locally: [`docs/TRY-IT-LOCALLY.md`](docs/TRY-IT-LOCALLY.md).
**On mainnet** ([`docs/mainnet.md`](docs/mainnet.md)): release-policy circuit **#6** and Guard decision circuit **#7** on processor #101 `0x73153e5fd2Acac604D49d6ca9fea27b750718F22`; SignetRegistry [`0x98dB5B6B…0589`](https://www.oklink.com/xlayer/address/0x98dB5B6B1545D0fb374da40a02045B93398E0589), SignetFactory [`0xc5e12ffe…7986`](https://www.oklink.com/xlayer/address/0xc5e12ffe9D5bE7085441bD955724A6FAff9f7986), Signet's site gate for `signetguard.xyz` [`0xa3d4dfb5…4503`](https://www.oklink.com/xlayer/address/0xa3d4dfb5fB47D2CcF9b4a0a0fcC64Ac3fFef4503).
**Honest limit:** users without Guard are not protected at signing; the watchtower alerts their team instead ([`THREAT_MODEL.md`](THREAT_MODEL.md)).
**Judges:** start with [`JUDGES.md`](JUDGES.md) (5 minutes). Machine-readable: [`claims.json`](claims.json), [`llms.txt`](llms.txt).

---

## What is in this repo

| Package | What it does | Status |
|---|---|---|
| `packages/circuit` | Release-policy circuit (34 NAND) and Guard decision circuit (22 NAND), reference functions, exhaustive 512-row tests | both on mainnet (#6, #7) |
| `packages/contracts` | ReleaseGate (one per project), SignetRegistry (domains, enumerable list, chunked file writes), SignetFactory | 189 Foundry tests; on mainnet |
| `packages/cli` | `signet` CLI: init, verify, seal, propose, diff (Diff Guard), approve, publish, upload, wait, freeze | staging |
| `packages/action` | GitHub Action: verify, seal, propose, publish when the circuit allows, then deploy | staging (local runner) |
| `packages/extension` | Guard (Chrome MV3): page check from the browser cache, signing check decided by the Guard circuit | staging; not in the Web Store |
| `packages/gateway` | The verified copy as a normal web page, every file checked against the sealed hashes | staging; not deployed |
| `packages/dashboard` | Landing page, projects, proposals with Diff Guard, approvals, freeze/revoke, `/prove`, badge | live on Cloudflare Pages, reading mainnet |
| `packages/watchtower` | Loads every sealed site each minute, alerts the team on a confirmed mismatch | staging, one region |
| `packages/attacks` | The attack suite and the benchmark | staging |

## Built on TapeOut: what Signet really uses

Everything below is on X Layer mainnet (chain 196) unless it says otherwise. `pnpm verify:claims` checks the
on-chain parts (C1–C9 in [`CLAIMS.md`](CLAIMS.md)).

| TapeOut part | How Signet uses it | On mainnet |
|---|---|---|
| **Circuit #6** on processor **#101** [`0x73153e5f…8F22`](https://www.oklink.com/xlayer/address/0x73153e5fd2Acac604D49d6ca9fea27b750718F22): release policy, 34 NAND, 9 inputs, 2 outputs | ReleaseGate calls `processor.eval(6, …)` **inside every publish and unfreeze transaction**: the circuit's PUBLISH / UNFREEZE output decides. A Solidity mirror, equal on all 512 inputs, is used only if the circuit beacon's implementation changes or the call fails. Truth table: [`docs/policy-truth-table.md`](docs/policy-truth-table.md) | Taped out 2026-11-16 (mint [`0x1c772cbe…`](https://www.oklink.com/xlayer/tx/0x1c772cbe1cfeded533308f7fb3be7a07338144754d8d95205359efef0ff6b1be), tape-out [`0x354cb0d5…`](https://www.oklink.com/xlayer/tx/0x354cb0d5e93245326e19cab3c701d5b6b72122d6e293c96f6d7b2211a4f82b96)); 512/512 rows verified on 2 RPCs |
| **Circuit #7** on processor #101: Guard decision, 22 NAND, 9 inputs, 3 outputs | Guard asks it for ALLOW / WARN / BLOCK on every signature, with an `eth_call` to `eval`. A local mirror is used if the stored netlist isn't the reviewed one. Truth table: [`docs/guard-truth-table.md`](docs/guard-truth-table.md) | Taped out 2026-11-18 (mint [`0xa655247a…`](https://www.oklink.com/xlayer/tx/0xa655247a48cb08f60d0b3304b3a8d0fea540115b6ed1f5472900f3c793f3b059), tape-out [`0x8fc6a9d7…`](https://www.oklink.com/xlayer/tx/0x8fc6a9d7dbf6082783b267449ee13c6327af56f2a662e087f23f1c40ade44c16)); 512/512 verified |
| **Circuit Container** of circuit #5 [`0x8E2E14Ac…94Ed`](https://www.oklink.com/xlayer/address/0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed) + **SiteRegistry** [`0xd6EFb7ad…ADB6`](https://www.oklink.com/xlayer/address/0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6), the storage DeWEB sites live in | Each release's sealed manifest (`signet/files.json`, `allowlist.json`, `origins.json`) and the files of the **verified copy** go here, under `projects/<domain>/` (Signet's own site: `signet/<domain>/`). [SignetRegistry](https://www.oklink.com/xlayer/address/0x98dB5B6B1545D0fb374da40a02045B93398E0589) is the container's SiteRegistry **operator** (a 30-day grant) and writes only files that the domain's gate approved in a release | Container opened, and a test file written and read back (Spike B, C6). The registry is the operator until 2026-12-18. No project's files are uploaded yet |
| **Chunked writes** (`SiteRegistry.appendChunk`) | `SignetRegistry.writeChunk` stores files over 48,000 bytes as 24,000-byte pieces, one proved piece per transaction, so a real bundle fits under the per-transaction gas limit | Deployed in the registry. Measured on a mainnet fork: a 300 KB bundle = 13 transactions, ≈ 0.0015 OKB (R10) |
| **TapeKit / TAP-10 reading rules** | Guard, the gateway, the watchtower and `/prove` read files with `SiteRegistry.read` and accept one only if its size and SHA-256 equal the on-chain record ([TAP-10 §7.1](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-10.md)). Chain facts are read from **two independent RPCs that must agree**, as TapeKit does. The verified-copy gateway reuses [TapeKit's service-worker gateway](https://github.com/TapeOutProtocol/TapeKit/tree/main/sw-gateway) design (our own code, with Guard pinning its files) | The rule runs against mainnet in `/prove`. The gateway is staging-only |

Not used yet (see the Roadmap): TapeSend, TapeCode, hosting the site itself on DeWEB.

## Roadmap (planned, not built)

- **TapeSend alerts.** The watchtower would send alerts ("site doesn't match its seal", "new tier 10/11 proposal",
  "gate frozen") to a team's container inbox through the DeWEB hub `0xe61A…25ee`. The sender would be a relay
  contract holding an opened container, so the server key can only send rate-limited alerts. Measured: ≈ 0.0000039
  OKB per alert. **Waiting on TapeOut** to confirm the hub implementation that was upgraded on 2026-11-18
  (`0xf6b8…9261`, not yet listed in TAP-10).
- **TapeCode sealing (design ready).** TapeCode uploads to a staging container. `signet seal --from-container`
  reads the exact bytes from the chain, the gate's approvals decide, and SignetRegistry copies the approved files
  to production, where TapeCode's key can't write.
- Hosting this site on DeWEB (≈ 0.0044 OKB of storage), the Chrome Web Store listing, and the watchtower in 3 regions.

Research, sources and costs: [`docs/ecosystem-integration.md`](docs/ecosystem-integration.md).

Spec and every decision with its reason: [`docs/signet-spec.md`](docs/signet-spec.md), [`docs/decisions.md`](docs/decisions.md). Built for the X Layer TapeOut Accelerate hackathon. MIT licensed.
