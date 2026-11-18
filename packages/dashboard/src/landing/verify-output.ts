// Lines copied verbatim from a real `pnpm verify:claims` run (block in the header line), for the landing page's
// proof terminal. Regenerate after a new run; never edit a line by hand. "…" marks lines left out.
export const VERIFY_OUTPUT: [kind: 'cmd' | 'dim' | 'gap' | 'ok' | 'pend', text: string][] = [
 [
  "cmd",
  "$ pnpm verify:claims"
 ],
 [
  "dim",
  "Signet claims, checked against X Layer mainnet at block 76226970 on https://xlayerrpc.okx.com and https://xlayer.drpc.org (read-only)"
 ],
 [
  "gap",
  "…"
 ],
 [
  "ok",
  "PASS    C1 [mainnet] The release policy is TapeOut circuit #6 on processor #101 (X Layer mainnet): 9 inputs, 2 outputs, 34 NAND gates, no state"
 ],
 [
  "ok",
  "PASS    C3 [mainnet] Circuit #6 gives the published truth table (docs/policy-truth-table.md) on all 512 inputs"
 ],
 [
  "ok",
  "PASS    C5 [mainnet] A taped-out circuit's behavior can't be upgraded through its beacon: the circuit beacon's owner is 0x0, it points at the implementation Signet pins, and the processor's code is the pinned proxy (TapeOut's source is not verified; this is what can be checked on-chain)"
 ],
 [
  "ok",
  "PASS    C8 [mainnet] Signet's contracts are on mainnet: SignetRegistry (with its enumerable domain list), SignetFactory, the ReleaseGate implementation and Signet's own site gate"
 ],
 [
  "ok",
  "PASS    C9 [mainnet] The Guard decision circuit is on mainnet and gives the published truth table (docs/guard-truth-table.md) on all 512 inputs"
 ],
 [
  "gap",
  "…"
 ],
 [
  "ok",
  "ALL CHECKS PASSED (9 on mainnet, 10 from the repo, 0 pending deployment)"
 ]
];
