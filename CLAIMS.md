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
| C4 | Circuit #6 was minted and taped out by the dev wallet, which still holds it | mint [`0x1c772cbe…b1be`](https://www.oklink.com/xlayer/tx/0x1c772cbe1cfeded533308f7fb3be7a07338144754d8d95205359efef0ff6b1be), tape-out [`0x354cb0d5…2b96`](https://www.oklink.com/xlayer/tx/0x354cb0d5e93245326e19cab3c701d5b6b72122d6e293c96f6d7b2211a4f82b96) (block 76,060,134); `ownerOf(6)` |
| C5 | A taped-out circuit's behavior can't be upgraded: the circuit beacon's owner is `0x0`, its implementation is the one Signet pins, the processor is the pinned proxy | beacon `0xf70d…991C` `owner()`, `implementation()`; processor code hash `0x57aa306f…17d5`; `docs/tapeout-interfaces.md` §6 |
| C6 | Signet's container is circuit #5's container, opened on mainnet; a file stored in it reads back with the recorded SHA-256 | container `0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed`; open [`0x7125a14a…edb2`](https://www.oklink.com/xlayer/tx/0x7125a14ab3eda56b928b6831a0a61db66fbf7b651a6d8cbf8e4be7fe6991edb2), write [`0xf88b8c67…bcc3`](https://www.oklink.com/xlayer/tx/0xf88b8c679358a6dbf4524fb57fd370ee78f960dd36d7db795875a3b91331bcc3); `packages/contracts/spike-data/manifest-sample.json` |
| C7 | A contract can read a TapeOut circuit's output inside a transaction (Spike A) | probe `0xD12717Fd5604798f66a62554d5AcBB535677DB7E`, `record(true,true)` [`0xaa5aae2f…93ad`](https://www.oklink.com/xlayer/tx/0xaa5aae2f2b6f7bf8a6661867a5281fd089dd14406a39b0950f0110cf60c493ad), `lastOut()` = true |
| C8 | **PENDING.** Signet's contracts are on mainnet: SignetRegistry (enumerable domain list), SignetFactory, the ReleaseGate implementation, Signet's own site gate | Not deployed. Plan, exact calls and cost (≈ 0.00018 OKB): `docs/mainnet-plan.md` A. On staging: every suite |
| C9 | **PENDING.** The Guard decision circuit is on mainnet and gives its published truth table on all 512 inputs | Not taped out on mainnet. Plan (≈ 0.0020 OKB): `docs/mainnet-plan.md` B. On staging: circuit #7, 512/512 (`staging/guard-tapeout.sh`); simulated against live mainnet state: 512/512 |

## In the repo (recomputed, or the cited tests exist; run them with `pnpm test` and the staging suites)

| ID | Claim | Evidence |
|---|---|---|
| R1 | Every release needs at least one human approval: no row of the policy circuit publishes without one | `packages/circuit/artifacts/policy.json` (the 64 rows with no approval); C3 ties it to mainnet |
| R2 | The Guard decision circuit never blocks in observe mode or when Guard can't check the release | `packages/circuit/artifacts/guard.json` (384 rows); `docs/guard-truth-table.md` |
| R3 | The committed circuit artifacts are exactly what the netlist builders produce | `packages/circuit/scripts/artifact.ts`; CI test `committed artifact … matches` |
| R4 | The risk tier is computed on-chain, so CI can't propose a changed allowlist at a lower tier | `packages/contracts/test/ReleaseGate.t.sol`: `test_tier_*`, `test_H1_ciCannotShipNewAllowlistAtALowerTier` |
| R5 | The CI key can propose and call publish, but never approve, cancel, revoke, freeze, unfreeze, switch modes or propose admin changes | `test_threat7_proposerCanOnlyPropose`, `test_row11_proposerKeyCannotProposeAdmin`, `test_unfreeze_guardianAndProposerCannotApprove`, `test_freeze_anyOneApproverOrGuardian_notProposerOrStranger` |
| R6 | On staging, **all 12 attacks against Guard users are blocked**, with **0 false blocks on 16 clean sessions** | `docs/attack-report.md`; reproduce: `pnpm staging:up && pnpm attacks` |
| R9 | Against the same 12 attacks on staging, **SRI alone blocks 2, a hash-only checker 7, Signet 12**, with 0 false blocks | `docs/benchmark.md`; reproduce: `pnpm staging:up && pnpm benchmark`. The hash-only column is an ablation of Guard, not TEE Shield itself |
| R10 | A 300 KB bundle can be stored on-chain as the verified copy: 13 transactions, each under the 16.7M per-transaction gas cap | `docs/demo/chunked-upload.json` (70.05M gas in total, ≈ 0.0015 OKB at 0.021 gwei); `packages/gateway/test/staging/chunked.test.ts`; `SignetRegistry.writeChunk` |
| R7 | Guard makes no network request on a domain that isn't sealed | `packages/extension/test/staging/guard.test.ts`, "privacy: …" (counts RPC and site requests) |
| R8 | Diff Guard flags a poisoned npm package (new address, origin, approve/transferFrom calls) and the chain makes it tier 10 | `docs/demo/diff-guard-poisoned.txt`; `packages/cli/test/staging/e2e.test.ts` |

## Claims we do not make

- That users without Guard are protected at signing. **They aren't.** The attack suite runs the same DNS hijack against a browser without Guard to show it: the drainer's request reaches the wallet, and the only response is the watchtower alerting the team within about a minute. It is reported in its own section of `docs/attack-report.md` as a limit, not counted among the attacks above.
- That Guard survives being compromised itself (a malicious update, build or Chrome Web Store account). It doesn't; this can't be tested from outside and is documented in `THREAT_MODEL.md` (threat 17).
- That Signet is on mainnet. Only the release-policy circuit, the container and the spikes are.
- That Guard works with MetaMask or OKX Wallet. It was tested with a mock wallet.
- That TapeOut's contracts are audited or source-verified. They are neither; C5 checks what can be checked on-chain.
