// Asks the Guard decision circuit (a TapeOut circuit on processor #101) for a decision: one view call to
// eval(id, input), on two RPCs at the same block that must agree. The circuit can't change, so an answer is cached
// per input; once a day Guard re-checks that the stored netlist is the reviewed one and that the circuit beacon
// still points at the implementation it was checked with. If any of that fails, the local mirror decides: the
// reference function the netlist is proven equal to on all 512 inputs (packages/circuit/test/guard.test.ts).
import { encodeFunctionData, decodeFunctionResult, parseAbi, sha256, type Hex } from 'viem';
import { guard, guardInputNumber, packGuard, unpackGuard, type GuardInputs, type GuardOutputs } from '@signet/circuit/src/guard-reference.ts';
import { agree } from './rpc.ts';
import type { Net } from './types.ts';

// docs/tapeout-interfaces.md §2 (eval, netlist) and §1 (beacon implementation)
const cpuAbi = parseAbi(['function eval(uint256 id, bytes input) view returns (bytes)', 'function netlist(uint256 id) view returns (bytes)']);
const beaconAbi = parseAbi(['function implementation() view returns (address)']);
const DAY = 24 * 3600_000;

export interface Answer { out: GuardOutputs; by: 'circuit' | 'circuit-cached' | 'mirror'; input: number; why?: string }
interface Cache { trustedAt: number; out: Record<string, number> }
export interface Store { get(): Promise<Cache | undefined>; set(c: Cache): Promise<void> }

const oneHot = (b: number) => b === 1 || b === 2 || b === 4;

export async function decideWithCircuit(net: Net, facts: GuardInputs, store: Store): Promise<Answer> {
  const input = guardInputNumber(facts);
  const mirror = (why: string): Answer => ({ out: guard(facts), by: 'mirror', input, why });
  const c = net.guardCircuit;
  if (!c) return mirror('no Guard circuit on this network');
  let cache = (await store.get()) ?? { trustedAt: 0, out: {} };
  try {
    if (Date.now() - cache.trustedAt > DAY) {
      const [nl, impl] = await agree(net, [
        { to: c.processor, data: encodeFunctionData({ abi: cpuAbi, functionName: 'netlist', args: [BigInt(c.id)] }) },
        { to: c.beacon, data: encodeFunctionData({ abi: beaconAbi, functionName: 'implementation' }) },
      ]);
      const stored = decodeFunctionResult({ abi: cpuAbi, functionName: 'netlist', data: nl as Hex });
      const implementation = decodeFunctionResult({ abi: beaconAbi, functionName: 'implementation', data: impl as Hex });
      if (sha256(stored) !== c.netlistSha256) return mirror('the circuit on-chain is not the reviewed netlist');
      if (implementation.toLowerCase() !== c.implementation.toLowerCase()) return mirror('the circuit implementation changed');
      cache = { trustedAt: Date.now(), out: {} }; // a fresh check starts a fresh cache
      await store.set(cache);
    }
    const hit = cache.out[String(input)];
    if (hit !== undefined && oneHot(hit)) return { out: unpackGuard(hit), by: 'circuit-cached', input };
    const packed = `0x${(input & 0xff).toString(16).padStart(2, '0')}${(input >> 8).toString(16).padStart(2, '0')}` as Hex;
    const [r] = await agree(net, [{ to: c.processor, data: encodeFunctionData({ abi: cpuAbi, functionName: 'eval', args: [BigInt(c.id), packed] }) }]);
    const bytes = decodeFunctionResult({ abi: cpuAbi, functionName: 'eval', data: r as Hex });
    const b = bytes.length === 4 ? parseInt(bytes.slice(2, 4), 16) : -1;
    if (!oneHot(b)) return mirror(`the circuit returned ${bytes}`);
    if (b !== packGuard(guard(facts))) return mirror(`the circuit and the mirror disagree on row ${input}`); // can't happen: proven equal
    cache.out[String(input)] = b;
    await store.set(cache);
    return { out: unpackGuard(b), by: 'circuit', input };
  } catch (e) {
    return mirror(e instanceof Error ? e.message : String(e));
  }
}
