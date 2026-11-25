# Claims

Every claim Signet makes, with its evidence. **`pnpm verify:claims`** checks all of them (about 2 minutes,
read-only, no key): the mainnet ones with live calls to X Layer on two RPC operators that must agree, the repo ones
by recomputing them from the committed artifacts or confirming the cited test exists. It exits with an error if
any check fails, and it reports claims about things not yet deployed as **PENDING**, never as passed.

Processor #101 = `0x73153e5fd2Acac604D49d6ca9fea27b750718F22`. Dev wallet = `0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE`.

## On X Layer mainnet

| ID | Claim | Evidence |
|---|---|---|
| C1 | The release policy is TapeOut circuit **#6** on processor #101: 9 inputs, 2 outputs, 34 NAND gates, no state | `circuitInfo(6)` on processor #101 |
| C2 | Circuit #6's stored netlist is the reviewed one (sha256 `0x1a2e1987…20db`) | `netlist(6)`; `packages/circuit/artifacts/policy.json` |
| C3 | Circuit #6 gives the published truth table on **all 512 inputs** | 512 `eval(6, input)` calls per RPC; `docs/policy-truth-table.md` |
| C4 | Circuit #6 was minted and taped out by the dev wallet; since 2026-11-21 Signet's site gate `0xa3d4…4503` holds it (moving it out needs 3 of 3 approvers + 24 h) | mint [`0x1c772cbe…b1be`](https://web3.okx.com/explorer/x-layer/evm/tx/0x1c772cbe1cfeded533308f7fb3be7a07338144754d8d95205359efef0ff6b1be), move to the gate [`0x71d27701…1c5a`](https://web3.okx.com/explorer/x-layer/evm/tx/0x71d277016408f603fe62a62c8c6ccdf06099df4a1c6579d8b55dd7abd5341c5a), tape-out [`0x354cb0d5…2b96`](https://web3.okx.com/explorer/x-layer/evm/tx/0x354cb0d5e93245326e19cab3c701d5b6b72122d6e293c96f6d7b2211a4f82b96) (block 76,060,134); `ownerOf(6)` |
| C5 | A taped-out circuit's behavior can't be upgraded: the circuit beacon's owner is `0x0`, its implementation is the one Signet pins, the processor is the pinned proxy | beacon `0xf70d…991C` `owner()`, `implementation()`; processor code hash `0x57aa306f…17d5`; `docs/tapeout-interfaces.md` §6 |
| C6 | Signet's container is circuit #5's container, opened on mainnet; a file stored in it reads back with the recorded SHA-256 | container `0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed`; open [`0x7125a14a…edb2`](https://web3.okx.com/explorer/x-layer/evm/tx/0x7125a14ab3eda56b928b6831a0a61db66fbf7b651a6d8cbf8e4be7fe6991edb2), write [`0xf88b8c67…bcc3`](https://web3.okx.com/explorer/x-layer/evm/tx/0xf88b8c679358a6dbf4524fb57fd370ee78f960dd36d7db795875a3b91331bcc3); `packages/contracts/spike-data/manifest-sample.json` |
| C7 | A contract can read a TapeOut circuit's output inside a transaction (Spike A) | probe `0xD12717Fd5604798f66a62554d5AcBB535677DB7E`, `record(true,true)` [`0xaa5aae2f…93ad`](https://web3.okx.com/explorer/x-layer/evm/tx/0xaa5aae2f2b6f7bf8a6661867a5281fd089dd14406a39b0950f0110cf60c493ad), `lastOut()` = true |
| C8 | Signet's contracts are on mainnet: SignetRegistry (enumerable domain list), SignetFactory, the ReleaseGate implementation, Signet's own site gate | registry [`0x98dB…0589`](https://web3.okx.com/explorer/x-layer/evm/address/0x98dB5B6B1545D0fb374da40a02045B93398E0589), factory [`0xc5e1…7986`](https://web3.okx.com/explorer/x-layer/evm/address/0xc5e12ffe9D5bE7085441bD955724A6FAff9f7986), implementation [`0xD146…3B3D`](https://web3.okx.com/explorer/x-layer/evm/address/0xD14697C1dFEAdA3A117Ff8CD5358c80743453B3D), site gate [`0xa3d4…4503`](https://web3.okx.com/explorer/x-layer/evm/address/0xa3d4dfb5fB47D2CcF9b4a0a0fcC64Ac3fFef4503) for `signetguard.xyz`; 5 transactions from block 76,226,335 (`docs/mainnet.md`) |
| C9 | The Guard decision circuit is on mainnet and gives its published truth table on all 512 inputs | circuit **#7** on processor #101: mint [`0xa655…b059`](https://web3.okx.com/explorer/x-layer/evm/tx/0xa655247a48cb08f60d0b3304b3a8d0fea540115b6ed1f5472900f3c793f3b059), tape-out [`0x8fc6…4c16`](https://web3.okx.com/explorer/x-layer/evm/tx/0x8fc6a9d7dbf6082783b267449ee13c6327af56f2a662e087f23f1c40ade44c16) (block 76,226,683); 512/512 on both RPCs (`packages/circuit/artifacts/guard-deployment.json`) |
| C10 | signetguard.xyz's gate is in **enforce** mode since 2026-11-25 (one approver's `enforce()`, allowed 7 days after the gate was made), not frozen, with a published release and **no guardian** | `enforced()`, `frozen()`, `currentRelease()`, `guardian()` on `0xa3d4…4503`; `enforce()` by approver A in [`0x00de5449…2dd0`](https://web3.okx.com/explorer/x-layer/evm/tx/0x00de54492ffa1a2a0574d9d3664e407b0586d8d711bcd95910feabf5b9952dd0) (block 76,840,474, event `Enforced`) |
| C11 | misthos.world's gate (the team's own app) has published release #1 and is in **observe** mode; its team can switch to enforce from 2026-12-01 08:14 UTC. **No guardian** | `currentRelease()`, `enforced()`, `guardian()`, `deployedAt()` on `0xDfFf…4a59`; publish [`0xdb1cc141…fd0b`](https://web3.okx.com/explorer/x-layer/evm/tx/0xdb1cc141906904fe82b20ba94c606d2fafa5913a1c73680b3a32c1ac341dfd0b) (2026-11-25, tier 10: 2 approvals + 24 h) |

## In the repo (recomputed, or the cited tests exist)

What CI runs on every push (`.github/workflows/test.yml`): the typecheck and `pnpm -r test`, which is **173 Foundry
tests** (the 17 `*.fork.t.sol` tests are skipped there: they need an X Layer RPC), both circuits on all 512 inputs,
and the unit tests of every package. Run the fork tests yourself, read-only:
`cd packages/contracts && XLAYER_RPC_URL=https://xlayerrpc.okx.com forge test` (190 passed on 2026-11-25). The
staging suites and the attack suite run on a local fork, not in CI (`pnpm staging:up`, then `pnpm attacks`;
`docs/TRY-IT-LOCALLY.md`).

| ID | Claim | Evidence |
|---|---|---|
| R1 | Every release needs at least one human approval: no row of the policy circuit publishes without one | `packages/circuit/artifacts/policy.json` (the 64 rows with no approval); C3 ties it to mainnet |
| R2 | The Guard decision circuit never blocks in observe mode or when Guard can't check the release | `packages/circuit/artifacts/guard.json` (384 rows); `docs/guard-truth-table.md` |
| R3 | The committed circuit artifacts are exactly what the netlist builders produce | `packages/circuit/scripts/artifact.ts`; CI test `committed artifact … matches` |
| R4 | The risk tier is computed on-chain, so CI can't propose a changed allowlist at a lower tier | `packages/contracts/test/ReleaseGate.t.sol`: `test_tier_*`, `test_H1_ciCannotShipNewAllowlistAtALowerTier` |
| R5 | The CI key can propose and call publish, but never approve, cancel, revoke, freeze, unfreeze, switch modes or propose admin changes | `test_threat7_proposerCanOnlyPropose`, `test_row11_proposerKeyCannotProposeAdmin`, `test_unfreeze_guardianAndProposerCannotApprove`, `test_freeze_anyOneApproverOrGuardian_notProposerOrStranger` |
| R6 | On staging, **all 12 attacks against Guard users are blocked**, with **0 false blocks on 16 clean sessions** | `docs/attack-report.md`; reproduce: `pnpm staging:up && pnpm attacks` |
| R9 | Against the same 12 attacks (written by us, run on our own local fork of X Layer), **SRI alone blocks 2, Signet Guard with signature checks off ("hash-only") 7, Signet 12**, with 0 false blocks | `docs/benchmark.md`; reproduce: `pnpm staging:up && pnpm benchmark`. The hash-only column is an ablation of Guard, not TEE Shield itself |
| R10 | A 300 KB bundle can be stored on-chain as the verified copy: 13 transactions, each under the 16.7M per-transaction gas cap | `docs/demo/chunked-upload.json` (70.05M gas in total, ≈ 0.0015 OKB at 0.021 gwei); `packages/gateway/test/staging/chunked.test.ts`; `SignetRegistry.writeChunk` |
| R7 | Guard makes no network request on a domain that isn't sealed | `packages/extension/test/staging/guard.test.ts`, "privacy: …" (counts RPC and site requests) |
| R11 | Guard 0.3.5 refuses, in enforce mode, `eth_sign` and any signature it can't decode (typed data without a verifying contract or not readable, an empty batch). Circuit #7 only warns for those rows; Guard's rule on top of it can only turn that warning into a refusal. Observe mode and unchecked sites still only warn | `packages/extension/test/policy.test.ts` ("enforce mode: eth_sign and every signature Guard cannot decode are refused…"); `packages/extension/test/staging/guard.test.ts` ("enforce mode (Guard 0.3.5): …", real Chromium, mock wallet) |
| R8 | Diff Guard flags a poisoned npm package (new address, origin, approve/transferFrom calls) and the chain makes it tier 10 | `docs/demo/diff-guard-poisoned.txt`; `packages/cli/test/staging/e2e.test.ts` |

## Claims we do not make

- That users without Guard are protected at signing. **They aren't.** The attack suite runs the same DNS hijack against a browser without Guard to show it: the drainer's request reaches the wallet, and the only response is the watchtower alerting the team (within about a minute on the local fork; on mainnet within about 10 minutes, a round every 5 minutes). It is reported in its own section of `docs/attack-report.md` as a limit, not counted among the attacks above.
- That Guard survives being compromised itself (a malicious update, build or Chrome Web Store account). It doesn't; this can't be tested from outside and is documented in `THREAT_MODEL.md` (threat 17).
- That Signet protects many people on mainnet today. signetguard.xyz is in enforce mode (C10), so Guard users there are refused what its seal doesn't allow; misthos.world is still in observe mode (C11): Guard reports, never blocks. Few people run Guard yet, and no project outside the team has a gate.
- That misthos.world is an outside adopter. It is the team's own app (on Arc), sealed to test Signet on a server-rendered site.
- That Guard works with MetaMask or OKX Wallet. The automated suites use a mock wallet that records every request; one manual test with Rabby passed on 2026-11-25 (a sealed action on signetguard.xyz/app reached Rabby with no false refusal). MetaMask and OKX Wallet are not tested.
- That no hacked key can change your site. A stolen hosting, CDN or DNS credential can still change what visitors load. What Signet guarantees is narrower: **no single key can publish a release** (CI only proposes; an approver must approve; circuit #6 decides), and a site that no longer matches its published release is **detected within minutes** (the watchtower, a round every 5 minutes) and **blocked for Guard users** in enforce mode.
- That every action on a gate takes 3 of 3 + 24 h. Safety actions are fast on purpose, because they only stop or remove things: any one approver can freeze or revoke the current release at once; two can unfreeze, un-revoke, remove the guardian, or remove a file from a revoked release. Changes are slow: approvers, the CI key, the recovery address, the guardian, timelocks, the domain binding, the circuit copy and switching back to observe mode all take **3 of 3 + 24 h** (tier 11). Switching to enforce (stricter) takes one approver, after the gate's first 7 days.
- That the approvers of Signet's own gates are independent people. Approvers A, B and C and the recovery address are the same on both gates and are held by the Signet team itself; no outside approver yet.
- That TapeOut's contracts are audited or source-verified. They are neither; C5 checks what can be checked on-chain.
