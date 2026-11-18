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
| `packages/circuit` | Release-policy circuit (34 NAND) and Guard decision circuit (22 NAND), reference functions, exhaustive 512-row tests | policy circuit on mainnet; Guard circuit on staging |
| `packages/contracts` | ReleaseGate (one per project), SignetRegistry (domains, enumerable list, chunked file writes), SignetFactory | 189 Foundry tests; staging |
| `packages/cli` | `signet` CLI: init, verify, seal, propose, diff (Diff Guard), approve, publish, upload, wait, freeze | staging |
| `packages/action` | GitHub Action: verify, seal, propose, publish when the circuit allows, then deploy | staging (local runner) |
| `packages/extension` | Guard (Chrome MV3): page check from the browser cache, signing check decided by the Guard circuit | staging; not in the Web Store |
| `packages/gateway` | The verified copy as a normal web page, every file checked against the sealed hashes | staging; not deployed |
| `packages/dashboard` | Projects, proposals with Diff Guard, approvals, freeze/revoke, `/prove`, badge | staging; not deployed |
| `packages/watchtower` | Loads every sealed site each minute, alerts the team on a confirmed mismatch | staging, one region |
| `packages/attacks` | The attack suite and the benchmark | staging |

Spec and every decision with its reason: [`docs/signet-spec.md`](docs/signet-spec.md), [`docs/decisions.md`](docs/decisions.md). Built for the X Layer TapeOut Accelerate hackathon. MIT licensed.
