// Gate-level Signet release-policy circuit (NAND only, combinational, 9 inputs, 2 outputs).
//
// Derivation from the spec table (checked exhaustively against src/reference.ts):
//   Let c1 = >=1 approval, c2 = >=2 approvals (majority), c3 = 3 of 3.
//   The approvals needed are "at least k" with k = 1 + r1 + r0:  00 -> c1, 01 -> c2, 10 -> c2, 11 -> c3.
//     Q = c3 | (c2 & !(r0&r1)) | (c1 & !(r0|r1))
//   The timelock is tS for tiers 0x and tL for tiers 1x:   T = r1 ? tL : tS
//   The fast lane exists exactly for the tiers with r0 = 0 (00 and 10): FAST = !r0 & e & c3
//     PUBLISH  = !f & ((T & Q) | FAST)
//     UNFREEZE = c2
// Outputs are the last two signals (TAP-02 §4 step 4): PUBLISH, then UNFREEZE.
import { NetlistBuilder, type Netlist } from './netlist.ts';
import { INPUTS } from './reference.ts';

export function buildPolicy(): { netlist: Netlist; builder: NetlistBuilder } {
  const g = new NetlistBuilder(INPUTS.length);
  const [a0, a1, a2, tS, tL, r1, r0, f, e] = INPUTS.map((_, i) => g.input(i)) as [
    number, number, number, number, number, number, number, number, number,
  ];

  // approval counts
  const na0 = g.not(a0, '!a0');
  const na1 = g.not(a1, '!a1');
  const or01 = g.nand(na0, na1, 'a0|a1');
  const x = g.nand(a0, a1, '!(a0&a1)');
  const y = g.nand(a2, or01, '!(a2&(a0|a1))');
  const c2 = g.nand(x, y, 'c2 = >=2 approvals');
  const and01 = g.not(x, 'a0&a1');
  const nc3 = g.nand(and01, a2, '!c3');
  const c3 = g.not(nc3, 'c3 = 3 of 3');
  const nor01 = g.not(or01, '!a0&!a1');
  const na2 = g.not(a2, '!a2');
  const c1 = g.nand(nor01, na2, 'c1 = >=1 approval');

  // timelock for this tier: T = r1 ? tL : tS
  const nr1 = g.not(r1, '!r1');
  const t1 = g.nand(r1, tL, '!(r1&tL)');
  const t2 = g.nand(nr1, tS, '!(!r1&tS)');
  const T = g.nand(t1, t2, 'T = timelock passed');

  // approvals required for this tier: Q = c3 | (c2 & !(r0&r1)) | (c1 & !(r0|r1))
  const z = g.nand(r0, r1, '!(r0&r1)');
  const n2 = g.nand(c2, z, '!(c2&!(r0&r1))');
  const nr0 = g.not(r0, '!r0');
  const rAny = g.nand(nr0, nr1, 'r0|r1');
  const w = g.not(rAny, '!r0&!r1');
  const n3 = g.nand(c1, w, '!(c1&!r0&!r1)');
  const q1 = g.nand(nc3, n2, 'c3|(c2&!(r0&r1))');
  const nq1 = g.not(q1, '!q1');
  const Q = g.nand(nq1, n3, 'Q = approvals enough');

  // normal path, fast lane, freeze
  const nNormal = g.nand(T, Q, '!(T&Q)');
  const ne3 = g.nand(e, c3, '!(e&c3)');
  const e3 = g.not(ne3, 'e&c3');
  const nFast = g.nand(e3, nr0, '!FAST');
  const go = g.nand(nNormal, nFast, '(T&Q)|FAST');
  const nf = g.not(f, '!f');
  const nPublish = g.nand(nf, go, '!PUBLISH');
  g.not(nPublish, 'PUBLISH');
  // UNFREEZE = c2, recomputed here so it is the last signal (outputs are the last nOut signals).
  g.nand(x, y, 'UNFREEZE');

  return { netlist: g.build(2), builder: g };
}
