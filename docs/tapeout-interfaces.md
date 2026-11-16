# TapeOut interfaces (X Layer mainnet, chain id 196)

Source of truth for every TapeOut ABI and address the code uses (CLAUDE.md hard rule 1). Nothing here is guessed.
Each row says where it came from and how it was confirmed.

**Confidence labels**

- **Spec**: written in a TAP ([TapeOutProtocol/TAPs](https://github.com/TapeOutProtocol/TAPs) at commit `527477e`).
- **Bytecode**: the 4-byte selector is in the deployed X Layer bytecode, and its name comes from the public signature DB (`cast 4byte`). A matching keccak hash is strong evidence for the name, but **no TapeOut contract on X Layer has verified source** (Sourcify: no match for the factory, circuit or transistor implementations, checked 2026-11-16).
- **Measured**: read on X Layer with `eth_call` / `eth_getStorageAt`, or exercised on a local anvil fork (`packages/contracts/test/spike/SpikeA.fork.t.sol`). No mainnet transaction was sent.

Spike A reads were made on 2026-11-16 at X Layer block ≈ 76,055,171 via `https://rpc.xlayer.tech`, `https://xlayerrpc.okx.com` and `https://xlayer.drpc.org`.

## 1. Addresses

| Contract | Address | Source | Measured on 2026-11-16 |
|---|---|---|---|
| Processor factory (UUPS proxy) | `0x1f09DAeFA827f02CBb40967cc91b259763760761` | [TAP-10 Deployments](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-10.md#deployments) | `isSealed()` = 0 (not sealed); `owner()` = `0xB3D85b42A045c1A88D800CAD0F55d2566a4D3138`; `cpuCount()` = 424. Same values on 2 operators (OKX, dRPC) |
| Factory implementation | **`0x336e9F0F4c3fEe7C8c803377e4DEA00293f4ae2a`** | ERC-1967 slot of the factory | **Differs from TAP-10** (`0x74956236Ab64eD143933040B4137E8A352e4d17b`): the factory was upgraded after 2026-09-27 |
| Circuit beacon | `0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C` | TAP-10 | `implementation()` = circuit impl below. **`owner()` = `0x0`** (renounced; TAP-10 expected the factory). The beacon only has `upgradeTo`, `implementation`, `owner`, `renounceOwnership`, `transferOwnership` |
| Circuit (processor) implementation | `0x977f217887E085D298Cb3819cDAD5A0ee35F29B2` | TAP-10 | matches the beacon; 12,562 bytes |
| Transistor beacon | `0x1059Ad62cAbB6a6925bb65aA617300556c60A51B` | `factory.transistorBeacon()` | implementation `0x265bf10faB9ddEC0eE0A649C6B9DB845f1b9a06b` |
| `bem()` token | `0x60e62Efa9405d6873C5deaBD4E6CC91c25363952` | `factory.bem()` | not used in Spike A |
| Protocol wallet | `0x571d447f4f24688eC35Ccf07f1D6993655F6aF15` | `factory.protocolWallet()` | same address as the DeWEB hub owner in TAP-10 |
| Processor #101 (Spike A target) | `0x73153e5fd2Acac604D49d6ca9fea27b750718F22` | `factory.cpuAt(101)` | transistors `0xBf0B72e195Ea4FC40E8d474dA1B579601100ae54`; `mintPrice` 1e12 wei; `supplyCap` 10,000,000; `minted` 2,530,172 |
| Processor #1 (example) | `0x0565EA48CA41Ae559d8d491dbb0a9ec945DB551b` | TAP-10 Test Cases; `factory.cpuAt(1)` | name "My4004"; transistors sold out (100,000/100,000) |
| Container opener | `0x536adD8F30f03b69f6fbF29d425A816A0dC50106` | TAP-10 | not read yet (Spike B) |
| ERC-6551 registry | `0x000000006551c19487814612e58FE06813775758` | TAP-10 | not read yet |
| Container implementation | `0xAC4F791353eE9F06e2C50Ae4C34680D28Ea52a57` | TAP-10 | not read yet |
| Container payments table | `0x13b8AFa4Fd1b29B09D23A57A75ba8D3078d44858` | TAP-10 | not read yet |
| SiteRegistry (UUPS proxy) | `0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6` | TAP-10 | not read yet (Spike B) |
| DomainBinding (UUPS proxy) | `0x68809Fd2fb343aA57D0aeB7f33Defe477c9666f9` | TAP-10 | not read yet |
| DeWEB hub (proxy) / X Layer impl v3 | `0xe61A9C7213a6Aa616C246a2B569e555B417b25ee` / `0xdCC57797089eBD9f26e686379A4323f353a3F9C6` | TAP-10 | not read yet (TapeSend) |

Public RPCs (from [TapeKit `kernel/src/config.js`](https://github.com/TapeOutProtocol/TapeKit/blob/main/kernel/src/config.js), commit `37c617e`): `https://rpc.xlayer.tech`, `https://xlayerrpc.okx.com` (both OKX), `https://xlayer.drpc.org` (dRPC), `https://196.rpc.thirdweb.com`. TapeKit treats them as **two independent operators** (OKX and dRPC). `rpc.xlayer.tech` started returning HTTP 403 after about 1,500 calls in a few minutes.

## 2. Processor contract (one per processor, ERC-721 beacon proxy)

| Function | Selector | Source | Notes |
|---|---|---|---|
| `nextId() view returns (uint256)` | `0x61b8ce8c` | Spec ([TAP-02 §6](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-02.md#6-contract-interface-read-only-part)) + bytecode + measured | **Returns the last id assigned, not the next one** (TAP-02 says "the id the next taped-out circuit will get"): on #101 it returns 5 while circuit 5 exists and a tape-out gets 6 (2026-11-16). Read the id from the `tapeout` return value or the NFT mint event instead |
| `circuitInfo(uint256 id) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)` | `0x084d60f1` | Spec + bytecode + measured (fork) | reverts `no circuit` |
| `netlist(uint256 id) view returns (bytes)` | `0x3fc4be56` | Spec + bytecode + measured (fork) | |
| `eval(uint256 id, bytes inputs) view returns (bytes)` | `0x934d06ea` | Spec + bytecode + **measured: callable from a Solidity contract** (fork) | Combinational only; reverts `has latch: use step` if `nState > 0` |
| `step(uint256 id, bytes state, bytes inputs) view returns (bytes newState, bytes outputs)` | `0xe8281a1a` | Spec + bytecode | for circuits with LATCH |
| `tapeout(bytes netlist, uint32 nIn, uint32 nOut) payable returns (uint256 id)` | `0x7bd3ac1d` | Spec + bytecode + measured (fork) | `msg.value` must equal `TAPEOUT_FEE` (revert `tapeout fee`, measured); burns the caller's NAND/LATCH transistors **of this processor** (reverts with no transistors, measured); mints the circuit NFT to the caller |
| `TAPEOUT_FEE() view returns (uint256)` | `0xadfb2b69` | Bytecode + measured | **1.3e15 wei = 0.0013 OKB** on X Layer (TAP-02 says 0.0002 BNB on BSC) |
| `transistors() view returns (address)` | `0x6fbd1719` | Bytecode + measured | the processor's ERC-1155 transistor token; `transistorsContract()` (`0x36e07b61`) returns the same address |
| `ownerOf(uint256)`, `balanceOf(address)`, ERC-721 standard | — | Bytecode | |
| `TREASURY() view returns (address)` | `0x2d2c5565` | Bytecode | proc #1: `0xEBeceDeA36e598b64E17f8d519EB77441C539F76` |
| `sweepFees()` | `0xd113b95c` | Bytecode | not used |

Other spec items: `beat(address cpu, uint256 id, bytes inputs)` (`0x1fc0021d`, TAP-02 §6) is **not** in the X Layer circuit bytecode; it lives elsewhere and is not needed.

Revert strings found in the X Layer circuit bytecode match TAP-02 §3: `bad opcode`, `no outputs`, `too many pins`, `too few signals for outputs`, `LATCH d out of range`, `REF: target not a registered CPU`, `REF size`, `size overflow`, `state overflow`, `tapeout fee`.

### Netlist format and bit packing (TAP-02 §2, §4, §5)

- Signals: 0 = const 0, 1 = const 1, `2 + i` = input `i`, then the outputs of the elements in record order. Outputs are the **last `nOut` signals**.
- Records, all big-endian, `u24` = 3 bytes: NAND `0x00 a:u24 b:u24` (7 bytes); LATCH `0x01 d:u24` (4 bytes); REF `0x02 cpu:20 id:u64 nIns:u8 nOuts:u8 ins:u24×nIns`.
- NAND/REF inputs may only refer backwards; a LATCH `d` may refer forwards (feedback).
- Packing: bit `i` is bit `i mod 8` of byte `i / 8` (LSB first). Outputs are exactly `ceil(nOut/8)` bytes.
- Spike A AND circuit: `00 000002 000003 | 00 000004 000004`, `nIn = 2`, `nOut = 1`, 2 NANDs. Measured truth table through `CircuitProbe`: 00→0, 10→0, 01→0, 11→1.

## 3. Transistor token (one per processor, ERC-1155 beacon proxy)

| Function | Selector | Source | Notes |
|---|---|---|---|
| `NAND() view returns (uint256)` | `0x3bcce6c9` | Bytecode + measured | token id **0** |
| `LATCH() view returns (uint256)` | `0x15f47f4f` | Bytecode + measured | token id **1** |
| `mint(uint256 id, uint256 amount) payable` | `0x1b2ef1ca` | Bytecode + **measured** | **`msg.value ≥ amount × mintPrice() + protocolFee()`** (protocolFee is **flat per call**); below that it reverts `insufficient`. **Overpayment is kept, not refunded.** The recipient must be an EOA or an ERC-1155 receiver |
| `mintPrice() view returns (uint256)` | `0x6817c76c` | Bytecode + measured | set per processor (proc #101: 1e12 wei) |
| `protocolFee() view returns (uint256)` | `0xb0e21e8a` | Bytecode + measured | 6.6e14 wei (0.00066 OKB) on every processor read |
| `supplyCap()`, `minted()` | `0x8f770ad0`, `0x4f02c420` | Bytecode + measured | |
| `balanceOf(address, uint256)` | `0x00fdd58e` | Bytecode (ERC-1155) | |
| `burnFrom(address, uint256, uint256)` | `0x124d91e5` | Bytecode | contains the string `only circuits`: only the processor can burn |
| `circuits() view returns (address)` | `0x5f48772d` | Bytecode + measured | the processor this token belongs to |
| `creator()`, `withdraw()`, `owed(address)` | — | Bytecode | not used |

## 4. Processor factory

| Function | Selector | Source | Notes |
|---|---|---|---|
| `cpuCount() view returns (uint256)` | `0xa94da8a7` | Spec (TAP-02 §6, TAP-10) + measured | 424 |
| `cpuAt(uint256 i) view returns (address)` | `0x4bc7cbbd` | Spec + measured | |
| `isCPU(address) view returns (bool)` | `0x5f5a364f` | [TapeKit `selectors.js`](https://github.com/TapeOutProtocol/TapeKit/blob/main/kernel/src/selectors.js) + measured | |
| `isSealed() view returns (uint256)` | `0x631f9852` | Spec (TAP-10 §13.8) + measured | 0 |
| `circuitBeacon()`, `transistorBeacon()`, `bem()`, `protocolWallet()` | `0xddcb22fa`, `0xb3746a25`, `0x8765cf7b`, `0x06d6e63f` | Bytecode + measured | |
| `deployFee()`, `protocolFee()` | `0xeb2a5d2c`, `0xb0e21e8a` | Bytecode + measured | 1e7 and 1e6. **Unit unknown** (maybe the `bem` token); not needed for Spike A |
| `createCPU(string,string,string,uint256,uint256)` | `0x47f9b5fd` | Bytecode only | **Parameter meaning and payment are unknown. Not used.** Spike A uses an existing processor |

## 5. Gas and cost (measured 2026-11-16)

From `forge script script/spike/SpikeA.s.sol` (simulation against live state, no broadcast) and the fork test:

| Step | Gas limit (forge estimate) | Gas used (fork) | Value sent |
|---|---|---|---|
| `mint(NAND, 2)` on proc #101 | 119,337 | ~95,800 | 0.000662 OKB |
| `tapeout(AND, 2, 1)` | 328,597 | 240,256 | 0.0013 OKB |
| deploy `CircuitProbe` | 703,571 | — | 0 |
| `probe.record(true, true)` (contract → `eval`) | 111,437 | 84,040 | 0 |

The gas price was 0.02 gwei base. The OP-stack `GasPriceOracle.getL1Fee` returned **0** for all 4 transactions.

### Spike A on mainnet: done 2026-11-16

| Item | Value |
|---|---|
| Sender (dev wallet) | `0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE` |
| Processor | #101, `0x73153e5fd2Acac604D49d6ca9fea27b750718F22` |
| Circuit ID | **5** (2-input AND, `nIn` 2, `nOut` 1, `nState` 0, `gateCount` 2; `netlist(5)` = `0x0000000200000300000004000004`; `ownerOf(5)` = dev wallet) |
| Probe contract | `0xD12717Fd5604798f66a62554d5AcBB535677DB7E` (`cpu()` = #101, `circuitId()` = 5) |

| # | Tx | Block | Gas used | L2 gas fee (wei) | Value (wei) |
|---|---|---|---|---|---|
| 1 | `mint(0, 2)`: [`0x941443a1…52e9`](https://www.oklink.com/xlayer/tx/0x941443a174f38effc4a4a4c532dd3807d04528fc683d409594c2be139a0752e9) | 76,057,582 | 86,399 | 1,727,980,086,399 | 662,000,000,000,000 |
| 2 | `tapeout(AND, 2, 1)`: [`0xd0a696bf…51a9`](https://www.oklink.com/xlayer/tx/0xd0a696bfd9a79191d542c899d363bb69e85a1972137e300189a743d804d951a9) | 76,057,584 | 224,682 | 4,493,640,224,682 | 1,300,000,000,000,000 |
| 3 | deploy `CircuitProbe`: [`0x4b8367bb…9a82`](https://www.oklink.com/xlayer/tx/0x4b8367bb737a27d9d7be195bb297c50c38623cf2d5c5b1b7539f5e5942e79a82) | 76,057,586 | 541,209 | 10,824,180,541,209 | 0 |
| 4 | `probe.record(true, true)`: [`0xaa5aae2f…93ad`](https://www.oklink.com/xlayer/tx/0xaa5aae2f2b6f7bf8a6661867a5281fd089dd14406a39b0950f0110cf60c493ad) | 76,057,587 | 80,679 | 1,613,580,080,679 | 0 |
| | **Total** | | **932,969** | **18,659,380,932,969** (0.0000187 OKB) | **1,962,000,000,000,000** (0.001962 OKB) |

- Effective gas price was 20,000,001 wei (0.02 gwei); the receipts' `l1Fee` was 0 on all four.
- **Total spent: 0.001980659380932969 OKB**, equal to the dev wallet's balance drop between blocks 76,057,581 and 76,057,587 (0.031629232644504788 → 0.029648573263571819).
- **Read-back on mainnet:** `probe.lastOut()` = `true`, so AND(1,1) returned 1 inside transaction 4. Its `Evaluated` event logged `(a=1, b=1, out=1, gasUsed=56,091)` for the contract → `eval` call. `probe.evaluate(...)` returns 0 for (1,0), (0,1) and (0,0).

## 6. Can a factory upgrade change an existing circuit's `eval`? (measured 2026-11-16)

**Answer: no, not through any path we can see on-chain.** A factory upgrade affects only what the factory itself does: creating new processors, fees, and the `isCPU` registry that `tapeout` checks for new REF circuits. It doesn't change how an existing circuit evaluates. The one remaining caveat is that the circuit implementation has no verified source (below).

The call path for `eval` on an existing circuit, from `cast call --trace` on processor #101, circuit 3:

```
caller ──call──▶ processor proxy 0x7315…8F22 (295 bytes, no functions of its own)
                   │ staticcall implementation()  ──▶ circuit beacon 0xf70d…991C ──returns──▶ 0x977f…29B2
                   └ delegatecall eval(id, inputs) ──▶ circuit implementation 0x977f…29B2
                                                         reads the netlist from SSTORE2 data contracts (code, immutable)
```

The factory (`0x1f09…0761`) **does not appear** in the trace.

| Link in the path | Who can change it | Evidence |
|---|---|---|
| Processor proxy → which beacon | **Nobody.** The beacon address is a `PUSH32` constant in the proxy's runtime bytecode, not a storage slot | `cast code 0x7315…8F22` contains `7f…f70d1ed4f62cf3780157b0b421b7e2f45bd0991c`; the proxy has no function selectors; the ERC-1967 implementation and admin slots are 0 |
| Beacon → which implementation | **Nobody.** Beacon `owner()` = `0x0` (storage slot 0 = 0); `upgradeTo` is `onlyOwner` | `eth_call upgradeTo(...)` from the factory reverts `OwnableUnauthorizedAccount(0x1f09…0761)`, and from the factory owner reverts `OwnableUnauthorizedAccount(0xB3D8…4D3138)`. The beacon isn't a proxy (619 bytes, ERC-1967 implementation slot 0) |
| Implementation code | **Nobody.** Contract code can't change. The implementation contains **no `DELEGATECALL` and no `SELFDESTRUCT`** opcodes (`cast disassemble`: 5 `CALL`, 6 `STATICCALL`, 1 `CREATE`, 28 `SSTORE`) | |
| Processor storage (circuit → netlist pointer) | Only through the implementation's own functions: `tapeout` (appends new ids), ERC-721 transfers and approvals, `sweepFees`, `initialize`. `initialize` reverts `InvalidInitialization` for any caller, including the factory | `eth_call` from `0x…dEaD`, the factory owner and the factory |
| Netlist bytes | **Nobody.** Stored as SSTORE2 contract code | TAP-02 §6 |

**Caveats:**

- No source is verified, so "no setter for a stored netlist" rests on TAP-02 (verified BSC source of the same design) plus the selector list above. No selector looks like a setter.
- A circuit that uses **REF** also evaluates the referenced circuits. These run on processors with the same beacon, so the same answer applies.
- **ReleaseGate should pin** the beacon's `implementation()` and the processor's code hash, and refuse to publish if either changes. This is cheap insurance in case the analysis above misses something.

## 7. `eval` gas vs gate count (measured on a fork, 2026-11-16)

`packages/contracts/test/spike/EvalGas.fork.t.sol`: NAND-only 10-input/2-output circuits, taped out on a fork of processor #101. The measurement is the gas a calling contract sees for `CPU.eval(...)` (call + proxy + beacon lookup + evaluation), taking the maximum over 8 random inputs.

| Circuit | Gates | `eval` gas |
|---|---|---|
| synthetic 10 in / 2 out | 2 | 36,840 |
| synthetic 10 in / 2 out | 30 | 99,966 |
| synthetic 10 in / 2 out | 60 | 167,112 |
| synthetic 10 in / 2 out | 90 | 234,870 |
| synthetic 10 in / 2 out | 120 | 302,744 |
| existing #101/#3, 2 in / 1 out | 3 | 35,563 |
| existing #101/#2, 9 in / 5 out | 72 | 195,950 |
| existing #101/#1, 16 in / 16 out | 1,204 | 2,751,177 |

**Fit: gas ≈ 32,300 + 2,253 × gates**, linear. It predicts the 72-gate and 1,204-gate circuits within 1%; TAP-02 measured ~2,317 gas/gate on BSC.

**Estimate for the Signet policy circuit (10 inputs, 2 outputs, 60–120 NANDs): about 170,000–305,000 gas per `eval`.** At 0.02 gwei that is about 0.0000034–0.0000061 OKB per call. Inputs and outputs barely matter; gate count dominates. Even 120 gates fits easily inside `propose`/`publish`.

## 8. Containers and SiteRegistry (Spike B; fork-measured and done on mainnet 2026-11-16)

Sources:
- [TAP-10 Appendix A](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-10.md#appendix-a-access-layer-contract-interfaces) for the reads, writes and events.
- [TapeKit issue #6](https://github.com/TapeOutProtocol/TapeKit/issues/6) (a maintainer confirms SiteRegistry/DomainBinding are live on X Layer, with 7 sites).
- X Layer bytecode.
- `packages/contracts/test/spike/SpikeB.fork.t.sol`.

**Our circuit's container:** `opener.accountOf(#101 0x7315…8F22, 5)` = **`0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed`**. It is not deployed and not opened (2026-11-16).

### Spike B on mainnet: done 2026-11-16

| Item | Value |
|---|---|
| Container (ERC-6551 account of circuit #5 on processor #101) | **`0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed`**, now deployed (173 bytes) and `isOpened` = true |
| TapeKit name | `5.2.101` (label `#5@2.101`) |
| File | `signet/manifest-sample.json`, `application/json`, 422 bytes, 1 chunk, sha256 `0x9159d0b16fa1726067a740567a986494aa1778f465ab7332fb3d717591768dcc` (= `shasum -a 256` of `packages/contracts/spike-data/manifest-sample.json`) |

| # | Tx | Block | Gas used | L2 gas fee (wei) | Value (wei) |
|---|---|---|---|---|---|
| 1 | `opener.open(#101, 5)`: [`0x7125a14a…edb2`](https://www.oklink.com/xlayer/tx/0x7125a14ab3eda56b928b6831a0a61db66fbf7b651a6d8cbf8e4be7fe6991edb2) | 76,058,449 | 167,256 | 3,345,120,167,256 | 80,000,000,000,000,000 |
| 2 | `SiteRegistry.putFile(...)`: [`0xf88b8c67…bcc3`](https://www.oklink.com/xlayer/tx/0xf88b8c679358a6dbf4524fb57fd370ee78f960dd36d7db795875a3b91331bcc3) | 76,058,451 | 398,221 | 7,964,420,398,221 | 0 |
| | **Total** | | **565,477** | **11,309,540,565,477** (0.0000113 OKB) | **0.08 OKB** |

- Gas price was 20,000,001 wei and the receipts' `l1Fee` was 0.
- **Total spent: 0.080011309540565477 OKB**, equal to the dev wallet's balance drop between blocks 76,058,448 and 76,058,451 (0.128648573263571819 → 0.048637263723006342).
- The mainnet `putFile` used 398,221 total gas for 422 bytes, slightly below the fork estimate of ~436k (the fork figure was an upper estimate from calldata pricing).

**Read-back, verified two ways:**

1. `packages/contracts/script/spike/spikeB-verify.sh 0x8E2E…94Ed signet/manifest-sample.json` → size 422 = 422, sha256 matches, `status: ok (verified)`.
2. **TapeKit's own kernel** (`@tapekit/kernel` from `TapeOutProtocol/TapeKit#37c617e…&path:/kernel`, default config: built-in OKX + dRPC nodes, pinned block, store implementation check): `packages/extension/scripts/spikeB-tapekit-read.mjs`. Result at block 76,058,510:
   - `resolve("5.2.101")` → network `xlayer`, container `0x8e2e…94ed`, holder = dev wallet, `opened: true`, `paid: false`, stores accepted, status `unpaid`.
   - `manifest` → paths `["signet/manifest-sample.json"]`.
   - `getFile` → 422 bytes read, `declaredSha` = `sha256` = `0x9159…8dcc`, **`status: "ok"`, `verified: true`**.

### Container opener `0x536adD8F30f03b69f6fbF29d425A816A0dC50106` (not a proxy; 2,604 bytes)

| Function | Selector | Source | Notes |
|---|---|---|---|
| `accountOf(address circuits, uint256 tokenId) view returns (address)` | `0x0c1905e5` | TAP-10 + measured | ERC-6551 `registry.account(impl 0xAC4F…2a57, salt 0, 196, circuits, tokenId)` (trace) |
| `isOpened(address circuits, uint256 tokenId) view returns (bool)` | `0x8b508494` | TAP-10 + TapeKit `selectors.js` + measured | reads `payments.paid(container)` (trace) |
| `isDeployed(address, uint256) view returns (bool)` | `0xf13906b8` | Bytecode | |
| `FEE() view returns (uint256)` | `0xc57981b5` | Bytecode + measured | **8e16 wei = 0.08 OKB**, one time per container |
| `open(address circuits, uint256 tokenId) payable` | `0x0a0e5c9d` | Bytecode + **measured on fork** | Deploys the container and marks it paid. The circuit holder succeeds with exactly `FEE()` (net cost exactly 0.08 OKB); `FEE() − 1` reverts. Overpayment was not tested. ~177k execution gas |
| `treasury()`, `registry()`, `payments()`, `implementation()` | — | Bytecode + measured | treasury `0xE2f77062c6060503e0289c6638D1B0A7C76cBB9d`; registry = ERC-6551 registry; payments `0x13b8…4858`; implementation = container impl `0xAC4F…2a57` |

### SiteRegistry `0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6` (UUPS proxy)

- The implementation slot is `0xa85c4143d1D4A77f54b8e4ecC9E6D1418Afea45f`, which equals the TAP-10 accepted implementation.
- `owner()` = `0xE4fc10592FA8ad7c408B81e99CfC54Ef4B14283d`, so it is upgradeable by that owner.
- `CHUNK_MAX` = 24,000 bytes, `CHUNKS_MAX` = 350, `OPERATOR_TTL_MAX` = 2,592,000 s (30 days).

| Function | Selector | Source | Notes |
|---|---|---|---|
| `fileInfo(address container, string path) view returns (uint32 size, string contentType, bytes32 sha256Hash, uint40 updatedAt, uint256 chunkCount)` | `0x6c609107` | TAP-10 + measured | `chunkCount` 0 = no file |
| `read(address container, string path) view returns (bytes)` | `0xccaa7afb` | TAP-10 + measured | reverts `NoSuchFile()` |
| `readRange(address, string, uint256 offset, uint256 len) view returns (bytes)` | `0x15a4cae2` | TAP-10 | |
| `pathCount(address)`, `pathsRange(address,uint256,uint256)`, `paths(address)`, `fallbackPath(address)` | `0xb554782b`, `0xb056072c`, `0x599e4610`, `0xa76c7713` | TAP-10 + measured | |
| `isOpenedContainer(address) view returns (bool)` | `0x8951bab2` | TAP-10 + measured | |
| `canEdit(address container, address account) view returns (bool)` | `0xbcfe519c` | Bytecode + measured | true for the circuit holder only after `open` |
| `putFile(address container, string path, string contentType, bytes32 sha256Hash, bytes data)` | `0xfab2ed82` | TAP-10 + **measured on fork** | Holder or operator only (a stranger reverts). **Reverts before `open`.** Works without any DomainBinding payment. `sha256Hash` is the hash of the **whole** file, declared up front |
| `appendChunk(address container, string path, uint256 expectIndex, bytes data)` | `0xe2b51347` | TAP-10 + measured on fork | 2-chunk file read back and verified |
| `removeFile(address,string)`, `setFallback(address,string)`, `setOperator(address,address,uint256)` | `0x0a9c1871`, `0x4dc21ad0`, `0xc88cb026` | TAP-10 + bytecode | not used yet |

Error seen: `0x30cd7471` = `NotOwner()` (TAP-10 error list) when the caller can't edit.

**Display vs read:** the TapeKit kernel's `resolve` returns status `unpaid` when no DomainBinding is paid, and official shells don't display such sites (TAP-10 §6.3). But `getFile` and `SiteRegistry.read` don't check payment ([kernel.js](https://github.com/TapeOutProtocol/TapeKit/blob/37c617e7e332787c8a32a81e4d7d05a28a06c156/kernel/src/kernel.js)). **Signet's Guard can read manifests from an opened, unpaid container.** The DeWEB failover copy, which users open in a shell, would need DomainBinding paid (`monthlyFee()`, not read yet).

**Verification rule used** (TAP-10 §7.1 step 4, same as the kernel's `getFile`): declared `size` == bytes read, and `sha256(bytes)` == declared `sha256Hash`; an all-zero hash = `no-hash`. `packages/contracts/script/spike/spikeB-verify.sh` implements it. On 2026-11-16 it verified live site `1.2.245` (`index.html`, 12,702 bytes, sha256 `0x41c00f6f…a4d6`, status ok).

### Write cost (fork, 2026-11-16)

"Total" = execution gas + intrinsic (21,000 + calldata at 16 gas per non-zero byte, 4 per zero byte), for random (non-compressible) bytes. Fees assume the 0.02 gwei measured in Spike A, with L1 fee 0.

| Write | Execution gas | Total gas | Fee (OKB) |
|---|---|---|---|
| `putFile` 300 B | 378,766 | 407,166 | 0.0000081 |
| `putFile` 1,024 B | 520,065 | 559,861 | 0.0000112 |
| `putFile` 4,096 B | 1,192,653 | 1,281,481 | 0.0000256 |
| `putFile` 12,000 B | 2,923,809 | 3,138,765 | 0.0000628 |
| `putFile` 24,000 B (1 full chunk) | 5,553,770 | 5,960,162 | 0.0001192 |
| `appendChunk` 24,000 B | 5,423,134 | ≈ 5,829,500 | 0.0001166 |
| `putFile` sample manifest (422 B, JSON) | 405,472 | ≈ 435,900 | 0.0000087 |

**Cost per KB: about 241,000 gas per extra KB** (slope 12 KB → 24 KB), i.e. **≈ 0.0000048 OKB per KB** at 0.02 gwei, plus about 330,000 gas (≈ 0.0000066 OKB) fixed per file. A 5 MB full site costs about 1.24 billion gas ≈ 0.025 OKB in gas (spread over ≥ 214 transactions of ≤ 6M gas; the block gas limit is 210M). A few-KB manifest costs well under 0.0001 OKB. **The dominant cost is the one-time 0.08 OKB container opening, not storage.**

## 9. Open items

- **Immutability**: answered in §6. One residual risk: unverified source.
- `createCPU` arguments and fee unit (only needed if Signet wants its own processor).
- `eval` gas per gate on X Layer for the real ~1,024-row policy circuit (TAP-02 measured ~2,317 gas/gate on BSC).
- Sources not available: `trytotapeout/awesome-tapeout` returns 404 (2026-11-16); "Forgeout" not found by search; [tapeout.pro](https://tapeout.pro) is a read-only BSC verifier with no X Layer addresses.
