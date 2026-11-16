# Decisions

- **2026-11-16: Spike A tapes out on an existing processor (#101, `0x73153e…8F22`), not on our own.** Why: `createCPU` has no published ABI semantics; minting 2 NANDs on #101 costs 0.000662 OKB. Anyone can call `eval` on any circuit, so the processor's owner doesn't matter for ReleaseGate.
- **2026-11-16: Spike A circuit is a 2-NAND AND, not a single NAND.** Why: AND has a non-trivial truth table (only 11→1), so a wrong bit order or inverted output shows up in the test. It costs one more transistor (1e12 wei).
- **2026-11-16: ReleaseGate stores the circuit beacon's `implementation()` address at deploy and refuses to publish if it ever changes.** Why: on-chain checks show nobody can upgrade the beacon (owner `0x0`) and the processor proxy hardcodes the beacon (see `docs/tapeout-interfaces.md` §6), but the TapeOut source is unverified. Pinning the address costs one STATICCALL per publish and turns any unexpected change into a refusal instead of a silently different policy.
- **2026-11-16: One `.env` at the repo root; `packages/contracts/.env` is a symlink to it (`pnpm env:link`).** Why: Foundry reads `.env` only from its project folder, not from parent folders (tested).
