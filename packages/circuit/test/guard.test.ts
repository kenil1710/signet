import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildGuard } from '../src/guard.ts';
import { guard, guardInputsOf, guardInputNumber, packGuard, unpackGuard, GUARD_COMBINATIONS, GUARD_INPUTS, type GuardInputs } from '../src/guard-reference.ts';
import { decode, evaluate, pack, unpack } from '../src/netlist.ts';
import { guardArtifact } from '../scripts/artifact.ts';

test('guard netlist equals the reference on all 512 input combinations, and exactly one output is 1', () => {
  const { netlist } = buildGuard();
  assert.equal(GUARD_COMBINATIONS, 512);
  for (let n = 0; n < GUARD_COMBINATIONS; n++) {
    const want = guard(guardInputsOf(n));
    const got = unpack(evaluate(netlist, pack(GUARD_INPUTS.map((_, i) => ((n >> i) & 1) === 1))), 3);
    assert.deepEqual({ ALLOW: got[0], WARN: got[1], BLOCK: got[2] }, want, `input #${n}`);
    assert.equal(got.filter(Boolean).length, 1, `one-hot at #${n}`);
  }
});

test('guard netlist: well-formed, NAND only, combinational, every input used', () => {
  const { netlist, builder } = buildGuard();
  const d = decode(netlist);
  assert.equal(d.nState, 0);
  assert.ok(d.recs.every((r) => r.op === 'NAND'));
  assert.equal(netlist.bytes.length, 7 * builder.gates);
  assert.deepEqual([netlist.nIn, netlist.nOut], [9, 3]);
  // no unused input bit (CLAUDE.md rule 7): flipping each input changes the output on some row
  for (let i = 0; i < 9; i++) {
    const matters = Array.from({ length: 512 }, (_, n) => n).some((n) => packGuard(guard(guardInputsOf(n))) !== packGuard(guard(guardInputsOf(n ^ (1 << i)))));
    assert.ok(matters, `input ${GUARD_INPUTS[i]} is never used`);
  }
});

test('the rules, spot checks', () => {
  const all: GuardInputs = { checked: true, pageMatches: true, targetSealed: true, spenderSealed: true, recipientOk: true, decoded: true, frozen: false, revoked: false, enforceMode: true };
  const d = (o: Partial<GuardInputs>) => { const r = guard({ ...all, ...o }); return r.BLOCK ? 'BLOCK' : r.WARN ? 'WARN' : 'ALLOW'; };
  assert.equal(d({}), 'ALLOW');
  for (const k of ['pageMatches', 'targetSealed', 'spenderSealed', 'recipientOk'] as const) {
    assert.equal(d({ [k]: false }), 'BLOCK', k);
    assert.equal(d({ [k]: false, enforceMode: false }), 'WARN', `${k} in observe mode`);
    assert.equal(d({ [k]: false, checked: false }), 'WARN', `${k} when Guard could not check`);
  }
  assert.equal(d({ revoked: true }), 'BLOCK');
  assert.equal(d({ revoked: true, enforceMode: false }), 'WARN');
  assert.equal(d({ decoded: false }), 'WARN');
  assert.equal(d({ frozen: true }), 'WARN');
  assert.equal(d({ decoded: false, spenderSealed: false }), 'BLOCK', 'an unsealed spender blocks even in an otherwise unknown call');
  assert.equal(d({ checked: false }), 'WARN');
  assert.equal(d({ enforceMode: false }), 'ALLOW');
  assert.equal(guardInputNumber(all), 0x13f);
  assert.deepEqual(unpackGuard(packGuard(guard(all))), guard(all));
});

test('committed guard artifact matches the current netlist (CI drift check)', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  assert.deepEqual(JSON.parse(readFileSync(`${root}artifacts/guard.json`, 'utf8')), guardArtifact());
});
