// Guard 0.3.3: is a release of this gate about to be published? In enforce mode, a page that doesn't match the seal
// is held (signatures stay refused, the red page waits) for up to HOLD_MS while a release proposal can publish now,
// because the team deploys the new files seconds before the publish transaction is mined (scripts/release-site.sh).
// "Can publish now" is the gate's own rule: the proposal is live (not executed, not cancelled, same approver set, not
// expired), built on the current release, not frozen, and the release policy (the reference function of circuit #6,
// equal to the netlist on all 512 inputs) says PUBLISH for the gate's policyInputs(id) at this block.
// Read on both RPCs at one block (agree), like every chain fact Guard acts on.
import { decodeFunctionResult, encodeFunctionData, type Abi } from 'viem';
import { policy, inputsOf } from '@signet/circuit/src/reference.ts';
import { gateAbi, MULTICALL3 } from './abi.ts';
import { agree, type Call } from './rpc.ts';
import type { Hex, Net } from './types.ts';

export { HOLD_MS, POLL_MS } from './hold.ts';
export const PROPOSAL_TTL = 7 * 24 * 3600; // ReleaseGate.PROPOSAL_TTL
const KIND_RELEASE = 1;
const LOOK_BACK = 3; // the newest proposals looked at

export interface ProposalView { kind: number; executed: boolean; cancelled: boolean; proposedAt: number; baseRelease: bigint; approverSet: bigint }
export interface GateNow { currentRelease: bigint; approverSet: bigint; frozen: boolean; chainNow: number }

/// Pure: can this proposal be published right now (the same checks ReleaseGate._publish makes, but the baseline).
export function canPublishNow(p: ProposalView, bits: number, g: GateNow): boolean {
  if (p.kind !== KIND_RELEASE || p.executed || p.cancelled || g.frozen) return false;
  if (p.approverSet !== g.approverSet || p.baseRelease !== g.currentRelease) return false;
  if (g.chainNow > p.proposedAt + PROPOSAL_TTL) return false;
  return policy(inputsOf(bits & 0x1ff)).PUBLISH;
}

const c = (to: Hex, functionName: string, args: unknown[] = []): Call => ({ to, data: encodeFunctionData({ abi: gateAbi as Abi, functionName, args }) });
const o = <T>(functionName: string, data: string): T => decodeFunctionResult({ abi: gateAbi as Abi, functionName, data: data as Hex }) as T;

/// The id of a release proposal of `gate` that can publish now, or null. Throws if the RPCs can't be read or disagree
/// (the caller then shows the red page at once, as before).
export async function publishableRelease(net: Net, gate: Hex): Promise<number | null> {
  const [n, cur, set, fz, now] = await agree(net, [c(gate, 'proposalCount'), c(gate, 'currentRelease'), c(gate, 'approverSet'), c(gate, 'frozen'), c(MULTICALL3, 'getCurrentBlockTimestamp')]);
  const g: GateNow = { currentRelease: o<bigint>('currentRelease', cur!), approverSet: o<bigint>('approverSet', set!), frozen: o<boolean>('frozen', fz!), chainNow: Number(o<bigint>('getCurrentBlockTimestamp', now!)) };
  const count = Number(o<bigint>('proposalCount', n!));
  if (g.frozen || count === 0) return null;
  const ids = Array.from({ length: Math.min(LOOK_BACK, count) }, (_, i) => count - i);
  const r = await agree(net, ids.flatMap((id) => [c(gate, 'getProposal', [BigInt(id)]), c(gate, 'policyInputs', [BigInt(id)])]));
  for (let i = 0; i < ids.length; i++) {
    const p = o<{ kind: number; executed: boolean; cancelled: boolean; proposedAt: number; baseRelease: bigint; approverSet: bigint }>('getProposal', r[2 * i]!);
    if (canPublishNow({ ...p, kind: Number(p.kind), proposedAt: Number(p.proposedAt) }, Number(o<number>('policyInputs', r[2 * i + 1]!)), g)) return ids[i]!;
  }
  return null;
}
