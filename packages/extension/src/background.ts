// Guard service worker. Holds what the chain says about sealed domains, decides signing requests, sets the
// badge. Privacy (hard rule 8): the only thing fetched without a sealed domain being involved is the public
// list of sealed domains (the registry's own domain list), on a timer. A visited host is compared with that
// list locally; for a host that is not on it, nothing is sent anywhere.
import { decodeFunctionResult, encodeFunctionData, hexToBytes, sha256, zeroAddress } from 'viem';
import { gateAbi, registryAbi, siteAbi } from './lib/abi.ts';
import { agree, either, RpcError, type Call } from './lib/rpc.ts';
import { parseSealed, ALLOWLIST_PATH, ORIGINS_PATH, FILES_PATH } from './lib/sealed.ts';
import { decide, factsOf } from './lib/policy.ts';
import { decideWithCircuit } from './lib/guard-circuit.ts';
import { domainOfGatewayHost, encodeLabel } from './lib/label.ts';
import type { Decision, GuardEvent, Hex, Net, PageInfo, PageReport, Sealed, SignRequest, SiteState } from './lib/types.ts';

declare const __NET__: Net;
/// Benchmark-only build (packages/attacks, docs/benchmark.md): the page check alone, as a hash-only checker does it.
/// The signing-time allowlist is off: targets, spenders, recipients and decoding are treated as fine.
declare const __HASH_ONLY__: boolean;
const NET = __NET__;
const FRESH_MS = 60_000; // re-read the chain for a sealed domain at most once a minute
const STALE_MS = 24 * 3600_000; // RPCs down: the cached release is used for up to 24 h (spec, "X Layer RPC down")
const SYNC_MINUTES = 5;
const local = chrome.storage.local;
const session = chrome.storage.session;
const get = async <T>(area: chrome.storage.StorageArea, key: string): Promise<T | undefined> => (await area.get(key))[key] as T | undefined;

// ---------------------------------------------------------------- the list of sealed domains

interface DomainList { list: string[]; syncedAt: number }
let syncing: Promise<void> | null = null;
const PAGE = 100;

/// The registry keeps every claimed domain in an append-only list (domainCount / domainsRange). Only the new
/// tail is read, and like every chain fact both RPCs must give the same answer; otherwise the list stays as it is.
async function syncDomains(): Promise<void> {
  if (!NET.registry) return;
  const state = (await get<DomainList>(local, 'domains')) ?? { list: [], syncedAt: 0 };
  const [c] = await agree(NET, [call(NET.registry, registryAbi, 'domainCount')]);
  const count = Number(out<bigint>(registryAbi, 'domainCount', c!));
  const list = [...state.list];
  while (list.length < count) {
    const [page] = await agree(NET, [call(NET.registry, registryAbi, 'domainsRange', [BigInt(list.length), BigInt(PAGE)])]);
    const more = out<string[]>(registryAbi, 'domainsRange', page!);
    if (more.length === 0) break;
    list.push(...more);
  }
  await local.set({ domains: { list, syncedAt: Date.now() } satisfies DomainList });
}
const sync = () => (syncing ??= syncDomains().catch(() => {}).finally(() => (syncing = null)));

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create('sync', { periodInMinutes: SYNC_MINUTES });
  void sync();
});
chrome.runtime.onStartup.addListener(() => void sync());
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'sync') void sync();
});

// ---------------------------------------------------------------- what the chain says about one domain

const call = (to: Hex, abi: typeof gateAbi | typeof registryAbi | typeof siteAbi, functionName: string, args: unknown[] = []): Call => ({ to, data: encodeFunctionData({ abi, functionName, args } as never) });
const out = <T>(abi: typeof gateAbi | typeof registryAbi | typeof siteAbi, functionName: string, data: string): T => {
  if (data === 'revert') throw new RpcError(`${functionName} reverted`);
  return decodeFunctionResult({ abi, functionName, data: data as Hex } as never) as T;
};

async function readFile(container: Hex, path: string): Promise<Uint8Array | null> {
  const data = await either(NET, call(NET.siteRegistry, siteAbi, 'read', [container, path]));
  if (data === 'revert') return null; // NoSuchFile
  const bytes = hexToBytes(out<Hex>(siteAbi, 'read', data));
  return bytes.length ? bytes : null;
}

async function refreshSite(domain: string, cached: SiteState | undefined): Promise<SiteState> {
  if (!NET.registry) throw new RpcError('Signet is not deployed on this network');
  const base = { domain, checkedAt: Date.now(), stale: false, reason: '', gate: null, container: null, prefix: '', enforced: false, frozen: false, release: 0, approvers: [], current: null, valid: [], manifests: {} } satisfies Partial<SiteState>;
  const [b] = await agree(NET, [call(NET.registry, registryAbi, 'bindingOf', [domain])]);
  const [gate, container, prefix] = out<[Hex, Hex, string]>(registryAbi, 'bindingOf', b!);
  if (gate === zeroAddress) return { ...base, status: 'unbound', reason: 'The registry does not bind this domain to a gate.' };
  const known = Object.keys(cached?.manifests ?? {}) as Hex[];
  const r = await agree(NET, [
    call(gate, gateAbi, 'activeRelease'), call(gate, gateAbi, 'currentManifestHash'), call(gate, gateAbi, 'currentRelease'),
    call(gate, gateAbi, 'enforced'), call(gate, gateAbi, 'frozen'), call(gate, gateAbi, 'getApprovers'),
    ...known.map((h) => call(gate, gateAbi, 'isValidManifest', [h])),
  ]);
  const [filesRoot, allowlistHash, originsHash, ok] = out<[Hex, Hex, Hex, boolean]>(gateAbi, 'activeRelease', r[0]!);
  const current = out<Hex>(gateAbi, 'currentManifestHash', r[1]!);
  const state = {
    ...base, gate, container, prefix, current,
    release: Number(out<bigint>(gateAbi, 'currentRelease', r[2]!)), enforced: out<boolean>(gateAbi, 'enforced', r[3]!),
    frozen: out<boolean>(gateAbi, 'frozen', r[4]!), approvers: [...out<string[]>(gateAbi, 'getApprovers', r[5]!)],
  };
  if (state.release === 0) return { ...state, current: null, status: 'no-release', reason: 'This domain is bound to a gate that has not published a release yet.' };
  if (!ok) return { ...state, status: 'revoked', reason: 'The team revoked the current release.' };

  // manifests still valid on-chain: the current one, and the previous one during its grace window
  const manifests: Record<string, Sealed> = {};
  known.forEach((h, i) => {
    if (h !== current && out<boolean>(gateAbi, 'isValidManifest', r[6 + i]!)) manifests[h] = cached!.manifests[h]!;
  });
  let sealed = cached?.manifests[current];
  if (!sealed) {
    // H-1, off-chain half: the files in the container count only if they hash to what the gate published
    const bytes = await Promise.all([ALLOWLIST_PATH, ORIGINS_PATH, FILES_PATH].map((p) => readFile(container, prefix + p)));
    if (bytes.some((x) => x === null)) return { ...state, manifests, valid: [], status: 'unverified', reason: "The release's manifest files are not in the container yet." };
    try {
      sealed = parseSealed(domain, bytes[0]!, bytes[1]!, bytes[2]!);
    } catch (e) {
      return { ...state, manifests, valid: [], status: 'unverified', reason: `The manifest files in the container can't be read: ${(e as Error).message}.` };
    }
    if (sealed.filesRoot !== filesRoot || sealed.allowlistHash !== allowlistHash || sealed.originsHash !== originsHash || sealed.manifestHash !== current) {
      return { ...state, manifests, valid: [], status: 'unverified', reason: 'The manifest files in the container do not hash to the release published on-chain. They were rejected.' };
    }
  }
  manifests[current] = sealed;
  return { ...state, manifests, valid: Object.keys(manifests) as Hex[], status: 'sealed', reason: '' };
}

const inflight = new Map<string, Promise<SiteState>>();
function getSite(domain: string): Promise<SiteState> {
  const running = inflight.get(domain);
  if (running) return running;
  const p = (async (): Promise<SiteState> => {
      const cached = await get<SiteState>(local, `site:${domain}`);
      if (cached && !cached.stale && Date.now() - cached.checkedAt < FRESH_MS) return cached;
      try {
        const fresh = await refreshSite(domain, cached);
        await local.set({ [`site:${domain}`]: fresh });
        return fresh;
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        // Could not read the chain. A release verified less than 24 h ago still counts; otherwise: unverified.
        if (cached && cached.status === 'sealed' && Date.now() - cached.checkedAt < STALE_MS) return { ...cached, stale: true, reason: `Using the release checked earlier: ${why}.` };
        return { domain, status: 'unverified', reason: `Could not check the chain: ${why}.`, checkedAt: 0, stale: true, gate: cached?.gate ?? null, container: cached?.container ?? null, prefix: cached?.prefix ?? '', enforced: false, frozen: false, release: 0, approvers: [], current: null, valid: [], manifests: {} };
      }
  })().finally(() => inflight.delete(domain));
  inflight.set(domain, p);
  return p;
}

// ---------------------------------------------------------------- tabs, badge, events

interface TabState { domain: string; url: string; report: PageReport | null }
type Light = 'green' | 'red' | 'grey';
const BADGE: Record<Light, { text: string; color: string }> = { green: { text: 'OK', color: '#1a7f37' }, red: { text: '!', color: '#cf222e' }, grey: { text: '?', color: '#6e7781' } };

export function lightOf(site: SiteState, report: PageReport | null): Light {
  if (site.status === 'revoked') return 'red';
  if (report?.status === 'tampered' && site.status === 'sealed') return 'red';
  if (site.status !== 'sealed' || !report || report.status !== 'ok') return 'grey';
  return 'green';
}

async function paint(tabId: number, site: SiteState | null, report: PageReport | null): Promise<void> {
  try {
    if (!site) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      await chrome.action.setTitle({ tabId, title: 'Signet Guard' });
      return;
    }
    const light = lightOf(site, report);
    await chrome.action.setBadgeText({ tabId, text: BADGE[light].text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE[light].color });
    const words = light === 'green' ? `Sealed · release #${site.release} · 3 approvers` : light === 'red' ? "This page doesn't match its sealed release" : site.reason || 'Not fully checked';
    await chrome.action.setTitle({ tabId, title: `Signet Guard: ${site.domain}\n${words}` });
  } catch { /* the tab is gone */ }
}

async function logEvent(e: GuardEvent): Promise<void> {
  const events = (await get<GuardEvent[]>(local, 'events')) ?? [];
  events.unshift(e);
  await local.set({ events: events.slice(0, 200) });
}

const blockedUrl = (tabId: number, domain: string, url: string) => `${chrome.runtime.getURL('blocked.html')}#${new URLSearchParams({ tab: String(tabId), domain, url })}`;

// ---------------------------------------------------------------- messages

type Msg =
  | { type: 'site'; host: string; url: string }
  | { type: 'report'; report: PageReport }
  | { type: 'sign'; req: SignRequest }
  | { type: 'tab-info'; tabId: number }
  | { type: 'bypass'; tabId: number; domain: string; url: string }
  | { type: 'wrong-block'; domain: string; note: string }
  | { type: 'open-copy'; domain: string }
  | { type: 'copy'; domain: string }
  | { type: 'copy-file'; domain: string; path: string };

async function handle(msg: Msg, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const tabId = sender.tab?.id;
  switch (msg.type) {
    case 'site': {
      if (tabId === undefined) return null;
      const domains = (await get<DomainList>(local, 'domains'))?.list ?? [];
      // the gateway shows a sealed domain's verified copy on <label>.<gateway>: Guard treats it as that domain
      const viaGateway = NET.gateway ? domainOfGatewayHost(new URL(msg.url).host, new URL(NET.gateway.url).host) : null;
      const host = viaGateway ?? msg.host;
      if (!domains.includes(host)) {
        // not a sealed domain: no lookup, no request, nothing kept
        await session.remove(`tab:${tabId}`);
        void paint(tabId, null, null);
        return null;
      }
      const site = await getSite(host);
      if (site.status === 'unbound') {
        void paint(tabId, null, null);
        return null;
      }
      await session.set({ [`tab:${tabId}`]: { domain: host, url: msg.url, report: null } satisfies TabState });
      void paint(tabId, site, null);
      const hashes: Record<string, string[]> = {};
      for (const h of site.valid) for (const f of site.manifests[h]!.files) (hashes[f.path] ??= []).push(f.sha256.slice(2));
      const cur = site.current ? site.manifests[site.current] : undefined;
      const info: PageInfo = {
        domain: host, site: site.status, reason: site.reason, enforce: site.enforced,
        bypass: !!(await get<boolean>(session, `bypass:${tabId}:${host}`)),
        hashes, origins: cur?.origins ?? [], scripts: site.valid.flatMap((h) => site.manifests[h]!.scripts),
        gateway: viaGateway ? NET.gateway!.pins : null,
      };
      return info;
    }
    case 'report': {
      if (tabId === undefined) return null;
      const tab = await get<TabState>(session, `tab:${tabId}`);
      if (!tab) return null;
      const site = await getSite(tab.domain);
      const before = tab.report?.status;
      await session.set({ [`tab:${tabId}`]: { ...tab, report: msg.report } satisfies TabState });
      void paint(tabId, site, msg.report);
      const bad = site.status === 'revoked' || (site.status === 'sealed' && msg.report.status === 'tampered');
      if (!bad) return { redirect: false };
      const bypass = !!(await get<boolean>(session, `bypass:${tabId}:${tab.domain}`));
      const block = site.enforced && !bypass;
      if (before !== 'tampered') {
        const wrong = msg.report.files.filter((f) => ['mismatch', 'unknown', 'unknown-origin', 'sri-mismatch'].includes(f.status));
        await logEvent({
          at: Date.now(), domain: tab.domain, kind: 'page', refused: block, url: msg.report.url,
          title: site.status === 'revoked' ? 'Release revoked' : "Page doesn't match its sealed release",
          reason: site.status === 'revoked' ? site.reason : `${wrong.length} file(s) differ from release #${site.release}.`,
          details: wrong.map((f) => `${f.status}  ${f.url}`),
        });
      }
      if (block) void chrome.tabs.update(tabId, { url: blockedUrl(tabId, tab.domain, msg.report.url) });
      return { redirect: block };
    }
    case 'sign': {
      const tab = tabId === undefined ? undefined : await get<TabState>(session, `tab:${tabId}`);
      const allow: Decision = { by: 'mirror', input: 0, action: 'allow', enforced: false, refused: false, title: '', reason: '', details: [] };
      if (!tab) return allow;
      const site = await getSite(tab.domain);
      const ctx = { site: site.status, page: tab.report?.status ?? 'unknown', allowlist: site.current ? (site.manifests[site.current]?.allowlist ?? null) : null, frozen: site.frozen, enforced: site.enforced } as const;
      const verdict = decide(msg.req, ctx);
      // the policy names the facts; the Guard decision circuit decides
      const facts = factsOf(verdict, ctx);
      if (__HASH_ONLY__) Object.assign(facts, { targetSealed: true, spenderSealed: true, recipientOk: true, decoded: true });
      const answer = await decideWithCircuit(NET, facts, {
        get: () => get(local, 'guardCircuit'),
        set: (c) => local.set({ guardCircuit: c }),
      });
      const action = answer.out.BLOCK ? 'block' : answer.out.WARN ? 'warn' : 'allow';
      const d: Decision = { ...verdict, by: answer.by, input: answer.input, action, enforced: site.enforced, refused: action === 'block' };
      if (action !== 'allow') {
        const how = `decided by ${answer.by === 'mirror' ? `the local mirror (${answer.why})` : `the Guard circuit, row 0x${answer.input.toString(16).padStart(3, '0')}${answer.by === 'circuit-cached' ? ', cached' : ''}`}`;
        await logEvent({ at: Date.now(), domain: tab.domain, kind: 'sign', refused: d.refused, url: tab.url, title: verdict.title, reason: verdict.reason, details: [msg.req.method, ...verdict.details, how] });
      }
      return d;
    }
    case 'tab-info': {
      const tab = await get<TabState>(session, `tab:${msg.tabId}`);
      if (!tab) return null;
      const site = await getSite(tab.domain);
      const events = ((await get<GuardEvent[]>(local, 'events')) ?? []).filter((e) => e.domain === tab.domain).slice(0, 20);
      const { manifests: _m, ...brief } = site;
      return { tab, site: brief, light: lightOf(site, tab.report), events, files: site.current ? site.manifests[site.current]?.files.length : 0 };
    }
    case 'bypass': {
      await session.set({ [`bypass:${msg.tabId}:${msg.domain}`]: true });
      await chrome.tabs.update(msg.tabId, { url: msg.url });
      return true;
    }
    case 'wrong-block': {
      // Nothing is sent anywhere: the report is built locally and handed to the user to pass on to the team.
      const site = await getSite(msg.domain);
      const events = ((await get<GuardEvent[]>(local, 'events')) ?? []).filter((e) => e.domain === msg.domain).slice(0, 10);
      const report = {
        kind: 'signet-guard-wrong-block', guard: chrome.runtime.getManifest().version, at: new Date().toISOString(), domain: msg.domain, note: msg.note,
        gate: site.gate, release: site.release, manifest: site.current, mode: site.enforced ? 'enforce' : 'observe', site: site.status, events,
      };
      const reports = (await get<unknown[]>(local, 'reports')) ?? [];
      await local.set({ reports: [report, ...reports].slice(0, 20) });
      return JSON.stringify(report, null, 2);
    }
    case 'open-copy': {
      // opened by the worker: a page can't open an extension page itself (nothing here is web-accessible)
      // with a gateway: the copy is a normal page on its own origin, where the wallet works. Without one (or for a
      // domain too long for a DNS label): the preview inside the extension.
      const label = NET.gateway ? encodeLabel(msg.domain) : null;
      const g = NET.gateway ? new URL(NET.gateway.url) : null;
      await chrome.tabs.create({ url: label && g ? `${g.protocol}//${label}.${g.host}/` : `${chrome.runtime.getURL('copy.html')}#${new URLSearchParams({ domain: msg.domain })}` });
      return true;
    }
    case 'copy': {
      // The verified copy: which sealed files are stored in the container, checked against the sealed hash.
      const site = await getSite(msg.domain);
      const sealed = site.current ? site.manifests[site.current] : undefined;
      if (site.status !== 'sealed' || !sealed || !site.container) return { ok: false, reason: site.reason || 'No verified release for this domain.' };
      return { ok: true, domain: site.domain, release: site.release, manifest: site.current, container: site.container, prefix: site.prefix, files: sealed.files };
    }
    case 'copy-file': {
      const site = await getSite(msg.domain);
      const f = site.current ? site.manifests[site.current]?.files.find((x) => x.path === msg.path) : undefined;
      if (!f || !site.container) return { ok: false, why: 'not a sealed file' };
      const bytes = await readFile(site.container, site.prefix + msg.path).catch(() => null);
      if (!bytes) return { ok: false, why: 'not stored on-chain' };
      if (sha256(bytes) !== f.sha256) return { ok: false, why: 'the stored bytes do not match the sealed hash' };
      let bin = '';
      for (const x of bytes) bin += String.fromCharCode(x);
      return { ok: true, contentType: f.contentType, base64: btoa(bin) };
    }
  }
}

chrome.runtime.onMessage.addListener((msg: Msg, sender, respond) => {
  handle(msg, sender).then(respond, () => respond(null));
  return true;
});
chrome.tabs.onRemoved.addListener((tabId) => void session.remove(`tab:${tabId}`));
// Chrome clears a tab's badge on every navigation. When a tab was sent to the warning page, its state is still
// here (a sealed or unsealed page would have replaced or removed it at document_start): paint it again.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== 'complete') return;
  void (async () => {
    const tab = await get<TabState>(session, `tab:${tabId}`);
    if (tab?.report) void paint(tabId, await getSite(tab.domain), tab.report);
  })();
});
// No sync on wake-up: the worker wakes for every page, and the list download must not follow the user's browsing.
