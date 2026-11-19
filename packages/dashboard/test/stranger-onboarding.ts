// A stranger follows /start, word for word, on a throwaway fork of X Layer mainnet (the real Signet contracts),
// with a made-up domain and fresh wallets. Nothing is sent to mainnet.
//   node packages/dashboard/test/stranger-onboarding.ts
// Steps: install the CLI from the npm registry (`npm install -g signetguard`, a fresh npm cache, no repo), keygen, create the gate in the
// dashboard's "Protect a site" wizard (a wallet in the page), link, domain proof (+ --check against a local copy of
// the site), the workflow's commands (verify, seal, propose), two approvals in the dashboard, 24 h, `wait --publish`,
// and the badge. Every step is logged as OK or FAILED; the first failure stops the run.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const DASH = join(ROOT, 'packages/dashboard');
const NETF = JSON.parse(readFileSync(join(ROOT, 'packages/contracts/deployments/mainnet.json'), 'utf8'));
const PORT = 8557, FORK = `http://127.0.0.1:${PORT}`;
const DOMAIN = 'acme-swap.example';
const ACME_PORT = 8598; // the stranger's own site (it serves their /.well-known/signet.json, as https://acme-swap.example would)
const OUT = join(ROOT, 'staging/.run/stranger'); rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const lines: string[] = [];
const log = (s: string) => { console.log(s); lines.push(s); writeFileSync(join(OUT, 'log.txt'), lines.join('\n') + '\n'); };
const fresh = () => `0x${[...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
const rpc = async (method: string, params: unknown[] = []) => {
  const j = await (await fetch(FORK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
};
async function step<T>(name: string, f: () => Promise<T> | T): Promise<T> {
  try {
    const r = await f();
    log(`OK      ${name}${typeof r === 'string' && r ? `: ${r}` : ''}`);
    return r;
  } catch (e) {
    log(`FAILED  ${name}: ${(e as Error).message.split('\n').slice(0, 6).join(' | ')}`);
    process.exit(1);
  }
}

// ---- the fork, the stranger's wallets
const anvil = spawn('anvil', ['--fork-url', process.env.XLAYER_RPC_URL ?? NETF.rpcUrl, '--chain-id', '196', '--port', String(PORT), '--auto-impersonate', '--silent', '--base-fee', '20000000', '--gas-price', '20000000']); // mainnet's 0.02 gwei, so /start's 0.0005 OKB is tested for real
process.on('exit', () => anvil.kill());
for (let i = 0; i < 120; i++) { try { await rpc('eth_blockNumber'); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const W = { creator: fresh(), a: fresh(), b: fresh(), c: fresh(), recovery: fresh() };
for (const w of [W.creator, W.a, W.b]) await rpc('anvil_setBalance', [w, '0x2386f26fc10000']); // 0.01 OKB each, on the fork

// ---- the stranger's machine: an empty folder and a fresh npm prefix
const home = mkdtempSync(join(tmpdir(), 'stranger-'));
const proj = join(home, 'acme-swap'); mkdirSync(join(proj, 'src'), { recursive: true }); mkdirSync(join(proj, 'public'));
writeFileSync(join(proj, 'src/index.html'), '<!doctype html><title>Acme Swap</title><h1>Acme Swap</h1><script src="app.js"></script>');
writeFileSync(join(proj, 'src/app.js'), 'document.title = "Acme Swap";');
// a bare environment: no repo, nothing on PATH but the fresh npm prefix, node and the system; an empty npm cache
const env: Record<string, string> = { HOME: home, TMPDIR: tmpdir(), npm_config_cache: join(home, '.npm'), PATH: `${join(home, 'g/bin')}:${join(process.execPath, '..')}:/usr/bin:/bin`, SIGNET_RPC_URL: FORK };
// not spawnSync: this same process serves the site the commands download from (a sync call would deadlock)
const run = (cmd: string, extra: Record<string, string> = {}) => new Promise<string>((res, rej) => {
  const c = spawn('bash', ['-c', cmd], { cwd: proj, env: { ...env, ...extra } });
  let out = '';
  c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (out += d));
  c.on('close', (code) => (code === 0 ? res(out.trim()) : rej(new Error(`$ ${cmd}\n${out}`))));
});

// ---- the site, built for this fork (the stranger's browser talks to "mainnet" = the fork)
const dist = mkdtempSync(join(tmpdir(), 'site-'));
const b = spawnSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { cwd: DASH, encoding: 'utf8', env: { ...process.env, SIGNET_NETWORK: 'mainnet', SIGNET_RPC_URL: FORK, SIGNET_RPC_URL2: FORK, SIGNET_PROOF_ORIGIN: `http://127.0.0.1:${ACME_PORT}` } });
if (b.status !== 0) throw new Error(b.stderr);
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.webp': 'image/webp', '.json': 'application/json', '.tgz': 'application/gzip' };
const serve = (dir: string, clean = true, port = 0) => new Promise<{ url: string; close(): void }>((res) => {
  const s = http.createServer((q, r) => {
    let p = q.url!.split('?')[0]!.slice(1) || 'index.html';
    if (clean && !existsSync(join(dir, p)) && existsSync(join(dir, `${p}.html`))) p += '.html'; // clean URLs, as Cloudflare Pages
    // the header /start tells teams to add, so the dashboard and badge can read the proof
    if (p === '.well-known/signet.json') r.setHeader('access-control-allow-origin', '*');
    try { r.setHeader('content-type', types[extname(p)] ?? 'application/octet-stream'); r.end(readFileSync(join(dir, p))); } catch { r.statusCode = 404; r.end(); }
  });
  s.listen(port, '127.0.0.1', () => res({ url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, close: () => s.close() }));
});
const site = await serve(dist);

// ---- /start, word for word
const startHtml = await (await fetch(`${site.url}/start`)).text();
await step('/start is served at the clean URL /start', () => (/Protect your site/.test(startHtml) ? 'yes' : Promise.reject(new Error('no /start page'))));

// STRANGER_CLI=<path to signetguard-x.y.z.tgz>: test a build before it is published (default: the npm registry)
const local = process.env.STRANGER_CLI;
const latest = local ? local.match(/signetguard-(\d+\.\d+\.\d+)\.tgz$/)![1]! : (await (await fetch('https://registry.npmjs.org/signetguard')).json())['dist-tags'].latest as string;
await step(`1. npm install -g ${local ? local.split('/').pop() : 'signetguard (from the npm registry)'}`, async () => (await run(`npm install -g --prefix ${join(home, 'g')} ${local ?? 'signetguard'}`)).split('\n').pop()!);
await step('1. `signet` is the one npm just installed', async () => { const w = await run('command -v signet'); if (!w.startsWith(join(home, 'g/bin'))) throw new Error(w); return w.replace(home, '~stranger'); });
await step(`1. signet --version (expected ${latest})`, async () => { const v = await run('signet --version'); if (v !== latest) throw new Error(v); return v; });
const proposer = await step('1. signet keygen', async () => (await run('signet keygen')).match(/0x[0-9a-fA-F]{40}/)![0]);
await step('1. the key file is git-ignored', () => (readFileSync(join(proj, '.signet/.gitignore'), 'utf8').includes('*') ? 'yes' : Promise.reject(new Error('no .gitignore'))));

// 2. the wizard
const browser = await chromium.launch();
async function wallet(who: string): Promise<Page> {
  const ctx = await browser.newContext();
  await ctx.addInitScript(({ rpc, acct }) => {
    let chain = '0x1'; // the stranger's wallet starts on Ethereum
    const subs: ((c: string) => void)[] = [];
    (window as unknown as { ethereum: unknown }).ethereum = {
      on(ev: string, f: (c: string) => void) { if (ev === 'chainChanged') subs.push(f); },
      async request({ method, params }: { method: string; params?: unknown[] }) {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [acct];
        if (method === 'eth_chainId') return chain;
        if (method === 'wallet_switchEthereumChain') { if ((params![0] as { chainId: string }).chainId !== '0xc4') throw Object.assign(new Error('x'), { code: 4902 }); chain = '0xc4'; subs.forEach((f) => f(chain)); return null; }
        if (method === 'wallet_addEthereumChain') { chain = '0xc4'; subs.forEach((f) => f(chain)); return null; }
        const j = await (await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }) })).json();
        if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
        return j.result;
      },
    };
  }, { rpc: FORK, acct: who });
  const page = await ctx.newPage();
  page.on('console', (m) => writeFileSync(join(OUT, 'console.txt'), `[${who.slice(0, 8)} ${m.type()}] ${m.text()}\n`, { flag: 'a' }));
  page.on('pageerror', (e) => writeFileSync(join(OUT, 'console.txt'), `[${who.slice(0, 8)} pageerror] ${e.message}\n`, { flag: 'a' }));
  return page;
}
const toastAfter = async (p: Page, sel: string) => {
  await p.evaluate(() => { const t = document.getElementById('toast'); if (t) t.textContent = ''; });
  await p.click(sel);
  try {
    await p.waitForFunction(() => { const t = document.getElementById('toast')?.textContent ?? ''; return t.length > 0 && !/waiting for the wallet/.test(t); }, null, { timeout: 90000 });
  } catch {
    throw new Error(`still "${await p.locator('#toast').innerText()}"; status line "${await p.locator('#st').innerText().catch(() => '')}"`);
  }
  return p.locator('#toast').innerText();
};
const wz = await wallet(W.creator);
await wz.goto(`${site.url}/app#/new`);
await step('2. the wizard page opens; the wrong-chain bar offers "Switch to X Layer"', async () => { await wz.locator('#chainbar').waitFor({ state: 'visible' }); return await toastAfter(wz, '#switchchain'); });
await wz.fill('#f-domain', DOMAIN); await wz.fill('#f-a', W.a); await wz.fill('#f-b', W.b); await wz.fill('#f-c', W.c);
await wz.fill('#f-proposer', proposer); await wz.fill('#f-recovery', W.recovery);
await step('2. "1. Reserve the domain"', async () => { const t = await toastAfter(wz, '#commit'); if (!/^reserved/.test(t)) throw new Error(t); return t; });
await rpc('evm_mine'); await rpc('evm_mine');
await step('2. "2. Create the gate" opens two blocks later', async () => { await wz.locator('#create:not([disabled])').waitFor({ timeout: 20000 }); return 'enabled'; });
const gate = await step('2. "2. Create the gate"', async () => { const t = await toastAfter(wz, '#create'); const m = t.match(/gate (0x[0-9a-fA-F]{40}) created/); if (!m) throw new Error(t); return m[1]!; });
const nextText = await wz.locator('#next').innerText();
await wz.screenshot({ path: join(OUT, 'wizard-done.png'), fullPage: true });
await step('2. the wizard shows the next commands with this domain and gate', () => (nextText.includes(`signet link ${DOMAIN} ${gate}`) ? 'yes' : Promise.reject(new Error(nextText.slice(0, 300)))));

// 3. domain proof
if (process.env.STRANGER_INIT) {
  // /start's fastest path: one command writes the config, the proof, the host's header file and the workflow
  await step(`3. signet init --domain ${DOMAIN} --gate <gate> --host cloudflare --yes`, async () => (await run(`signet init --domain ${DOMAIN} --gate ${gate} --host cloudflare --yes`)).split('\n').filter((l) => /Wrote|CORS/.test(l)).join(' | '));
  await step('3. init wrote the config, the proof, the _headers rule and the workflow', () => {
    const cfg = JSON.parse(readFileSync(join(proj, 'signet.config.json'), 'utf8'));
    const proof = JSON.parse(readFileSync(join(proj, 'public/.well-known/signet.json'), 'utf8'));
    const headers = readFileSync(join(proj, 'public/_headers'), 'utf8');
    const wf = readFileSync(join(proj, '.github/workflows/signet.yml'), 'utf8');
    if (cfg.gate.toLowerCase() !== gate.toLowerCase() || proof.gate.toLowerCase() !== gate.toLowerCase()) throw new Error('gate mismatch');
    if (!/\/\.well-known\/signet\.json\n  Access-Control-Allow-Origin: \*/.test(headers)) throw new Error('no CORS rule');
    if (!wf.includes(`npm install -g signetguard@${latest}`) || !/signet wait dist --publish/.test(wf) || !/wrangler@4 pages deploy dist/.test(wf)) throw new Error(wf);
    return `yes (workflow pins signetguard@${latest})`;
  });
} else {
  await step(`3. signet link ${DOMAIN} <gate>`, async () => (await run(`signet link ${DOMAIN} ${gate}`)).split('\n')[0]!);
  await step('3. signet domain public', async () => (await run('signet domain public')).split('\n')[0]!);
}
const build = () => { rmSync(join(proj, 'dist'), { recursive: true, force: true }); cpSync(join(proj, 'src'), join(proj, 'dist'), { recursive: true }); cpSync(join(proj, 'public'), join(proj, 'dist'), { recursive: true }); };
build();
const acme = await serve(join(proj, 'dist'), true, ACME_PORT);
await step('3. signet domain --check (the deployed site, served locally as the domain)', async () => (await run('signet domain --check', { SIGNET_DOMAIN_ORIGIN: acme.url })).split('\n').pop()!);

// 4. the workflow's commands (what the GitHub job runs), with the secret as an env var
// /start asks for ≈0.0005 OKB, enough on mainnet (priority fee 1 wei there). Anvil suggests a 1 gwei priority fee,
// which a wallet multiplies by the gas limit, so the fork run gets 0.005.
await rpc('anvil_setBalance', [proposer, '0x11c37937e08000']);
const key = readFileSync(join(proj, '.signet/proposer.key'), 'utf8').trim();
await step('4. signet verify dist && signet seal dist && signet propose dist --reuse', async () => (await run('signet verify dist && signet seal dist && signet propose dist --reuse', { SIGNET_PROPOSER_KEY: key })).split('\n').filter((l) => /Proposed|risk tier|needs/.test(l)).join(' | '));
const id = (await run('signet status')).match(/#(\d+)/)?.[1] ?? '1';

// 5. approvals in the dashboard, 24 h, wait --publish, badge
for (const [n, who] of [['A', W.a], ['B', W.b]] as const) {
  const p = await wallet(who);
  await p.goto(`${site.url}/app#/p/${DOMAIN}`);
  await p.locator('#switchchain').click().catch(() => {});
  await p.locator(`tr[data-id="${id}"] button[data-a="approve"]`).waitFor({ timeout: 60000 });
  await step(`5. Approver ${n} approves in the dashboard`, async () => { const t = await toastAfter(p, `tr[data-id="${id}"] button[data-a="approve"]`); if (!/^approved/.test(t)) throw new Error(t); return t; });
}
await rpc('evm_increaseTime', [86400 + 60]); await rpc('evm_mine');
await step('5. (after 24 h) signet wait dist --publish', async () => {
  const out = await run('signet wait dist --publish --timeout 120 --interval 2', { SIGNET_PROPOSER_KEY: key });
  // a published release without its manifest stored on-chain is a FAILURE: Guard couldn't check the site
  if (!/read back projects\/acme-swap\.example\/signet\/files\.json: matches/.test(out)) throw new Error(`published, but the manifest wasn't uploaded:\n${out}`);
  return out.split('\n').filter((l) => /Published release|wrote|read back/i.test(l)).join(' | ');
});
await step('5. the 3 manifest files are on-chain (a second upload finds all of them stored, unchanged)', async () => {
  const out = await run('signet upload dist', { SIGNET_PROPOSER_KEY: key });
  const same = out.split('\n').filter((l) => /^\s+same\s/.test(l)).length;
  if (same !== 3 || /wrote/.test(out)) throw new Error(out);
  return '3 of 3 stored';
});
const bp = await wallet(W.creator);
await bp.goto(`${site.url}/app#/badge/${DOMAIN}`);
await step('5. the badge page says "Sealed by Signet" for the domain', async () => { await bp.locator('.badge.ok').waitFor({ timeout: 30000 }); return (await bp.locator('.badge').innerText()).replace(/\s+/g, ' '); });
await bp.screenshot({ path: join(OUT, 'badge.png') });
await browser.close(); site.close(); acme.close();
log('ALL STEPS PASSED');
process.exit(0);
