# Judge red-team audit (Phase 1, 2026-11-19)

Read-only. Each answer is TRUE / FALSE / PARTLY with evidence: a file and line, or a transaction or address. Some
evidence comes from a fork of mainnet (marked "fork"); nothing was sent to mainnet for this audit.

## 1. Does Guard call circuit #7 on mainnet at runtime, or use a local copy?

**TRUE: it calls circuit #7.** It uses the local mirror only in specific failure cases, and it isn't in anyone's
browser yet.

- **The call path.** `extension/src/background.ts:257` `decideWithCircuit(NET, facts, …)`
  → `extension/src/lib/guard-circuit.ts:22–53`.
  - Once a day it checks that the stored netlist hashes to the reviewed one and that the beacon implementation is
    unchanged (`:30–37`).
  - Then it `eth_call`s **`processor.eval(7, input)`** on **both RPCs, at one block, which must agree** (`:44`).
  - It caches the answer per input; the circuit can't change.
- **The mirror decides only when:** there's no Guard circuit on the network (`:26`), the netlist or implementation
  check fails (`:36–37`), the answer isn't one-hot (`:47`), it disagrees with the mirror (`:48`, impossible: they
  are proven equal on 512 rows), or the RPCs fail (`:53`).
- **Mainnet:** the build picks up `tapeout.guardCircuitId = 7` from `deployments/mainnet.json`
  (`extension/scripts/build.mjs`). **Caveat:** it's an `eth_call` made by the extension, not an on-chain
  transaction. Nobody runs Guard yet (it isn't in the Web Store), and its signing decisions were tested on
  staging (#7 there), not against mainnet's #7.

## 2. When does ReleaseGate use the Solidity mirror instead of circuit #6?

**TRUE: the circuit is called in every publish and unfreeze.** The mirror is used only if the circuit beacon's
implementation changes or the `eval` call fails.

- **Where it's called:**
  - `contracts/src/ReleaseGate.sol:636–650` `_policy(bits)`: if `beacon.implementation() != pinnedImplementation`,
    it emits `PolicyFallbackBeaconChanged` and uses the mirror. Otherwise it `try policyProcessor.eval(6, …)`. If
    that reverts or returns anything but 1 byte, it emits `PolicyFallbackEvalFailed` and uses the mirror.
  - `_policy` is called from `publish` (`:387`) and `unfreeze` (`:452`).
- **Proof on a mainnet fork** (2026-11-19, release #2, real approvers impersonated, 24 h warped): the publish tx's
  trace shows `0x7315…8F22::eval(6, 0x3b00) [staticcall] → 0x977f…29B2::eval(6, 0x3b00) [delegatecall]`, then
  `Published(2, 0x0bbe…d34a, tier 2)`. **0 fallback events.** Input `0x3b` = approvers A+B, short and long timelocks
  passed, tier 10.
- **On mainnet itself:** no release has been published yet, so this hasn't happened on mainnet. After release #2
  is published, its transaction will show the same `eval(6, …)` call.

## 3. Who holds circuit #5's container NFT? What can the holder do? What would moving it into the site gate take?

- **Holder:** the dev wallet `signet-dev` `0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE`
  (`ownerOf(5)` on processor `0x7315…8F22`, read 2026-11-19).
- **What the holder can do to site files** (SiteRegistry, `docs/tapeout-interfaces.md` §SiteRegistry):
  - `putFile`, `appendChunk`, `removeFile` and `setFallback` **anywhere in the shared container**: every project's
    `projects/<domain>/` and Signet's `signet/<domain>/`.
  - **`setOperator`**: revoke SignetRegistry's write access, or appoint another operator.
  - Transfer or sell the NFT.
- **What it can't do:** forge a sealed release. Every manifest and file is checked against the hashes in the
  gate's on-chain release. The **worst case is denial of service:** deleted or overwritten files make Guard
  report "could not check" (it fails open) and break the verified copy. It's also a single key that must renew
  the registry's 30-day operator grant (due **2026-12-18**).
- **Moving it into Signet's site gate:**

  | | |
  |---|---|
  | Tx | `processor.safeTransferFrom(signet-dev, siteGate 0xa3d4…4503, 5)` from signet-dev. The gate accepts TapeOut circuits (`ReleaseGate.sol:587–590`) |
  | Gas | **77,923 gas ≈ 0.0000016 OKB** (estimated against mainnet, from signet-dev; not sent) |
  | After | **Anyone** can call `siteGate.renewOperator(processor, 5)` (`:592–597`) to renew SignetRegistry's grant, so no human key needs to remember. Moving the NFT out again takes the gate's tier-11 `TransferCircuit` (3 of 3 + 24 h) |
  | Risks | (a) Hard to undo: it needs 3 of 3 approvers plus 24 h. (b) A contract holder can't `publishKey`, so container #5 could never *receive* sealed TapeSend messages (it could still send). (c) Not tested yet: SignetRegistry writing to the shared container while a gate holds it, and `renewOperator` on the shared container. **Fork-test both before doing it.** (d) The site gate's 3 approvers then control every free project's file store: right in principle, and worth stating |

## 4. Is the `signet` CLI on npm? Does every README command work for a fresh user as written?

- **On npm: FALSE.** The package is private (`packages/cli/package.json`: `"private": true`). Phase 0b built the
  stand-alone `signetguard` package (`docs/onboarding.md`). The name is free on npm but not published.
- **README commands: FALSE for a fresh user.** The README's commands (`pnpm install && pnpm verify:claims`,
  `docs/TRY-IT-LOCALLY.md`, `pnpm staging:up`, …) all need a clone of the repository, and
  **`github.com/kenil1710/signet` is private** (anonymous HTTP 404). A judge without access can't run any of them.
  With access, they work (last full run green: `verify:claims` 9/10/0 at block 76,235,142).
- **No-terminal path that works today:** `https://signet-6l4.pages.dev/app#/prove` runs the same circuit checks in
  the browser (verified against mainnet 2026-11-18: "All checks passed (0 pending deployment)").

## 5. Can a stranger protect their own site in 10 minutes by following our docs?

**FALSE today; PARTLY after release #3 and an npm publish.**

- **On a fork:** following `/start` word for word passed every step, from the CLI install to the badge
  (`test/stranger-onboarding.ts`).
- **What's missing** (`docs/onboarding.md`, "Still broken"):
  - `/start` and the CLI package aren't live (they ship in release #3);
  - the CLI isn't on npm;
  - the repository is private;
  - Guard isn't in the Web Store;
  - the domain proof isn't enforced;
  - the team must find OKB;
  - **the first release always waits 24 h** (tier 10).
- **Time:** the commands take a few minutes. Collecting three approver addresses, funding wallets and adding a
  repository secret takes longer. The landing page's "Ten minutes to set up" overstates it (§7).

## 6. Can our verified copy be opened through TapeKit's official gateway?

**Not today; it's possible with two steps and very little OKB.**

- `https://5-2-101.tapekit.org/` (circuit #5 on processor #101) answers 200 but shows "not activated":
  `DomainBinding.isContainerLive(#5's container) = false`.
- **Step 1, activate:** signet-dev, the holder, calls `DomainBinding.bind("5.2.101", 0x8E2E…94Ed, months)`
  (`0x6880…66f9`, TAP-10 §6.3).
  - Measured: `monthlyFee()` = **0** today (the contract owner can change it at any time);
    `bind(…, 1 month)` estimates **186,103 gas ≈ 0.0000037 OKB**.
  - TAP-10 says plainly that the fee only gates *display* in compliant shells.
- **Step 2, store the full copy:** today only manifests are stored. A full upload of signetguard.xyz ≈ 0.0044 OKB
  (`docs/demo/site/REPORT.md`).
- **Layout:** the shared container holds many projects under prefixes (`signet/signetguard.xyz/…`) and has no root
  `index.html` (`fallbackPath` = ""). So the copy would be at
  **`https://5-2-101.tapekit.org/signet/signetguard.xyz/`**, not at the root. Not tested: that TapeKit's gateway
  serves sub-paths with relative assets (our build uses `base: './'`, so it should).
- A project with its **own container** (files at the root) would get `https://<id>-2-<cpu>.tapekit.org/` directly.
- TapeKit checks each file against SiteRegistry's own SHA-256. Those are the same bytes Signet sealed, but TapeKit
  doesn't check Signet's manifest. Guard's "Open the verified copy" goes to Signet's gateway, which does.

## 7. Other claims a judge could prove false

| Where | Claim | Verdict | Fix |
|---|---|---|---|
| **README, JUDGES.md** | "Verify it yourself: `pnpm install && pnpm verify:claims`" | **Can't be done without repo access** (private) | Make the repo public, or lead with `/prove` |
| **Landing, teams section** | "**Ten minutes to set up.**" | **Overstated** (§5) | Phase 3: e.g. "Set up in an afternoon; first release live the next day", or measure it |
| **Landing, Free plan** | "…Guard protection for every visitor who has it, **public alerts**" | **Not built** (the watchtower alerts the team on Telegram; public posts aren't built) | Drop "public alerts", or mark it planned |
| **Landing, Pro plan** | "a watchtower that checks every minute, private alerts, the release diff view, **a verified copy hosted on X Layer**" | Marked "early access"; the verified-copy hosting isn't live | Keep "early access" and add "(planned)" to the copy |
| **README "Built on TapeOut"** | "ReleaseGate calls `eval(6, …)` inside every publish and unfreeze" | **True in code and on a fork**, not yet seen on mainnet (no publish yet) | Add release #2's publish tx once it exists |
| **Landing, proof card** | "Upgrade keys: None on the circuit. Its beacon owner is 0x0." | **True** (C5). Note: TapeOut's processor *factory* is upgradeable and unsealed (`docs/tapeout-interfaces.md`), and the DeWEB hub was upgraded on 2026-11-18. Neither changes what circuit #6 computes | Fine; THREAT_MODEL already covers TapeOut trust |
| Landing benchmark | "12 attacks. 12 stopped." / "0 false blocks, 16 clean sessions" | True **on staging** (R6, R9); the landing copy doesn't say "staging" next to the bars | Add "on a fork of X Layer" under the bars |
| Landing hero | "#42 · demoswap.xyz", "Sealed · 2 of 3 approved" | An illustration, not a real release | Fine as an illustration; could add "demo" |
| Dashboard under enforce | (product, not a claim) The dashboard calls other projects' gates, which aren't in Signet's own sealed allowlist | With signetguard.xyz in **enforce** mode, Guard would refuse those approvals (`docs/onboarding.md` #7) | Fix before switching our site to enforce |
| **Domain squatting** | (not claimed, but implied by "Sealed") Anyone can bind any unbound domain | **TRUE risk** (`docs/domain-ownership.md`) | Layer 1 before Guard ships |
