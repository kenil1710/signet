// Everything the dashboard reads from the chain. Chain facts come from two RPCs at the same block that must agree
// (the same rule as Guard); file bytes from either, and they only count if they hash to the on-chain values.
import { decodeFunctionResult, encodeFunctionData, hexToBytes, zeroAddress, type Abi, type Address, type Hex } from 'viem';
import { gateAbi } from '@signet/cli/src/abi.ts';
import { registryAbi, siteAbi } from '@signet/extension/src/lib/abi.ts';
import { agree, either, type Call } from '@signet/extension/src/lib/rpc.ts';
import { parseSealed, ALLOWLIST_PATH, ORIGINS_PATH, FILES_PATH } from '@signet/extension/src/lib/sealed.ts';
import type { Net, Sealed } from '@signet/extension/src/lib/types.ts';

declare const __SIGNET_NET__: Net & { name: string; tapeout: Record<string, unknown>; explorer?: string };
export const NET = __SIGNET_NET__;
export const GATE_ABI = gateAbi as unknown as Abi;

export const enc = (to: Address, abi: Abi, functionName: string, args: unknown[] = []): Call => ({ to, data: encodeFunctionData({ abi, functionName, args }) });
export const dec = <T>(abi: Abi, functionName: string, data: string): T => {
  if (data === 'revert') throw new Error(`${functionName} reverted`);
  return decodeFunctionResult({ abi, functionName, data: data as Hex }) as T;
};
/// Facts: two RPCs that must agree (staging may have one; then that one).
export const read = (calls: Call[]): Promise<string[]> => (NET.rpcUrl2 ? agree(NET, calls) : Promise.all(calls.map((c) => either(NET, c))));
export async function one<T>(to: Address, abi: Abi, fn: string, args: unknown[] = []): Promise<T> {
  const [r] = await read([enc(to, abi, fn, args)]);
  return dec<T>(abi, fn, r!);
}

export async function domains(): Promise<string[]> {
  if (!NET.registry) return [];
  const n = Number(await one<bigint>(NET.registry, registryAbi as Abi, 'domainCount'));
  const out: string[] = [];
  while (out.length < n) {
    const page = await one<string[]>(NET.registry, registryAbi as Abi, 'domainsRange', [BigInt(out.length), 100n]);
    if (!page.length) break;
    out.push(...page);
  }
  return out;
}

export interface Proposal {
  id: number; kind: number; tier: number; emergency: boolean; executed: boolean; cancelled: boolean; approvals: number; proposerSlot: number;
  proposedAt: number; readyAt: number; baseRelease: bigint; baseline: bigint; approverSet: bigint; filesRoot: Hex; allowlistHash: Hex; originsHash: Hex;
}
export interface Project {
  domain: string; gate: Address; container: Address; prefix: string; approvers: Address[]; proposer: Address; recovery: Address; guardian: Address;
  enforced: boolean; frozen: boolean; unfreezeApprovals: number; shortDelay: number; longDelay: number; graceWindow: number;
  currentRelease: number; manifest: Hex | null; revoked: boolean; approverSet: bigint; proposalCount: number; chainTime: number; proposals: Proposal[];
}

export async function project(domain: string): Promise<Project | null> {
  if (!NET.registry) return null;
  const [gate, container, prefix] = await one<[Address, Address, string]>(NET.registry, registryAbi as Abi, 'bindingOf', [domain]);
  if (gate === zeroAddress) return null;
  const names = ['getApprovers', 'proposer', 'recovery', 'guardian', 'enforced', 'frozen', 'unfreezeApprovals', 'shortDelay', 'longDelay', 'graceWindow', 'currentRelease', 'currentManifestHash', 'activeRelease', 'approverSet', 'proposalCount'];
  const r = await read(names.map((n) => enc(gate, GATE_ABI, n)));
  const v = Object.fromEntries(names.map((n, i) => [n, dec<unknown>(GATE_ABI, n, r[i]!)])) as Record<string, unknown>;
  const count = Number(v.proposalCount as bigint);
  const ids = Array.from({ length: Math.min(count, 25) }, (_, i) => count - i);
  const pr = ids.length ? await read(ids.map((id) => enc(gate, GATE_ABI, 'getProposal', [BigInt(id)]))) : [];
  const proposals = pr.map((d, i) => {
    const p = dec<Record<string, unknown>>(GATE_ABI, 'getProposal', d);
    return { ...p, id: ids[i]!, kind: Number(p.kind), tier: Number(p.tier), approvals: Number(p.approvals), proposerSlot: Number(p.proposerSlot), proposedAt: Number(p.proposedAt), readyAt: Number(p.readyAt) } as Proposal;
  });
  const now = await fetch(NET.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['latest', false] }) }).then((x) => x.json()).then((j) => parseInt(j.result.timestamp, 16));
  const active = v.activeRelease as [Hex, Hex, Hex, boolean];
  return {
    domain, gate, container, prefix, approvers: [...(v.getApprovers as Address[])], proposer: v.proposer as Address, recovery: v.recovery as Address, guardian: v.guardian as Address,
    enforced: v.enforced as boolean, frozen: v.frozen as boolean, unfreezeApprovals: Number(v.unfreezeApprovals), shortDelay: Number(v.shortDelay), longDelay: Number(v.longDelay), graceWindow: Number(v.graceWindow),
    currentRelease: Number(v.currentRelease as bigint), manifest: Number(v.currentRelease as bigint) ? (v.currentManifestHash as Hex) : null, revoked: Number(v.currentRelease as bigint) > 0 && !active[3],
    approverSet: v.approverSet as bigint, proposalCount: count, chainTime: now, proposals,
  };
}

/// The current release's sealed lists from the container, only if they hash to the gate's published values.
export async function releaseLists(p: Project): Promise<{ sealed: Sealed | null; why: string; stored?: Sealed }> {
  const bytes: (Uint8Array | null)[] = [];
  for (const f of [ALLOWLIST_PATH, ORIGINS_PATH, FILES_PATH]) {
    const d = await either(NET, enc(NET.siteRegistry, siteAbi as Abi, 'read', [p.container, p.prefix + f]));
    bytes.push(d === 'revert' ? null : hexToBytes(dec<Hex>(siteAbi as Abi, 'read', d)));
  }
  if (bytes.some((b) => !b || !b.length)) return { sealed: null, why: "the release's manifest files are not in the container" };
  const s = parseSealed(p.domain, bytes[0]!, bytes[1]!, bytes[2]!);
  const [filesRoot, allowlistHash, originsHash] = await one<[Hex, Hex, Hex, boolean]>(p.gate, GATE_ABI, 'activeRelease');
  if (s.filesRoot !== filesRoot || s.allowlistHash !== allowlistHash || s.originsHash !== originsHash) return { sealed: null, why: 'the files in the container do not hash to the release on-chain', stored: s };
  return { sealed: s, why: '' };
}

/// Which earlier release of this gate (if any) the stored lists belong to: the current release's upload is then
/// missing, which is not the same as files that match no release at all.
export async function releaseOf(p: Project, stored: Sealed): Promise<number | null> {
  let id = BigInt(p.currentRelease);
  for (let n = 0; id !== 0n && n < 50; n++) {
    const r = await one<[Hex, Hex, Hex, Hex, number, bigint]>(p.gate, GATE_ABI, 'releases', [id]);
    if (r[0] === stored.manifestHash) return Number(id);
    id = r[5];
  }
  return null;
}

// ---------------------------------------------------------------- proposal status (same rules as the CLI)

export const TIERS = ['00 code only', '01 new external origin', '10 allowlist changed', '11 admin change'];
const NEED = [1, 2, 2, 3];
export const count = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1);
export function status(p: Proposal, s: Project): { open: boolean; publishable: boolean; text: string; at: number | null } {
  const c = count(p.approvals);
  const need = NEED[p.tier]!;
  const closed = (text: string) => ({ open: false, publishable: false, text, at: null });
  if (p.executed) return closed(p.kind === 1 ? 'published' : 'executed');
  if (p.cancelled) return closed('cancelled');
  if (p.approverSet !== s.approverSet) return closed('void (the approvers changed)');
  if (s.chainTime > p.proposedAt + 7 * 86400) return closed('expired');
  if (p.kind === 1 && p.baseRelease !== BigInt(s.currentRelease)) return closed('stale: another release was published since');
  const fz = s.frozen ? ' The gate is FROZEN.' : '';
  if (p.emergency && c === 3 && (p.tier === 0 || p.tier === 2)) return { open: true, publishable: !s.frozen, text: `${c} of 3, emergency fast lane: can publish now.${fz}`, at: null };
  if (p.readyAt === 0) return { open: true, publishable: false, text: `${c} of 3 approvals: needs ${need - c} more.${fz}`, at: null };
  const at = p.readyAt + (p.tier <= 1 ? s.shortDelay : s.longDelay);
  if (s.chainTime >= at) return { open: true, publishable: !s.frozen, text: `${c} of 3, timelock over: can publish now.${fz}`, at };
  return { open: true, publishable: false, text: `${c} of 3, timelock running.${fz}`, at };
}
export const span = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};
