// Rehearses Signet's FIRST real release (signetguard.xyz, site gate 0xa3d4…4503) on a throwaway fork of X Layer
// mainnet. It uses the real deployed contracts, the real CI proposer key (fork only) and the exact bytes Cloudflare
// serves. Nothing is sent to mainnet.
//   node packages/dashboard/test/rehearse-first-release.ts
// 1. download every file https://signet-6l4.pages.dev serves (must equal packages/dashboard/dist byte for byte)
// 2. signet seal + propose (CI proposer), on the fork
// 3. Approvers A and B approve THROUGH THE DASHBOARD (the mainnet build pointed at the fork, a test wallet in the
//    page standing in for MetaMask), as the real approvals will be made
// 4. fast-forward 24 h; publish (circuit #6 decides); write the 3 manifest files (no other files: no verified copy)
// 5. Guard (built for the fork) opens the LIVE Cloudflare bytes under http://signetguard.xyz and reports what it shows
// Then prints every transaction with its signer and gas, and the OKB at today's mainnet gas price.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, cpSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const NETF = JSON.parse(readFileSync(join(ROOT, 'packages/contracts/deployments/mainnet.json'), 'utf8'));
const LIVE = 'https://signet-6l4.pages.dev';
const PORT = 8556, FORK = `http://127.0.0.1:${PORT}`;
const GATE = NETF.gates.site.address as string, DOMAIN = NETF.gates.site.domain as string;
const PROPOSER = '0x93272103b49B955dF493999F4B9Dea4852FA9453';
const [A, B] = ['0xB9ef367A86DE5150a5390c4148073901587d2416', '0x3280887C6ed2c0C43679918654f72222b767e6dc'];
const PROJECT = join(ROOT, 'packages/dashboard');
const OUT = join(ROOT, 'staging/.run/first-release'); rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const log = (...a: unknown[]) => { const l = a.join(' '); console.log(l); writeFileSync(join(OUT, 'log.txt'), l + '\n', { flag: 'a' }); };
const sh = (cmd: string, args: string[], env: NodeJS.ProcessEnv = {}, cwd?: string) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd, env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  return r.stdout.trim();
};
const rpc = async (method: string, params: unknown[] = []) => {
  const j = await (await fetch(FORK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
};
const CLI_ENV = { SIGNET_NETWORK: 'mainnet', SIGNET_RPC_URL: FORK, SIGNET_PRIVATE_KEY: '', SIGNET_PROPOSER_KEY: '' };
const signet = (...args: string[]) => sh(process.execPath, [join(ROOT, 'packages/cli/src/cli.ts'), '-C', PROJECT, ...args], CLI_ENV);
// `publish` and `upload` (anyone may send them; the circuit decides) sign with SIGNET_PRIVATE_KEY: here the CI proposer's
// key, as the GitHub Action does. On this fork it comes from the key file (never printed).
const signetCI = (...args: string[]) => sh(process.execPath, [join(ROOT, 'packages/cli/src/cli.ts'), '-C', PROJECT, ...args], (() => { const k = readFileSync(join(PROJECT, '.signet/proposer.key'), 'utf8').trim(); return { ...CLI_ENV, SIGNET_PROPOSER_KEY: k, SIGNET_PRIVATE_KEY: k }; })());

// ---- 1. the exact files Cloudflare serves
const dist = join(PROJECT, 'dist');
const files = (function walk(d: string): string[] { return readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [relative(dist, join(d, f))])); })(dist).filter((f) => f !== '_headers');
const site = join(OUT, 'site'); mkdirSync(site);
for (const f of files) {
  const url = f === 'index.html' ? '/' : f === 'app.html' ? '/app' : `/${f}`;
  const res = await fetch(LIVE + url);
  if (res.status !== 200) throw new Error(`${url}: HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (!body.equals(readFileSync(join(dist, f)))) throw new Error(`${f}: the live file differs from dist/`);
  mkdirSync(join(site, f, '..'), { recursive: true }); writeFileSync(join(site, f), body);
}
log(`1. downloaded ${files.length} files from ${LIVE}; each is byte-identical to packages/dashboard/dist (_headers is config, not served)`);

// ---- the fork
const anvil = spawn('anvil', ['--fork-url', process.env.XLAYER_RPC_URL ?? NETF.rpcUrl, '--chain-id', '196', '--port', String(PORT), '--auto-impersonate', '--silent']);
process.on('exit', () => anvil.kill());
for (let i = 0; i < 120; i++) { try { await rpc('eth_blockNumber'); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const startBlock = parseInt(await rpc('eth_blockNumber'), 16);
for (const w of [PROPOSER, A, B]) await rpc('anvil_setBalance', [w, '0x16345785d8a0000']); // 0.1 OKB each, on the fork only
log(`   fork of mainnet at block ${startBlock}; proposer, A and B given 0.1 OKB on the fork (they hold 0 on mainnet)`);

// ---- 2. seal + propose
const sealOut = signet('seal', site);
writeFileSync(join(OUT, 'seal.txt'), sealOut);
const manifest = JSON.parse(readFileSync(join(site, 'signet-manifest.json'), 'utf8'));
const sealedFiles = JSON.parse(readFileSync(join(site, 'signet/files.json'), 'utf8'));
log(`2. sealed ${(sealedFiles.files ?? sealedFiles).length} files, filesRoot ${manifest.filesRoot}`);
log(`   allowlist.json: ${readFileSync(join(site, 'signet/allowlist.json'), 'utf8').trim()}`);
log(`   origins.json:   ${readFileSync(join(site, 'signet/origins.json'), 'utf8').trim()}`);
const prop = signet('propose', site);
writeFileSync(join(OUT, 'propose.txt'), prop);
const id = prop.match(/Proposed release #(\d+)/)![1]!;
log(`   ${prop.split('\n').filter((l) => /Proposed|risk tier|needs/.test(l)).join('\n   ')}`);

// ---- 3. approvals through the dashboard (mainnet build, pointed at the fork)
const dash = mkdtempSync(join(tmpdir(), 'dash-'));
sh('npx', ['vite', 'build', '--outDir', dash, '--emptyOutDir'], { SIGNET_NETWORK: 'mainnet', SIGNET_RPC_URL: FORK, SIGNET_RPC_URL2: FORK }, PROJECT);
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.webp': 'image/webp' };
const dsrv = http.createServer((q, r) => { const p = q.url!.split('?')[0] === '/' ? 'index.html' : q.url!.split('?')[0]!.slice(1); try { r.setHeader('content-type', types[extname(p)] ?? 'application/octet-stream'); r.end(readFileSync(join(dash, p))); } catch { r.statusCode = 404; r.end(); } });
await new Promise<void>((r) => dsrv.listen(0, '127.0.0.1', r));
const durl = `http://127.0.0.1:${(dsrv.address() as { port: number }).port}/app.html`;
const browser = await chromium.launch();
for (const [name, who] of [['A', A], ['B', B]] as const) {
  const ctx = await browser.newContext();
  // stands in for MetaMask: the page asks it for the account and sends the transaction it builds
  await ctx.addInitScript(({ rpc, acct }) => {
    (window as unknown as { ethereum: unknown }).ethereum = { async request({ method, params }: { method: string; params?: unknown[] }) {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [acct];
      const j = await (await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }) })).json();
      if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
      return j.result;
    } };
  }, { rpc: FORK, acct: who });
  const page = await ctx.newPage();
  await page.goto(`${durl}#/p/${DOMAIN}`);
  await page.locator(`tr[data-id="${id}"] button[data-a="approve"]`).waitFor({ timeout: 60000 });
  await page.click(`tr[data-id="${id}"] button[data-a="approve"]`);
  await page.waitForFunction(() => { const t = document.getElementById('toast')?.textContent ?? ''; return t.length > 0 && !/waiting for the wallet/.test(t); }, null, { timeout: 90000 });
  const toast = await page.locator('#toast').innerText();
  log(`3. Approver ${name} (${who}) in the dashboard: "${toast}"`);
  if (!/^approved/.test(toast)) throw new Error(`approval ${name} failed: ${toast}`);
  if (name === 'B') { await page.reload(); await page.locator(`tr[data-id="${id}"] .cd`).waitFor({ timeout: 30000 }); log(`   dashboard now shows: ${(await page.locator(`tr[data-id="${id}"]`).innerText()).replace(/\s+/g, ' ')}`); await page.screenshot({ path: join(OUT, 'dashboard-after-approvals.png'), fullPage: true }); }
  await ctx.close();
}

// ---- 4. 24 h, publish, manifest files
let early = '';
try { signetCI('publish', id, '--no-upload'); early = 'PUBLISHED (unexpected!)'; } catch (e) { early = (e as Error).message.split('\n').filter((l) => l.startsWith('signet:') || /refused|Policy|timelock/i.test(l)).join(' ') || (e as Error).message.slice(-300); }
if (/PUBLISHED|No signing key/.test(early)) throw new Error(`the early publish check is not valid: ${early}`);
log(`4. publish before the 24 h: ${early.trim()}`);
await rpc('evm_increaseTime', [86400 + 60]); await rpc('evm_mine');
const pub = signetCI('publish', id, site);
writeFileSync(join(OUT, 'publish.txt'), pub);
log(`   after 24 h: ${pub.split('\n').filter((l) => /Published|wrote|manifest|upload|file/i.test(l)).slice(0, 8).join('\n   ')}`);
log(`   gate.currentRelease() = ${sh('cast', ['call', GATE, 'currentRelease()(uint64)', '--rpc-url', FORK])}`);

// ---- 5. Guard on the live bytes under signetguard.xyz
const ext = mkdtempSync(join(tmpdir(), 'guard-'));
log('   Guard build: ' + sh(process.execPath, [join(ROOT, 'packages/extension/scripts/build.mjs')], { SIGNET_NETWORK: 'mainnet', SIGNET_RPC_URL: FORK, SIGNET_RPC_URL2: FORK, GUARD_OUT: ext, SIGNET_GATEWAY_URL: '' }, join(ROOT, 'packages/extension')).split('\n').slice(0, 3).join(' | '));
// The live bytes. With `swap`, /app is answered with index.html's bytes instead: a different sealed file put in
// its place, which Guard must call a mismatch.
let swap = false;
const proxy = http.createServer(async (q, r) => {
  const res = await fetch(LIVE + (swap && q.url === '/app' ? '/' : q.url), { redirect: 'manual' });
  r.statusCode = res.status;
  res.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) r.setHeader(k, v); });
  r.end(Buffer.from(await res.arrayBuffer()));
});
await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
const pport = (proxy.address() as { port: number }).port, origin = `http://${DOMAIN}:${pport}`;
const prof = mkdtempSync(join(tmpdir(), 'guard-prof-'));
const gctx = await chromium.launchPersistentContext(prof, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--host-resolver-rules=MAP ${DOMAIN} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${origin}`] });
const sw = gctx.serviceWorkers()[0] ?? (await gctx.waitForEvent('serviceworker'));
const extId = new URL(sw.url()).host;
for (let i = 0; i < 300; i++) { const l = await sw.evaluate(async () => ((await chrome.storage.local.get('domains')).domains?.list ?? []) as string[]).catch(() => []); if (l.includes(DOMAIN)) break; await new Promise((r) => setTimeout(r, 200)); }
log(`   Guard's sealed-domain list: ${JSON.stringify(await sw.evaluate(async () => (await chrome.storage.local.get('domains')).domains ?? null))}`);
const seen: Record<string, string> = {};
for (const [path, swapped] of [['/', false], ['/app', false], ['/app', true]] as const) {
  swap = swapped;
  const page = await gctx.newPage();
  await page.goto(origin + path, { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  // Guard has no "tabs" permission; its per-tab state (tab:<id> in session storage) says which tab holds this page
  const tab = await sw.evaluate(async (u) => {
    const all = await chrome.storage.session.get(null);
    const k = Object.keys(all).filter((x) => x.startsWith('tab:')).find((x) => (all[x] as { url: string }).url === u);
    return k ? Number(k.slice(4)) : null;
  }, page.url());
  if (tab === null) log(`   (no Guard tab state for ${page.url()})`);
  const pop = await gctx.newPage();
  await pop.setViewportSize({ width: 360, height: 600 });
  await pop.goto(`chrome-extension://${extId}/popup.html?tab=${tab}`);
  await pop.waitForSelector('h1');
  const t = (await pop.locator('#root').innerText()).replace(/\s+/g, ' ');
  const label = `${path}${swapped ? ' (index.html bytes put in place of app.html)' : ''}`;
  seen[label] = t;
  log(`5. Guard on ${DOMAIN}${label}: ${t.slice(0, 300)}`);
  const st = await sw.evaluate(async (d) => { const x = (await chrome.storage.local.get(`site:${d}`))[`site:${d}`] as { status?: string; reason?: string; release?: number } | undefined; return x ? { status: x.status, reason: x.reason, release: x.release } : null; }, DOMAIN);
  const tabst = await sw.evaluate(async (t) => (await chrome.storage.session.get(`tab:${t}`))[`tab:${t}`] ?? null, tab);
  log(`   site state: ${JSON.stringify(st)} | tab report: ${JSON.stringify(tabst).slice(0, 600)}`);
  await pop.screenshot({ path: join(OUT, `guard-popup${path === '/' ? '-home' : path.replace(/\//g, '-')}${swapped ? '-swapped' : ''}.png`) });
  await pop.close(); await page.close();
}
await gctx.close(); await browser.close(); dsrv.close(); proxy.close();
const okHome = /SEALED .*this page matches/i.test(seen['/']!), okApp = /SEALED .*this page matches/i.test(seen['/app']!);
const redSwap = /DOESN'T MATCH/i.test(seen['/app (index.html bytes put in place of app.html)']!);
log(`   checks: / sealed ${okHome}, /app sealed ${okApp}, substituted /app refused ${redSwap}`);
if (!okHome || !okApp || !redSwap) throw new Error('Guard did not give the expected results');

// ---- every transaction on the fork, with its signer and gas
const end = parseInt(await rpc('eth_blockNumber'), 16);
const gp = BigInt(sh('cast', ['gas-price', '--rpc-url', NETF.rpcUrl]));
const names: Record<string, string> = { [PROPOSER.toLowerCase()]: 'CI proposer', [A.toLowerCase()]: 'Approver A', [B.toLowerCase()]: 'Approver B' };
const rows: { who: string; what: string; gas: bigint }[] = [];
for (let b = startBlock + 1; b <= end; b++) {
  const blk = await rpc('eth_getBlockByNumber', [`0x${b.toString(16)}`, true]);
  for (const tx of blk.transactions) {
    const rc = await rpc('eth_getTransactionReceipt', [tx.hash]);
    const sel = tx.input.slice(0, 10);
    const what = sh('cast', ['4byte-decode', tx.input]).split('\n')[0]?.replace(/^\d+\)\s*/, '').replace(/"/g, '') || sel;
    rows.push({ who: names[tx.from.toLowerCase()] ?? tx.from, what: `${what.split('(')[0]} → ${tx.to === GATE.toLowerCase() || tx.to?.toLowerCase() === GATE.toLowerCase() ? 'site gate' : tx.to?.toLowerCase() === NETF.contracts.registry.toLowerCase() ? 'SignetRegistry' : tx.to}`, gas: BigInt(rc.gasUsed) });
  }
}
log('\ntransactions on the fork (gas used; OKB at the current mainnet gas price ' + Number(gp) / 1e9 + ' gwei):');
const byWho: Record<string, bigint> = {};
rows.forEach((r, i) => { log(`  ${i + 1}. ${r.who.padEnd(12)} ${r.what.padEnd(40)} gas ${r.gas.toString().padStart(9)}  ${(Number(r.gas * gp) / 1e18).toFixed(9)} OKB`); byWho[r.who] = (byWho[r.who] ?? 0n) + r.gas; });
for (const [w, g] of Object.entries(byWho)) log(`  total ${w.padEnd(12)} gas ${g}  ${(Number(g * gp) / 1e18).toFixed(9)} OKB`);
const tot = rows.reduce((s, r) => s + r.gas, 0n);
log(`  TOTAL gas ${tot}  ${(Number(tot * gp) / 1e18).toFixed(9)} OKB`);
writeFileSync(join(OUT, 'transactions.json'), JSON.stringify(rows.map((r) => ({ ...r, gas: Number(r.gas) })), null, 1));
process.exit(0);
