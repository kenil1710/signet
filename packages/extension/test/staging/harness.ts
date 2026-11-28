// Test rig for Guard on the staging chain: a sealed project made with the real CLI, a web server that can
// serve the sealed build clean or tampered, two RPC proxies in front of anvil (Guard needs two RPCs; the
// proxies also record every request and can lie or go down), a mock wallet, and headless Chromium with the
// built extension loaded. Not product code.
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Every temp folder the harness makes (projects, builds, browser profiles) is removed when the test process exits,
// so repeated runs don't fill the disk (a benchmark run made ~200). KEEP_TMP=1 keeps them for debugging.
const made: string[] = [];
const tmp = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  made.push(d);
  return d;
};
process.on('exit', () => {
  if (process.env.KEEP_TMP) return;
  for (const d of made) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';
import { createPublicClient, createWalletClient, encodeFunctionData, parseAbi, http as viemHttp, type Address } from 'viem';
import { loadNetwork } from '@signet/contracts/network';

export const net = loadNetwork('local');
export const pub = createPublicClient({ transport: viemHttp(net.rpcUrl) });
export const anvil = (method: string, params: unknown[] = []) => pub.request({ method, params } as never);
const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const CLI = join(ROOT, 'packages/cli/src/cli.ts');
export const DEMO_DIR = join(ROOT, 'docs/demo');
const gateAbi = parseAbi(['function proposer() view returns (address)', 'function enforce()', 'function enforced() view returns (bool)']);

export const USER = '0x1111111111111111111111111111111111111111';
export const TOKEN = '0x1E4a5963aBFD975d8c9021ce480b42188849D41d';
export const ROUTER = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
export const DRAINER = '0xBAD0C0fFeE5BAD0c0ffEe5baD0c0ffeE5baD0C0F';
const pad = (a: string) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
/// What an attacker appends to the main bundle: ask the wallet to approve the drainer for everything.
export const DRAIN_DATA = `0x095ea7b3${pad(DRAINER)}${'f'.repeat(64)}`;
export const TAMPER = `\n;(async()=>{try{const e=window.ethereum;const [a]=await e.request({method:"eth_requestAccounts"});const r=await e.request({method:"eth_sendTransaction",params:[{from:a,to:"${TOKEN}",data:"${DRAIN_DATA}"}]});console.log("DRAINER got "+r)}catch(x){console.log("DRAINER refused: "+x.message)}})();\n`;

// ---------------------------------------------------------------- a sealed project (through the real CLI)

export function signet(dir: string, args: string[], as?: string): string {
  const env: NodeJS.ProcessEnv = { ...process.env, SIGNET_NETWORK: 'local' };
  delete env.SIGNET_PRIVATE_KEY;
  delete env.SIGNET_PROPOSER_KEY;
  const r = spawnSync(process.execPath, [CLI, '-C', dir, ...(as ? ['--as', as] : []), ...args], { encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`signet ${args.join(' ')}\n${r.stdout}${r.stderr}`);
  return r.stdout + r.stderr;
}

export interface Project { dir: string; dist: string; domain: string; gate: Address }

/// init + first release of the demo dApp, published with a full on-chain copy. The gate starts in observe mode.
export async function sealDemoDapp(domain: string, o: { spenders?: string[] } = {}): Promise<Project> {
  const dir = tmp('guard-project-');
  const dist = join(dir, 'dist');
  const b = spawnSync('pnpm', ['--filter', '@signet/demo-dapp', 'build'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SIGNET_NETWORK: 'local' } });
  if (b.status !== 0) throw new Error(`demo-dapp build failed\n${b.stdout}${b.stderr}`);
  cpSync(join(ROOT, 'packages/demo-dapp/dist'), dist, { recursive: true });
  signet(dir, ['init', '--domain', domain, '--approvers', 'approver1,approver2,approver3', '--recovery', 'recovery', '--guardian', 'guardian', '--no-wait'], 'user1');
  await anvil('anvil_mine', ['0x2']);
  signet(dir, ['init'], 'user1');
  const cfgFile = join(dir, 'signet.config.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
  // the team declares who may be given an allowance: the router (Permit2 is recognized by the CLI)
  writeFileSync(cfgFile, JSON.stringify({ ...cfg, allowlist: { '196': { spenders: [ROUTER, ...(o.spenders ?? [])] } } }, null, 2));
  signet(dir, ['domain', dist]); // the domain proof: dist/.well-known/signet.json names this gate
  signet(dir, ['seal', dist]);
  await anvil('anvil_setBalance', [await pub.readContract({ address: cfg.gate, abi: gateAbi, functionName: 'proposer' }), '0xde0b6b3a7640000']);
  const id = signet(dir, ['propose', dist, '--emergency']).match(/Proposed release #(\d+)/)![1]!; // the CI key from init
  for (const a of ['approver1', 'approver2', 'approver3']) signet(dir, ['approve', id], a);
  // these tests move the staging clock by a week per run; the registry's operator grant lasts 30 days
  const renew = spawnSync(join(ROOT, 'staging/renew-operator.sh'), { encoding: 'utf8' });
  if (renew.status !== 0) throw new Error(`staging:renew failed\n${renew.stdout}${renew.stderr}`);
  signet(dir, ['publish', id, dist, '--full'], 'user2');
  return { dir, dist, domain, gate: cfg.gate };
}

/// Observe -> enforce: allowed 7 days after the gate was created, by any approver.
export async function switchToEnforce(p: Project): Promise<void> {
  await anvil('evm_increaseTime', [`0x${(7 * 86400 + 60).toString(16)}`]);
  await anvil('anvil_mine', ['0x1']);
  const wallet = createWalletClient({ transport: viemHttp(net.rpcUrl) });
  const hash = await wallet.sendTransaction({ account: net.accounts!.approvers[0] as Address, to: p.gate, data: encodeFunctionData({ abi: gateAbi, functionName: 'enforce' }), chain: null });
  await until('the enforce transaction', () => pub.getTransactionReceipt({ hash }), 30000);
  if (!(await pub.readContract({ address: p.gate, abi: gateAbi, functionName: 'enforced' }))) throw new Error('the gate did not switch to enforce mode');
}

// ---------------------------------------------------------------- web server

/// tamper: true = the main bundle is tampered on every request; 'once' = on the next request only, then clean.
/// root: serve another build (a new release) from now on; html: serve these bytes as index.html instead of the file;
/// notFound: these bytes instead of the build's 404.html (served, with status 404, for unknown paths when it has one).
/// proof: what /.well-known/signet.json answers. undefined = the sealed file (the domain confirms its gate);
/// 'drop' = 404 (a domain that never confirmed this gate, or a hijack that removes the file); a string = that body.
export interface Site { port: number; log: string[]; tamper: boolean | 'once'; proof?: 'drop' | string; root?: string; html?: Buffer; notFound?: Buffer; close(): void }

/// Serves the sealed build for any *.signet.test host and a small unsealed page for every other host.
export async function serveSite(dist: string): Promise<Site> {
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const main = `assets/${readdirSync(join(dist, 'assets')).find((f) => /^index-.*\.js$/.test(f))}`;
  const site: Site = { port: 0, log: [], tamper: false, close: () => server.close() };
  const server = http.createServer((req, res) => {
    const host = (req.headers.host ?? '').split(':')[0]!;
    const path = req.url!.split('?')[0]!;
    site.log.push(`${host}${path}`);
    if (!host.endsWith('.signet.test')) {
      if (path === '/') {
        res.setHeader('content-type', 'text/html');
        res.end('<!doctype html><title>Unsealed</title><h1>An ordinary site</h1><script src="/app.js"></script>');
      } else if (path === '/app.js') {
        res.setHeader('content-type', 'text/javascript');
        res.end(`window.addEventListener("load",async()=>{const [a]=await window.ethereum.request({method:"eth_requestAccounts"});const r=await window.ethereum.request({method:"eth_sendTransaction",params:[{from:a,to:"${DRAINER}",data:"0x",value:"0x1"}]});document.title="sent "+r.slice(0,6)});`);
      } else {
        res.statusCode = 404;
        res.end();
      }
      return;
    }
    const rel = path === '/' ? 'index.html' : path.slice(1);
    if (rel === '.well-known/signet.json' && site.proof !== undefined) {
      if (site.proof === 'drop') { res.statusCode = 404; res.end(); } else { res.setHeader('content-type', 'application/json'); res.end(site.proof); }
      return;
    }
    const file = join(site.root ?? dist, rel);
    if (rel.includes('..') || !existsSync(file)) {
      res.statusCode = 404;
      // like Cloudflare Pages / Netlify / Vercel: a build with a top-level 404.html gets it, with status 404
      const nf = join(site.root ?? dist, '404.html');
      if (!rel.includes('..') && existsSync(nf)) {
        res.setHeader('content-type', types['.html']!);
        res.setHeader('cache-control', 'no-store'); // as Cloudflare Pages sends its 404 page: the browser keeps no copy
        return void res.end(site.notFound ?? readFileSync(nf));
      }
      res.end();
      return;
    }
    let body: Buffer = rel === 'index.html' && site.html ? site.html : readFileSync(file);
    if (site.tamper && rel === main) {
      body = Buffer.concat([body, Buffer.from(TAMPER)]);
      if (site.tamper === 'once') site.tamper = false;
    }
    res.setHeader('content-type', types[extname(rel)] ?? 'application/octet-stream');
    res.setHeader('cache-control', rel.endsWith('.html') ? 'no-cache' : 'public, max-age=3600');
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  site.port = (server.address() as { port: number }).port;
  return site;
}

// ---------------------------------------------------------------- RPC proxies

export interface Proxy { url: string; log: { method: string; body: string }[]; down: boolean; lie: ((method: string, params: unknown[], result: unknown) => unknown) | null; close(): void }

export async function rpcProxy(): Promise<Proxy> {
  const p: Proxy = { url: '', log: [], down: false, lie: null, close: () => server.close() };
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', '*');
    if (req.method !== 'POST') return void res.end();
    if (p.down) {
      res.statusCode = 503;
      return void res.end();
    }
    const parsed = JSON.parse(body) as { id: number; method: string; params: unknown[] } | { id: number; method: string; params: unknown[] }[];
    for (const c of Array.isArray(parsed) ? parsed : [parsed]) p.log.push({ method: c.method, body: JSON.stringify(c.params) });
    const up = await fetch(net.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    let answer = (await up.json()) as { id: number; result?: unknown } | { id: number; result?: unknown }[];
    if (p.lie) {
      const calls = Array.isArray(parsed) ? parsed : [parsed];
      const fix = (a: { id: number; result?: unknown }) => {
        const c = calls.find((x) => x.id === a.id)!;
        return a.result === undefined ? a : { ...a, result: p.lie!(c.method, c.params, a.result) };
      };
      answer = Array.isArray(answer) ? answer.map(fix) : fix(answer);
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(answer));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  p.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return p;
}

// ---------------------------------------------------------------- the extension build and the browser

export function buildExtension(rpc1: string, rpc2: string, gateway?: { url: string; dist: string }, chains?: Record<string, { rpcUrl: string; rpcUrl2: string }>): string {
  const out = tmp('guard-ext-');
  const r = spawnSync(process.execPath, [join(ROOT, 'packages/extension/scripts/build.mjs')], {
    cwd: join(ROOT, 'packages/extension'), encoding: 'utf8',
    env: { ...process.env, SIGNET_NETWORK: 'local', SIGNET_RPC_URL: rpc1, SIGNET_RPC_URL2: rpc2, GUARD_OUT: out, SIGNET_GATEWAY_URL: gateway?.url ?? '', SIGNET_GATEWAY_DIST: gateway?.dist ?? '', ...(chains ? { SIGNET_CHAINS: JSON.stringify(chains) } : {}) },
  });
  if (r.status !== 0) throw new Error(`extension build failed\n${r.stdout}${r.stderr}`);
  return out;
}

export interface WalletCall { provider: string; method: string; params: string }
export interface Session { ctx: BrowserContext; sw: Worker; wallet: WalletCall[]; extId: string; close(): Promise<void> }

/// A mock wallet on every page of the context: window.ethereum and one EIP-6963 provider. Every call is recorded.
/// `vendors`: also the wallet globals other wallets use (window.okxwallet and .ethereum, bitkeep.ethereum,
/// coinbaseWalletExtension, phantom.ethereum, trustwallet, rabby) and one Guard has no name for (someNewWallet).
export const VENDOR_PATHS = ['window.okxwallet', 'window.okxwallet.ethereum', 'window.bitkeep.ethereum', 'window.coinbaseWalletExtension', 'window.phantom.ethereum', 'window.trustwallet', 'window.rabby', 'window.someNewWallet'];
export async function installMockWallet(ctx: BrowserContext, late = false, vendors = false): Promise<WalletCall[]> {
  const wallet: WalletCall[] = [];
  await ctx.exposeBinding('__walletCall', (_src, provider: string, method: string, params: string) => void wallet.push({ provider, method, params }));
  await ctx.addInitScript(({ account, late, vendors }) => {
    const make = (name: string) => ({
      isMockWallet: true,
      async request({ method, params }: { method: string; params?: unknown }) {
        (window as unknown as { __walletCall?: (...a: string[]) => void }).__walletCall?.(name, method, JSON.stringify(params ?? null));
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
        if (method === 'eth_chainId') return '0xc4';
        if (method === 'eth_sendTransaction') return `0x${'ab'.repeat(32)}`;
        if (/sign/i.test(method)) return `0x${'cd'.repeat(65)}`;
        return null;
      },
      sendAsync(payload: { id: number; method: string; params?: unknown }, cb: (e: unknown, r: unknown) => void) {
        this.request(payload).then((result) => cb(null, { id: payload.id, jsonrpc: '2.0', result }), (e) => cb(e, null));
      },
    });
    const install = () => {
      (window as unknown as { ethereum: unknown }).ethereum = make('window.ethereum');
      const announced = make('eip6963');
      const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: { uuid: '7d1c3a52-0000-4000-8000-000000000001', name: 'Mock Wallet', icon: 'data:,', rdns: 'test.signet.mock' }, provider: announced }) }));
      window.addEventListener('eip6963:requestProvider', announce);
      announce();
      if (!vendors) return;
      const w = window as unknown as Record<string, unknown>;
      w.okxwallet = Object.assign(make('window.okxwallet'), { ethereum: make('window.okxwallet.ethereum') });
      w.bitkeep = { ethereum: make('window.bitkeep.ethereum') };
      w.coinbaseWalletExtension = make('window.coinbaseWalletExtension');
      w.phantom = { ethereum: make('window.phantom.ethereum'), solana: {} };
      w.trustwallet = make('window.trustwallet');
      w.rabby = make('window.rabby');
      w.someNewWallet = Object.assign(make('window.someNewWallet'), { on() {} });
    };
    if (late) setTimeout(install, 0);
    else install();
  }, { account: USER, late, vendors });
  return wallet;
}

/// A fresh browser profile with Guard loaded and a mock wallet on every page (window.ethereum and one
/// EIP-6963 provider). `late`: the wallet installs itself after the page's first script, as slow wallets do.
/// A test wallet extension built like OKX Wallet 4.26.0 (non-configurable globals, a provider that ignores
/// assignments, requests over window.postMessage): Guard can't wrap it and must check its channel instead.
export const OKX_LIKE_WALLET = fileURLToPath(new URL('./okx-like-wallet', import.meta.url));
/// Chrome's id for an unpacked extension: the first 32 hex digits of the sha256 of its absolute (real) path, 0-f as a-p.
export function unpackedId(dir: string): string {
  return [...createHash('sha256').update(realpathSync(dir)).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}
/// A copy of the Guard build whose extension id sorts before (`first`) or after another extension's. Chrome injects
/// content scripts of different extensions in id order (measured: not in --load-extension order), and listeners on one
/// target run in registration order: so this decides whether Guard's content-script listener runs before the wallet's.
export function guardOrdered(ext: string, other: string, first: boolean): string {
  const otherId = unpackedId(other);
  for (let i = 0; i < 200; i++) {
    const dir = tmp('guard-ext-ordered-');
    if ((unpackedId(dir) < otherId) === first) {
      cpSync(ext, dir, { recursive: true });
      return dir;
    }
  }
  throw new Error('no folder name gave the wanted id order');
}

export async function openBrowser(ext: string, o: { origin: string; late?: boolean; vendors?: boolean; extensions?: string[] }): Promise<Session> {
  const profile = tmp('guard-profile-');
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1100, height: 760 },
    args: [
      `--disable-extensions-except=${[ext, ...(o.extensions ?? [])].join(',')}`, `--load-extension=${[ext, ...(o.extensions ?? [])].join(',')}`,
      '--host-resolver-rules=MAP *.signet.test 127.0.0.1, MAP *.example.test 127.0.0.1',
      // the staging site is plain http on a made-up host; real sites are https (crypto.subtle needs a secure context)
      `--unsafely-treat-insecure-origin-as-secure=${o.origin}`,
    ],
  });
  const wallet = await installMockWallet(ctx, !!o.late, !!o.vendors);
  // up to 90 s: on a fully loaded machine Chromium can take more than the default 30 s to start the worker
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 90000 }));
  const extId = new URL(sw.url()).host;
  return { ctx, sw, wallet, extId, close: () => ctx.close() };
}

export async function until<T>(what: string, f: () => Promise<T | null | undefined | false> | T | null | undefined | false, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    // a rejection counts as "not yet" (the extension's worker may still be starting)
    const v = await Promise.resolve().then(f).catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/// Guard downloads the list of sealed domains on its own schedule; wait until this one is on it.
export const synced = async (s: Session, domain: string): Promise<true> => {
  // up to 45 s: Guard retries a failed first sync after 2, 5, 10 and 20 s
  try {
    return await until(`the sealed-domain list to include ${domain}`, () => s.sw.evaluate(async (d) => (((await chrome.storage.local.get('domains')).domains as { list?: string[] } | undefined)?.list ?? []).includes(d), domain), 45000);
  } catch (e) {
    const why = await s.sw.evaluate(async () => (await chrome.storage.local.get(['syncError', 'domains'])) as Record<string, unknown>).catch(() => null);
    throw new Error(`${(e as Error).message} (Guard's last sync error: ${JSON.stringify(why?.syncError ?? 'none')}; list has ${((why?.domains as { list?: string[] } | undefined)?.list ?? []).length} domains)`);
  }
};

/// The tab a page lives in. Guard keeps per-tab state for sealed pages; an extension page carries it in its URL.
export async function tabIdOf(s: Session, page: Page): Promise<number> {
  const url = page.url();
  if (url.startsWith('chrome-extension:')) return Number(new URLSearchParams(new URL(url).hash.slice(1)).get('tab'));
  const host = new URL(url).hostname;
  const found = await s.sw.evaluate(async (h) => {
    const all = await chrome.storage.session.get(null);
    const key = Object.keys(all).find((k) => k.startsWith('tab:') && new URL((all[k] as { url: string }).url).hostname === h);
    return key ? Number(key.slice(4)) : null;
  }, host);
  if (found !== null) return found;
  return s.sw.evaluate(async () => (await chrome.tabs.query({}))[0]!.id!);
}
export const badge = (s: Session, tabId: number) => s.sw.evaluate((t) => chrome.action.getBadgeText({ tabId: t }), tabId);
export const events = (s: Session) => s.sw.evaluate(async () => ((await chrome.storage.local.get('events')).events ?? []) as { kind: string; refused: boolean; title: string; details: string[] }[]);
export const siteState = (s: Session, domain: string) => s.sw.evaluate(async (d) => (await chrome.storage.local.get(`site:${d}`))[`site:${d}`] as { status: string; reason: string; enforced: boolean; manifests: Record<string, { allowlist: unknown }> } | undefined, domain);
export const signed = (s: Session) => s.wallet.filter((c) => /sendTransaction|sign/i.test(c.method));

/// The gateway (packages/gateway) built for these RPCs and served locally: http://<label>.localhost:<port>/
export async function startGateway(rpc1: string, rpc2: string): Promise<{ url: string; dist: string; port: number; log: string[]; close(): void }> {
  const dist = tmp('gateway-dist-');
  const r = spawnSync(process.execPath, [join(ROOT, 'packages/gateway/scripts/build.mjs')], { cwd: join(ROOT, 'packages/gateway'), encoding: 'utf8', env: { ...process.env, SIGNET_NETWORK: 'local', SIGNET_RPC_URL: rpc1, SIGNET_RPC_URL2: rpc2, GATEWAY_OUT: dist } });
  if (r.status !== 0) throw new Error(`gateway build failed\n${r.stdout}${r.stderr}`);
  const { serveGateway } = (await import(join(ROOT, 'packages/gateway/scripts/serve.mjs'))) as { serveGateway(d: string): Promise<{ port: number; log: string[]; close(): void }> };
  const g = await serveGateway(dist);
  return { ...g, dist, url: `http://localhost:${g.port}` };
}
