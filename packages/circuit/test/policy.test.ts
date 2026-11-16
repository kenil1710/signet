import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPolicy } from '../src/policy.ts';
import { policy, inputsOf, N_COMBINATIONS, INPUTS } from '../src/reference.ts';
import { NetlistBuilder, decode, evaluate, pack, unpack, toHex } from '../src/netlist.ts';
import { artifact } from '../scripts/artifact.ts';

test('policy netlist equals the reference on all 512 input combinations', () => {
  const { netlist } = buildPolicy();
  assert.equal(N_COMBINATIONS, 512);
  for (let n = 0; n < N_COMBINATIONS; n++) {
    const want = policy(inputsOf(n));
    const got = unpack(evaluate(netlist, pack(INPUTS.map((_, i) => ((n >> i) & 1) === 1))), 2);
    assert.deepEqual({ PUBLISH: got[0], UNFREEZE: got[1] }, want, `input #${n}`);
  }
});

test('policy netlist is well-formed, NAND only, combinational', () => {
  const { netlist, builder } = buildPolicy();
  const d = decode(netlist);
  assert.equal(d.nState, 0);
  assert.ok(d.recs.every((r) => r.op === 'NAND'));
  assert.equal(netlist.bytes.length, 7 * builder.gates);
  assert.equal(netlist.nIn, 9);
  assert.equal(netlist.nOut, 2);
});

test('spec rules, spot checks', () => {
  const p = (o: Partial<Record<(typeof INPUTS)[number], boolean>>) =>
    policy({ a0: false, a1: false, a2: false, tS: false, tL: false, r1: false, r0: false, f: false, e: false, ...o });
  // tier 00: 1 approval + tS; no timelock -> fast lane only with 3 of 3 + e
  assert.equal(p({ a1: true, tS: true }).PUBLISH, true);
  assert.equal(p({ a1: true }).PUBLISH, false);
  assert.equal(p({ a0: true, a1: true, a2: true, e: true }).PUBLISH, true);
  // tier 01: 2 approvals + tS; no fast lane
  assert.equal(p({ r0: true, a0: true, tS: true }).PUBLISH, false);
  assert.equal(p({ r0: true, a0: true, a2: true, tS: true }).PUBLISH, true);
  assert.equal(p({ r0: true, a0: true, a1: true, a2: true, e: true }).PUBLISH, false);
  // tier 10: 2 approvals + tL (tS is not enough), or 3 of 3 + e
  assert.equal(p({ r1: true, a0: true, a1: true, tS: true }).PUBLISH, false);
  assert.equal(p({ r1: true, a0: true, a1: true, tL: true }).PUBLISH, true);
  assert.equal(p({ r1: true, a0: true, a1: true, a2: true, e: true }).PUBLISH, true);
  // tier 11: 3 of 3 + tL, no fast lane
  assert.equal(p({ r1: true, r0: true, a0: true, a1: true, tL: true }).PUBLISH, false);
  assert.equal(p({ r1: true, r0: true, a0: true, a1: true, a2: true, tL: true }).PUBLISH, true);
  assert.equal(p({ r1: true, r0: true, a0: true, a1: true, a2: true, e: true, tS: true }).PUBLISH, false);
  // frozen: never publishes
  assert.equal(p({ f: true, a0: true, a1: true, a2: true, tS: true, tL: true, e: true }).PUBLISH, false);
  // unfreeze: >= 2 approvals, regardless of anything else
  assert.equal(p({ a0: true }).UNFREEZE, false);
  assert.equal(p({ a0: true, a2: true, f: true }).UNFREEZE, true);
});

test('builder reproduces the Spike A circuit #5 bytes recorded on mainnet', () => {
  const g = new NetlistBuilder(2);
  const n = g.nand(g.input(0), g.input(1));
  g.nand(n, n);
  assert.equal(toHex(g.build(1).bytes), '0x0000000200000300000004000004');
});

test('committed artifact and truth table match the current netlist (CI drift check)', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const committed = JSON.parse(readFileSync(`${root}artifacts/policy.json`, 'utf8'));
  assert.deepEqual(committed, artifact());
});
