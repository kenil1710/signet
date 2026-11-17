// Gate-level Signet Guard decision circuit (NAND only, combinational, 9 inputs, 3 outputs).
//
// Derivation (checked exhaustively against src/guard-reference.ts):
//   OK    = pageMatches & targetSealed & spenderSealed & recipientOk & !revoked     (no violation)
//   BLOCK = checked & !OK & enforceMode
//   ALLOW = checked & OK & decoded & !frozen
//   WARN  = !ALLOW & !BLOCK          (ALLOW and BLOCK can't both be 1, so exactly one output is 1)
// Outputs are the last three signals (TAP-02 §4 step 4): ALLOW, WARN, BLOCK.
import { NetlistBuilder, type Netlist } from './netlist.ts';
import { GUARD_INPUTS } from './guard-reference.ts';

export function buildGuard(): { netlist: Netlist; builder: NetlistBuilder } {
  const g = new NetlistBuilder(GUARD_INPUTS.length);
  const [c, p, t, s, r, d, f, v, e] = GUARD_INPUTS.map((_, i) => g.input(i)) as [number, number, number, number, number, number, number, number, number];

  // OK = p & t & s & r & !v
  const pt = g.not(g.nand(p, t, '!(p&t)'), 'p&t');
  const sr = g.not(g.nand(s, r, '!(s&r)'), 's&r');
  const ptsr = g.not(g.nand(pt, sr, '!(p&t&s&r)'), 'p&t&s&r');
  const nv = g.not(v, '!revoked');
  const nOK = g.nand(ptsr, nv, '!OK = a violation');
  const OK = g.not(nOK, 'OK');

  // BLOCK = c & !OK & e
  const ce = g.not(g.nand(c, e, '!(c&e)'), 'c&e');
  const nBLOCK = g.nand(ce, nOK, '!BLOCK');

  // ALLOW = c & OK & d & !f
  const nf = g.not(f, '!frozen');
  const dnf = g.not(g.nand(d, nf, '!(d&!f)'), 'd&!f');
  const cOK = g.not(g.nand(c, OK, '!(c&OK)'), 'c&OK');
  const nALLOW = g.nand(cOK, dnf, '!ALLOW');

  // WARN = !ALLOW & !BLOCK
  const nWARN = g.nand(nALLOW, nBLOCK, '!WARN');

  g.not(nALLOW, 'ALLOW');
  g.not(nWARN, 'WARN');
  g.not(nBLOCK, 'BLOCK');
  return { netlist: g.build(3), builder: g };
}
