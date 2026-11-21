# TapeOut ecosystem integration: TapeSend, TapeCode, FabX (research, 2026-11-18)

Read-only research: no transaction was sent and nothing was uploaded. "Measured" means read or simulated on
X Layer mainnet today (`eth_call`, `eth_estimateGas` and `eth_getStorageAt`, on xlayerrpc.okx.com and
xlayer.drpc.org, which agreed). Costs are at today's gas price, 0.020 gwei.

## Summary

| Tool | Fit | In one line |
|---|---|---|
| **TapeSend** | **Strong for sending, weak for receiving** | A watchtower alert costs ≈ 0.0000039 OKB, and the sender can be a contract, so the watchtower's own key is worth little. But a team can only *read* sealed alerts if one of its members holds an **opened** TapeOut container in a plain wallet, and opening one costs 0.08 OKB. The hub was also upgraded **today** to an implementation no public document lists yet. |
| **TapeCode** | **Weak (workable)** | TapeCode publishes by writing files straight into the app's own container through SiteRegistry, with no release record and no approval step. Signet can seal what TapeCode uploaded, but TapeCode's one-click Upload can't stay the production publish once a gate guards the container. |
| **FabX** | **No fit** | A circuit-design and transistor-mining site (fabx.tech) with a FAB token, known only from community repos and posts. It has nothing to do with website integrity. Not worth building on. |
| DeWEB / TapeKit (what we already use) | Described **correctly but too little** in README and JUDGES.md; **out of date** in `llms.txt`; **over-claimed** in the spec | See §4. |

---

## 1. TapeSend

### 1.1 What it is (confirmed)

TapeSend is the **messaging layer of TAP-10** ("DeWEB Access and Messaging Layers"). There is one contract, the
**DeWEB hub**, at the same address on every chain. Its official client is www.tapesend.com (up, HTTP 200), with
source in TapeKit `apps/tapesend` (web, Android, iOS and Electron). TAP-14 (private channels), TAP-18 (agent task
messages) and TAP-19 (group conversations) build on it.

| Item | X Layer mainnet (196) | Source |
|---|---|---|
| Hub (ERC-1967 proxy) | `0xe61A9C7213a6Aa616C246a2B569e555B417b25ee` | TAP-10 Deployments; measured |
| Implementation listed in TAP-10 (v3) | `0xdCC57797089eBD9f26e686379A4323f353a3F9C6` | TAP-10 Deployments (read 2026-09-27) |
| **Implementation now** | **`0xf6b86f44bd039bacc8d3670971d556202d579261`**, since block **76,218,561** (**2026-11-18 07:39 UTC**), upgrade tx [`0xf6218f8a…83c5`](https://web3.okx.com/explorer/x-layer/evm/tx/0xf6218f8a3817ccb48be761f6030ac0f4f23b9850cb7b620beeb47303d3bc83c5) sent by the hub owner `0x571d…aF15` | measured (binary search of the implementation slot, then the `Upgraded` log) |
| Hub owner / sealed | `0x571d447f4f24688eC35Ccf07f1D6993655F6aF15` / **not sealed** (`isSealed()` = 0); the processor factory is not sealed either | measured |

**The new implementation (unknown).** No public document lists it: not TAP-10 (last change 2026-09-28), not
TapeKit (last commit 2026-10-22), not TAPs (2026-11-10). It keeps every TAP-10 function we would use: `send`,
`publishKey`, `revokeKey`, `keyFor`, `inboxCount`, `inboxPage` and `outboxPage` are all present, and
`MAX_PAYLOAD()` = 16000, `MAX_PAGE()` = 200, `SUITE_X25519()` = 1. Three selectors that aren't in the public
signature database were added; one, `circuitCodehash()`, was removed, and in its place a new no-argument function
returns `0xf5c0b3bf…dc6c`. I don't know what changed. Under TAP-10 §13.8 a compliant client **MUST NOT send**
through an implementation that isn't listed (`hub-changed`). So the official TapeSend app may refuse to send until
it's updated, even though the contract itself still accepts our sends (measured below). **Ask the TapeOut team
before building.**

### 1.2 How a message is sent and read (confirmed, TAP-10 §12–§20)

- **Endpoint:** a 32-byte ID made of `uint32(0) ‖ uint64(chainId) ‖ container`. Messages go **from a container
  to a container**.
- **Send:** `send(address circuits, uint256 tokenId, bytes32 to, bytes32 ref, bytes payload)` (`0xa181b579`).
  - The caller must be the **current holder** (`ownerOf(#ID) == msg.sender`) of a circuit on a registered
    processor, and that circuit's container must be **opened** (paid).
  - **Contracts may send**, but the TapeSend client marks such messages "indirect".
  - The recipient needn't be opened.
  - The payload is at most 16,000 bytes.
  - The hub is **non-payable**: there are no protocol fees, only gas. Measured: a wallet that isn't the holder gets
    `NotHolder` (`0x7623fb52`).
- **Storage:** each `send` appends an inbox entry for `to` and an outbox entry for `from` (sender, block, time,
  digest). The **payload exists only in the `Sent` event**, so readers fetch it with `eth_getLogs` and check it
  against the digest. No indexer is needed.
- **Encryption (suite 1):** X25519 + HKDF-SHA256 + XChaCha20-Poly1305.
  - A sealed payload is `TS 0x02 0x01 ‖ ephemeral key ‖ nonce ‖ key commitment ‖ 1–16 key slots ‖ ciphertext`;
    a public payload is `TS 0x02 0x00 ‖ JSON`.
  - The content is JSON: `{v:1, kind:"message", subject, body, ts, attachments}`.
- **Keys:** the recipient's X25519 key comes from a **wallet signature over a fixed text**, so it's never stored
  anywhere. It's published with `publishKey` (`0x23e0bbc6`), which **refuses contract holders** (`ContractHolder`).
  `keyFor` reports `usable = true` only while the holder is a plain account.
- **Sealing needs no sender key:** the sender only needs the recipient's usable key. Adding a slot for its own
  key is optional.
- **Reading:** a client reads `inboxCount`/`inboxPage(endpoint)` under two-node agreement, then fetches each
  payload from the `Sent` log. The TapeSend app shows the inbox of **containers that the connected wallet holds**
  (`apps/tapesend/src/data/tapesend.ts`: `savedIdentities(wallet)`, `unlock`). Metadata (who, when, size) is
  public forever; only sealed content is private.

### 1.3 Measured cost per alert

Simulated with `eth_estimateGas` from the dev wallet, which holds circuit **#5** (Signet's opened shared
container). The recipient was the container of circuit #7. Nothing was signed. Both RPCs gave the same numbers.

| Payload | Gas | OKB at 0.020 gwei |
|---|---:|---:|
| Public alert (456 B: a 452-byte JSON body) | 193,478 | **0.0000039** |
| Sealed to the team (617 B, 1 key slot) | 197,456 | **0.0000039** |
| Sealed to the team + Signet's copy (673 B, 2 slots) | 198,951 | 0.0000040 |
| Maximum payload (16,000 B) | 408,621 | 0.0000082 |
| `publishKey` (the team, once, from their own wallet) | 135,957 | 0.0000027 |

So 1,000 alerts cost about **0.004 OKB**. The sender pays the gas, which means **Signet pays** from the
watchtower's gas wallet.

### 1.4 Design: watchtower → team inbox

**Who sends.** Only the holder of an opened container can send. Signet has exactly one opened container,
circuit #5. It's held by the dev wallet, and it's also the file store for every free-tier project. The options:

| Option | How | One-time cost | Watchtower key worth stealing? |
|---|---|---|---|
| A. Dev wallet sends | The server holds the signet-dev key | 0 | **Yes, very.** At the time it held circuits #5, #6 and #7, renewed the file operator, and was the site gate's guardian (all three circuits are in the site gate and the guardian role is gone since 2026-11-21). **Rejected.** |
| **B. Relay contract holds circuit #5** | `SignetAlerts` holds the #5 NFT. A hot "watchtower" key can only call `alert(to, ref, payload)`, which calls `hub.send(P, 5, …)`, with a daily rate limit. An admin (signet-dev, later a multisig) can rotate that key, renew the SiteRegistry operator grant for SignetRegistry, and take the NFT back. | deploy ≈ 0.6–0.8M gas ≈ **0.000012–0.000016 OKB**; NFT transfer ≈ 0.000002; operator re-grant 136,055 gas ≈ **0.0000027** (measured on the earlier deploy). Total **≈ 0.00002 OKB** | **Low.** A thief can send spam or fake alerts from Signet's identity until the admin rotates the key. The thief can't move the NFT or touch files. Fake alerts could carry phishing links, so alerts would carry **no links**: they name the dashboard, and the reader types it. |
| C. A separate alerts container | Same relay, but holding circuit **#7**'s container (or a new tiny circuit). Circuit #5, the file store, isn't touched. | **0.08 OKB** to open (`FEE()`, measured) + ≈ 0.00002 | Low |

**Recommendation: C if you can fund 0.08 OKB** (signet-dev has 0.0445 OKB, so it can't today). **Otherwise B**,
after a fork test proves two unknowns:
1. that SignetRegistry's operator grant on the shared container survives the NFT transfer, or can be re-granted
   by the relay (`setOperator` worked for a contract holder in our 2026-11-16 fork test);
2. that `hub.send` works with a contract as holder. TAP-10 says it does, but it isn't measured.

**Which events alert.** All of these are already detected or readable on-chain: "site doesn't match its seal"
(watchtower, confirmed on two loads), "new tier 10 / tier 11 proposal" (the gate's `Proposed` event, tier
computed on-chain), "gate frozen" / "unfrozen" / "release revoked" (gate events). Each alert is one `send`, and
`ref` = keccak(domain, release, kind) groups the thread.

**Where a team's inbox is recorded.** The gate and SignetRegistry are immutable and have no field for it. So the
mapping (domain → the team's TapeSend endpoint) lives in the watchtower's config. A team opts in on the dashboard
by signing a message with an approver key, and the dashboard shows that opt-in. No transaction is needed.

**How a team reads alerts.**
- **Sealed alerts (private):** a team member must hold an **opened** container in a **plain wallet**, then open
  www.tapesend.com, connect that wallet and sign the key text once (`publishKey`, ≈ 0.0000027 OKB, paid by the
  team).
  - A team that doesn't already have a container needs a circuit (≈ 0.002 OKB) plus opening (**0.08 OKB**). That's
    a real barrier, so it fits **TapeOut-native teams**.
  - A **Pro** team's own site container won't do: once its gate holds that NFT, `publishKey` refuses the contract
    holder.
- **Public alerts:** `to` needn't be opened or have a key, so the watchtower can address any container. They're
  readable by anyone from the hub, and Signet's dashboard can list them for a domain. Whether the TapeSend app
  shows an inbox for an unopened container is **unknown** (not tested). Most alert content is public anyway
  (proposals and freezes are on-chain events; a hijack is posted publicly by design).
- **Telegram stays** as the default channel for teams without a container. TapeSend is the on-chain,
  verifiable channel.

### 1.5 Answers to the four questions

| Question | Answer |
|---|---|
| Exact OKB per alert | **≈ 0.0000039 OKB** (193k–199k gas at 0.020 gwei, for a 456–673-byte alert); at most 0.0000082 for a 16 KB payload. No protocol fee. |
| Who pays | The sender's wallet, i.e. **Signet** (the watchtower's gas wallet). The team pays only its one-time `publishKey` (≈ 0.0000027 OKB) and, if it has none yet, a container (≈ 0.082 OKB). |
| Can the watchtower send without a key worth stealing? | **Yes, with a relay contract holding the container NFT** (options B/C). The hot key can only send rate-limited alerts. TAP-10 explicitly allows contract holders to `send`. The catch: clients label such messages "indirect". |
| How a team reads alerts | On **www.tapesend.com** (or the app), connected with the wallet that holds their opened container, after unlocking the key once. Public alerts can also be listed by Signet's dashboard straight from the hub. |

---

## 2. TapeCode

### 2.1 What is confirmed

There are **no official TapeCode docs** that I could find: nothing in the TapeOutProtocol GitHub org, and no
documentation site. It's mentioned as a TapeOut tool ([KuCoin insight on DeWEB](https://www.kucoin.com/news/insight/TAP/6aedc8fdabae5e0007c5353d)),
and one hackathon project documents using it ([PeekBox README](https://github.com/ivanzhao0315-arch/peekbox):
"uploaded with TapeCode"; "TapeCode, 'Upload', same container (only changed files are sent)").

I checked PeekBox's site on chain (container `0x3F79e17c3D0E4622F94595B50fC0D5f41DA1919B`, circuit #1 of
processor #339 `0xb460…eFb6`, live at `1-2-339.tapekit.org`):

- **The publish is plain SiteRegistry writes into the app's own container.**
  - `index.html` was written by [`0xf7f864c0…6d8c`](https://web3.okx.com/explorer/x-layer/evm/tx/0xf7f864c0b558d63c5d3ddaa357e6973c89db7392bfd02186c21c2c1df3476d8c), a `putFile` (`0xfab2ed82`) of 2,369,393 gas.
  - `app.js` (44 KB) was written in chunks; one piece was [`0xfa454808…ee62`](https://web3.okx.com/explorer/x-layer/evm/tx/0xfa4548087458b533df6619e925626452c7bb20c5781b1b7a0d5530ac9ff5ee62), an `appendChunk` (`0xe2b51347`) of 4,501,833 gas.
  - Both were sent **directly to SiteRegistry**, so there's no TapeCode contract in between.
- **There is no release record.** Files are replaced in place, path by path (10 paths, fallback `index.html`). No
  manifest, approval, timelock or version is stored; the only record is each file's `sha256`, size and
  `updatedAt`.
- **The uploader wasn't the holder.** The writes came from `0x19b4…5695`. The circuit holder is `0xAAB5…a9b1`.
  Today `canEdit(container, uploader)` is **false** and `canEdit(container, holder)` is true.

**Inferred, not confirmed:** TapeCode uploads with a **temporary SiteRegistry operator key**. The holder grants it
with `setOperator`, which lasts at most 30 days, and it has expired here.

**Unknown:**
- TapeCode's URL and its docs;
- whether it can export the built files;
- whether it can upload under a path prefix, or into a container whose holder is a contract;
- whether it calls `setOperator` itself.

### 2.2 Design: sealing a TapeCode-built app

The security point of Signet is that **nothing reaches production without approvals**. TapeCode's flow is the
opposite: whoever holds the upload key publishes immediately, and a stolen TapeCode session key is the same as a
hijack. So:

1. **TapeCode keeps building and uploads to a *staging* container.** That's the team's own container, held by a
   team wallet; TapeCode works unchanged.
2. **`signet seal --from-container <staging container>`** (new, about 0.5 day). It reads the files straight from
   SiteRegistry (`paths` + `read`), so TapeCode needn't export anything and the bytes are exactly what TapeCode
   uploaded. It then hashes them, extracts the allowlist and origins as today, and writes the seal.
3. **Propose → approvals → publish on the gate.** The risk tier is computed on-chain, and Diff Guard works as now.
4. **The approved files are copied into production by SignetRegistry.**
   - Production is either `projects/<domain>/` in Signet's shared container (free tier), or a production container
     whose NFT the **gate** holds (`bindingOf` returns "not protected" unless the gate is the holder).
   - The copy is the existing `signet upload`, which also re-checks every hash. Only approved files can be written;
     TapeCode's key can't write to production.
5. **Guard and the watchtower check production** as they do today. Users open the production name, not the staging
   one.

**Rating: weak, but workable.** It's not impossible: TapeCode stays the editor and its uploads become the review
input. It is hard to keep "publish to DeWEB in one click" *and* require approval. TapeCode would need a "propose"
button that calls `signet propose` instead of writing to production. That would be a small integration on
TapeCode's side, and we'd need to ask them.

**Cost per release:** the copy pays storage gas again, about 241,000 gas per KB plus about 330,000 per file
(measured in Spike B), i.e. **≈ 0.0000048 OKB/KB + 0.0000066 OKB per file**. For an app like PeekBox, at an
estimated 150 KB in 10 files, that's **≈ 0.0008 OKB per release**, plus about 0.00001 OKB for propose, approvals and
publish. Setting up a gate once costs ≈ 0.000012 OKB (`createGate` measured at 576,686 gas) + 0.0000009 (commit).
With a team's own production container, add the NFT transfer to the gate (≈ 0.000002) and `grantOperator`
(≈ 0.0000027).

---

## 3. FabX

**What I found:**
- [fabx.tech](https://fabx.tech) is live. Its title is "Fab X | On-chain Circuits & Proof of Design", and its
  description reads "Design circuits with NAND and LATCH on X Layer… how circuit designs become miners… transistor
  and circuit markets".
- Community repos describe a **transistor-mining** workflow (tapeout, then arm / start / claim / stop / reclaim):
  [fabx-minter](https://github.com/854771076/fabx-minter) and
  [fabx-miner-desk](https://github.com/runesleo/fabx-miner-desk).
- A [KuCoin post](https://www.kucoin.com/news/insight/UP/6ae6219cbbcb52000745546c) calls FAB "the first community
  mining protocol on TapeOut".

**What I couldn't find:** official documentation, contract addresses from an official source, or who runs it.
I won't guess at those.

**Fit: none.** It's about mining with circuits and circuit markets, not website integrity or alerts. The only
conceivable link (listing Signet's circuits #6 and #7 on its market) adds nothing for users or judges.

---

## 4. Is our existing DeWEB / TapeKit use described correctly?

**What we actually use (all confirmed):**
- **Processor #101** circuits: **#6** (release policy, mainnet), **#7** (Guard decision, mainnet), and **#5**,
  whose container is Signet's **opened** file store.
- **SiteRegistry** (the DeWEB access layer's storage): a test file was written and read back on mainnet
  (C6, Spike B). SignetRegistry is its **operator** for 30 days, until 2026-12-18. No project files are on mainnet
  yet.
- **TapeKit:**
  - Guard, the gateway and /prove use **TAP-10 §7.1's verification rule** and two-node agreement, re-implemented
    with direct `eth_call`s, not the kernel (decision 2026-11-17).
  - The kernel itself is used only in Spike B's read script.
  - The gateway **reuses TapeKit's service-worker gateway design** but is our own code.
- **Not used:** TapeSend, TapeCode, uploading Signet's site to DeWEB (it's on Cloudflare Pages), and the verified
  copy at a `*.tapekit.org` address.

| Document | Verdict | What to fix |
|---|---|---|
| README.md | Correct, but it **never mentions** DeWEB, SiteRegistry or TapeKit, which undersells real integration | Add a three-line "Built on TapeOut" section: processor #101 circuits #6/#7, circuit #5's container + SiteRegistry as the sealed-file store, TapeKit's verification rule and gateway design. |
| JUDGES.md | Correct ("Signet's container stores what we say") but just as silent | The same three lines. |
| **llms.txt** | **Out of date / wrong:** line 5 says Signet's contracts and the Guard circuit are "planned… not sent" | Update to the mainnet deployment (registry, factory, site gate, circuit #7; `docs/mainnet.md`). |
| docs/signet-spec.md | **Over-claims** in many places: "Alerts via TapeSend" (l.49, 86, 90, 229, 243, 256, 367), "Dashboard (on DeWEB)" (l.50, 408), "verified copy on DeWEB via TapeKit" (l.82, 245), "Guard reads the same manifest through TapeKit" (l.90), "TapeSend for alerts / dashboard hosted on DeWEB" in the judging table (l.299, 314, 369) | Mark these as planned, or change them to what's built: Telegram alerts; the site on Cloudflare Pages; our own gateway on TapeKit's design; direct `eth_call`s with TapeKit's rule. |

---

## 5. Build plan (nothing built yet)

| # | Work | Time | Mainnet OKB |
|---|---|---|---|
| 0 | Ask the TapeOut team: is hub implementation `0xf6b8…9261` accepted (and when will TAP-10 or TapeKit list it)? Can the TapeSend app read the inbox of an unopened container? Is there a TapeCode "propose" hook or file export? | 0.5 h to ask | 0 |
| 1 | Fix the descriptions (§4): README and JUDGES "Built on TapeOut", llms.txt status, spec over-claims | 1 h | 0 |
| 2 | `SignetAlerts` relay contract (holds the NFT; hot key can only `alert`; rate limit; admin rotates the key, renews the operator, withdraws the NFT) + Foundry tests + a fork test of `hub.send` through it and of the operator grant after the transfer | 1 day | — |
| 3 | Watchtower TapeSend channel: TAP-10 payload builder (public + sealed; @noble/curves X25519, @noble/hashes HKDF, @noble/ciphers XChaCha20-Poly1305), `keyFor` under two-node agreement, TAP-10 test vectors, no links in alert text | 1–1.5 days | — |
| 4 | Dashboard: TapeSend opt-in (an approver signs the endpoint), and an "Alerts sent" list read from the hub's outbox | 0.5–1 day | 0 |
| 5 | End-to-end on the staging fork (the fork has the hub): hijack → alert in a container inbox, opened with a key derived as the TapeSend app does | 0.5 day | 0 |
| 6 | Mainnet: deploy the relay and move the NFT (option B), or also open #7's container (option C). Needs your yes. | 0.5 h | **B: ≈ 0.00002 OKB**; **C: ≈ 0.08002 OKB** |
| 7 | Mainnet demo: one real sealed alert to an approver's container (#5's holder can publish a key via tapesend.com) | 0.5 h | ≈ 0.0000039 per alert + 0.0000027 for `publishKey` |
| 8 | TapeCode: `signet seal --from-container`, then the staging → production flow (§2.2), demoed on the fork with a TapeCode-style upload (plain `putFile`) | 1 day | per release ≈ 0.0000048 OKB/KB + 0.0000066/file (≈ 0.0008 for a 150 KB / 10-file app) |

**Total build time:** ≈ 4–5 days for TapeSend (steps 2–7) plus 1 day for TapeCode (step 8). Mainnet spend for the
TapeSend integration is **≈ 0.00003 OKB** with option B, or ≈ 0.08 OKB with option C.

## Sources

- [TAP-10: DeWEB Access and Messaging Layers](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-10.md):
  §12–§20 (TapeSend), Deployments, Security Considerations
- [TAP-14 Private Channels](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-14.md),
  [TAP-18 Agent Mandates and Task Messages](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-18.md),
  [TAP-19 Group Conversations](https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-19.md)
- [TapeSend app source: TapeKit `apps/tapesend`](https://github.com/TapeOutProtocol/TapeKit/tree/main/apps/tapesend) (commit `37c617e`) and [www.tapesend.com](https://www.tapesend.com)
- Hub upgrade on X Layer: [tx `0xf6218f8a…83c5`](https://web3.okx.com/explorer/x-layer/evm/tx/0xf6218f8a3817ccb48be761f6030ac0f4f23b9850cb7b620beeb47303d3bc83c5)
- [PeekBox README (TapeCode upload)](https://github.com/ivanzhao0315-arch/peekbox); its TapeCode writes:
  [`0xf7f864c0…6d8c`](https://web3.okx.com/explorer/x-layer/evm/tx/0xf7f864c0b558d63c5d3ddaa357e6973c89db7392bfd02186c21c2c1df3476d8c),
  [`0xfa454808…ee62`](https://web3.okx.com/explorer/x-layer/evm/tx/0xfa4548087458b533df6619e925626452c7bb20c5781b1b7a0d5530ac9ff5ee62)
- [KuCoin insight: DeWEB, TapeKit and TapeCode](https://www.kucoin.com/news/insight/TAP/6aedc8fdabae5e0007c5353d)
- FabX: [fabx.tech](https://fabx.tech), [fabx-minter](https://github.com/854771076/fabx-minter),
  [fabx-miner-desk](https://github.com/runesleo/fabx-miner-desk), [KuCoin post on FAB](https://www.kucoin.com/news/insight/UP/6ae6219cbbcb52000745546c)
- [X Layer Build X / TapeOut Accelerate](https://web3.okx.com/xlayer/build-x-series) (projects must use TapeOut
  circuits, contracts or on-chain data on X Layer)
- Our own measurements: `docs/tapeout-interfaces.md` (Spike B storage costs, container `FEE()`, operator rules)
