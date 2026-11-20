// decideWithCircuit: the on-chain Guard circuit decides; the local mirror decides alone only while the circuit is
// unreachable; a reachable circuit that can't be trusted fails safe (the strictest of circuit, mirror and WARN).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionResult, parseAbi, sha256, type Hex } from 'viem';
import { decideWithCircuit, failSafe } from '../src/lib/guard-circuit.ts';
import { RpcError, type Call } from '../src/lib/rpc.ts';
import { guard, guardInputNumber, packGuard, GUARD_INPUTS, type GuardInputs, type GuardOutputs } from '@signet/circuit/src/guard-reference.ts';
import type { Net } from '../src/lib/types.ts';

const cpuAbi = parseAbi(['function eval(uint256 id, bytes input) view returns (bytes)', 'function netlist(uint256 id) view returns (bytes)']);
const beaconAbi = parseAbi(['function implementation() view returns (address)']);
const NETLIST = '0x00000002000003000000040000040506' as Hex;
const IMPL = '0x977f0000000000000000000000000000000029b2' as Hex;
const net = { guardCircuit: { processor: '0x73153e5fd2Acac604D49d6ca9fea27b750718F22', id: 7, netlistSha256: sha256(NETLIST), beacon: '0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C', implementation: IMPL } } as unknown as Net;

const facts = (n: number): GuardInputs => Object.fromEntries(GUARD_INPUTS.map((k, i) => [k, ((n >> i) & 1) === 1])) as GuardInputs;
const store = () => { let c: any; return { get: async () => c, set: async (x: any) => { c = x; } }; };
const packed = (b: number) => encodeFunctionResult({ abi: cpuAbi, functionName: 'eval', result: `0x${b.toString(16).padStart(2, '0')}` });
const action = (o: GuardOutputs) => (o.BLOCK ? 'block' : o.WARN ? 'warn' : 'allow');

/// A fake pair of RPCs. evalOut(input) is the circuit's answer byte (or a raw hex result); throws to simulate errors.
function chain(o: { evalOut?: (input: number) => number | Hex; netlist?: Hex; impl?: Hex; fail?: 'all' | 'eval' }) {
  return async (_n: Net, calls: Call[]): Promise<string[]> => {
    if (o.fail === 'all') throw new RpcError('xlayerrpc.okx.com could not be reached');
    return calls.map((c) => {
      if (c.data.startsWith('0x3fc4be56')) return encodeFunctionResult({ abi: cpuAbi, functionName: 'netlist', result: o.netlist ?? NETLIST });
      if (c.to === net.guardCircuit!.beacon) return encodeFunctionResult({ abi: beaconAbi, functionName: 'implementation', result: o.impl ?? IMPL });
      if (o.fail === 'eval') throw new RpcError('the two RPCs disagree');
      // eval(uint256 id, bytes input): selector, id, offset, length, then the 2 input bytes (low byte first)
      const at = 2 + 8 + 64 * 3;
      const lo = parseInt(c.data.slice(at, at + 2), 16), hi = parseInt(c.data.slice(at + 2, at + 4), 16);
      const out = o.evalOut ? o.evalOut(lo | (hi << 8)) : packGuard(guard(facts(lo | (hi << 8))));
      return typeof out === 'string' ? out : packed(out);
    });
  };
}

test('failSafe: the strictest answer, never below WARN', () => {
  const A = { ALLOW: true, WARN: false, BLOCK: false }, W = { ALLOW: false, WARN: true, BLOCK: false }, B = { ALLOW: false, WARN: false, BLOCK: true };
  assert.equal(action(failSafe(A)), 'warn');
  assert.equal(action(failSafe(A, A)), 'warn');
  assert.equal(action(failSafe(W, A)), 'warn');
  assert.equal(action(failSafe(A, B)), 'block');
  assert.equal(action(failSafe(B)), 'block');
});

test('the circuit decides when it answers and agrees with the mirror (all 512 rows), then the answer is cached', async () => {
  const s = store();
  for (let n = 0; n < 512; n++) {
    const a = await decideWithCircuit(net, facts(n), s, chain({}));
    assert.equal(a.by, 'circuit', `row ${n}`);
    assert.equal(a.input, guardInputNumber(facts(n)));
    assert.deepEqual(a.out, guard(facts(n)));
  }
  const again = await decideWithCircuit(net, facts(5), s, chain({ fail: 'eval' }));
  assert.equal(again.by, 'circuit-cached');
});

test('unreachable circuit (RPC error or RPCs disagreeing): the mirror decides, and says so', async () => {
  for (const fail of ['all', 'eval'] as const) {
    const a = await decideWithCircuit(net, facts(0x1ff), store(), chain({ fail }));
    assert.equal(a.by, 'mirror');
    assert.deepEqual(a.out, guard(facts(0x1ff)));
    assert.match(a.why!, /^the Guard circuit is unreachable: /);
  }
  const none = await decideWithCircuit({ guardCircuit: null } as unknown as Net, facts(3), store(), chain({}));
  assert.equal(none.by, 'mirror');
});

test('circuit and mirror disagree, on every row: fail-safe, never the mirror alone, never ALLOW', async () => {
  for (let n = 0; n < 512; n++) {
    const mine = packGuard(guard(facts(n)));
    for (const other of [1, 2, 4].filter((b) => b !== mine)) {
      const a = await decideWithCircuit(net, facts(n), store(), chain({ evalOut: () => other }));
      assert.equal(a.by, 'conflict', `row ${n}`);
      assert.notEqual(action(a.out), 'allow', `row ${n}`);
      // the strictest of the two answers (and WARN)
      const want = Math.max(1, mine === 4 || other === 4 ? 2 : 1);
      assert.equal(action(a.out), want === 2 ? 'block' : 'warn', `row ${n} mirror ${mine} circuit ${other}`);
      assert.match(a.why!, /disagree on row 0x/);
    }
  }
});

test('a reachable circuit that cannot be trusted fails safe: malformed answer, changed netlist, changed implementation', async () => {
  const allowRow = [...Array(512).keys()].find((n) => guard(facts(n)).ALLOW)!;
  const cases: [string, Parameters<typeof chain>[0], RegExp][] = [
    ['not one-hot', { evalOut: () => 3 }, /returned 0x03/],
    ['zero', { evalOut: () => 0 }, /returned 0x00/],
    ['two bytes', { evalOut: () => encodeFunctionResult({ abi: cpuAbi, functionName: 'eval', result: '0x0100' }) }, /returned 0x0100/],
    ['undecodable', { evalOut: () => '0xdead' as Hex }, /undecodable/],
    ['netlist changed', { netlist: '0x00000002000003000000040000040507' }, /not the reviewed netlist/],
    ['implementation changed', { impl: '0x0000000000000000000000000000000000000bad' }, /implementation changed/],
  ];
  for (const [name, o, why] of cases) {
    const a = await decideWithCircuit(net, facts(allowRow), store(), chain(o));
    assert.equal(a.by, 'conflict', name);
    assert.equal(action(a.out), 'warn', `${name}: an ALLOW row becomes at least WARN`);
    assert.match(a.why!, why, name);
  }
  const blockRow = [...Array(512).keys()].find((n) => guard(facts(n)).BLOCK)!;
  const b = await decideWithCircuit(net, facts(blockRow), store(), chain({ evalOut: () => 1 }));
  assert.equal(action(b.out), 'block', 'a BLOCK row stays BLOCK even if the circuit says ALLOW');
});
