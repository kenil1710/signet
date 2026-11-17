// The gateway on the staging chain (pnpm staging:up). The demo dApp is sealed with the real CLI and published
// with a full on-chain copy; a plain Chromium (no Guard) with a mock wallet opens it on its gateway subdomain.
// The gateway's server holds only the boot page and the worker; two RPC proxies let the tests lie or go quiet.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { decodeFunctionResult, encodeFunctionResult, hexToString, parseAbi, toHex } from 'viem';
import { encodeLabel } from '@signet/extension/src/lib/label.ts';
import { anvil, net, sealDemoDapp, rpcProxy, installMockWallet, signed, DRAINER, DEMO_DIR, type Project, type Proxy, type WalletCall } from '@signet/extension/test/staging/harness.ts';
// @ts-expect-error plain .mjs without types
import { serveGateway } from '../../scripts/serve.mjs';

const domain = `copy-${Date.now().toString(36)}.signet.test`;
let project: Project;
let rpcA: Proxy;
let rpcB: Proxy;
let gateway: { port: number; log: string[]; close(): void };
let browser: Browser;
let origin = '';
const read = parseAbi(['function read(address,string) view returns (bytes)']);
const sealedFiles = () => (JSON.parse(readFileSync(join(project.dist, 'signet/files.json'), 'utf8')) as { files: { path: string; sha256: string }[] }).files;

/// A fresh profile (no service worker yet) with a wallet, like a first-time visitor.
async function visitor(): Promise<{ page: Page; wallet: WalletCall[]; close(): Promise<void> }> {
  const ctx = await browser.newContext();
  const wallet = await installMockWallet(ctx);
  const page = await ctx.newPage();
  return { page, wallet, close: () => ctx.close() };
}
const text = (page: Page) => page.locator('body').innerText();
/// Open a gateway address and let the boot page install the worker and reload.
async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller && !document.getElementById('main'), null, { timeout: 20000 });
  await page.waitForLoadState('load');
}

before(async () => {
  await anvil('anvil_nodeInfo').catch(() => {
    throw new Error(`the staging chain is not running at ${net.rpcUrl}: pnpm staging:up`);
  });
  project = await sealDemoDapp(domain);
  [rpcA, rpcB] = [await rpcProxy(), await rpcProxy()];
  const dist = mkdtempSync(join(tmpdir(), 'gateway-dist-'));
  const b = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/build.mjs', import.meta.url))], { encoding: 'utf8', env: { ...process.env, SIGNET_NETWORK: 'local', SIGNET_RPC_URL: rpcA.url, SIGNET_RPC_URL2: rpcB.url, GATEWAY_OUT: dist } });
  assert.equal(b.status, 0, b.stdout + b.stderr);
  gateway = await serveGateway(dist);
  origin = `http://${encodeLabel(domain)}.localhost:${gateway.port}`;
  browser = await chromium.launch({ headless: true });
});
beforeEach(() => {
  rpcA.down = rpcB.down = false;
  rpcA.lie = rpcB.lie = null;
});
after(async () => {
  await browser?.close();
  gateway?.close();
  rpcA?.close();
  rpcB?.close();
});

test('the verified copy is a normal page on its own origin: the app runs, a wallet is there, signing works', async () => {
  const v = await visitor();
  await open(v.page, `${origin}/`);
  await v.page.waitForSelector('#app[data-lazy="loaded"]'); // the main bundle and its lazy chunk both ran
  assert.equal(await v.page.locator('h1').textContent(), 'Demo Swap');
  assert.deepEqual(await v.page.evaluate(() => [location.protocol, isSecureContext, typeof (window as unknown as { ethereum?: unknown }).ethereum]), ['http:', true, 'object']);
  await v.page.click('#approve');
  await v.page.waitForSelector('#status[data-state="ok"]');
  await v.page.click('#permit');
  await v.page.waitForFunction(() => /Permit2: done/.test(document.getElementById('status')!.textContent!));
  assert.deepEqual(signed({ wallet: v.wallet } as never).map((c) => c.method), ['eth_sendTransaction', 'eth_signTypedData_v4']);
  // the gateway's server handed out the boot page and the worker, and no site content
  const served = [...new Set(gateway.log.map((l) => l.slice(l.indexOf('/') + 1)))].sort();
  assert.deepEqual(served, ['', '.signet/boot.js', 'sw.js']);
  // every file the page got is byte-for-byte the sealed one
  for (const f of sealedFiles()) {
    const got = await v.page.evaluate(async (p) => {
      const r = await fetch(`/${p}`);
      const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await r.arrayBuffer()))].map((b) => b.toString(16).padStart(2, '0')).join('');
      return [r.status, `0x${h}`, r.headers.get('x-signet-sha256'), r.headers.get('x-signet-release'), r.headers.get('x-signet-domain')];
    }, f.path);
    assert.deepEqual(got, [200, f.sha256, f.sha256, '1', domain], f.path);
  }
  if (process.env.SIGNET_SAVE_DEMO) await v.page.screenshot({ path: join(DEMO_DIR, 'gateway-verified-copy.png') });
  await v.close();
});

test('routes, missing files, the status page and the gateway\'s own files', async () => {
  const v = await visitor();
  await open(v.page, `${origin}/`);
  await v.page.goto(`${origin}/swap/settings`); // a route of the single-page app
  assert.equal(await v.page.locator('h1').textContent(), 'Demo Swap');
  const missing = await v.page.goto(`${origin}/assets/drainer.js`);
  assert.equal(missing!.status(), 404);
  assert.match(await text(v.page), /Not part of the sealed release/);
  await v.page.goto(`${origin}/.signet/status`);
  const status = await text(v.page);
  assert.match(status, new RegExp(`Verified copy of ${domain}`));
  assert.match(status, new RegExp(project.gate));
  for (const f of sealedFiles()) assert.ok(status.includes(f.sha256), f.path);
  assert.equal(await v.page.locator('script').count(), 0, 'the gateway\'s own pages have no scripts');
  await v.page.goto(`${origin}/`);
  const own = await v.page.evaluate(async () => {
    const hashes = (await (await fetch('/.signet/hashes.json')).json()) as Record<string, string>;
    const sw = await (await fetch('/sw.js')).arrayBuffer();
    const post = await fetch('/', { method: 'POST', body: 'x' });
    return [hashes['sw.js'], [...new Uint8Array(await crypto.subtle.digest('SHA-256', sw))].map((b) => b.toString(16).padStart(2, '0')).join(''), post.status];
  });
  assert.equal(own[0], own[1], '/sw.js comes from the gateway, not from the site');
  assert.equal(own[2], 405);
  await v.close();
});

test('the site may only talk to the origins its team sealed', async () => {
  const v = await visitor();
  await open(v.page, `${origin}/`);
  const csp = await v.page.evaluate(async () => (await fetch('/')).headers.get('content-security-policy'));
  assert.match(csp!, /connect-src 'self' blob: data:/);
  const blocked = await v.page.evaluate(() => fetch('https://example.com/').then(() => 'sent', () => 'blocked'));
  assert.equal(blocked, 'blocked');
  const inline = await v.page.evaluate(() => new Promise((res) => {
    const s = document.createElement('script');
    s.src = 'https://example.com/x.js';
    s.onerror = () => res('blocked');
    s.onload = () => res('loaded');
    document.head.append(s);
  }));
  assert.equal(inline, 'blocked');
  await v.close();
});

test('bytes that do not match the sealed hash are not shown', async () => {
  const main = sealedFiles().find((f) => /assets\/index-.*\.js$/.test(f.path))!.path;
  // both RPCs serve a changed main bundle
  rpcA.lie = rpcB.lie = (method, params, result) => {
    const data = (params[0] as { data?: string })?.data ?? '';
    if (method !== 'eth_call' || !data.startsWith('0xccaa7afb') || !data.includes(toHex(main).slice(2))) return result;
    const js = hexToString(decodeFunctionResult({ abi: read, functionName: 'read', data: result as `0x${string}` }));
    return encodeFunctionResult({ abi: read, functionName: 'read', result: toHex(`${js}\n;document.title="DRAINED";`) });
  };
  const v = await visitor();
  await open(v.page, `${origin}/`);
  await v.page.waitForTimeout(1000);
  assert.equal(await v.page.title(), 'Signet Demo dApp', 'the changed script never ran');
  assert.equal(await v.page.locator('#app[data-lazy="loaded"]').count(), 0);
  const res = await v.page.evaluate(async (p) => {
    const r = await fetch(`/${p}`);
    return [r.status, await r.text()];
  }, main);
  assert.equal(res[0], 502);
  assert.match(res[1] as string, /A file was rejected/);
  assert.ok(!(res[1] as string).includes('DRAINED'));
  await v.close();
});

test('a forged manifest, RPCs that disagree, and RPCs that are down: nothing is shown', async () => {
  rpcA.lie = rpcB.lie = (method, params, result) => {
    const data = (params[0] as { data?: string })?.data ?? '';
    if (method !== 'eth_call' || !data.startsWith('0xccaa7afb') || !data.includes(toHex('signet/allowlist.json').slice(2))) return result;
    const json = hexToString(decodeFunctionResult({ abi: read, functionName: 'read', data: result as `0x${string}` }));
    return encodeFunctionResult({ abi: read, functionName: 'read', result: toHex(json.replace('"spenders":[', `"spenders":["${DRAINER}",`)) });
  };
  let v = await visitor();
  await open(v.page, `${origin}/`);
  assert.match(await text(v.page), /was rejected[\s\S]*do not hash to the release published on-chain/);
  await v.close();

  rpcA.lie = null;
  rpcB.lie = (method, _p, result) => (method === 'eth_call' && typeof result === 'string' && result.length === 258 ? `${result.slice(0, 60)}ff${result.slice(62)}` : result);
  v = await visitor();
  await open(v.page, `${origin}/`);
  assert.match(await text(v.page), /Could not check the chain[\s\S]*the two RPCs disagree/);
  assert.equal(await v.page.locator('#app').count(), 0);
  await v.close();

  rpcB.lie = null;
  rpcA.down = rpcB.down = true;
  v = await visitor();
  await open(v.page, `${origin}/`);
  assert.match(await text(v.page), /Could not check the chain/);
  await v.close();
});

test('addresses that are not a sealed domain, and the landing page', async () => {
  const v = await visitor();
  await open(v.page, `http://never-sealed-example.localhost:${gateway.port}/`);
  assert.match(await text(v.page), /never\.sealed\.example is not a sealed site/);
  await v.page.goto(`http://localhost:${gateway.port}/`);
  assert.match(await text(v.page), /Signet gateway/);
  await v.page.fill('#d', domain);
  await v.page.click('button');
  await v.page.waitForSelector('#app[data-lazy="loaded"]', { timeout: 20000 });
  assert.equal(new URL(v.page.url()).origin, origin);
  await v.close();
});
