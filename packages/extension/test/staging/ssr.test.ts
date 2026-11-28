// Signet v2 on staging (pnpm staging:up): a server-rendered Next.js site (packages/demo-next) sealed with page mode
// "ssr" and a factory rule, served by `next start` behind a proxy that can tamper with it, and Guard 0.3.0 in a real
// browser. The gate is in enforce mode, so a refusal is a real refusal.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWalletClient, http as viemHttp, encodeFunctionData, parseAbi, keccak256, toHex, getAddress, type Address, type Hex } from 'viem';
import type { Page } from 'playwright';
import { anvil, net, pub, signet, switchToEnforce, rpcProxy, buildExtension, openBrowser, until, synced, tabIdOf, badge, events, signed, DRAINER, USER, TOKEN, type Proxy, type Session } from './harness.ts';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const DEMO = join(ROOT, 'packages/demo-next');
const domain = `ssr-${Date.now().toString(36)}.signet.test`;
const OTHER = getAddress(net.accounts!.users[0]!);
const factoryAbi = parseAbi(['function createVault(bytes32,address,address,address) returns (address)', 'function predictVaultAddress(address,bytes32) view returns (address)']);
const vaultAbi = parseAbi(['function initialize(bytes32,address,address,address)']);
const ID = keccak256(toHex('my-program'));
const ID_NEW = keccak256(toHex('another-program'));

let rpcA: Proxy;
let rpcB: Proxy;
let ext: string;
let origin: string;
let next: ChildProcess;
let proxy: http.Server;
let siteDir: string;
let factory: Address;
const vaults: Record<'mine' | 'others' | 'attackers' | 'fake', Address> = {} as never;
const flags = { tamperChunk: false, inline: '', external: false };
const open: Session[] = [];
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

// ---------------------------------------------------------------- chain setup: a Misthos-style factory and vaults
const wallet = createWalletClient({ transport: viemHttp(net.rpcUrl) });
async function send(from: Address, to: Address | null, data: Hex): Promise<Address | null> {
  const hash = await wallet.sendTransaction({ account: from, to, data, chain: null, gas: 3_000_000n });
  const r = await until('the transaction', () => pub.getTransactionReceipt({ hash }), 30000);
  if (r.status !== 'success') throw new Error(`transaction failed: ${hash}`);
  return r.contractAddress ?? null;
}
async function deployFactory(): Promise<void> {
  const art = JSON.parse(readFileSync(join(ROOT, 'packages/contracts/out/MockVaultFactory.sol/MockVaultFactory.json'), 'utf8'));
  const vart = JSON.parse(readFileSync(join(ROOT, 'packages/contracts/out/MockVaultFactory.sol/MockVault.json'), 'utf8'));
  const deployer = net.accounts!.deployer as Address;
  factory = (await send(deployer, null, art.bytecode.object))!;
  await anvil('anvil_impersonateAccount', [USER]);
  await anvil('anvil_setBalance', [USER, '0xde0b6b3a7640000']);
  const create = (owner: Address, id: Hex) => encodeFunctionData({ abi: factoryAbi, functionName: 'createVault', args: [id, owner, owner, '0x0000000000000000000000000000000000000000'] });
  const predict = (d: Address, id: Hex) => pub.readContract({ address: factory, abi: factoryAbi, functionName: 'predictVaultAddress', args: [d, id] });
  await send(USER as Address, factory, create(USER as Address, ID)); // yours: you created it, you own it
  vaults.mine = await predict(USER as Address, ID);
  await send(OTHER, factory, create(OTHER, ID)); // someone else's
  vaults.others = await predict(OTHER, ID);
  await send(OTHER, factory, create(USER as Address, keccak256(toHex('bait')))); // an attacker's, naming you as owner
  vaults.attackers = await predict(OTHER, keccak256(toHex('bait')));
  vaults.fake = (await send(deployer, null, vart.bytecode.object))!; // same code, not from the factory
  await send(deployer, vaults.fake, encodeFunctionData({ abi: vaultAbi, functionName: 'initialize', args: [ID, USER as Address, USER as Address, '0x0000000000000000000000000000000000000000'] }));
}

// ---------------------------------------------------------------- the site: next start behind a tampering proxy
async function startSite(): Promise<{ nextPort: number; port: number }> {
  const nextPort = 4800 + Math.floor(Math.random() * 400);
  next = spawn(process.execPath, [join(DEMO, 'node_modules/next/dist/bin/next'), 'start', '-p', String(nextPort)], { cwd: DEMO, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'ignore' });
  await until('next start', async () => (await fetch(`http://127.0.0.1:${nextPort}/`).catch(() => null))?.ok, 60000);
  proxy = http.createServer(async (req, res) => {
    const url = req.url!;
    if (url === '/.well-known/signet.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      return void res.end(readFileSync(join(siteDir, '.well-known/signet.json')));
    }
    if (url === '/evil-sw.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return void res.end('self.addEventListener("fetch", () => {});');
    }
    if (url === '/x.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return void res.end('console.log("injected")');
    }
    const r = await fetch(`http://127.0.0.1:${nextPort}${url}`, { headers: { accept: String(req.headers.accept ?? '*/*') }, redirect: 'manual' });
    let body = Buffer.from(await r.arrayBuffer());
    const ct = r.headers.get('content-type') ?? '';
    if (flags.tamperChunk && url.startsWith('/_next/static/chunks/') && url.endsWith('.js')) body = Buffer.concat([body, Buffer.from('\n;void "tampered";')]);
    if (ct.includes('text/html')) {
      let h = body.toString('utf8');
      if (flags.inline) h = h.replace('<head>', `<head><script>${flags.inline}</script>`);
      if (flags.external) h = h.replace('<head>', `<head><script src="http://evil.example.test:${port}/x.js"></script>`);
      body = Buffer.from(h);
    }
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => { if (!['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(k)) headers[k] = v; });
    res.writeHead(r.status, headers);
    res.end(body);
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  const port = (proxy.address() as { port: number }).port;
  return { nextPort, port };
}

// ---------------------------------------------------------------- browser helpers
async function browser(): Promise<Session> {
  const s = await openBrowser(ext, { origin });
  open.push(s);
  await synced(s, domain);
  return s;
}
async function visit(s: Session, path: string): Promise<{ page: Page; tab: number }> {
  const page = s.ctx.pages()[0] ?? (await s.ctx.newPage());
  await page.goto(`${origin}${path}`, { waitUntil: 'load' });
  return { page, tab: await until('the tab to be known to Guard', () => tabIdOf(s, page)) };
}
const light = (s: Session, tab: number, want: string) => until(`badge "${want}"`, async () => (await badge(s, tab)) === want).catch(async (e: Error) => {
  const rep = await s.sw.evaluate(async (t) => (await chrome.storage.session.get(`tab:${t}`))[`tab:${t}`], tab) as { report?: { status: string; files: { status: string; url: string; note?: string }[] } } | undefined;
  const bad = rep?.report?.files.filter((f) => !['ok', 'ok-sri', 'ok-inline', 'ok-ssr'].includes(f.status)) ?? [];
  throw new Error(`${e.message}; report ${rep?.report?.status}: ${JSON.stringify(bad).slice(0, 1500)}`);
});
const q = (vault: Address, id = ID) => `?vault=${vault}&token=${TOKEN}&factory=${factory}&id=${id}`;
async function act(page: Page, id: string): Promise<string> {
  // close Guard's "Signature refused" notice from a previous refusal, as a user would
  await page.evaluate(() => { document.getElementById('signet-guard-notice')?.remove(); document.getElementById('out')!.textContent = ''; });
  await page.click(`#${id}`);
  await page.waitForFunction(() => /: (sent|error)/.test(document.getElementById('out')?.textContent ?? ''), null, { timeout: 15000 });
  return (await page.locator('#out').textContent())!;
}
const drainerCalls = (s: Session) => signed(s).filter((c) => c.params.toLowerCase().includes(DRAINER.slice(2).toLowerCase()));

before(async () => {
  await anvil('anvil_nodeInfo').catch(() => {
    throw new Error(`the staging chain is not running at ${net.rpcUrl}: pnpm staging:up`);
  });
  await deployFactory();
  const b = spawnSync('pnpm', ['--filter', '@signet/demo-next', 'build'], { cwd: ROOT, encoding: 'utf8' });
  if (b.status !== 0) throw new Error(`demo-next build failed\n${b.stdout}${b.stderr}`);
  const dir = tmp('ssr-project-');
  siteDir = join(dir, 'site');
  mkdirSync(join(siteDir, '_next'), { recursive: true });
  cpSync(join(DEMO, '.next/static'), join(siteDir, '_next/static'), { recursive: true }); // what is served as /_next/static
  if (existsSync(join(DEMO, 'public'))) cpSync(join(DEMO, 'public'), siteDir, { recursive: true });
  signet(dir, ['init', '--domain', domain, '--approvers', 'approver1,approver2,approver3', '--recovery', 'recovery', '--guardian', 'guardian', '--no-wait'], 'user1');
  await anvil('anvil_mine', ['0x2']);
  signet(dir, ['init'], 'user1');
  const cfgFile = join(dir, 'signet.config.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
  writeFileSync(cfgFile, JSON.stringify({
    ...cfg,
    pages: { mode: 'ssr', crawl: ['/', '/stream'] },
    allowlist: { '196': { targets: [factory], factories: [{ factory, predict: 'predictVaultAddress(address,bytes32)', id: 'programId()', roles: ['owner()', 'guardian()'] }] } },
  }, null, 2));
  signet(dir, ['domain', siteDir]);
  const { nextPort, port } = await startSite();
  origin = `http://${domain}:${port}`;
  // crawl next itself: signet runs synchronously, so the proxy in this process couldn't answer meanwhile
  const sealed = signet(dir, ['seal', siteDir, '--crawl', `http://127.0.0.1:${nextPort}`]);
  assert.match(sealed, /Server-rendered pages: .* [1-9]\d* inline script\(s\) sealed/);
  await anvil('anvil_setBalance', [await pub.readContract({ address: cfg.gate, abi: parseAbi(['function proposer() view returns (address)']), functionName: 'proposer' }), '0xde0b6b3a7640000']);
  const id = signet(dir, ['propose', siteDir, '--emergency']).match(/Proposed release #(\d+)/)![1]!;
  for (const a of ['approver1', 'approver2', 'approver3']) signet(dir, ['approve', id], a);
  const renew = spawnSync(join(ROOT, 'staging/renew-operator.sh'), { encoding: 'utf8' });
  if (renew.status !== 0) throw new Error(`staging:renew failed\n${renew.stdout}${renew.stderr}`);
  signet(dir, ['publish', id, siteDir], 'user2');
  await switchToEnforce({ dir, dist: siteDir, domain, gate: cfg.gate });
  [rpcA, rpcB] = [await rpcProxy(), await rpcProxy()];
  ext = buildExtension(rpcA.url, rpcB.url, undefined, { '196': { rpcUrl: rpcA.url, rpcUrl2: rpcB.url } });
});
beforeEach(() => {
  flags.tamperChunk = false;
  flags.inline = '';
  flags.external = false;
  rpcA.lie = rpcB.lie = null;
});
after(async () => {
  for (const s of open) await s.close().catch(() => {});
  proxy?.close();
  next?.kill();
  rpcA?.close();
  rpcB?.close();
});

test('clean server-rendered site in enforce mode: green on a prerendered and a streamed page, no warning, your own vault works', async () => {
  const s = await browser();
  for (const path of ['/', '/stream']) {
    const { page, tab } = await visit(s, `${path}${q(vaults.mine)}`);
    if (path === '/stream') await page.waitForSelector('#slow');
    await light(s, tab, 'OK');
    // Guard 0.3.7: the popup counts the server-rendered page and the inline scripts as checked, in green
    const pp = await s.ctx.newPage();
    await pp.goto(`chrome-extension://${s.extId}/popup.html?tab=${tab}`);
    await pp.waitForSelector('h1');
    const dd = pp.locator('dt:text-is("Files matched") + dd');
    const text = (await dd.innerText()).trim();
    const m = /^(\d+) \/ (\d+) loaded checked · (\d+) files? \+ (\d+) inline \+ 1 server-rendered page$/.exec(text);
    assert.ok(m, `popup line: ${text}`);
    assert.equal(m[1], m[2], `all loaded items checked: ${text}`);
    assert.equal(Number(m[3]) + Number(m[4]) + 1, Number(m[2]), text);
    assert.equal(await dd.getAttribute('class'), 'good', text);
    assert.equal(await pp.locator('h2', { hasText: 'Page check' }).count(), 0, 'no "Page check" list of OK items');
    await pp.close();
  }
  const { page } = await visit(s, `/stream${q(vaults.mine)}`);
  await page.waitForSelector('#slow');
  assert.match(await act(page, 'approve'), /approve: sent/);
  assert.match(await act(page, 'deposit'), /deposit: sent/);
  const p2 = await visit(s, `/${q(vaults.mine, ID_NEW)}`);
  assert.match(await act(p2.page, 'create'), /create: sent/, 'the factory itself is a sealed target');
  assert.equal(signed(s).length, 3);
  assert.deepEqual(await events(s), [], 'no warning, no refusal, no page report');
  await s.close();
});

test('a tampered JS chunk: the page does not match, signatures are refused', async () => {
  flags.tamperChunk = true;
  const s = await browser();
  const page = s.ctx.pages()[0] ?? (await s.ctx.newPage());
  await page.goto(`${origin}/${q(vaults.mine)}`, { waitUntil: 'load' }).catch(() => {});
  await until('the page report', async () => (await events(s)).find((e) => e.kind === 'page'));
  const ev = (await events(s)).find((e) => e.kind === 'page')!;
  assert.ok(ev.refused && ev.details.some((d) => /^mismatch .*\/_next\/static\/chunks\//.test(d)), JSON.stringify(ev));
  assert.equal(signed(s).length, 0);
  await s.close();
});

test('an injected inline script: reported as injected, the page is taken over by the warning', async () => {
  flags.inline = 'console.log("not sealed")';
  const s = await browser();
  const page = s.ctx.pages()[0] ?? (await s.ctx.newPage());
  await page.goto(`${origin}/${q(vaults.mine)}`, { waitUntil: 'load' }).catch(() => {});
  const ev = await until('the page report', async () => (await events(s)).find((e) => e.kind === 'page'));
  assert.ok(ev.refused && ev.details.some((d) => /^injected\s+inline:/.test(d)), JSON.stringify(ev));
  await until('the warning page', () => page.url().startsWith('chrome-extension://'));
  await s.close();
});

test('the race: an injected script that signs at once is refused (re-scan before every signature)', async () => {
  flags.inline = `window.ethereum.request({method:"eth_sendTransaction",params:[{from:"${USER}",to:"${TOKEN}",data:"0x095ea7b3${DRAINER.slice(2).toLowerCase().padStart(64, '0')}${'f'.repeat(64)}"}]}).catch(function(){})`;
  const s = await browser();
  const page = s.ctx.pages()[0] ?? (await s.ctx.newPage());
  await page.goto(`${origin}/${q(vaults.mine)}`, { waitUntil: 'load' }).catch(() => {});
  await until('the refusal', async () => (await events(s)).find((e) => e.kind === 'sign' || e.kind === 'page'));
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(drainerCalls(s).length, 0, 'the drainer approval never reached the wallet');
  await s.close();
});

test('an injected external script: not a sealed origin', async () => {
  flags.external = true;
  const s = await browser();
  const page = s.ctx.pages()[0] ?? (await s.ctx.newPage());
  await page.goto(`${origin}/${q(vaults.mine)}`, { waitUntil: 'load' }).catch(() => {});
  const ev = await until('the page report', async () => (await events(s)).find((e) => e.kind === 'page'));
  assert.ok(ev.refused && ev.details.some((d) => /^unknown-origin\s+http:\/\/evil\.example\.test/.test(d)), JSON.stringify(ev));
  await s.close();
});

test('an unexpected service worker on the origin: not sealed', async () => {
  const s = await browser();
  const { page } = await visit(s, `/${q(vaults.mine)}`);
  // a worker left behind by an earlier hijack (registered here directly, not by a page script)
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.register('/evil-sw.js');
    await new Promise<void>((r) => (reg.active ? r() : (reg.installing ?? reg.waiting)!.addEventListener('statechange', () => reg.active && r())));
  });
  await page.reload({ waitUntil: 'load' }).catch(() => {});
  const ev = await until('the page report', async () => (await events(s)).find((e) => e.kind === 'page'));
  assert.ok(ev.details.some((d) => /^unknown .*evil-sw\.js/.test(d)), JSON.stringify(ev));
  await s.close();
});

test('factory rule: a fake vault, someone else\'s vault and an attacker\'s vault naming you are all refused', async () => {
  const s = await browser();
  for (const [name, v] of [['fake', vaults.fake], ['others', vaults.others], ['attackers', vaults.attackers]] as const) {
    const { page, tab } = await visit(s, `/${q(v)}`);
    await light(s, tab, 'OK');
    assert.match(await act(page, 'approve'), /approve: error Signet Guard refused this signature: Spender not in the sealed allowlist/, name);
    assert.match(await act(page, 'deposit'), /deposit: error Signet Guard refused this signature: Contract not in the sealed allowlist/, name);
  }
  assert.equal(signed(s).length, 0);
  const notes = (await events(s)).flatMap((e) => e.details).join('\n');
  assert.match(notes, /not created by the sealed factory/);
  assert.match(notes, /not made for you/);
  await s.close();
});

test('factory rule is strict: the two RPCs disagree about your own vault, so it is refused', async () => {
  rpcA.lie = (method, params, result) => {
    const call = (params[0] ?? {}) as { to?: string };
    if (method !== 'eth_call' || call.to?.toLowerCase() !== vaults.mine.toLowerCase()) return result;
    return typeof result === 'string' ? result.replace(/.$/, (c) => (c === '0' ? '1' : '0')) : result;
  };
  const s = await browser();
  const { page, tab } = await visit(s, `/${q(vaults.mine)}`);
  await light(s, tab, 'OK');
  assert.match(await act(page, 'approve'), /approve: error Signet Guard refused this signature: Spender not in the sealed allowlist/);
  assert.match((await events(s)).flatMap((e) => e.details).join('\n'), /could not check the factory: the two RPCs disagree/);
  await s.close();
});
