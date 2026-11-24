// Everything the dashboard reads from the chain. Chain facts come from two RPCs at the same block that must agree
// (the same rule as Guard); file bytes from either, and they only count if they hash to the on-chain values.
import { decodeFunctionResult, encodeFunctionData, hexToBytes, zeroAddress, type Abi, type Address, type Hex } from 'viem';
import { gateAbi, factoryAbi } from '@signet/cli/src/abi.ts';
import { proofNames, PROOF_PATH } from '@signet/extension/src/lib/proof.ts';
import { registryAbi, siteAbi, MULTICALL3 } from '@signet/extension/src/lib/abi.ts';
import { agreeAt, callOne, commonHead, either, MAX_BATCH, type Call } from '@signet/extension/src/lib/rpc.ts';
import { parseSealed, ALLOWLIST_PATH, ORIGINS_PATH, FILES_PATH } from '@signet/extension/src/lib/sealed.ts';
import type { Net, Sealed } from '@signet/extension/src/lib/types.ts';

declare const __SIGNET_NET__: Net & { name: string; tapeout: Record<string, unknown>; explorer?: string };
export const NET = __SIGNET_NET__;
declare const __SIGNET_PROOF_ORIGIN__: string;
declare const __SIGNET_WATCHTOWER_STATUS__: string;

// ---- the watchtower's public status (written each round by .github/workflows/watchtower.yml)
export interface WatchStatus { updatedAt: string; network: string; domains: { domain: string; status: string; checkedAt: string | null; release: number | null }[]; operator: { until: string; daysLeft: number } | null;
  /// the watchtower's last run of /prove in its browser (absent until one finished)
  prove?: { checkedAt: string; block: string | null; summary: string; rows: { claim: string; status: string; detail: string }[] } }
export async function watchtowerStatus(): Promise<WatchStatus | null> {
  if (!__SIGNET_WATCHTOWER_STATUS__) return null;
  try {
    const r = await fetch(__SIGNET_WATCHTOWER_STATUS__, { cache: 'no-store', credentials: 'omit' });
    return r.ok ? ((await r.json()) as WatchStatus) : null;
  } catch {
    return null;
  }
}
const utc = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 120 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
const WORDS: Record<string, string> = { ok: 'matches its sealed release', mismatch: 'DOES NOT MATCH its sealed release', unreachable: "couldn't be loaded", unchecked: 'not checked (no release published, or its manifest is not stored)', new: 'not checked yet' };
/// One line for a domain (or the whole watchtower, without a domain), honest when there's no status.
export function watchLine(s: WatchStatus | null, domain?: string): { cls: string; text: string } {
  if (!s) return { cls: 'dim', text: 'Watchtower: no public status yet (it is published once the repository is public).' };
  const stale = Date.now() - Date.parse(s.updatedAt) > 30 * 60000;
  const head = `Watchtower: last round ${utc(s.updatedAt)} (${ago(s.updatedAt)})${stale ? ' (late: GitHub runs schedules on a best-effort basis)' : ''}`;
  if (!domain) return { cls: s.domains.some((d) => d.status === 'mismatch' || d.status === 'unreachable') ? 'bad' : stale ? 'warnsum' : 'ok', text: `${head}; ${s.domains.map((d) => `${d.domain} ${WORDS[d.status] ?? d.status}${d.release ? ` (release #${d.release})` : ''}`).join('; ') || 'watching no domain'}${s.operator ? `; file-store operator grant valid for ${s.operator.daysLeft} more days` : ''}.` };
  const d = s.domains.find((x) => x.domain === domain);
  if (!d) return { cls: 'dim', text: `${head}; it doesn't watch ${domain} (watched with Pro).` };
  return { cls: d.status === 'ok' ? 'ok' : d.status === 'mismatch' || d.status === 'unreachable' ? 'bad' : 'dim', text: `${head}: ${domain} ${WORDS[d.status] ?? d.status}${d.release ? ` (release #${d.release})` : ''}${d.checkedAt ? `, checked ${ago(d.checkedAt)}` : ''}.` };
}

// ---- the domain proof (docs/domain-ownership.md): the dashboard, /prove and the badge show a project as sealed
// only if its domain names its gate in /.well-known/signet.json. Read cross-origin, so the domain must allow it
// (Access-Control-Allow-Origin: *); a blocked read is "unreachable", never "confirmed".
export type Proof = 'confirmed' | 'not-confirmed' | 'unreachable';
export async function domainProof(domain: string, gate: string): Promise<Proof> {
  const url = `${__SIGNET_PROOF_ORIGIN__.replace('{domain}', domain)}${PROOF_PATH}`;
  let res: Response;
  try {
    res = await fetch(url, { mode: 'cors', cache: 'no-store', credentials: 'omit', redirect: 'error' });
  } catch {
    return 'unreachable';
  }
  if (!res.ok) return 'not-confirmed';
  return proofNames((await res.text()).slice(0, 4096), gate, NET.chainId) ? 'confirmed' : 'not-confirmed';
}
export const PROOF_WORDS: Record<Proof, string> = {
  confirmed: 'The domain confirms this gate (/.well-known/signet.json).',
  'not-confirmed': "Not verified: this site hasn't confirmed this gate. Its /.well-known/signet.json is missing or names another gate.",
  unreachable: "Not verified: the domain's /.well-known/signet.json couldn't be read from here (it must allow cross-origin reads: Access-Control-Allow-Origin: *).",
};
export const GATE_ABI = gateAbi as unknown as Abi;
export const FACTORY_ABI = factoryAbi as unknown as Abi;

export const enc = (to: Address, abi: Abi, functionName: string, args: unknown[] = []): Call => ({ to, data: encodeFunctionData({ abi, functionName, args }) });
export const dec = <T>(abi: Abi, functionName: string, data: string): T => {
  if (data === 'revert') throw new Error(`${functionName} reverted`);
  return decodeFunctionResult({ abi, functionName, data: data as Hex }) as T;
};
/// Facts: two RPCs that must agree (staging may have one; then that one), at one block: the newest both have, or
/// `block` when the caller pins several reads to the same block (/prove).
/// More calls than one JSON-RPC batch holds (3, xlayer.drpc.org's limit) go through Multicall3's aggregate3 in chunks
/// of MC_CHUNK, one eth_call each (measured 2026-11-25 on both mainnet RPCs: 128 `eval`s of the policy circuit are
/// 11.8M gas and answer in 0.4–1.2 s; 512 are 47M, too close to the RPCs' 50M eth_call cap). A call that reverts
/// inside the multicall is "revert", as in a plain batch, so both RPCs are compared the same way.
export const MC_CHUNK = 128;
const mcAbi = [{ type: 'function', name: 'aggregate3', stateMutability: 'payable', inputs: [{ type: 'tuple[]', components: [{ name: 'target', type: 'address' }, { name: 'allowFailure', type: 'bool' }, { name: 'callData', type: 'bytes' }] }], outputs: [{ type: 'tuple[]', components: [{ name: 'success', type: 'bool' }, { name: 'returnData', type: 'bytes' }] }] }] as const satisfies Abi;
export const head = (): Promise<number> => commonHead(NET);
const rawAt = (calls: Call[], block: number): Promise<string[]> => (NET.rpcUrl2 ? agreeAt(NET, calls, block) : callOne(NET.rpcUrl, calls, block));
export async function read(calls: Call[], block?: number): Promise<string[]> {
  const at = block ?? (await head());
  if (calls.length <= MAX_BATCH) return rawAt(calls, at);
  const chunks: Call[][] = [];
  for (let i = 0; i < calls.length; i += MC_CHUNK) chunks.push(calls.slice(i, i + MC_CHUNK));
  const wrapped = chunks.map((c) => ({ to: MULTICALL3 as Address, data: encodeFunctionData({ abi: mcAbi, functionName: 'aggregate3', args: [c.map((x) => ({ target: x.to, allowFailure: true, callData: x.data }))] }) }));
  const out: string[] = [];
  for (let i = 0; i < wrapped.length; i += MAX_BATCH) {
    const got = await rawAt(wrapped.slice(i, i + MAX_BATCH), at);
    for (const g of got) {
      if (g === 'revert') throw new Error('Multicall3 reverted');
      for (const r of decodeFunctionResult({ abi: mcAbi, functionName: 'aggregate3', data: g as Hex })) out.push(r.success ? r.returnData : 'revert');
    }
  }
  return out;
}
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
