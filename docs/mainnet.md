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
| Guard decision circuit | **#7** on processor #101 (22 NAND, 9 inputs, 3 outputs; 512/512 rows checked on both RPCs at block 76,226,736). Held by the site gate since 2026-11-21, like #5 and #6 |
| Shared file container (circuit #5); operator = the registry for 30 days | [`0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed`](https://web3.okx.com/explorer/x-layer/evm/address/0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed) |

## Site gate roles (`signetguard.xyz`)

| Role | Address |
|---|---|
| Approver A | `0xB9ef367A86DE5150a5390c4148073901587d2416` |
| Approver B | `0x3280887C6ed2c0C43679918654f72222b767e6dc` |
| Approver C | `0x1C4704480E258bdBF8719ffba1679dD0e158c74c` |
| CI proposer (can propose and publish; never approve) | `0x93272103b49B955dF493999F4B9Dea4852FA9453` (key from `signet keygen`, not in the repo) |
| Recovery | `0x69400a5f15F6b2D84AAB70989B32266010E6cD93` |
| Guardian (freeze only) | **none** since 2026-11-24 (signet-ops `0x9275…E291` removed by approvers A and B with `voteRemoveGuardian()`: its keystore password was lost, see "Plan B" below). Before: signet-ops 2026-11-23 → 24 (tier-11 `SetGuardian`, proposal #6); signet-dev until 2026-11-20, then none |

Mode: **enforce** since 2026-11-25 12:25:10 UTC (approver A, see "Enforce mode on" below); observe before (a new gate starts there). Current release: **#14** (published 2026-11-26); #3, #4 and #5 were published 2026-11-20; #6 was the tier-11 guardian change (2026-11-23). See the "Release #…" sections below.

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

## signet-dev rotation, step 2: approver C and the renewer funded (2026-11-21)

Sent by the team from signet-dev with `cast send <to> --value 0.0001ether --gas-limit 21000 --account signet-dev`.

| Tx | To | Value (OKB) | Block | Gas | Fee (OKB) |
|---|---|---:|---:|---:|---:|
| [`0x788d86fb…fdd2`](https://web3.okx.com/explorer/x-layer/evm/tx/0x788d86fb0ca3cb8d6a4a53f5ca94309cfaecbc9a91e4fab21af1db8f92d7fdd2) | Approver C `0x1C47…c74c` | 0.0001 | 76,479,051 | 21,000 | 0.00000042 |
| [`0x3e8772bd…d795`](https://web3.okx.com/explorer/x-layer/evm/tx/0x3e8772bd9efb474c7e9e732dc720f833306d695afe4e190453a06811a7bed795) | Watchtower renewer `0xF7fF…E4b0` | 0.0001 | 76,479,070 | 21,000 | 0.00000042 |

After (both RPCs): Approver C 0.000100862337790599 OKB (enough for its tier-11 approvals, ≈ 44.5k gas each);
renewer 0.0001 OKB (≈ 40 operator renewals; the low-balance alert stops); signet-dev 0.043358370552861684 OKB,
nonce 22.

## signet-dev rotation, step 3: circuits #6 and #7 moved into the site gate (2026-11-21)

Sent by the team from signet-dev: `cast send <processor> 'safeTransferFrom(address,address,uint256)' <signet-dev> <site gate> <id> --gas-limit 80000 --account signet-dev`.
The gate accepts only circuit NFTs from a processor with its pinned code hash (`processorCodehash` = processor #101's,
`0x57aa…17d5`).

| Tx | Circuit | Block | Gas | Fee (OKB) | Event |
|---|---|---:|---:|---:|---|
| [`0x71d27701…1c5a`](https://web3.okx.com/explorer/x-layer/evm/tx/0x71d277016408f603fe62a62c8c6ccdf06099df4a1c6579d8b55dd7abd5341c5a) | #6 (release policy) | 76,479,357 | 59,934 | 0.0000012586 | `Transfer(signet-dev → site gate, 6)` |
| [`0xbe1d7877…4462`](https://web3.okx.com/explorer/x-layer/evm/tx/0xbe1d7877fe1fc10b6aff2ac152c19a00aac92db2fe68da9c66cf30eadc384462) | #7 (Guard decision) | 76,479,389 | 55,134 | 0.0000011578 | `Transfer(signet-dev → site gate, 7)` |

After (both RPCs): `ownerOf(5)`, `ownerOf(6)` and `ownerOf(7)` = site gate `0xa3d4…4503`; `eval(6, …)` and
`eval(7, …)` still answer any caller, and `pnpm verify:claims` re-checked both circuits on all 512 rows. Moving a
circuit out needs the gate's tier-11 `TransferCircuit` (3 of 3 + 24 h). signet-dev: 0.043355954124861684 OKB,
nonce 24, and no role left on the gate.

## signet-dev rotation, step 4: SetGuardian(signet-ops) proposed and approved 3 of 3 (2026-11-21)

Tier-11 admin change: 3 of 3 approvals + 24 h. Sent by the approvers from Rabby; each snippet checked the chain, the
sender's role and (for approvals) that proposal #6 is exactly SetGuardian(signet-ops) before sending.

| Tx | From | Call | Block | Gas | Fee (OKB) |
|---|---|---|---:|---:|---:|
| [`0x373138be…364b`](https://web3.okx.com/explorer/x-layer/evm/tx/0x373138be7c23bf2c242cbd1806d1c436680c061acc6de48f0958c624921c364b) | Approver A | `proposeAdmin(4 = SetGuardian, abi.encode(0x9275eDEC1c4940B85a1e11Cce3EAd662ba00E291))` → `Proposed(id 6, kind 2, tier 3 = 11)` | 76,480,424 | 174,269 | 0.0000049841 |
| [`0x78c0580f…63c3`](https://web3.okx.com/explorer/x-layer/evm/tx/0x78c0580fb1aee71daf51e96c689d2085d1d52926fe2524864929c4124afd63c3) | Approver A | `approve(6)` → `Approved(6, slot 0)` | 76,480,947 | 39,751 | 0.0000011369 |
| [`0x13ff5eb3…2e92`](https://web3.okx.com/explorer/x-layer/evm/tx/0x13ff5eb38554ac668d0e48cd402af0335ec8acf905f91c04e75ae25b994d2e92) | Approver B | `approve(6)` → `Approved(6, slot 1)` | 76,480,987 | 41,994 | 0.0000012010 |
| [`0xdf5ed0b9…80a1`](https://web3.okx.com/explorer/x-layer/evm/tx/0xdf5ed0b98e39c33fea65740814d4381a81486b903ce5de45c57416bde4fe80a1) | Approver C | `approve(6)` → `Approved(6, slot 2)` | 76,481,006 | 44,483 | 0.0000012722 |

State (both RPCs): proposal #6 approvals = 7 (A, B, C), `readyAt` = 1795250042 (2026-11-21 08:34:02 UTC), approver
set 0 (current). **Publishable from 2026-11-22 08:34:02 UTC (14:04:02 IST)**; expires 2026-11-28 08:24:20 UTC.
Publishing (`publish(6)`, ≈ 188,645 gas, fork-tested) sets the guardian to signet-ops. No other admin change may be
executed before it: a `SetApprover` would void proposal #6.

## signet-dev rotation, step 4 done: SetGuardian(signet-ops) published (2026-11-23)

| Tx | From | Call | Block | Gas | Fee (OKB) |
|---|---|---|---:|---:|---:|
| [`0xfdbe3bf7…83d6`](https://web3.okx.com/explorer/x-layer/evm/tx/0xfdbe3bf74e95c27318ba5ddac9d499cfc4df5d5c16a00d42eddd928608d583d6) | Approver A | `publish(6)` → `AdminExecuted(6, action 4 = SetGuardian)` | 76,665,695 | 188,645 | 0.0000053952 |

After (both RPCs): `guardian()` = signet-ops `0x9275…E291`; proposal #6 executed. Step 4 cost in total
(propose + 3 approvals + publish): 489,142 gas, ≈ 0.0000140 OKB.

## signet-dev rotation, step 5 done: OKB swept to signet-ops (2026-11-23). Rotation complete

Sent by the team: `cast send 0x9275eDEC1c4940B85a1e11Cce3EAd662ba00E291 --value 43355534124840684 --legacy --gas-price 20000001 --gas-limit 21000 --account signet-dev`.

| Tx | From → to | Value (OKB) | Block | Gas | Fee (OKB) |
|---|---|---:|---:|---:|---:|
| [`0xd980e920…5d37`](https://web3.okx.com/explorer/x-layer/evm/tx/0xd980e9205ef7a146dcb913b14fa4041ec0840c93b795afbeb6e38a8aaf825d37) | signet-dev → signet-ops | 0.043355534124840684 | 76,679,835 (15:47:51 UTC) | 21,000 | 0.000000420000021 |

After (xlayerrpc.okx.com and rpc.xlayer.tech): signet-dev balance **0**, nonce 25; signet-ops 0.043355534124840684 OKB.
**The signet-dev rotation is complete:** signet-dev holds no OKB, no circuit NFT (#5, #6, #7 are in the site gate), and
no role on the gate (not an approver, proposer, recovery or guardian). The guardian is signet-ops.

## Release #14 published (2026-11-26, tier 00): landing content at once, full verify:claims output, dashboard skeletons

- Approved by approver A at 05:20:14 UTC (10:50 IST), publishable from 06:20:14 UTC.
- `scripts/release-site.sh 14` at 06:20 UTC: Cloudflare deployment `a4c22337` (12 new files, 15 reused), then publish tx [`0x987c087d…75aa`](https://web3.okx.com/explorer/x-layer/tx/0x987c087d992a30688b7d50aaf3ef4e50e4baa1700bd7a4bd51d2c4dac7be75aa) (block 76,905,018 at 06:20:54 UTC, 292,923 gas; decided by circuit #6), `signet/files.json` written (1,889,709 gas) and read back.
- Checks: 27/27 live files equal `release/14`; `/api/check` and `/api/watchtower` answer JSON; an unknown path is a 404 with the sealed 404.html; `currentRelease()` = 14 and `enforced()` = true on both RPCs; `/api/check` reports both sites sealed. Guard 0.3.5 (mainnet build): popup "Release #14 · this page matches", "Mode: enforce (Guard blocks)"; `/`, `/app`, `/start` and a 404 page green; a tampered `/start` red, then green again. Live landing page: the proof terminal shows all 10 lines; a fast scroll at 1440 px gives the same frames as the local check. Dashboard: skeleton rows while the RPCs answer (list loaded after 17 s with each RPC call delayed 4 s).
- CI key after #14's publish: 0.002952 OKB.

## Release #14 proposed (2026-11-25, tier 00): landing content at once, full verify:claims output, dashboard skeletons

- Proposed by the CI key at 15:55 UTC: tx [`0x37605d9c…7758`](https://web3.okx.com/explorer/x-layer/tx/0x37605d9c5bd5c44455a795512f512da68cb06cd652594a7a13a73715972d7758) (168,996 gas), manifest `0x915789ea…6b6c`. Tier 00 (allowlist and origins equal #13's): 1 approval + 1 h.
- Fork rehearsal (mainnet fork with #13 live, enforce mode): before the timelock Guard 0.3.5 showed the red page on #14's bytes (no release could publish); after it, Guard held the page for #14 and turned green 10 s after the publish started, never red.

## Release #13 published (2026-11-25, tier 00): judge review 4 fixes, the first rollout in enforce mode

- Guard 0.3.5 published first as a pre-release (tag `guard-v0.3.5` at `bfc29ca`, 13:35 UTC); #13's Guard links point to it.
- Proposed by the CI key at 13:36:24 UTC (block ≈ 76,844,748), approved by approver A at 14:51:04 UTC, publishable from 15:51:04 UTC.
- `scripts/release-site.sh 13` at 15:51 UTC: Cloudflare deployment `fc90516e` (5 new files, 22 reused), then publish tx [`0x69be1afa…61af`](https://web3.okx.com/explorer/x-layer/tx/0x69be1afa066295b0f6113e2bfd5ac45bccd78aa59e688e4be0998824499661af) (block 76,852,874, 292,923 gas; decided by circuit #6), `signet/files.json` written (1,889,709 gas) and read back.
- Checks: 27/27 live files equal `release/13`; `/api/check` and `/api/watchtower` answer JSON; an unknown path is a 404 with the sealed 404.html; `currentRelease()` = 13 and `enforced()` = true on both RPCs. `/api/check` now reports signetguard.xyz and misthos.world as sealed (the `redirect: 'manual'` fix); llms.txt has 0 dead links; /start links Guard 0.3.5. Guard 0.3.5 (mainnet build): popup "Release #13 · this page matches", "Mode: enforce (Guard blocks)"; `/`, `/app`, `/start` and a 404 page green; a tampered `/start` red, then green again.
- CI key after #13's propose and publish: 0.002999 OKB.

## Enforce mode on for signetguard.xyz (2026-11-25, 17:55 IST)

Guard now replaces a page of signetguard.xyz that doesn't match the published seal with its red page and refuses
signatures the seal doesn't allow. Visitors without Guard see no difference.

- **Call:** `enforce()` (`0x58f93ec9`, value 0) on the site gate `0xa3d4…4503`, sent by **approver A** `0xB9ef…2416`
  from Rabby (a short console script that first checks the chain, the approver, the 7 days and that the gate isn't
  frozen), after the team's yes. Allowed from 2026-11-25 09:52:14 UTC
  (`deployedAt` + 7 days).
- **Tx** [`0x00de5449…2dd0`](https://web3.okx.com/explorer/x-layer/tx/0x00de54492ffa1a2a0574d9d3664e407b0586d8d711bcd95910feabf5b9952dd0),
  block 76,840,474 (12:25:10 UTC), status success, gas 34,702 at 0.0286 gwei = **0.00000099 OKB**, event
  `Enforced(0xB9ef…2416)`. A has 0.000155 OKB left.
- **Before (11:52 UTC):** on a mainnet fork, `enforce()` from A passed (34,702 gas) and from a non-approver reverted
  `NotApprover`; Guard 0.3.4 pointed at the fork showed `/`, `/app`, `/start` and the 404 page green and a tampered
  `/start` red. On mainnet: not frozen, release #12 current, no pending proposal (`proposalCount` = 12), 27/27 live
  files equal to `release/12`, watchtower green. The real-wallet test with Rabby passed the same day (a sealed action
  on /app reached Rabby, no false refusal).
- **After (12:27–12:32 UTC):** `enforced()` = true on xlayerrpc.okx.com and xlayer.drpc.org; release 12, not frozen.
  Guard 0.3.4 (mainnet build) popup: "Mode: enforce (Guard blocks)", "Release #12 · this page matches what the team
  sealed"; `/`, `/app`, `/start` and `/nonexistent-page-xyz` (HTTP 404) green; a tampered `/start` → red page ("This
  site's seal is broken … Nothing was sent"), then green again untampered. /prove: all checks passed, release #12 row
  "enforce mode". Watchtower round 45613677889 (12:27 UTC): 0 alerts.
- **Rollback:** the fast fix is making the site match its seal (Cloudflare Pages rollback to deployment `9f8902be`,
  release #12). Back to observe on-chain is `proposeAdmin(13, 0x)` (SetObserveMode, tier 11: 3 of 3 + 24 h).
- misthos.world stays in observe mode; its gate allows `enforce()` from 2026-12-01 08:14 UTC.

## Release #13 proposed (2026-11-25, tier 00): Guard links → 0.3.5, /api/check fix, docs in line with the chain

Sealed into `packages/dashboard/release/13` (manifest `0x8069ee21…8462`); allowlist and origins equal #12's, so tier 00
(computed on-chain). Guard 0.3.5 published first as a pre-release (`guard-v0.3.5` from commit `bfc29ca`, workflow run
45625063278; zip SHA-256 `51592394…`, checked against the asset; `gh attestation verify` exit 0).

| Tx | From | Call | Gas |
|---|---|---|---:|
| [`0x5bc212bc…2336`](https://web3.okx.com/explorer/x-layer/evm/tx/0x5bc212bc6c6774a3c51524e7b6e588edc2d1f95b4ec0d339a25bb8a114d22336) | CI proposer | `proposeRelease` → #13, tier 00, block 76,844,748, 0.020000001 gwei | 168,996 |

Next: approver A `approve(13)`, then after the 1 h timelock `scripts/release-site.sh 13` (deploy + `publish(13)` + `signet/files.json`).

## Release #12 published (2026-11-25): a real 404 page, phone layout, /prove "not checked" on RPC errors

Sealed into `packages/dashboard/release/12` (manifest `0x5ffa4289…5982`, 28 files: `404.html` is new; resealed after Guard 0.3.4 was published so its links point to `guard-v0.3.4`; the first seal `0x6feb8911…22c5` was never proposed); allowlist and
origins equal #11's, so tier 00. Contents (from the 2026-11-25 audit): unknown URLs answer HTTP 404 with a sealed
`404.html` (they answered 200 with the home page); at 375 px the landing seal no longer covers buttons and /start's
code blocks keep their indentation; /prove retries a check once on an RPC error and then shows "Not checked", never
"Failed" (the watchtower's 08:06 UTC run showed one FAIL that the next run didn't). Checked on a Cloudflare preview
deployment (`001cb8ed.signet-6l4.pages.dev`, not production): routes unchanged, `/a/b/c` → 404 with the sealed bytes.
Guard 0.3.3 shows the 404 page as unverified (grey); 0.3.4 checks it (published as a pre-release, `guard-v0.3.4`, zip SHA-256 `f58f19f2…0b0e`, Sigstore attestation verified).
Fork rehearsal (of the reseal): propose 168,996 gas, approve A 39,958, publish 292,923, files.json 1,889,519 (read back), manifest
equal to the seal. On mainnet at 0.020000001 gwei: CI key ≈ 0.000047 OKB; approver A ≈ 0.0000008 OKB.
The preview deployment used for those checks was deleted after (an unsealed public copy).

| Tx | From | Call | Gas |
|---|---|---|---:|
| [`0x11208a32…cee4`](https://web3.okx.com/explorer/x-layer/evm/tx/0x11208a32451f915cce4bbda4868c6995e877cbe01ece1e00f632f4048e9cfee4) | CI proposer | `proposeRelease` → #12, tier 00 | 168,996 |
| approver A | — | `approve(12)` (08:31 UTC) | |
| [`0xb2cfd35f…92b2`](https://web3.okx.com/explorer/x-layer/evm/tx/0xb2cfd35ffe9998d4680aab34afc90f1c5cb2be3c2e4a79ed01a5c6399be092b2) | CI proposer | `publish(12)`, block 76,830,678 | 292,923 |
| SiteRegistry | CI proposer | `signet/files.json` (7,640 B), read back | 1,889,519 |

`scripts/release-site.sh 12`: Cloudflare deployment `9f8902be` (5 new files, 22 reused); 27/27 live files identical;
`/api/*` JSON; an unknown path answers 404 with the sealed 404.html. Both RPCs: `currentRelease()` = 12. Live /prove
(headless Chromium): 8.1 / 8.3 s, all passed. Guard 0.3.4 (mainnet build): `/`, `/app`, `/start` OK, and
`/nonexistent-page-xyz` (HTTP 404) OK, its document checked against the sealed 404.html. CI key ≈ 0.003046 OKB left.

## Release #11 published (2026-11-25, tier 00): watchtower box hidden until it has data, Guard links → 0.3.3

Sealed into `packages/dashboard/release/11` (manifest `0xb5cc2196…4ce3`); allowlist and origins equal #10's. Fork
rehearsal: propose 168,996 gas, approve A 39,958, publish 292,923, files.json written and read back, manifest equal to
the seal. Proposed after the watchtower's new clock was confirmed: a Cloudflare Worker cron
(`packages/watchtower/cron`) started rounds at 06:20:52, 06:25:54 and 06:30:51 UTC.

| Tx | From | Call | Gas |
|---|---|---|---:|
| [`0x64ed2833…27b4`](https://web3.okx.com/explorer/x-layer/evm/tx/0x64ed283300ba8bc727188c998d7268a1daa0738272c6d6803b3b3117606c27b4) | CI proposer | `proposeRelease` → #11, tier 00 | 168,996 |
| approver A | — | `approve(11)` (06:33 UTC) | |
| [`0x8af10930…7d65`](https://web3.okx.com/explorer/x-layer/evm/tx/0x8af10930fc3163c953ee0466ffed51615afbee6faaa8e924861d329e74c97d65) | CI proposer | `publish(11)`, block 76,823,634 | 292,923 |
| SiteRegistry | CI proposer | `signet/files.json` (7,504 B), read back | 1,859,969 |

`scripts/release-site.sh 11`: Cloudflare deployment `414f1ac9` (7 new files, 19 reused); 26/26 live files identical;
`/api/*` JSON. Both RPCs: `currentRelease()` = 11. Live /prove (headless Chromium): 7.1 / 7.3 s, all passed; the
watchtower box shows its last run. Site links → guard-v0.3.3. CI key ≈ 0.003093 OKB left.

## Release #10 published (2026-11-25, tier 00): /prove in ~6 s, no "coming soon", /check fix, Functions back

Built with `SIGNET_REPO_PUBLIC=1` and sealed into `packages/dashboard/release/10` (manifest `0x262eac1f…4605`, 28
files). Contents: /prove reads through Multicall3 (128 `eval`s per `eth_call`), all checks in parallel at one pinned
block, row progress, and the watchtower's last /prove run shown at once (headless Chromium against mainnet: 6.2–7.0 s;
was ~4 min); footer/landing/start without "coming soon" (X link live, Telegram removed, setup help = an X DM to
@vekariya_kenil); /check counts `modulepreload` as scripts; docs: #9, Telegram alerts set up.

- **Tier 00.** Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`) is now in the dashboard bundle, but the team
  decided (2026-11-25) to exclude it in `signet.config.json`: the site only reads through it (`eth_call`), never asks a
  wallet to sign to it. So the allowlist and origins equal #9's. Guard refuses any signature to it (call, value,
  spender, EIP-712 domain), tested against this release's sealed allowlist (`packages/extension/test/policy.test.ts`).
  A first seal that kept it (`0xfdd83af7…e372`, tier 10) was replaced; it was never proposed.
- **Fork rehearsal** (anvil fork of mainnet): propose 168,984 gas (tier 00, needs 1 + 1h); approve A 39,958;
  `policyInputs` 1 → 9 after 1 h; publish 292,923; files.json 1,857,163 (allowlist and origins "same"), read back;
  `currentRelease` = 10, manifest equal to the seal. On mainnet at 0.020000001 gwei: CI key ≈ 2.32M gas ≈ **0.000046
  OKB** (has ≈ 0.003186); approver A ≈ 0.0000008 OKB.
- **Deploy with `scripts/release-site.sh 10`**, which now deploys from `packages/dashboard`, so the Pages Functions
  (`/api/check`, `/api/watchtower`) ship again: releases #7–#9 were deployed without them (found 2026-11-25). Step 4
  checks both answer JSON.

| Tx | From | Call | Gas |
|---|---|---|---:|
| [`0x37122c25…81c0`](https://web3.okx.com/explorer/x-layer/evm/tx/0x37122c259b41cd4e6d46076f35a491d628159d62d5164b0111b7cd3ab37f81c0) | CI proposer | `proposeRelease` → #10, tier 00 (block 76,812,533, 04:39:29 UTC) | 168,984 |
| [`0xa8f68eab…0d33`](https://web3.okx.com/explorer/x-layer/evm/tx/0xa8f68eab33a22c664c076fdb988124ff45c5f7e321569d8546ea120e1e070d33) | CI proposer | `publish(10)`, block 76,816,686 (`policyInputs` = 9, after approver A) | 292,923 |
| SiteRegistry | CI proposer | `signet/files.json` (7,504 B; allowlist/origins unchanged), read back | 1,857,163 |

`scripts/release-site.sh 10`: Cloudflare deployment `83a6af23` (9 new files, 17 reused), published seconds later; 26/26
live files byte-identical; `/api/check` and `/api/watchtower` answer JSON again. Both RPCs: `currentRelease()` = 10.
`/prove` on https://signetguard.xyz in headless Chromium: 7.2 / 6.7 / 7.0 s, all checks passed (release #10, 27 files
recomputed), no RPC errors. Site CI key ≈ 0.003139 OKB left.

Guard 0.3.3 published as a pre-release the same morning (`guard-v0.3.3`, zip SHA-256 `e843bd2c…de06`, Sigstore
attestation verified).

## Release #9 published (2026-11-24, tier 00): /privacy, CLI 0.2.2 on /start, Guard 0.3.2 links, docs synced

Built with `SIGNET_REPO_PUBLIC=1` and sealed into `packages/dashboard/release/9`; fork-rehearsed (tier 00, same gas).
Allowlist and origins equal #8's. Contents: `/privacy` (Guard's privacy policy, from `docs/PRIVACY.md`, linked from
/start, the footer and llms.txt), `/start` pins `signetguard@0.2.2` and serves only its tarball (byte-identical to npm),
Guard links point to the 0.3.2 pre-release, and the served docs (THREAT_MODEL, CLAIMS, llms.txt) carry the status
through #8 and plan B. Deploy and publish: `scripts/release-site.sh 9` (back to back).

| Tx | From | Call | Gas |
|---|---|---|---:|
| [`0xf4be7b86…2dcb`](https://web3.okx.com/explorer/x-layer/evm/tx/0xf4be7b865c4b63cbe450be3c7e362f8efb2dbabb9eecfd3feffbe01dc8962dcb) | CI proposer | `proposeRelease` → #9, tier 00 | 168,996 |
| [`0xe4bf89c6…5ed5`](https://web3.okx.com/explorer/x-layer/evm/tx/0xe4bf89c6ec94463620cb20e799949053bfd72169f1a9a1ab693b0c4e8fef5ed5) | approver A | `approve(9)` (15:51:19 UTC) | |
| [`0xd1778f82…c4c3`](https://web3.okx.com/explorer/x-layer/evm/tx/0xd1778f82adf6be8a670e4c6d95d4df6c1f92627ebf892dde035a316e9da9c4c3) | CI proposer | `publish(9)` at 16:52:33 UTC, block 76,770,117 (`policyInputs` = 9) | 292,923 |
| [`0xff7531ef…7652`](https://web3.okx.com/explorer/x-layer/evm/tx/0xff7531ef798dbb61b780e464e41e401a2fcb0179345c0be528e6e78bf27c7652) | CI proposer | SiteRegistry `signet/files.json` (7,504 B; allowlist/origins unchanged), read back | 1,859,992 |

`scripts/release-site.sh 9`, first real run: the chain said "can publish now" at 16:52 UTC; Cloudflare deployment
`2cf4cf42` (8 new files, 18 reused); publish sent seconds later; 26/26 live files byte-identical (browser user
agent). Both RPCs: `currentRelease()` = 9, manifest `0x3dfeafd6…7478`, prev 8. Chromium: 30 responses identical, no
page errors. Guard 0.3.2 (mainnet build, headless Chromium): OK, release #9, 9/9 files. Site CI key ≈ 0.003186 OKB left.

## Release #8 published; its files stored on DeWEB (container #5) (2026-11-24)

| Tx | From | Call | Block (UTC) | Gas | Fee (OKB) |
|---|---|---|---:|---:|---:|
| [`0x5864887c…f2b5`](https://web3.okx.com/explorer/x-layer/evm/tx/0x5864887cbfed48267774011cb3493fe27e8c5b2e91d9e2fb108673b29387f2b5) | site CI key | `publish(8)`, decided by circuit #6 | 76,754,781 (12:36:57) | 292,923 | 0.0000058585 |
| [`0x88da9302…4168`](https://web3.okx.com/explorer/x-layer/evm/tx/0x88da9302496b82b75acaab3c9eca7f0b0ba29168bd01190809b88526f8464168) | site CI key | registry write `signet/files.json` (7,364 B; allowlist and origins unchanged), read back | 76,754,785 | 1,829,584 | 0.0000365917 |

Both RPCs: `currentRelease()` = 8, `activeRelease()` filesRoot `0x5b25…5e71`, allowlistHash `0x5a48…efc5`, originsHash
`0xfa18…85cf`, true.

**The release's files on DeWEB's storage** (`signet upload release/8 --full`, re-measured first on a fork of the
post-publish state: same gas): SignetRegistry, as the container's operator, wrote every file release #8 lists into
circuit #5's container `0x8E2E…94Ed` in TapeOut's SiteRegistry under `signet/signetguard.xyz/` (the registry accepts
only files of the gate's current release). 67 transactions from the site CI key, nonces 19–85:
first [`0xef1f0bbf…7c07`](https://web3.okx.com/explorer/x-layer/evm/tx/0xef1f0bbffbfabc7a8d918c3cf31bd917d606bffb8add9fe405a854c89f297c07)
(block 76,755,000, 12:40:36), last [`0xa4e1bf80…6637`](https://web3.okx.com/explorer/x-layer/evm/tx/0xa4e1bf809fe2d7ebbd37ab097194e60c15590915857f1f72d20e1856df3c6637)
(76,755,156, 12:43:12); **301,117,113 gas = 0.006022342561117113 OKB**. Read back independently on both RPCs: 29/29
files (25 site files + the 3 lists + `files.json`), 1,296,412 bytes, size, stored SHA-256 and content all equal
`packages/dashboard/release/8`. Not displayed by DeWEB's own gateway (that needs `DomainBinding.bind` by the
container's holder, the gate, which can't call it; `docs/deweb-tapesend-plan.md`). Site CI key after: 0.003232245546612293 OKB.

## Plan B: signet-ops's keystore password lost; guardian removed from both gates (2026-11-24)

signet-ops (`0x9275eDEC1c4940B85a1e11Cce3EAd662ba00E291`) was the guardian of both gates. Its keystore is a standard V3
file (scrypt n = 2^18, AES-128-CTR, keccak MAC; cast opens keystores made by the same script), but no password the team
tried opens it: not in cast, and not with `scripts/check-keystore.mjs`, which reads the password with the creator's own
raw-mode reader and tries 5 interpretations of the keystrokes. Likely cause: `scripts/new-keystore.mjs` stored control
characters typed at creation (it treated only DEL as backspace); fixed in `825aaa2` (^H erases, control characters are
refused). signet-ops never sent a transaction (nonce 0), so the password was never exercised after creation.

**Consequences:** its **0.043355534124840684 OKB** is unrecoverable. As guardian it could only freeze, so nothing it
held could publish or change either gate. It was removed from both gates by approvers A and B (`voteRemoveGuardian()`,
2 of 3, takes effect at once; no timelock, and open proposals are unaffected), from the dashboard in Rabby, after a
fork test of the same four calls. Approver A also approved release #8 first (11:26:49 UTC).

| Tx | From | Gate | Block (UTC) | Gas | Fee (OKB) | Log |
|---|---|---|---:|---:|---:|---|
| [`0xc138fd29…835c`](https://web3.okx.com/explorer/x-layer/evm/tx/0xc138fd29ea7093eead38c9c81fccdff452739f3c605b52c85f5682163761835c) | Approver A | signetguard.xyz `0xa3d4…4503` | 76,750,713 (11:29:09) | 51,939 | 0.0000014855 | none (first vote) |
| [`0xddac68f9…3e1d`](https://web3.okx.com/explorer/x-layer/evm/tx/0xddac68f900d8cc5f127162aea8b5171aa671ad0ecc0752520699ba7856f63e1d) | Approver A | misthos.world `0xDfFf…4a59` | 76,750,741 (11:29:37) | 51,939 | 0.0000014855 | none (first vote) |
| [`0xf70abd8c…37ce`](https://web3.okx.com/explorer/x-layer/evm/tx/0xf70abd8c67a0dd5749059b9f339fd000b04ba7b6ee21899bca4ae142f02037ce) | Approver B | signetguard.xyz | 76,750,756 (11:29:52) | 36,398 | 0.0000010410 | `GuardianRemoved()` |
| [`0x251214a3…87be`](https://web3.okx.com/explorer/x-layer/evm/tx/0x251214a3cde952d4c3763311e194e0cdb64febeab1961d5e918ef314587be0fa) | Approver B | misthos.world | 76,750,764 (11:30:00) | 36,398 | 0.0000010410 | `GuardianRemoved()` |

After (xlayerrpc.okx.com and xlayer.drpc.org): `guardian()` = `0x0` and `guardianVoteAt(0..2)` = 0 on both gates.
Unaffected: release #8 (1 approval, timelock running; `policyInputs(8)` = 1) and Misthos proposal 1 (2 approvals, tier
10, 24 h running; `policyInputs(1)` = 35). Both gates now have no guardian; a new one would need a keystore made with the
fixed script and opened with cast **before** use, then `SetGuardian` (tier 11, 3 of 3 + 24 h) on each gate.

## Release #8 proposed (2026-11-24, tier 00): /prove under rate limits, /prove and /llms.txt URLs, docs synced

Built with `SIGNET_REPO_PUBLIC=1` from `b150241` (after #7 was published, so its docs say so) and sealed into
`packages/dashboard/release/8`; fork-rehearsed first (tier 00, same gas). Allowlist and origins equal #7's (the served
`llms.txt` names misthos.world's gate, which the site's config excludes: text, never called).

| Tx | From | Call | Block | Gas |
|---|---|---|---:|---:|
| [`0x4a54ce4a…46f7`](https://web3.okx.com/explorer/x-layer/evm/tx/0x4a54ce4a0c745f29da4c9478d752c3c80f6e15c9e4a8be22fd6a095828fe46f7) | CI proposer | `proposeRelease` → #8, tier 00 | 76,750,358 (11:23:14 UTC) | 168,996 |

Both RPCs: `proposalCount` = 8, `currentRelease` = 7. Diff Guard vs #7: nothing new to sign, no new origin.

**Approved** by Approver A at 11:26:49 UTC; timelock over 12:26:49. **Deployed** `release/8` (without the manifest folder) to
Cloudflare Pages (`c474750f`) at 12:28 UTC: all 25 files byte-identical with a browser user agent (with and without a
cache-busting query); the 4 pages in Chromium: 30 responses identical, other hosts only the two sealed RPCs, no page
errors; `/prove` redirects to `/app#/prove`, `/llms.txt` is served. The live `/prove` (headless, mainnet): all checks
passed, with 4 drpc HTTP 429s retried. Site CI key funded with 0.007 + 0.002 OKB from the team's personal X Layer
wallet (`0x52cf9ddc…33f8` and a second transfer): 0.009297038 OKB before publishing.

## Release #7 proposed (2026-11-24, tier 00): the "Create the gate" fix and the Guard 0.3.0 link

Proposal 7 (release numbers are proposal ids; #6 was the SetGuardian admin proposal). Built with `SIGNET_REPO_PUBLIC=1`
from `6bd8231` and sealed into `packages/dashboard/release/7` **before** any deploy; fork-rehearsed first (same tier and
gas). Contents: the wizard reads the created gate from its `GateCreated` event (the 0x0 bug, see below), `/start`
pins CLI 0.2.1 and serves only its tarball, `/start` links Signet Guard 0.3.0.

| Tx | From | Call | Block | Gas | Fee (OKB) |
|---|---|---|---:|---:|---:|
| [`0xe0f5d175…34d4`](https://web3.okx.com/explorer/x-layer/evm/tx/0xe0f5d1755ae08a0fc9a9e5f6c5e0fd04cd8c7f9b0013495588f7e940f90d34d4) | CI proposer `0x9327…9453` | `proposeRelease` → #7, tier 00 | 76,741,678 (08:58:34 UTC) | 168,996 | 0.00000338 |

filesRoot `0xc8d3…8973`; allowlistHash `0x5a48…efc5` and originsHash `0xfa18…85cf`, unchanged from #5 (Diff Guard: no new
contract, spender, origin, SRI hash or approve/permit/transfer call). Both RPCs: `proposalCount` = 7, `currentRelease` = 5.
Proposer balance after: 0.000341675452083773 OKB.

**Approved** (1 approval), timelock over 10:02 UTC. **Deployed** `release/7` (without the manifest folder) to Cloudflare
Pages (`29fd19b5`); all 23 files byte-identical with a browser user agent (with and without a cache-busting query),
and the 4 pages in Chromium: 30 responses identical, other hosts only the two sealed RPCs, no page errors. Fork
rehearsal of the publish found the CLI bug fixed in `21c4efc` (the upload didn't read the key file). **Published:**

| Tx | From | Call | Block | Gas |
|---|---|---|---:|---:|
| [`0xa44e63c1…0e94`](https://web3.okx.com/explorer/x-layer/evm/tx/0xa44e63c1d32b8c85a77239c475998996ca624da0e3bfb2c72895dde956680e94) | CI proposer | `publish(7)`, decided by circuit #6 | 76,750,284 (11:22:00 UTC) | 292,923 |
| [`0x4bc08440…4447`](https://web3.okx.com/explorer/x-layer/evm/tx/0x4bc084406e0a81f6a706e088a204ba5579e291910312b8e5f432b8c538304447) | CI proposer | registry write `signet/files.json` (7,090 B; allowlist and origins unchanged), read back and matched | 76,750,288 | 1,769,941 |

Both RPCs: `currentRelease()` = 7, `activeRelease()` = (`0xc8d3…8973`, `0x5a48…efc5`, `0xfa18…85cf`, true). Proposer
balance after: 0.000300418170020909 OKB.

## Misthos gate created: misthos.world bound (2026-11-24)

Sent by the team from Approver A in Rabby on https://signetguard.xyz/app#/new (the live release #5 dashboard), to the
factory `0xc5e12ffe9D5bE7085441bD955724A6FAff9f7986`, value 0, at 0.0286 gwei.

| Tx | Call | Block | Gas | Fee (OKB) | Events |
|---|---|---:|---:|---:|---|
| [`0x4327ca55…7270`](https://web3.okx.com/explorer/x-layer/evm/tx/0x4327ca55038d50e8e59b6ea4e98cade792e016ba306dc2fdafca2e41be967270) | `factory.commit(…)` | 76,739,001 (08:13:57 UTC) | 45,549 | 0.0000013027014 | `Committed` |
| [`0xf2ac22f0…d8bc`](https://web3.okx.com/explorer/x-layer/evm/tx/0xf2ac22f0566995dd00c2054262f6d3287ef85395c05ba15011b9184c187bd8bc) | `factory.createGate(…)` | 76,739,048 (08:14:44 UTC) | 536,383 | 0.0000153405538 | registry `0xad0c0064…` (gate), `GateCreated(gate, creator = A)` |

Total 581,932 gas, 0.0000166432552 OKB (the fork measured 581,944). **Gate `0xDfFf2307d45df1995502d8b300aE9AfbB01c4a59`**
(a minimal clone of the implementation `0xD146…3B3D`), the address the fork predicted.

After (xlayerrpc.okx.com and xlayer.drpc.org agree): `registry.bindingOf("misthos.world")` = gate `0xDfFf…4a59`,
container `0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed`, prefix `projects/misthos.world/`; `isGate` = true; approvers
A `0xB9ef…2416`, B `0x3280…6dc`, C `0x1C47…c74c`; proposer (Misthos CI) `0x88e003256804Df5b916E19849C7a26c4e1cC4D06`;
recovery `0x6940…cD93`; guardian signet-ops `0x9275…E291` (removed 2026-11-24, see "Plan B"); observe mode (`enforced` = false).

**Misthos CI key funded** (2026-11-24 08:47:41 UTC): [`0x7814a003…5e0b`](https://web3.okx.com/explorer/x-layer/evm/tx/0x7814a003312fa8fe1e625465bd06182839a9f448fca3d97b6bd01c9881475e0b),
block 76,741,025, 0.002 OKB from `0xe619216b27a37dde4238e0541bbc0e16916497f8` (the team's personal X Layer wallet, in Rabby) to the CI proposer
`0x88e0…4D06`; 21,000 gas at 0.0286 gwei (0.0000006006 OKB). CI key balance 0.002 OKB on both RPCs. (Planned from
signet-ops, whose keystore password does not open in cast: see `scripts/check-keystore.mjs`.)

**Dashboard bug found here:** the page showed "gate 0x000…0 created". The transaction was fine; the page read the
binding through both RPCs at the lower of their two heads, one block before `createGate` (see `docs/decisions.md`).

## Misthos release #1 proposed (2026-11-24, tier 10)

The first `signet-release` run ([45364446803](https://github.com/kenil1710/misthos/actions/runs/45364446803)) failed in
"Build for production" (Vercel CLI 39 can't read pnpm 12's two-document lockfile; nothing deployed or proposed; Vercel
did not deploy the merge). Fixed in kenil1710/misthos#2 (Vercel CLI 65.14.0). The second run
([45369533405](https://github.com/kenil1710/misthos/actions/runs/45369533405)) built, staged
`https://misthos-eifmwis7m-kenils-projects-a3f732d1.vercel.app` (misthos.world not assigned), sealed it in Chromium and
proposed:

| Tx | From | Call | Block | Gas |
|---|---|---|---:|---:|
| [`0x37e31bd0…511e`](https://web3.okx.com/explorer/x-layer/evm/tx/0x37e31bd0512b026c70b11eeaf58c8e974cb5e7c6a55c367996a1a6546330511e) | Misthos CI key `0x88e0…4D06` | `proposeRelease` → **proposal 1**, tier 10 | 76,745,206 (09:57:22 UTC) | 161,802 |

filesRoot `0xaa63…b53f`, allowlistHash `0xce06…7449`, originsHash `0xfd64…1a3b`. Page mode ssr, 7 inline script hashes
(as in the fork rehearsal), 423 files; allowlist: USDC + the factory on Arc 5042 and 5042002, no spenders, the
factory rule on both. Checks: the run's artifact hashes to the proposal (Diff Guard); every staged script and style
matches the artifact byte for byte; an independent `seal --crawl-browser` of the staged URL gives the same three
hashes. To publish: 2 approvals, then 24 h from the second (`readyAt`), before the proposal expires
(2026-12-01 09:57:22 UTC, 7 days after proposing); then `signet-promote` with run id 45369533405.

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
- ~~Fund approver C~~ Done 2026-11-21 (rotation step 2). The CI proposer and approvers A, B and C are funded.

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
