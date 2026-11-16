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
| `nextId() view returns (uint256)` | `0x61b8ce8c` | Spec ([TAP-02 §6](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-02.md#6-contract-interface-read-only-part)) + bytecode | |
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

## 6. Open items

- **Immutability.** The circuit beacon owner is `0x0`, so processor code (`eval`, `tapeout`) can't be upgraded through the beacon. The factory is **not** sealed and its owner can still upgrade it; that affects new processors and fees, not stored circuits. Before claiming "immutable" in the README, confirm that a beacon proxy has no other way to change its beacon (needs source, which isn't verified).
- `createCPU` arguments and fee unit (only needed if Signet wants its own processor).
- `eval` gas per gate on X Layer for the real ~1,024-row policy circuit (TAP-02 measured ~2,317 gas/gate on BSC).
- Sources not available: `trytotapeout/awesome-tapeout` returns 404 (2026-11-16); "Forgeout" not found by search; [tapeout.pro](https://tapeout.pro) is a read-only BSC verifier with no X Layer addresses.
