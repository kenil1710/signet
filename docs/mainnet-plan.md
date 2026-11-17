# Mainnet plan (X Layer, chain 196)

**Status: not sent.** Nothing below has been sent to mainnet. Every step waits for Kenil's explicit yes
(CLAUDE.md rule 2). The numbers come from a rehearsal of these exact scripts on a fork of mainnet
(`staging/rehearse-mainnet.sh`), plus a live simulation of the tape-out against mainnet state (no broadcast).
Both were run on 2026-11-17 at block ≈ 76,141,600.

| | |
|---|---|
| Sender | dev wallet `0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE` (holds circuits #5 and #6; nonce 8) |
| Balance | **0.046635572562621784 OKB** (same on xlayerrpc.okx.com and xlayer.drpc.org) |
| Gas price | 0.020–0.021 gwei (`eth_gasPrice` on the two RPCs); L1 fee 0 on every earlier Signet transaction |
| **Total for everything below** | **≈ 0.00218 OKB** at 0.021 gwei (**≈ 0.00238 OKB** if gas doubles to 0.04 gwei) |
| Left afterwards | ≈ 0.0445 OKB |

## A. Signet's contracts (`packages/contracts/script/MainnetDeploy.s.sol`)

| # | Call | Value | Gas (fork rehearsal) | Cost at 0.021 gwei |
|---|---|---|---|---|
| A1 | `new SignetRegistry(SiteRegistry 0xd6EF…ADB6, ContainerOpener 0x536a…0106, processor 0x7315…8F22, circuit 5, predicted factory, predicted site gate)` | 0 | 2,453,967 | 0.0000515 OKB |
| A2 | `new SignetFactory(registry, processor, circuit 6, netlist sha256 0x1a2e…20db, processor codehash 0x57aa…17d5, beacon 0xf70d…991C, implementation 0x977f…29B2)`; its constructor deploys the ReleaseGate implementation | 0 | 5,492,286 | 0.0001153 OKB |
| A3 | `factory.commit(keccak256(abi.encode(SIGNET_SITE_DOMAIN, salt, dev)))` | 0 | 45,561 | 0.0000010 OKB |
| A4 | `SiteRegistry.setOperator(0x8E2E…94Ed, registry, 2,592,000)` (30 days, the maximum) | 0 | 136,055 | 0.0000029 OKB |
| — | wait ≥ 2 blocks (commit-reveal) | | | |
| A5 | `factory.createGate([3 approvers], proposer, recovery, guardian, [(SIGNET_SITE_DOMAIN, salt, 0x0, 0)])`: Signet's own site gate, which must be the factory's first gate | 0 | 576,139 | 0.0000121 OKB |
| | **Subtotal A** | **0** | **8,704,008** | **0.000183 OKB** |

A1–A4 are `step1()`, A5 is `step2()`. The script checks the beacon implementation, the processor code hash, circuit #6's
netlist and the shared container before it sends anything, and it stops if the factory's or the site gate's
predicted address is wrong. In the rehearsal the predictions held: registry `0x98dB…0589`, factory `0xc5e1…7986`,
gate implementation `0xD146…3B3D`, site gate `0xa3d4…4503`. Those addresses depend on the dev wallet's nonce, so
they hold only if nothing else is sent from it first.

```bash
cd packages/contracts
# 1. simulate (no transaction): forge prints every call and the gas
forge script script/MainnetDeploy.s.sol --sig "step1()" --rpc-url xlayer --sender 0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE
# 2. send, after the yes
forge script script/MainnetDeploy.s.sol --sig "step1()" --rpc-url xlayer --account signet-dev --broadcast --slow
# 3. two blocks later
forge script script/MainnetDeploy.s.sol --sig "step2()" --rpc-url xlayer --account signet-dev --broadcast --slow
```

## B. Guard decision circuit (`packages/contracts/script/GuardTapeout.s.sol`)

| # | Call | Value | Gas (live simulation) | Cost |
|---|---|---|---|---|
| B1 | `transistors.mint(NAND, 22)` on processor #101 | 682,000,000,000,000 wei (22 × 1e12 + 6.6e14 protocol fee) | ~86,000 | 0.000682 OKB + 0.0000018 gas |
| B2 | `processor.tapeout(guard netlist, 9, 3)` | 1,300,000,000,000,000 wei (`TAPEOUT_FEE`) | ~420,000 | 0.0013 OKB + 0.0000088 gas |
| | **Subtotal B** | **0.001982 OKB** | **505,567** | **≈ 0.001993 OKB** |

The simulation against live mainnet state said the new circuit would be **#7** and that `eval` matched the reference
on all 512 inputs. The script refuses to send if the mint or tape-out fee goes above these numbers. Afterwards:

```bash
node packages/circuit/scripts/verify-mainnet.ts 0x73153e5fd2Acac604D49d6ca9fea27b750718F22 7 guard   # 512 eth_calls on 2 RPCs
```

Then record the transactions in `packages/circuit/artifacts/guard-deployment.json`, set `tapeout.guardCircuitId` in
`packages/contracts/deployments/mainnet.json`, and run `pnpm --filter @signet/circuit gen` (the truth table then
names the mainnet circuit).

## C. After deployment

| | Cost |
|---|---|
| Write `contracts.registry`, `factory`, `gateImplementation`, `gates.site` into `deployments/mainnet.json`; `pnpm verify:claims` then checks them | 0 |
| Renew the registry's operator grant every 30 days (`setOperator`, from the holder of circuit #5) | ≈ 0.000003 OKB each |
| Signet's own site: the first release of the dashboard (propose, 3 approvals, publish, write the manifest). Not ready: the dashboard isn't built. On staging a manifest-only release took ≈ 2–3M gas (propose 162k, publish 306k, 3 file writes 0.4–0.6M each, plus approvals) | ≈ 0.00006 OKB |

## What I need from you before step A

1. **Signet's own domain** (`SIGNET_SITE_DOMAIN`). It is hidden by the commitment until A5.
2. **Six addresses for Signet's site gate:** 3 approvers, the CI proposer, a recovery key kept offline, and a guardian (or none). All must be different, and none should be the dev wallet.
3. **The dev wallet as a Foundry keystore account** named `signet-dev` (`cast wallet import signet-dev --interactive`), so no key is ever on a command line.
4. Your yes for A (≈ 0.00018 OKB) and, separately, for B (≈ 0.0020 OKB).

## Risks

- **The shared container's operator is a 30-day grant.** If nobody renews it, file writes for free projects stop (publishing and Guard's checks keep working on what is already stored). Nobody is assigned to renew it yet.
- **The dev wallet stays the holder of circuits #5 and #6** and is the only key that can replace the operator. It should move to a multisig after the hackathon (decisions, 2026-11-16).
- **The registry and factory can't be upgraded** (by design). A bug means a v2 registry and new gates.
- **Nonce-dependent addresses.** Any other transaction from the dev wallet between simulation and A1 changes every predicted address; the script then stops before sending A3.
