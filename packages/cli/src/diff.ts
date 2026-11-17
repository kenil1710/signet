// Diff Guard: what a proposed release changes, compared with the release it would replace, in plain words.
// Pure functions here (no chain access, no Node APIs: the dashboard bundles this file); `signet diff` in commands.ts feeds them with hash-checked inputs.
// The JSON form (`DiffReport`) is what the dashboard renders.
import { CALL_KINDS, findCalls, isCode, snippetAt, type CallSite } from './calls.ts';
import { extractAddresses, extractOrigins } from './extract.ts';
import type { SealedLists, SealedFile, SealedScript } from './seal.ts';

const extname = (p: string) => (/\.[^./]+$/.exec(p)?.[0] ?? '');

export interface Where { file: string; snippet: string }
export interface AddressChange { chainId: string; address: string; roles: string[]; where: Where[] }
export interface DiffReport {
  version: 1;
  domain: string;
  base: { release: string; manifestHash: string } | null; // null: first release, nothing to compare with
  proposal: { manifestHash: string; filesRoot: string; allowlistHash: string; originsHash: string };
  files: {
    added: { path: string; size: number }[];
    removed: { path: string; size: number }[];
    changed: { path: string; from: string; size: number; sizeBefore: number }[]; // `from` differs for hashed file names
    unchanged: number;
  };
  allowlist: { added: AddressChange[]; removed: AddressChange[] };
  transfers: { chainId: string; from: string; to: string }[]; // who token transfers may go to: "user" | "allowlist" | "any"
  origins: { added: { origin: string; where: Where[] }[]; removed: string[] };
  scripts: { added: SealedScript[]; removed: SealedScript[]; sriChanged: { url: string; from: string | null; to: string | null }[] };
  calls: {
    baseKnown: boolean; // false: the base release was sealed without call counts, so "new" can't be told
    added: { kind: string; label: string; count: number; before: number; where: Where[] }[];
    removed: { kind: string; label: string; count: number; before: number }[];
  };
  tier: { expected: number; name: string; allowlistChanged: boolean; originsChanged: boolean; why: string[] };
  flags: string[]; // the lines a reviewer must not miss
}

export const TIER_NAMES = ['00 code only', '01 new external origin', '10 allowlist changed', '11 admin change'];
export const TRANSFER_WORDS: Record<string, string> = { user: "only to the user's own address", allowlist: "to the user or a sealed contract", any: 'to ANY address' };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/// "assets/app-3f9a1c2b.js" and "assets/app-77aa01de.js" are the same file with a new content hash.
function stem(path: string): string {
  return path.replace(/[-._][A-Za-z0-9_-]{8,}(?=\.[A-Za-z0-9]+$)/, '');
}

function diffFiles(base: SealedFile[], next: SealedFile[]): DiffReport['files'] {
  const before = new Map(base.map((f) => [f.path, f]));
  const after = new Map(next.map((f) => [f.path, f]));
  const changed: DiffReport['files']['changed'] = [];
  let added = next.filter((f) => !before.has(f.path));
  let removed = base.filter((f) => !after.has(f.path));
  let unchanged = 0;
  for (const f of next) {
    const b = before.get(f.path);
    if (!b) continue;
    if (b.sha256 === f.sha256) unchanged++;
    else changed.push({ path: f.path, from: f.path, size: f.size, sizeBefore: b.size });
  }
  for (const a of [...added]) {
    const twins = removed.filter((r) => stem(r.path) === stem(a.path) && extname(r.path) === extname(a.path));
    if (twins.length !== 1 || added.filter((x) => stem(x.path) === stem(a.path)).length !== 1) continue;
    changed.push({ path: a.path, from: twins[0]!.path, size: a.size, sizeBefore: twins[0]!.size });
    added = added.filter((x) => x !== a);
    removed = removed.filter((x) => x !== twins[0]);
  }
  const brief = (f: SealedFile) => ({ path: f.path, size: f.size });
  return { added: added.map(brief), removed: removed.map(brief), changed: changed.sort((a, b) => (a.path < b.path ? -1 : 1)), unchanged };
}

const ROLES = [['targets', 'contract'], ['spenders', 'spender'], ['eip712', 'EIP-712 verifier']] as const;

function rolesByAddress(lists: SealedLists | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [chainId, a] of Object.entries(lists?.allowlist ?? {})) {
    for (const [key, role] of ROLES) for (const addr of a[key] ?? []) {
      const k = `${chainId}:${addr}`;
      out.set(k, [...(out.get(k) ?? []), role]);
    }
  }
  return out;
}

/// `code(path)` returns a text file's content from the proposed build (to show where something was found).
export function diffSealed(domain: string, base: (SealedLists & { release: string }) | null, next: SealedLists, code: (path: string) => string): DiffReport {
  const files = diffFiles(base?.files ?? [], next.files);
  const texts = next.files.filter((f) => /\.(m?js|html?|css|json|svg|txt|xml|webmanifest)$/i.test(f.path)).map((f) => ({ file: f.path, text: code(f.path) }));
  const touched = new Set([...files.added.map((f) => f.path), ...files.changed.map((f) => f.path)]);
  // where something new was found: files this release touched first
  const order = [...texts].sort((a, b) => Number(touched.has(b.file)) - Number(touched.has(a.file)));
  const locate = (needle: string, has: (text: string) => boolean): Where[] => {
    const out: Where[] = [];
    for (const t of order) {
      if (!has(t.text)) continue;
      const i = t.text.toLowerCase().indexOf(needle.toLowerCase());
      out.push({ file: t.file, snippet: i >= 0 ? snippetAt(t.text, i, needle.length) : '' });
    }
    return out;
  };

  // allowlist: an address with a new role counts as added for that role
  const before = rolesByAddress(base);
  const after = rolesByAddress(next);
  const change = (from: Map<string, string[]>, to: Map<string, string[]>, find: boolean): AddressChange[] => {
    const out: AddressChange[] = [];
    for (const [k, roles] of to) {
      const fresh = roles.filter((r) => !(from.get(k) ?? []).includes(r));
      if (fresh.length === 0) continue;
      const [chainId, address] = k.split(':') as [string, string];
      out.push({ chainId, address, roles: fresh, where: find ? locate(address, (t) => extractAddresses(t).includes(address)) : [] });
    }
    return out;
  };
  const allowlist = { added: change(before, after, true), removed: change(after, before, false) };

  // the transfer rule per chain (a release sealed before the setting existed counts as "user")
  const transfers: DiffReport['transfers'] = [];
  if (base) for (const [chainId, a] of Object.entries(next.allowlist)) {
    const from = base.allowlist[chainId]?.transfers ?? 'user';
    const to = a.transfers ?? 'user';
    if (from !== to) transfers.push({ chainId, from, to });
  }

  const baseOrigins = new Set(base?.origins ?? []);
  const origins = {
    added: next.origins.filter((o) => !baseOrigins.has(o)).map((origin) => ({ origin, where: locate(origin, (t) => extractOrigins(t).includes(origin)) })),
    removed: [...baseOrigins].filter((o) => !next.origins.includes(o)),
  };

  const baseScripts = new Map((base?.scripts ?? []).map((s) => [s.url, s]));
  const nextScripts = new Map(next.scripts.map((s) => [s.url, s]));
  const scripts = {
    added: next.scripts.filter((s) => !baseScripts.has(s.url)),
    removed: (base?.scripts ?? []).filter((s) => !nextScripts.has(s.url)),
    sriChanged: next.scripts.filter((s) => baseScripts.has(s.url) && baseScripts.get(s.url)!.integrity !== s.integrity).map((s) => ({ url: s.url, from: baseScripts.get(s.url)!.integrity, to: s.integrity })),
  };

  // signing calls: counted over the whole build, because bundlers move code between chunks
  const sites: CallSite[] = texts.filter((t) => isCode(t.file)).flatMap((t) => findCalls(t.file, t.text));
  const baseKnown = !base || base.calls !== null;
  const calls: DiffReport['calls'] = { baseKnown, added: [], removed: [] };
  for (const k of CALL_KINDS) {
    const mine = sites.filter((s) => s.kind === k.kind);
    const was = base?.calls?.[k.kind] ?? 0;
    const where = [...mine].sort((a, b) => Number(touched.has(b.file)) - Number(touched.has(a.file))).map((s) => ({ file: s.file, snippet: s.snippet }));
    if (mine.length > was) calls.added.push({ kind: k.kind, label: k.label, count: mine.length, before: was, where: baseKnown && base ? where.slice(0, Math.max(mine.length - was, 1)) : where.slice(0, 3) });
    else if (mine.length < was) calls.removed.push({ kind: k.kind, label: k.label, count: mine.length, before: was });
  }

  // the tier, by the same rule as ReleaseGate._tier (the chain's value is the one that counts)
  const allowlistChanged = !base || base.allowlistHash !== next.allowlistHash;
  const originsChanged = !base || base.originsHash !== next.originsHash;
  const expected = allowlistChanged ? 2 : originsChanged ? 1 : 0;
  const why: string[] = [];
  const allowWords = [
    allowlist.added.length ? `${plural(allowlist.added.length, 'new address', 'new addresses')} (${allowlist.added.map((a) => a.roles.join(' + ')).join(', ')})` : '',
    allowlist.removed.length ? `${plural(allowlist.removed.length, 'address', 'addresses')} removed` : '',
    transfers.length ? `the token-transfer rule changed (${transfers.map((t) => `${t.from} -> ${t.to}`).join(', ')})` : '',
  ].filter(Boolean).join(', ');
  const originWords = [
    origins.added.length ? plural(origins.added.length, 'new external origin') : '',
    origins.removed.length ? `${plural(origins.removed.length, 'origin')} removed` : '',
    scripts.sriChanged.length ? `${plural(scripts.sriChanged.length, 'cross-origin script')} with a changed SRI hash` : '',
    scripts.added.length ? plural(scripts.added.length, 'new cross-origin script') : '',
    scripts.removed.length ? `${plural(scripts.removed.length, 'cross-origin script')} removed` : '',
  ].filter(Boolean).join(', ');
  if (!base) why.push('This is the first release (or every earlier one is revoked): there is nothing to compare with, so the whole allowlist counts as new.');
  else {
    if (allowlistChanged) why.push(`The allowlist changed: ${allowWords}. What the site may ask a wallet to sign is different from release #${base.release}.`);
    if (originsChanged) why.push(`The external origins changed: ${originWords}.${allowlistChanged ? ' Alone that would be tier 01; the allowlist change makes it tier 10, and the emergency fast lane is refused for this combination.' : ''}`);
    if (!allowlistChanged && !originsChanged) why.push('The allowlist and the external origins (with their SRI hashes) are byte-for-byte the same as the current release. Only code changed.');
  }

  const flags: string[] = [];
  for (const a of allowlist.added) flags.push(`NEW ${a.roles.join(' + ')} ${a.address} on chain ${a.chainId}${a.where[0] ? `, found in ${a.where[0].file}` : ' (from signet.config.json, not found in the code)'}`);
  for (const t of transfers) flags.push(`CHANGED token-transfer rule on chain ${t.chainId}: ${TRANSFER_WORDS[t.to] ?? t.to} (was: ${TRANSFER_WORDS[t.from] ?? t.from})`);
  for (const o of origins.added) flags.push(`NEW external origin ${o.origin}${o.where[0] ? `, found in ${o.where[0].file}` : ''}`);
  for (const s of scripts.sriChanged) flags.push(`CHANGED SRI hash for ${s.url}: the script's bytes are different`);
  for (const s of scripts.added) flags.push(`NEW cross-origin script ${s.url}${s.integrity ? '' : ' WITHOUT an SRI hash'}`);
  if (base) for (const c of calls.added) flags.push(`${baseKnown ? 'NEW' : 'PRESENT'} ${c.label} in the code: ${c.count} (was ${baseKnown ? c.before : 'not recorded'})`);

  return {
    version: 1, domain,
    base: base ? { release: base.release, manifestHash: base.manifestHash } : null,
    proposal: { manifestHash: next.manifestHash, filesRoot: next.filesRoot, allowlistHash: next.allowlistHash, originsHash: next.originsHash },
    files, allowlist, transfers, origins, scripts, calls,
    tier: { expected, name: TIER_NAMES[expected]!, allowlistChanged, originsChanged, why },
    flags,
  };
}

/// The report in plain words. `head` and `tail` are lines the command adds (what was checked; the on-chain status).
export function formatDiff(r: DiffReport, head: string[] = [], tail: string[] = []): string {
  const L: string[] = [...head];
  const at = (w: Where[]) => w.slice(0, 2).flatMap((x) => [`        in ${x.file}`, ...(x.snippet ? [`           ${x.snippet}`] : [])]);
  L.push('');
  L.push(`RISK TIER ${r.tier.name.toUpperCase()}`);
  for (const w of r.tier.why) L.push(`  ${w}`);
  L.push(...tail);

  L.push('', 'Contract addresses and spenders');
  if (r.allowlist.added.length + r.allowlist.removed.length + r.transfers.length === 0) L.push('  no change');
  for (const t of r.transfers) L.push(`  ~ CHANGED token transfers (chain ${t.chainId}): now ${TRANSFER_WORDS[t.to] ?? t.to}; before ${TRANSFER_WORDS[t.from] ?? t.from}`);
  for (const a of r.allowlist.added) L.push(`  + NEW ${a.roles.join(' + ')}  ${a.address}  (chain ${a.chainId})`, ...(a.where.length ? at(a.where) : ['        not found in the code: added in signet.config.json']));
  for (const a of r.allowlist.removed) L.push(`  - removed ${a.roles.join(' + ')}  ${a.address}  (chain ${a.chainId})`);

  L.push('', 'External origins');
  if (r.origins.added.length + r.origins.removed.length === 0) L.push('  no change');
  for (const o of r.origins.added) L.push(`  + NEW origin  ${o.origin}`, ...at(o.where));
  for (const o of r.origins.removed) L.push(`  - removed origin  ${o}`);

  L.push('', 'Cross-origin scripts (SRI hashes)');
  if (r.scripts.added.length + r.scripts.removed.length + r.scripts.sriChanged.length === 0) L.push('  no change');
  for (const s of r.scripts.sriChanged) L.push(`  ~ CHANGED SRI  ${s.url}`, `        was ${s.from ?? 'none'}`, `        now ${s.to ?? 'NONE'}`);
  for (const s of r.scripts.added) L.push(`  + NEW script  ${s.url}  ${s.integrity ?? 'NO SRI'}`);
  for (const s of r.scripts.removed) L.push(`  - removed script  ${s.url}`);

  L.push('', 'Approve / permit / transfer calls in the code');
  if (!r.calls.baseKnown) L.push('  The current release was sealed without call counts, so these are all the calls present, not only new ones.');
  if (r.calls.added.length + r.calls.removed.length === 0) L.push('  no new calls');
  for (const c of r.calls.added) L.push(`  + ${r.base && r.calls.baseKnown ? 'NEW ' : ''}${c.label}: ${c.count} in this build${r.base && r.calls.baseKnown ? `, ${c.before} in the current release` : ''}`, ...at(c.where));
  for (const c of r.calls.removed) L.push(`  - ${c.label}: ${c.count} in this build, ${c.before} in the current release`);
  L.push('  (a text scan of the bundled code; calls built at runtime are not found)');

  const f = r.files;
  L.push('', `Files: ${f.changed.length} changed, ${f.added.length} added, ${f.removed.length} removed, ${f.unchanged} unchanged`);
  for (const c of f.changed) L.push(`  ~ ${c.from === c.path ? c.path : `${c.from} -> ${c.path}`}  (${c.sizeBefore} -> ${c.size} bytes)`);
  for (const a of f.added) L.push(`  + ${a.path}  (${a.size} bytes)`);
  for (const d of f.removed) L.push(`  - ${d.path}`);
  return L.join('\n');
}
