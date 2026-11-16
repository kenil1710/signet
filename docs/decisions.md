# Decisions

- **2026-11-16: Spike A tapes out on an existing processor (#101, `0x73153e…8F22`), not on our own.** Why: `createCPU` has no published ABI semantics; minting 2 NANDs on #101 costs 0.000662 OKB. Anyone can call `eval` on any circuit, so the processor's owner doesn't matter for ReleaseGate.
- **2026-11-16: Spike A circuit is a 2-NAND AND, not a single NAND.** Why: AND has a non-trivial truth table (only 11→1), so a wrong bit order or inverted output shows up in the test. It costs one more transistor (1e12 wei).
