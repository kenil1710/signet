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
| Guardian (freeze only) | signet-ops `0x9275eDEC1c4940B85a1e11Cce3EAd662ba00E291` since 2026-11-23 (keystore with scrypt n = 2^18; tier-11 `SetGuardian`, proposal #6). Before: signet-dev until 2026-11-20, then none |

Mode: **observe** (a new gate starts there). Current release: **#7** (published 2026-11-24); #3, #4 and #5 were published 2026-11-20; #6 was the tier-11 guardian change (2026-11-23). See the "Release #…" sections below.

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

## Release #8 proposed (2026-11-24, tier 00): /prove under rate limits, /prove and /llms.txt URLs, docs synced

Built with `SIGNET_REPO_PUBLIC=1` from `b150241` (after #7 was published, so its docs say so) and sealed into
`packages/dashboard/release/8`; fork-rehearsed first (tier 00, same gas). Allowlist and origins equal #7's (the served
`llms.txt` names misthos.world's gate, which the site's config excludes: text, never called).

| Tx | From | Call | Block | Gas |
|---|---|---|---:|---:|
| [`0x4a54ce4a…46f7`](https://web3.okx.com/explorer/x-layer/evm/tx/0x4a54ce4a0c745f29da4c9478d752c3c80f6e15c9e4a8be22fd6a095828fe46f7) | CI proposer | `proposeRelease` → #8, tier 00 | 76,750,358 (11:23:14 UTC) | 168,996 |

Both RPCs: `proposalCount` = 8, `currentRelease` = 7. Diff Guard vs #7: nothing new to sign, no new origin.

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
recovery `0x6940…cD93`; guardian signet-ops `0x9275…E291`; observe mode (`enforced` = false).

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
