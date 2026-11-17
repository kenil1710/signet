// What the watchtower reads from the chain. Same rules as Guard (packages/extension): facts come from two RPCs
// at the same block when two are configured, and the sealed lists count only if they hash to the on-chain
// release. Read-only: the watchtower holds no key and sends no transaction.
import { decodeEventLog, decodeFunctionResult, encodeEventTopics, encodeFunctionData, hexToBytes, zeroAddress, type Abi, type Hex } from 'viem';
import { gateAbi } from '@signet/cli/src/abi.ts';
import { registryAbi, siteAbi } from '@signet/extension/src/lib/abi.ts';
import { agree, either, rpc, type Call } from '@signet/extension/src/lib/rpc.ts';
import { parseSealed, ALLOWLIST_PATH, ORIGINS_PATH, FILES_PATH } from '@signet/extension/src/lib/sealed.ts';
import type { Net, Sealed } from '@signet/extension/src/lib/types.ts';

export type { Net, Sealed };
const enc = (to: Hex, abi: Abi, functionName: string, args: unknown[] = []): Call => ({ to, data: encodeFunctionData({ abi, functionName, args }) });
const dec = <T>(abi: Abi, functionName: string, data: string): T => {
  if (data === 'revert') throw new Error(`${functionName} reverted`);
  return decodeFunctionResult({ abi, functionName, data: data as Hex }) as T;
};
/// Two RPCs that must agree when two are configured; otherwise the single one (staging).
const read = (net: Net, calls: Call[]): Promise<string[]> => (net.rpcUrl2 ? agree(net, calls) : Promise.all(calls.map((c) => either(net, c))));

export interface Binding { domain: string; gate: Hex; block: number }

/// Domains claimed in the registry from `fromBlock` on (the union of both RPCs' logs), and the block reached.
export async function newBindings(net: Net, fromBlock: number): Promise<{ bindings: Binding[]; next: number }> {
  if (!net.registry) throw new Error('Signet is not deployed on this network');
  const urls = [net.rpcUrl, net.rpcUrl2].filter((u): u is string => !!u);
  const head = Math.min(...(await Promise.all(urls.map((u) => rpc<string>(u, 'eth_blockNumber', [])))).map((h) => parseInt(h, 16)));
  const topics = [[encodeEventTopics({ abi: registryAbi, eventName: 'Claimed' })[0], encodeEventTopics({ abi: registryAbi, eventName: 'Transferred' })[0]]];
  const found = new Map<string, Binding>();
  let from = fromBlock;
  for (; from <= head; from += 5000) {
    const filter = { address: net.registry, topics, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${Math.min(head, from + 4999).toString(16)}` };
    for (const u of urls) {
      for (const log of await rpc<{ topics: Hex[]; data: Hex; blockNumber: Hex }[]>(u, 'eth_getLogs', [filter])) {
        const ev = decodeEventLog({ abi: registryAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data });
        const gate = ev.eventName === 'Claimed' ? ev.args.gate : ev.args.toGate;
        found.set(`${ev.args.domain}:${log.blockNumber}`, { domain: ev.args.domain, gate, block: parseInt(log.blockNumber, 16) });
      }
    }
  }
  return { bindings: [...found.values()].sort((a, b) => a.block - b.block), next: head + 1 };
}

export interface GateView {
  gate: Hex; container: Hex; prefix: string; release: number; current: Hex | null; revoked: boolean; frozen: boolean; enforced: boolean;
  filesRoot: Hex; allowlistHash: Hex; originsHash: Hex; proposalCount: number; shortDelay: number; longDelay: number; chainTime: number;
}

/// Null: the registry no longer binds the domain.
export async function gateView(net: Net, domain: string): Promise<GateView | null> {
  const [b] = await read(net, [enc(net.registry!, registryAbi, 'bindingOf', [domain])]);
  const [gate, container, prefix] = dec<[Hex, Hex, string]>(registryAbi, 'bindingOf', b!);
  if (gate === zeroAddress) return null;
  const names = ['activeRelease', 'currentManifestHash', 'currentRelease', 'frozen', 'enforced', 'proposalCount', 'shortDelay', 'longDelay'] as const;
  const r = await read(net, names.map((n) => enc(gate, gateAbi, n)));
  const [filesRoot, allowlistHash, originsHash, ok] = dec<[Hex, Hex, Hex, boolean]>(gateAbi, 'activeRelease', r[0]!);
  const release = Number(dec<bigint>(gateAbi, 'currentRelease', r[2]!));
  const block = await rpc<{ timestamp: Hex }>(net.rpcUrl, 'eth_getBlockByNumber', ['latest', false]);
  return {
    gate, container, prefix, release, current: release ? dec<Hex>(gateAbi, 'currentManifestHash', r[1]!) : null, revoked: release > 0 && !ok,
    frozen: dec<boolean>(gateAbi, 'frozen', r[3]!), enforced: dec<boolean>(gateAbi, 'enforced', r[4]!), filesRoot, allowlistHash, originsHash,
    proposalCount: Number(dec<bigint>(gateAbi, 'proposalCount', r[5]!)), shortDelay: Number(dec<number>(gateAbi, 'shortDelay', r[6]!)),
    longDelay: Number(dec<number>(gateAbi, 'longDelay', r[7]!)), chainTime: parseInt(block.timestamp, 16),
  };
}

export async function isValidManifest(net: Net, gate: Hex, hash: Hex): Promise<boolean> {
  const [r] = await read(net, [enc(gate, gateAbi, 'isValidManifest', [hash])]);
  return dec<boolean>(gateAbi, 'isValidManifest', r!);
}

/// The current release's sealed lists from the container. Null with a reason when they are missing or don't
/// hash to what the gate published (then there is nothing trustworthy to compare the site with).
export async function sealedLists(net: Net, domain: string, g: GateView): Promise<{ sealed: Sealed | null; why: string }> {
  const bytes: (Uint8Array | null)[] = [];
  for (const p of [ALLOWLIST_PATH, ORIGINS_PATH, FILES_PATH]) {
    const data = await either(net, enc(net.siteRegistry, siteAbi, 'read', [g.container, g.prefix + p]));
    bytes.push(data === 'revert' ? null : hexToBytes(dec<Hex>(siteAbi, 'read', data)));
  }
  if (bytes.some((b) => !b || b.length === 0)) return { sealed: null, why: "the release's manifest files are not in the container" };
  let sealed: Sealed;
  try {
    sealed = parseSealed(domain, bytes[0]!, bytes[1]!, bytes[2]!);
  } catch (e) {
    return { sealed: null, why: `the manifest files can't be read (${(e as Error).message})` };
  }
  if (sealed.filesRoot !== g.filesRoot || sealed.allowlistHash !== g.allowlistHash || sealed.originsHash !== g.originsHash || sealed.manifestHash !== g.current) {
    return { sealed: null, why: 'the manifest files in the container do not hash to the release on-chain' };
  }
  return { sealed, why: '' };
}

export interface Pending { id: number; kind: 'release' | 'admin'; tier: number; emergency: boolean; approvals: number; proposedAt: number; readyAt: number; earliest: number | null; expiresAt: number }

/// Open proposals with id > after (not executed, not cancelled, not expired).
export async function openProposals(net: Net, g: GateView, after: number): Promise<Pending[]> {
  const ids = Array.from({ length: Math.max(0, g.proposalCount - after) }, (_, i) => after + 1 + i);
  if (ids.length === 0) return [];
  const raw = await read(net, ids.map((id) => enc(g.gate, gateAbi, 'getProposal', [BigInt(id)])));
  const out: Pending[] = [];
  raw.forEach((data, i) => {
    const p = dec<{ kind: number; tier: number; emergency: boolean; executed: boolean; cancelled: boolean; approvals: number; proposedAt: number; readyAt: number }>(gateAbi, 'getProposal', data);
    const expiresAt = Number(p.proposedAt) + 7 * 86400;
    if (Number(p.kind) === 0 || p.executed || p.cancelled || g.chainTime > expiresAt) return;
    const approvals = [0, 1, 2].filter((b) => (Number(p.approvals) >> b) & 1).length;
    const readyAt = Number(p.readyAt);
    out.push({
      id: ids[i]!, kind: Number(p.kind) === 1 ? 'release' : 'admin', tier: Number(p.tier), emergency: p.emergency, approvals, proposedAt: Number(p.proposedAt), readyAt,
      earliest: readyAt ? readyAt + (Number(p.tier) <= 1 ? g.shortDelay : g.longDelay) : null, expiresAt,
    });
  });
  return out;
}
