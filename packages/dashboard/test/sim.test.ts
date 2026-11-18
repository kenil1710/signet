// The landing page's simulator against the real rule: the circuit #6 truth table (all 512 rows), the reference
// function the netlist is proven equal to, and every state the page's controls can reach (with the text it shows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeSim, type SimState } from '../src/landing/sim.ts';
import { policy, inputsOf } from '../../circuit/src/reference.ts';

const art = JSON.parse(readFileSync(fileURLToPath(new URL('../../circuit/artifacts/policy.json', import.meta.url)), 'utf8')) as { expected: string; netlistSha256: string };
const sim = makeSim(art.expected);

test('the lookup equals the circuit #6 truth table and the reference rule on all 512 rows', () => {
  for (let n = 0; n < 512; n++) {
    const want = policy(inputsOf(n));
    const got = sim.lookup(n);
    assert.equal(got & 1, want.PUBLISH ? 1 : 0, `PUBLISH row ${n}`);
    assert.equal((got >> 1) & 1, want.UNFREEZE ? 1 : 0, `UNFREEZE row ${n}`);
  }
  assert.equal(art.netlistSha256, '0x1a2e19870a19f653af4bddf049e1070461b7466577640a4cb341a579838b20db', 'the artifact is circuit #6 (the netlist on mainnet)');
});

test('every state the controls can reach maps to the right row, and the text agrees with the answer', () => {
  let states = 0;
  const rows = new Set<number>();
  for (let m = 0; m < 8; m++) for (const tier of [0, 1, 2, 3] as const) for (const wait of [0, 1, 2] as const) for (const f of [false, true]) for (const e of [false, true]) {
    const s: SimState = { a: !!(m & 1), b: !!(m & 2), c: !!(m & 4), tier, wait, f, e };
    const r = sim.run(s);
    const x = inputsOf(r.row);
    assert.deepEqual([x.a0, x.a1, x.a2, x.tS, x.tL, x.r1, x.r0, x.f, x.e], [s.a, s.b, s.c, wait >= 1, wait >= 2, tier >= 2, tier % 2 === 1, f, e]);
    const want = policy(x);
    assert.equal(r.pub, want.PUBLISH);
    assert.equal(r.unf, want.UNFREEZE);
    // the sentence must say "published" (or name the emergency path that publishes) exactly when PUBLISH = 1
    const saysPublished = /Published\.|is enough\.|Emergency path: all three approved/.test(r.why);
    assert.equal(saysPublished, r.pub, `${JSON.stringify(s)}: "${r.why}" but PUBLISH=${r.pub}`);
    if (f) assert.match(r.why, r.unf ? /can unfreeze/ : /Nothing publishes/);
    rows.add(r.row);
    states++;
  }
  assert.equal(states, 384);
  assert.equal(rows.size, 384, 'the controls reach 384 of the 512 rows: every row where tL implies tS (a day is also an hour)');
});
