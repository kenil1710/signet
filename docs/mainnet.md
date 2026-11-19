# Signet on X Layer mainnet (chain 196)

Deployed on **2026-11-18** from the dev wallet `signet-dev` `0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE`, after
the full rehearsal on a fork of mainnet (`staging/rehearse-mainnet-full.sh`: the same scripts and inputs, then every
staging suite and the attack suite against that deployment, all passing). Each transaction was approved before it was
sent (CLAUDE.md rule 2). Machine-readable: `packages/contracts/deployments/mainnet.json`.

## Addresses

| What | Address |
|---|---|
| SignetRegistry | [`0x98dB5B6B1545D0fb374da40a02045B93398E0589`](https://www.oklink.com/xlayer/address/0x98dB5B6B1545D0fb374da40a02045B93398E0589) |
| SignetFactory | [`0xc5e12ffe9D5bE7085441bD955724A6FAff9f7986`](https://www.oklink.com/xlayer/address/0xc5e12ffe9D5bE7085441bD955724A6FAff9f7986) |
| ReleaseGate implementation (deployed by the factory) | [`0xD14697C1dFEAdA3A117Ff8CD5358c80743453B3D`](https://www.oklink.com/xlayer/address/0xD14697C1dFEAdA3A117Ff8CD5358c80743453B3D) |
| Signet's site gate, for **signetguard.xyz** (files under `signet/signetguard.xyz/`) | [`0xa3d4dfb5fB47D2CcF9b4a0a0fcC64Ac3fFef4503`](https://www.oklink.com/xlayer/address/0xa3d4dfb5fB47D2CcF9b4a0a0fcC64Ac3fFef4503) |
| Release-policy circuit (taped out 2026-11-16) | **#6** on processor #101 [`0x73153e5fd2Acac604D49d6ca9fea27b750718F22`](https://www.oklink.com/xlayer/address/0x73153e5fd2Acac604D49d6ca9fea27b750718F22) |
| Guard decision circuit | **#7** on processor #101 (22 NAND, 9 inputs, 3 outputs; 512/512 rows checked on both RPCs at block 76,226,736) |
| Shared file container (circuit #5); operator = the registry for 30 days | [`0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed`](https://www.oklink.com/xlayer/address/0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed) |

## Site gate roles (`signetguard.xyz`)

| Role | Address |
|---|---|
| Approver A | `0xB9ef367A86DE5150a5390c4148073901587d2416` |
| Approver B | `0x3280887C6ed2c0C43679918654f72222b767e6dc` |
| Approver C | `0x1C4704480E258bdBF8719ffba1679dD0e158c74c` |
| CI proposer (can propose and publish; never approve) | `0x93272103b49B955dF493999F4B9Dea4852FA9453` (key from `signet keygen`, not in the repo) |
| Recovery | `0x69400a5f15F6b2D84AAB70989B32266010E6cD93` |
| Guardian (freeze only) | `0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE` (signet-dev) |

Mode: **observe** (a new gate starts there). No release published yet.

## Transactions (all from signet-dev, in order)

| # | Transaction | Block | Gas | Gas fee + value (OKB) |
|---|---|---:|---:|---:|
| 1 | Deploy SignetRegistry: [`0x2cda992a…ec7c`](https://www.oklink.com/xlayer/tx/0x2cda992a97393d2d222f51918df0d9395433b4a78f975cd3a77cc77af17aec7c) | 76,226,335 | 2,861,749 | 0.000057235 |
| 2 | Deploy SignetFactory (+ ReleaseGate implementation): [`0x92616ab4…c817`](https://www.oklink.com/xlayer/tx/0x92616ab4773a6bdc368420496b724a1d9efcb927b5ee6b0425b7e08dfaedc817) | 76,226,338 | 5,492,286 | 0.000109846 |
| 3 | factory.commit (hides signetguard.xyz): [`0x4fc13b49…9ba5`](https://www.oklink.com/xlayer/tx/0x4fc13b49efd3150e231865da8c82d347386fab03c1605e0d4e3ca3b6f6b19ba5) | 76,226,340 | 45,561 | 0.000000911 |
| 4 | SiteRegistry.setOperator(shared container, registry, 30 days): [`0x5d9c3753…39c1`](https://www.oklink.com/xlayer/tx/0x5d9c3753da8dc0785df5cad2bf720923e5b2a8005cf455d19d33465adcb239c1) | 76,226,342 | 136,055 | 0.000002721 |
| 5 | factory.createGate: Signet site gate for signetguard.xyz: [`0x939aa45b…eac4`](https://www.oklink.com/xlayer/tx/0x939aa45b92ff1bdc81f5a46dbce93b1f1ae9164177160d43c272ff2a4776eac4) | 76,226,498 | 576,686 | 0.000011534 |
| 6 | transistors.mint(NAND, 22): [`0xa655247a…b059`](https://www.oklink.com/xlayer/tx/0xa655247a48cb08f60d0b3304b3a8d0fea540115b6ed1f5472900f3c793f3b059) | 76,226,680 | 86,399 | 0.000683728 |
| 7 | processor.tapeout(Guard netlist) → circuit #7: [`0x8fc6a9d7…4c16`](https://www.oklink.com/xlayer/tx/0x8fc6a9d7dbf6082783b267449ee13c6327af56f2a662e087f23f1c40ade44c16) | 76,226,683 | 264,089 | 0.001305282 |
| | **Total** | | **9,462,825** | **0.002171257** |

Gas price paid: 0.020000001 gwei. The value in rows 6 and 7 is TapeOut's mint cost (0.000682 OKB) and tape-out fee
(0.0013 OKB). signet-dev went from nonce 8 to 15, and its balance from 0.046635572562621784 to
0.044464316053158959 OKB.

## Circuit #5 moved into the site gate (2026-11-19, sent by the user from signet-dev)

| Tx | Call | Block | Gas |
|---|---|---|---|
| `0x547047605047ba753f15a3cc41a9b29085efc9c08f332315d2ccb501e574714a` | `processor.safeTransferFrom(signet-dev, siteGate, 5)` | 76,306,374 | 77,034 |
| `0xdcc4684be63c41c8e2c3c819d89871e4b50cc103715636d13e049a5498d9ede1` | `siteGate.renewOperator(processor, 5)` | 76,306,506 | 115,241 |

After: `ownerOf(5)` = site gate `0xa3d4…4503`; `SiteRegistry.operatorOf(container #5)` = SignetRegistry;
`operatorUntil` = 1797667542 (**2026-12-19 08:05 UTC**); `canEdit(SignetRegistry)` = true, `canEdit(signet-dev)` = false.
Moving #5 out again needs the gate's tier-11 `TransferCircuit` (3 of 3 + 24 h). Fork-tested first (a full publish
through the registry after the move wrote and read back its manifest files).

## Checks after the deploy

- `record-mainnet` re-read all 7 receipts from xlayerrpc.okx.com and xlayer.drpc.org (both succeeded, both from
  signet-dev, same blocks). It confirmed the registry → factory → site gate links, and ran the 512-row check on
  circuit #7 on both RPCs.
- `pnpm verify:claims`: **ALL CHECKS PASSED (9 on mainnet, 10 from the repo, 0 pending deployment)** (`claims.json`).
- `/prove` (the dashboard built for mainnet, in a headless browser, no wallet): **All checks passed (0 pending
  deployment)**. Circuits #6 and #7 matched on all 512 rows through both RPCs; the beacon, the registry (1 domain)
  and `signetguard.xyz` (no release yet) all checked. Screenshots: `docs/demo/ui/prove-mainnet-1280.png`, `-390.png`.
- **Found after the deploy, and fixed:** xlayer.drpc.org answers HTTP 400 to a JSON-RPC batch of 4 or more calls.
  `/prove` (batches of 32), and Guard's per-site check (6–8 calls), failed on mainnet because of it, so Guard would
  have shown "could not check" (fail-open) on every sealed site. The shared helper (`packages/extension/src/lib/rpc.ts`)
  now sends at most 3 calls per request, all at the same pinned block. Staging never showed it, because both
  staging RPCs are local.

## Still to do (no OKB unless stated)

- Verify the source on OKX Explorer by hand: [`docs/verify/README.md`](verify/README.md) (OKLink's API login is no longer available; free, no wallet). Files checked against mainnet by `docs/verify/check.py`.
- ~~Renew the registry's operator grant~~ Done differently, 2026-11-19: circuit #5 moved into the site gate (below). The grant now runs to **2026-12-19 08:05 UTC** and **anyone** can renew it with `siteGate.renewOperator(processor, 5)`. The watchtower will do it automatically (planned, `packages/watchtower/README.md`).
- Signet's own site's first release (propose, 3 approvals, publish, upload): not done; DeWEB upload not approved.
- Fund the CI proposer and approvers with a little OKB when they start acting (not done).

## Runbook: release #3 → #4 (Fri 20 Nov 2026)

Prepared 2026-11-19 (commit after `de45bc7`); **not deployed**. The live site must stay byte-identical to release/3
until #3 is published.

1. **Publish #3** (from 13:45:22 IST / 08:15:22 UTC; proposal expires Thu 26 Nov 13:43:29 IST). CI proposer key;
   ≈ 0.00006 OKB (publish 306k gas + 3 manifest writes ≈ 2.66M gas). Shown to the user and sent only on their yes:
   `cd packages/dashboard && SIGNET_NETWORK=mainnet node ../cli/src/cli.ts -C . publish 3 release/3`
   Check: `currentRelease() = 3`, the 3 files read back, Guard-style check of the live site = sealed #3.
2. **Deploy the #4 site changes** (`/start`: `signetguard@0.1.2`, "publishing includes the upload", the Cloudflare
   Email Obfuscation / Rocket Loader warning, tarball link 0.1.2; 0.1.0 and 0.1.1 tarballs removed):
   `SIGNET_REPO_PUBLIC=1 pnpm --filter @signet/dashboard build && npx -y wrangler@4 pages deploy dist --project-name signet --branch main`
   (`SIGNET_REPO_PUBLIC=1` only once the GitHub repo is public: it turns the GitHub link on. Checked 2026-11-19: with
   or without it, #4's allowlist and origins equal #3's, so #4 is tier 00. The ReleaseGate implementation address
   shown on /app is excluded from the allowlist in `signet.config.json`: it's displayed, never called.)
   Then fetch every live file from signetguard.xyz into `release/4` and require byte-identity with `dist`.
3. **Seal and propose #4** from the live files: `seal release/4`, then `propose release/4`. Expected (fork-tested
   2026-11-19): **tier 00 code only**, 1 approval + 1 h; allowlistHash `0x5a48…efc5` and originsHash `0xfa18…85cf`
   unchanged from #3.
4. **The user approves** (1 approval) in the dashboard.
5. **Publish #4** after 1 h (+ its manifest upload), shown first and sent on the user's yes.
