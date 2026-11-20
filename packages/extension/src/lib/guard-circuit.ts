// Asks the Guard decision circuit (a TapeOut circuit on processor #101) for a decision: one view call to
// eval(id, input), on two RPCs at the same block that must agree. The circuit can't change, so an answer is cached
// per input; once a day Guard re-checks that the stored netlist is the reviewed one and that the circuit beacon
// still points at the implementation it was checked with.
//
// The local mirror (the reference function the netlist is proven equal to on all 512 inputs,
// packages/circuit/test/guard.test.ts) decides ALONE only when the circuit can't be reached: no circuit on this
// network, an RPC error, or the two RPCs disagreeing. When the circuit WAS reached but can't be trusted (its stored
// netlist or beacon implementation changed, a malformed answer, or an answer that differs from the mirror), Guard
// fails safe: the strictest of the circuit's answer (if well-formed), the mirror's answer and WARN. Never ALLOW.
import { encodeFunctionData, decodeFunctionResult, parseAbi, sha256, type Hex } from 'viem';
import { guard, guardInputNumber, packGuard, unpackGuard, type GuardInputs, type GuardOutputs } from '@signet/circuit/src/guard-reference.ts';
import { agree, type Call } from './rpc.ts';
import type { Net } from './types.ts';

// docs/tapeout-interfaces.md §2 (eval, netlist) and §1 (beacon implementation)
const cpuAbi = parseAbi(['function eval(uint256 id, bytes input) view returns (bytes)', 'function netlist(uint256 id) view returns (bytes)']);
const beaconAbi = parseAbi(['function implementation() view returns (address)']);
const DAY = 24 * 3600_000;

/// circuit / circuit-cached: the on-chain answer. mirror: the circuit was unreachable, the mirror decided.
/// conflict: the circuit answered but can't be trusted; the strictest of circuit, mirror and WARN.
export type DecidedBy = 'circuit' | 'circuit-cached' | 'mirror' | 'conflict';
export interface Answer { out: GuardOutputs; by: DecidedBy; input: number; why?: string }
interface Cache { trustedAt: number; out: Record<string, number> }
export interface Store { get(): Promise<Cache | undefined>; set(c: Cache): Promise<void> }

const oneHot = (b: number) => b === 1 || b === 2 || b === 4;
const RANK = { ALLOW: 0, WARN: 1, BLOCK: 2 } as const;
const rank = (o: GuardOutputs) => (o.BLOCK ? RANK.BLOCK : o.WARN ? RANK.WARN : RANK.ALLOW);
/// The strictest of the given answers, and never below WARN.
export function failSafe(...outs: GuardOutputs[]): GuardOutputs {
  const r = Math.max(RANK.WARN, ...outs.map(rank));
  return { ALLOW: false, WARN: r === RANK.WARN, BLOCK: r === RANK.BLOCK };
}

export async function decideWithCircuit(net: Net, facts: GuardInputs, store: Store, call: (net: Net, calls: Call[]) => Promise<string[]> = agree): Promise<Answer> {
  const input = guardInputNumber(facts);
  const mirror = (why: string): Answer => ({ out: guard(facts), by: 'mirror', input, why: `the Guard circuit is unreachable: ${why}` });
  const conflict = (why: string, circuitOut?: GuardOutputs): Answer =>
    ({ out: failSafe(guard(facts), ...(circuitOut ? [circuitOut] : [])), by: 'conflict', input, why });
  const c = net.guardCircuit;
  if (!c) return mirror('no Guard circuit on this network');
  let cache = (await store.get()) ?? { trustedAt: 0, out: {} };
  try {
    if (Date.now() - cache.trustedAt > DAY) {
      const [nl, impl] = await call(net, [
        { to: c.processor, data: encodeFunctionData({ abi: cpuAbi, functionName: 'netlist', args: [BigInt(c.id)] }) },
        { to: c.beacon, data: encodeFunctionData({ abi: beaconAbi, functionName: 'implementation' }) },
      ]);
      let stored: Hex, implementation: string;
      try {
        stored = decodeFunctionResult({ abi: cpuAbi, functionName: 'netlist', data: nl as Hex });
        implementation = decodeFunctionResult({ abi: beaconAbi, functionName: 'implementation', data: impl as Hex });
      } catch {
        return conflict('the circuit check returned an undecodable answer');
      }
      if (sha256(stored) !== c.netlistSha256) return conflict('the circuit on-chain is not the reviewed netlist');
      if (implementation.toLowerCase() !== c.implementation.toLowerCase()) return conflict('the circuit implementation changed');
      cache = { trustedAt: Date.now(), out: {} }; // a fresh check starts a fresh cache
      await store.set(cache);
    }
    const hit = cache.out[String(input)];
    if (hit !== undefined && oneHot(hit)) return { out: unpackGuard(hit), by: 'circuit-cached', input };
    const packed = `0x${(input & 0xff).toString(16).padStart(2, '0')}${(input >> 8).toString(16).padStart(2, '0')}` as Hex;
    let r: string | undefined;
    try {
      [r] = await call(net, [{ to: c.processor, data: encodeFunctionData({ abi: cpuAbi, functionName: 'eval', args: [BigInt(c.id), packed] }) }]);
    } catch (e) {
      return mirror(e instanceof Error ? e.message : String(e));
    }
    let bytes: Hex;
    try {
      bytes = decodeFunctionResult({ abi: cpuAbi, functionName: 'eval', data: r as Hex });
    } catch {
      return conflict(`the circuit returned an undecodable answer`);
    }
    const b = bytes.length === 4 ? parseInt(bytes.slice(2, 4), 16) : -1;
    if (!oneHot(b)) return conflict(`the circuit returned ${bytes}`);
    if (b !== packGuard(guard(facts))) return conflict(`the circuit and the local mirror disagree on row 0x${input.toString(16).padStart(3, '0')}`, unpackGuard(b));
    cache.out[String(input)] = b;
    await store.set(cache);
    return { out: unpackGuard(b), by: 'circuit', input };
  } catch (e) {
    return mirror(e instanceof Error ? e.message : String(e));
  }
}
