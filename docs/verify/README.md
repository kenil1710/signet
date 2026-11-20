# Verifying Signet's contracts on OKX Explorer (manual, free, no wallet)

Everything in this folder was checked against X Layer mainnet before it was written: `python3 docs/verify/check.py`.
Each standard-JSON file, compiled with plain solc 0.8.24, gives **exactly** the on-chain code (metadata hash
included). Each constructor-arguments file is exactly what follows the creation code in the deploy transaction.

**Do the contracts in this order: 1 → 2 → 3 → 4.** The site gate (4) is a proxy of the implementation (3).

## The same for every contract

| Field | Value |
|---|---|
| Network | X Layer mainnet (chain 196) |
| Compiler type | **Solidity (Standard-Json-Input)** (first choice). Fallback: *Solidity (Single file)* with the `.flattened.sol` file |
| Compiler version | **v0.8.24+commit.e11b9ed9** |
| Optimization | **Yes**, runs **200** (already inside the JSON file; set it on the form too if it asks) |
| EVM version | **cancun** (already inside the JSON file; pick `cancun` if the form asks, not "default") |
| via-IR | No |
| License | **MIT License (MIT)** (every source file is `SPDX-License-Identifier: MIT`) |
| Libraries | none |

**Constructor arguments** are ABI-encoded hex. Paste them **without** `0x` (Etherscan-style forms want that). If
the form says the value is invalid, try again with `0x` in front.

I couldn't see the live OKX Explorer form; it's built in the browser, and OKX's docs don't list its fields. The
field names below are the usual Etherscan-style ones that OKX Explorer uses. If a label differs, match by meaning;
the values above don't change. OKX's API docs confirm it accepts both `solidity-standard-json-input` and
`solidity-single-file`.

---

## 1. SignetRegistry: `0x98dB5B6B1545D0fb374da40a02045B93398E0589`

1. Open **https://web3.okx.com/explorer/x-layer/evm/address/0x98dB5B6B1545D0fb374da40a02045B93398E0589**, or go to
   OKX Explorer, choose **X Layer**, and paste the address into the search box.
2. Open the **Contract** tab and click **Verify and Publish** (or "Verify contract").
3. Fill in the form:
   - Contract address: `0x98dB5B6B1545D0fb374da40a02045B93398E0589` (usually filled in already)
   - Compiler type: **Solidity (Standard-Json-Input)**
   - Compiler version: **v0.8.24+commit.e11b9ed9**
   - License: **MIT**
4. Next page: upload **`SignetRegistry.standard-input.json`**.
   - If it asks for the contract name or path, enter **`src/SignetRegistry.sol:SignetRegistry`** (or just
     `SignetRegistry`).
5. Constructor arguments (192 bytes, from `SignetRegistry.constructor-args.txt`):
   ```
   000000000000000000000000d6efb7adcc9c83dc4924ad56f6a8e4e969b9adb6000000000000000000000000536add8f30f03b69f6fbf29d425a816a0dc5010600000000000000000000000073153e5fd2acac604d49d6ca9fea27b750718f220000000000000000000000000000000000000000000000000000000000000005000000000000000000000000c5e12ffe9d5be7085441bd955724a6faff9f7986000000000000000000000000a3d4dfb5fb47d2ccf9b4a0a0fcc64ac3ffef4503
   ```
   These decode to: SiteRegistry `0xd6EF…ADB6`, ContainerOpener `0x536a…0106`, processor `0x7315…8F22`,
   circuit **5**, factory `0xc5e1…7986`, Signet site gate `0xa3d4…4503`.
6. Pass the captcha if there is one, then click **Verify and Publish**. Expected result: success, with the source
   showing under the Contract tab.

## 2. SignetFactory: `0xc5e12ffe9D5bE7085441bD955724A6FAff9f7986`

1. Open **https://web3.okx.com/explorer/x-layer/evm/address/0xc5e12ffe9D5bE7085441bD955724A6FAff9f7986**, then
   **Contract** → **Verify and Publish**.
2. Compiler type **Solidity (Standard-Json-Input)**, version **v0.8.24+commit.e11b9ed9**, license **MIT**.
3. Upload **`SignetFactory.standard-input.json`**. Contract name: **`src/SignetFactory.sol:SignetFactory`**.
   - The file also contains ReleaseGate.sol and PolicyMirror.sol: the factory creates the implementation in its
     constructor.
4. Constructor arguments (224 bytes, from `SignetFactory.constructor-args.txt`):
   ```
   00000000000000000000000098db5b6b1545d0fb374da40a02045b93398e058900000000000000000000000073153e5fd2acac604d49d6ca9fea27b750718f2200000000000000000000000000000000000000000000000000000000000000061a2e19870a19f653af4bddf049e1070461b7466577640a4cb341a579838b20db57aa306fd0be97087da3534e03398f5ff4efd533b5be4e45a405ce86fa6717d5000000000000000000000000f70d1ed4f62cf3780157b0b421b7e2f45bd0991c000000000000000000000000977f217887e085d298cb3819cdad5a0ee35f29b2
   ```
   These decode to: registry `0x98dB…0589`, policy processor `0x7315…8F22`, policy circuit **6**, netlist
   sha256 `0x1a2e…20db`, processor code hash `0x57aa…17d5`, circuit beacon `0xf70d…991C`, expected
   implementation `0x977f…29B2`.
5. **Verify and Publish**.

## 3. ReleaseGate implementation: `0xD14697C1dFEAdA3A117Ff8CD5358c80743453B3D`

1. Open **https://web3.okx.com/explorer/x-layer/evm/address/0xD14697C1dFEAdA3A117Ff8CD5358c80743453B3D**, then
   **Contract** → **Verify and Publish**.
2. Compiler type **Solidity (Standard-Json-Input)**, version **v0.8.24+commit.e11b9ed9**, license **MIT**.
3. Upload **`ReleaseGate.standard-input.json`**. Contract name: **`src/ReleaseGate.sol:ReleaseGate`**.
4. Constructor arguments: **leave empty**. Its constructor takes none, and the factory created it with
   `new ReleaseGate()` inside transaction 2.
   - Some explorers can't find a "creation transaction" for a contract created by another contract. If the form
     asks for one, use the factory's deploy tx
     `0x92616ab4773a6bdc368420496b724a1d9efcb927b5ee6b0425b7e08dfaedc817`.
5. **Verify and Publish**.

## 4. Signet's site gate (proxy): `0xa3d4dfb5fB47D2CcF9b4a0a0fcC64Ac3fFef4503`

This address has no Solidity source of its own. Its code is the 45-byte EIP-1167 minimal proxy
`363d3d373d3d3d363d73 d14697c1…53b3d 5af43d82803e903d91602b57fd5bf3`, which forwards every call to the
implementation (3). The factory creates one per project (`SignetFactory._clone`). So "verifying" it means linking
it to the verified implementation:

1. Finish step 3 first.
2. Open **https://web3.okx.com/explorer/x-layer/evm/address/0xa3d4dfb5fB47D2CcF9b4a0a0fcC64Ac3fFef4503**, then the
   **Contract** tab.
3. Many explorers recognise EIP-1167 clones on their own once the implementation is verified, and show "Minimal
   Proxy Contract for 0xD146…3B3D" with the implementation's code and ABI. If yours shows that, you're done.
4. If not, look for **More options → Is this a proxy?** (or "Proxy contract verification") and click **Verify**.
   - If it asks for the implementation, enter `0xD14697C1dFEAdA3A117Ff8CD5358c80743453B3D`.
   - Then **Save**. The Contract tab should get **Read as Proxy / Write as Proxy**.
5. If there's no proxy option: don't upload anything for this address. Its bytecode, shown above, proves it runs
   the implementation's verified code.

---

## If something fails

| Message | What to do |
|---|---|
| Bytecode doesn't match | Check the compiler version is exactly `v0.8.24+commit.e11b9ed9`, EVM **cancun**, optimizer **200**. If the form overrides the JSON settings, set them to match. |
| Constructor arguments invalid | Paste the file's line without `0x`; if that fails, with `0x`. Don't add spaces or line breaks. |
| Standard-JSON not offered | Use **Solidity (Single file)** with `<Name>.flattened.sol`, same version, optimizer 200, EVM cancun, same constructor arguments, contract name `SignetRegistry` / `SignetFactory` / `ReleaseGate`. The flattened file reproduces the code exactly but not the metadata hash, so the explorer may report it as a partial match. |
| "Already verified" | It's done; nothing to do. |

## Files

| File | For |
|---|---|
| `SignetRegistry.standard-input.json`, `SignetRegistry.constructor-args.txt`, `SignetRegistry.flattened.sol` | contract 1 |
| `SignetFactory.standard-input.json`, `SignetFactory.constructor-args.txt`, `SignetFactory.flattened.sol` | contract 2 |
| `ReleaseGate.standard-input.json`, `ReleaseGate.flattened.sol` | contract 3 (no constructor arguments) |
| `check.py` | re-checks every file against mainnet (read-only) |
