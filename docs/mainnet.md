# Signet on X Layer mainnet (chain 196)

Deployed on **2026-11-18** from the dev wallet `signet-dev` `0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE`, after
the full rehearsal on a fork of mainnet (`staging/rehearse-mainnet-full.sh`: the same scripts and inputs, then every
staging suite and the attack suite against that deployment, all passing). Each transaction was approved before it was
sent (project rule: every mainnet transaction is shown with its cost first). Machine-readable: `packages/contracts/deployments/mainnet.json`.

## Addresses

| What | Address |
|---|---|
| SignetRegistry | [`0x98dB5B6B1545D0fb374da40a02045B93398E0589`](https://web3.okx.com/explorer/x-layer/evm/address/0x98dB5B6B1545D0fb374da40a02045B93398E0589) |
| SignetFactory | [`0xc5e12ffe9D5bE7085441bD955724A6FAff9f7986`](https://web3.okx.com/explorer/x-layer/evm/address/0xc5e12ffe9D5bE7085441bD955724A6FAff9f7986) |
| ReleaseGate implementation (deployed by the factory) | [`0xD14697C1dFEAdA3A117Ff8CD5358c80743453B3D`](https://web3.okx.com/explorer/x-layer/evm/address/0xD14697C1dFEAdA3A117Ff8CD5358c80743453B3D) |
| Signet's site gate, for **signetguard.xyz** (files under `signet/signetguard.xyz/`) | [`0xa3d4dfb5fB47D2CcF9b4a0a0fcC64Ac3fFef4503`](https://web3.okx.com/explorer/x-layer/evm/address/0xa3d4dfb5fB47D2CcF9b4a0a0fcC64Ac3fFef4503) |
| Release-policy circuit (taped out 2026-11-16) | **#6** on processor #101 [`0x73153e5fd2Acac604D49d6ca9fea27b750718F22`](https://web3.okx.com/explorer/x-layer/evm/address/0x73153e5fd2Acac604D49d6ca9fea27b750718F22) |
| Guard decision circuit | **#7** on processor #101 (22 NAND, 9 inputs, 3 outputs; 512/512 rows checked on both RPCs at block 76,226,736) |
| Shared file container (circuit #5); operator = the registry for 30 days | [`0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed`](https://web3.okx.com/explorer/x-layer/evm/address/0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed) |

## Site gate roles (`signetguard.xyz`)

| Role | Address |
|---|---|
| Approver A | `0xB9ef367A86DE5150a5390c4148073901587d2416` |
| Approver B | `0x3280887C6ed2c0C43679918654f72222b767e6dc` |
| Approver C | `0x1C4704480E258bdBF8719ffba1679dD0e158c74c` |
| CI proposer (can propose and publish; never approve) | `0x93272103b49B955dF493999F4B9Dea4852FA9453` (key from `signet keygen`, not in the repo) |
| Recovery | `0x69400a5f15F6b2D84AAB70989B32266010E6cD93` |
| Guardian (freeze only) | none since 2026-11-20 (was signet-dev `0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE`; removed by 2 approvers, see "signet-dev rotation" below). Planned: signet-ops `0x9275eDEC1c4940B85a1e11Cce3EAd662ba00E291` |

Mode: **observe** (a new gate starts there). Current release: **#4** (published 2026-11-20; #3 before it, the same day). See "Release #3 published" and "Release #4 published" below.

## Transactions (all from signet-dev, in order)

| # | Transaction | Block | Gas | Gas fee + value (OKB) |
|---|---|---:|---:|---:|
| 1 | Deploy SignetRegistry: [`0x2cda992a…ec7c`](https://web3.okx.com/explorer/x-layer/evm/tx/0x2cda992a97393d2d222f51918df0d9395433b4a78f975cd3a77cc77af17aec7c) | 76,226,335 | 2,861,749 | 0.000057235 |
| 2 | Deploy SignetFactory (+ ReleaseGate implementation): [`0x92616ab4…c817`](https://web3.okx.com/explorer/x-layer/evm/tx/0x92616ab4773a6bdc368420496b724a1d9efcb927b5ee6b0425b7e08dfaedc817) | 76,226,338 | 5,492,286 | 0.000109846 |
| 3 | factory.commit (hides signetguard.xyz): [`0x4fc13b49…9ba5`](https://web3.okx.com/explorer/x-layer/evm/tx/0x4fc13b49efd3150e231865da8c82d347386fab03c1605e0d4e3ca3b6f6b19ba5) | 76,226,340 | 45,561 | 0.000000911 |
| 4 | SiteRegistry.setOperator(shared container, registry, 30 days): [`0x5d9c3753…39c1`](https://web3.okx.com/explorer/x-layer/evm/tx/0x5d9c3753da8dc0785df5cad2bf720923e5b2a8005cf455d19d33465adcb239c1) | 76,226,342 | 136,055 | 0.000002721 |
| 5 | factory.createGate: Signet site gate for signetguard.xyz: [`0x939aa45b…eac4`](https://web3.okx.com/explorer/x-layer/evm/tx/0x939aa45b92ff1bdc81f5a46dbce93b1f1ae9164177160d43c272ff2a4776eac4) | 76,226,498 | 576,686 | 0.000011534 |
| 6 | transistors.mint(NAND, 22): [`0xa655247a…b059`](https://web3.okx.com/explorer/x-layer/evm/tx/0xa655247a48cb08f60d0b3304b3a8d0fea540115b6ed1f5472900f3c793f3b059) | 76,226,680 | 86,399 | 0.000683728 |
| 7 | processor.tapeout(Guard netlist) → circuit #7: [`0x8fc6a9d7…4c16`](https://web3.okx.com/explorer/x-layer/evm/tx/0x8fc6a9d7dbf6082783b267449ee13c6327af56f2a662e087f23f1c40ade44c16) | 76,226,683 | 264,089 | 0.001305282 |
| | **Total** | | **9,462,825** | **0.002171257** |

Gas price paid: 0.020000001 gwei. The value in rows 6 and 7 is TapeOut's mint cost (0.000682 OKB) and tape-out fee
(0.0013 OKB). signet-dev went from nonce 8 to 15, and its balance from 0.046635572562621784 to
0.044464316053158959 OKB.

## Circuit #5 moved into the site gate (2026-11-19, sent from signet-dev)

| Tx | Call | Block | Gas |
|---|---|---|---|
| `0x547047605047ba753f15a3cc41a9b29085efc9c08f332315d2ccb501e574714a` | `processor.safeTransferFrom(signet-dev, siteGate, 5)` | 76,306,374 | 77,034 |
| `0xdcc4684be63c41c8e2c3c819d89871e4b50cc103715636d13e049a5498d9ede1` | `siteGate.renewOperator(processor, 5)` | 76,306,506 | 115,241 |

After: `ownerOf(5)` = site gate `0xa3d4…4503`; `SiteRegistry.operatorOf(container #5)` = SignetRegistry;
`operatorUntil` = 1797667542 (**2026-12-19 08:05 UTC**); `canEdit(SignetRegistry)` = true, `canEdit(signet-dev)` = false.
Moving #5 out again needs the gate's tier-11 `TransferCircuit` (3 of 3 + 24 h). Fork-tested first (a full publish
through the registry after the move wrote and read back its manifest files).

## Release #3 published (2026-11-20, 13:45 IST)

Sent from the CI proposer `0x93272103b49B955dF493999F4B9Dea4852FA9453` (nonces 3–6) with
`SIGNET_NETWORK=mainnet SIGNET_PRIVATE_KEY="$(cat .signet/proposer.key)" node ../cli/src/cli.ts -C . publish 3 release/3`
(`publish` reads only `SIGNET_PRIVATE_KEY`, not `.signet/proposer.key`). Gas price 0.020000001 gwei.

| Tx | Call | Block | Gas |
|---|---|---:|---:|
| [`0x797e35bb…ef4a`](https://web3.okx.com/explorer/x-layer/evm/tx/0x797e35bbce7f72436657e8641010c4e58cce94a6199ea7a56fef6e810878ef4a) | `siteGate.publish(3)`: tier 10, 3 of 3 approvals, decided by circuit #6 | 76,393,503 | 306,517 |
| [`0xdd3debc9…68a1`](https://web3.okx.com/explorer/x-layer/evm/tx/0xdd3debc9341ffaa261c9d586c9916c3479b0625b124990d8759dfc81128668a1) | registry write `signet/allowlist.json` (471 B) | 76,393,506 | 510,895 |
| [`0xdc968fcc…8c1b`](https://web3.okx.com/explorer/x-layer/evm/tx/0xdc968fcc4807d623a248b79b699122250f41f35efc26072bc0c991a26f678c1b) | registry write `signet/origins.json` (80 B) | 76,393,509 | 423,804 |
| [`0x756e437c…ad9a`](https://web3.okx.com/explorer/x-layer/evm/tx/0x756e437c15a4c137ed4e9a24c531be4d99e35b15a950cbf24fa15f17d41fad9a) | registry write `signet/files.json` (6,024 B) | 76,393,511 | 1,721,902 |
| | **Total** | | **2,963,118 (≈ 0.0000593 OKB)** |

Checks: `currentRelease() = 3` and `activeRelease()` = filesRoot `0x67a7…f0f9`, allowlistHash `0x5a48…efc5`,
originsHash `0xfa18…85cf`, ok = true on both xlayerrpc.okx.com and xlayer.drpc.org; `files.json` read back and
matched; the live signetguard.xyz files fetched and resealed give the same three hashes. Proposer balance after:
0.000431713516585676 OKB. Proposals #1 and #2 (tier 10, 0 approvals) stay open until they expire on 25 / 26 Nov.

## Release #4 published (2026-11-20, tier 00)

The repository went public first; the site was built with `SIGNET_REPO_PUBLIC=1` and deployed to Cloudflare Pages
(`a37f343d`). Every served file, fetched into `release/4`, was byte-identical to `dist` (Pages redirects `/x.html` to
`/x`, so the HTML pages are fetched there). Sealed: filesRoot `0x6d2e…a933`, allowlistHash `0x5a48…efc5` and
originsHash `0xfa18…85cf` equal to #3's, so **tier 00** (confirmed on a fork before proposing, then on-chain).

| Tx | From | Call | Block | Gas |
|---|---|---|---:|---:|
| [`0xdf06ac87…3ccf5`](https://web3.okx.com/explorer/x-layer/evm/tx/0xdf06ac8701e7195b72978530f0039bb19412f1f0deabf919f5da64680a43ccf5) | CI proposer | `proposeRelease` → #4, tier 00 | 76,402,750 | 168,996 |
| — | Approver A | `approve(4)` in the dashboard; timelock from 10:51:59 UTC | | |
| [`0x0462e7a0…122a`](https://web3.okx.com/explorer/x-layer/evm/tx/0x0462e7a078eac376e44f04d00ed1a7db9ff1cd24351fb498d3c7f29af5dd122a) | CI proposer | `publish(4)`, decided by circuit #6 | 76,406,499 | 292,923 |
| [`0x5fccc341…d2a3`](https://web3.okx.com/explorer/x-layer/evm/tx/0x5fccc341ad95b20c3961c13cf2b9b4631327edba546f41ae10632e936bc6d2a3) | CI proposer | registry write `signet/files.json` (6,802 B); allowlist and origins unchanged, so not rewritten | 76,406,502 | 1,701,706 |
| | | **Total (CI proposer)** | | **2,163,625 (≈ 0.0000433 OKB)** |

Checks: `currentRelease() = 4` and `activeRelease()` = #4's three hashes, ok = true, on both RPCs; `files.json` read
back and matched; the live site refetched and resealed gives the same three hashes. Proposer balance after:
0.000388441014422051 OKB.

## Release #5 published (2026-11-20, tier 00)

Built with `SIGNET_REPO_PUBLIC=1` and sealed from `dist` **before** deploying; proposed, approved (Approver A), then
deployed to Cloudflare Pages (`891b387c`) and checked **with a browser user agent** (all 23 files byte-identical; the
four HTML pages identical in Chromium; the only cross-origin requests are the two sealed RPCs) before publishing.
Contents: Guard fail-safe docs, /check and /prove fixes, the Guard 0.2.0 pre-release link on /start, explorer links to
OKX Explorer, benchmark wording.

| Tx | From | Call | Block | Gas |
|---|---|---|---:|---:|
| [`0x357fdb40…2324`](https://web3.okx.com/explorer/x-layer/evm/tx/0x357fdb40964b52fc1066a825baa0e1226a691fcb2640c5ee3e2497c4bea02324) | CI proposer | `proposeRelease` → #5, tier 00 | 76,408,967 | 168,996 |
| — | Approver A | `approve(5)`; timelock from 12:38:43 UTC | | |
| [`0xb97d2805…fbad`](https://web3.okx.com/explorer/x-layer/evm/tx/0xb97d280502e87164170ffb7883a796752216476c8e544ab37bf63472307cfbad) | CI proposer | `publish(5)`, decided by circuit #6 | 76,412,902 | 292,923 |
| [`0xd5a9ea6d…b1cc`](https://web3.okx.com/explorer/x-layer/evm/tx/0xd5a9ea6dcaefe985e298418377e993d4ef135baca74b505ca1d11a9bc90eb1cc) | CI proposer | registry write `signet/files.json` (6,802 B); allowlist and origins unchanged | 76,412,906 | 1,707,363 |
| | | **Total (CI proposer)** | | **2,169,282 (≈ 0.0000434 OKB)** |

Checks: `currentRelease() = 5` and `activeRelease()` = filesRoot `0x7d66…c6e4`, allowlistHash `0x5a48…efc5`,
originsHash `0xfa18…85cf`, ok = true, on both RPCs; `files.json` read back and matched; the live site refetched with a
browser user agent and resealed gives the same three hashes. Proposer balance after: 0.000345055372252769 OKB.

**Correction for #3 and #4:** their live byte checks used `curl` without a browser user agent. Cloudflare Web
Analytics' automatic setup was injecting a beacon script into the HTML for browsers only, so browsers got HTML that
didn't match #3 and #4 until it was turned off on 2026-11-20 (found by the first live watchtower round; after that
the live files matched #4 byte for byte with a browser user agent).

## signet-dev rotation, step 1: guardian removed (2026-11-20)

Approvers A and B each called `voteRemoveGuardian()` (calldata `0x2a62b187`) on the site gate from their own wallets
(Rabby). The second vote removed the guardian at once (two approvers may, also while frozen; votes count for 7 days).

| Tx | From | Block | Gas | Fee (OKB) | Log |
|---|---|---:|---:|---:|---|
| [`0x67ad6723…84ae`](https://web3.okx.com/explorer/x-layer/evm/tx/0x67ad6723c165dce85679b1c6b16427b6aec4812908666fc91b960cf66a6e84ae) | Approver A `0xB9ef…2416` | 76,409,662 | 51,939 | 0.0000014855 | none (first vote) |
| [`0x50bd19ef…bfa1`](https://web3.okx.com/explorer/x-layer/evm/tx/0x50bd19efd7b8698aa4ab7a08f97260b62e2be40a6f0247d7621ae907451bbfa1) | Approver B `0x3280…6dc` | 76,409,994 | 36,398 | 0.0000010410 | `GuardianRemoved()` from the gate: topic0 `0x49dba45944bff184119ef00551a537ea290e7554229b9e09fe7f63d4bcb072d9` = `keccak256("GuardianRemoved()")`, no data |

After: `guardian()` = `0x0` and `guardianVoteAt(0..2)` = 0 on both RPCs. signet-dev can no longer freeze the gate. Next
(planned, one transaction at a time): fund approver C, move circuits #6 and #7 into the site gate, propose
`SetGuardian(signet-ops 0x9275eDEC1c4940B85a1e11Cce3EAd662ba00E291)` (3 of 3 + 24 h), sweep signet-dev's OKB to
signet-ops last. Publish order: pending releases, then SetGuardian, then any SetApprover (it voids other open
proposals).

## Checks after the deploy

- `record-mainnet` re-read all 7 receipts from xlayerrpc.okx.com and xlayer.drpc.org (both succeeded, both from
  signet-dev, same blocks). It confirmed the registry → factory → site gate links, and ran the 512-row check on
  circuit #7 on both RPCs.
- `pnpm verify:claims`: **ALL CHECKS PASSED (9 on mainnet, 10 from the repo, 0 pending deployment)** (`claims.json`).
- `/prove` (the dashboard built for mainnet, in a headless browser, no wallet): **All checks passed (0 pending
  deployment)**. Circuits #6 and #7 matched on all 512 rows through both RPCs; the beacon, the registry (1 domain)
  and `signetguard.xyz` (no release yet at that time, 2026-11-18) all checked. Screenshots: `docs/demo/ui/prove-mainnet-1280.png`, `-390.png`.
- **Found after the deploy, and fixed:** xlayer.drpc.org answers HTTP 400 to a JSON-RPC batch of 4 or more calls.
  `/prove` (batches of 32), and Guard's per-site check (6–8 calls), failed on mainnet because of it, so Guard would
  have shown "could not check" (fail-open) on every sealed site. The shared helper (`packages/extension/src/lib/rpc.ts`)
  now sends at most 3 calls per request, all at the same pinned block. Staging never showed it, because both
  staging RPCs are local.

## Still to do (no OKB unless stated)

- Verify the source on OKX Explorer by hand: [`docs/verify/README.md`](verify/README.md) (OKLink's API login is no longer available; free, no wallet). Files checked against mainnet by `docs/verify/check.py`.
- ~~Renew the registry's operator grant~~ Done differently, 2026-11-19: circuit #5 moved into the site gate (below). The grant now runs to **2026-12-19 08:05 UTC** and **anyone** can renew it with `siteGate.renewOperator(processor, 5)`. The watchtower will do it automatically (planned, `packages/watchtower/README.md`).
- ~~Signet's own site's first release~~ Done: release #3 (tier 10, 3 of 3 approvals) and #4 (tier 00) published on 2026-11-20, manifests uploaded. Hosting the full site on DeWEB: not done.
- Fund approver C (it holds ≈ 0.0000009 OKB, too little for one approval): planned with the signet-dev rotation. The CI proposer and approvers A and B are funded.

## Runbook: release #3 → #4 (Fri 20 Nov 2026)

Prepared 2026-11-19 (commit after `de45bc7`); **not deployed**. The live site must stay byte-identical to release/3
until #3 is published.

1. **Publish #3** — **done 2026-11-20 13:45 IST**, see "Release #3 published" above. (From 13:45:22 IST / 08:15:22 UTC; proposal expires Thu 26 Nov 13:43:29 IST). CI proposer key;
   ≈ 0.00006 OKB (publish 306k gas + 3 manifest writes ≈ 2.66M gas). Shown to the team and sent only after their go-ahead:
   `cd packages/dashboard && SIGNET_NETWORK=mainnet node ../cli/src/cli.ts -C . publish 3 release/3`
   Check: `currentRelease() = 3`, the 3 files read back, Guard-style check of the live site = sealed #3.
2. **Deploy the #4 site changes** — **done 2026-11-20** (the team-first site, /start with `npx signetguard init`, /check, the watchtower
   status; /start pins `signetguard@0.1.3` and links the 0.1.3 tarball; the 0.1.0 tarball is removed). CLI **0.1.3 is
   published on npm** (`latest = 0.1.3`, checked 2026-11-20 with `npm view signetguard dist-tags --prefer-online`;
   the registry's shasum `321de3ef…80c9` equals `packages/cli/release/signetguard-0.1.3.tgz` and the site's copy):
   `SIGNET_REPO_PUBLIC=1 pnpm --filter @signet/dashboard build && npx -y wrangler@4 pages deploy dist --project-name signet --branch main`
   (`SIGNET_REPO_PUBLIC=1` only once the GitHub repo is public: it turns the GitHub link on. Checked 2026-11-19: with
   or without it, #4's allowlist and origins equal #3's, so #4 is tier 00. The ReleaseGate implementation address
   shown on /app is excluded from the allowlist in `signet.config.json`: it's displayed, never called.)
   Then fetch every live file from signetguard.xyz into `release/4` and require byte-identity with `dist`.
3. **Seal and propose #4** — **done** (tier 00) from the live files: `seal release/4`, then `propose release/4`. Expected (fork-tested
   2026-11-19): **tier 00 code only**, 1 approval + 1 h; allowlistHash `0x5a48…efc5` and originsHash `0xfa18…85cf`
   unchanged from #3.
4. **An approver approves** — **done** (Approver A) (1 approval) in the dashboard.
5. **Publish #4** — **done**, see "Release #4 published" above. after 1 h (+ its manifest upload), shown first and sent after the team's go-ahead.
