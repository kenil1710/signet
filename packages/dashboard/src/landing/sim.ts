// The landing page's policy simulator. Its answers are NOT computed by page code: they are looked up in the truth
// table of circuit #6 (packages/circuit/artifacts/policy.json, the table `pnpm verify:claims` checks against
// mainnet on all 512 inputs). The page only maps its controls to the 9 input bits and explains the answer.
//
// Input bits, in circuit order: a0 a1 a2 tS tL r1 r0 f e  (bit i of the row number = input i)
// Output byte: bit 0 PUBLISH, bit 1 UNFREEZE.

export const INPUT_NAMES = ['a0', 'a1', 'a2', 'tS', 'tL', 'r1', 'r0', 'f', 'e'] as const;

export interface SimState { a: boolean; b: boolean; c: boolean; tier: 0 | 1 | 2 | 3; wait: 0 | 1 | 2; f: boolean; e: boolean }
export interface SimResult { row: number; bits: boolean[]; pub: boolean; unf: boolean; why: string }

/// `expected` is the artifact's `expected` field: 512 output bytes, row n = packed inputs n.
export function makeSim(expected: string) {
  const table = expected.replace(/^0x/, '');
  if (table.length !== 1024) throw new Error('the policy truth table must have 512 rows');
  const lookup = (row: number) => parseInt(table.slice(2 * row, 2 * row + 2), 16);

  /// The controls as circuit inputs. The tier buttons are r1 r0 = 00 code only, 01 new origin, 10 new contract,
  /// 11 admin. The wait slider: under 1 h, 1 h+ (tS), 24 h+ (tS and tL: a day is also more than an hour).
  function bitsOf(s: SimState): boolean[] {
    return [s.a, s.b, s.c, s.wait >= 1, s.wait >= 2, (s.tier & 2) !== 0, (s.tier & 1) !== 0, s.f, s.e];
  }

  function run(s: SimState): SimResult {
    const bits = bitsOf(s);
    const row = bits.reduce((n, b, i) => n | (b ? 1 << i : 0), 0);
    const out = lookup(row);
    const pub = (out & 1) === 1;
    const unf = (out & 2) === 2;
    return { row, bits, pub, unf, why: why(s, pub, unf) };
  }

  /// Words for what the circuit answered. They describe the answer; they never decide it.
  function why(s: SimState, pub: boolean, unf: boolean): string {
    const n = Number(s.a) + Number(s.b) + Number(s.c);
    const tS = s.wait >= 1;
    const tL = s.wait >= 2;
    if (s.f) return unf ? 'Two of three approvers can unfreeze. Publishing waits until then.' : 'Frozen. Nothing publishes until two of three approvers unfreeze.';
    switch (s.tier) {
      case 0:
        if (pub) return n === 3 && s.e && !tS ? 'Emergency path: all three approved, so no wait.' : 'Code-only change: one approval and an hour is enough.';
        return n < 1 ? 'Needs at least one approver.' : 'Approved, but the 1-hour wait has not passed.';
      case 1:
        if (pub) return 'New origin: two approvals and an hour. Published.';
        if (n < 2) return 'A new origin needs two approvers.';
        if (n === 2) return 'Two approved. Waiting out the hour.';
        return s.e ? 'A new origin has no emergency path. Waiting out the hour.' : 'All three approved. Waiting out the hour.';
      case 2:
        if (pub) return tL ? 'New contract: two approvals and a full day. Published.' : 'Emergency path: all three approved.';
        return n < 2 ? 'A new contract needs two approvers.' : 'A new contract waits 24 hours, unless all three use the emergency path.';
      default:
        return pub ? 'Admin change: all three approvers and 24 hours. Published.' : 'Admin changes need all three approvers and 24 hours. No shortcut.';
    }
  }

  return { run, bitsOf, lookup };
}
