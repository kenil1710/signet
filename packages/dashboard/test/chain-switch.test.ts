// "Switch to X Layer" in the dashboard (the mainnet build), against wallet stand-ins that follow each wallet's
// documented behavior. Real MetaMask / Rabby can't be driven headless (their approval pop-ups need a person), so
// these check the protocol; confirm once by hand in each wallet.
//   npx vite build (SIGNET_NETWORK=mainnet) is done by the test; run: node --test test/chain-switch.test.ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let server: http.Server, url = '', browser: Browser;
before(async () => {
  const dist = mkdtempSync(join(tmpdir(), 'dash-chain-'));
  const b = spawnSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SIGNET_NETWORK: 'mainnet' } });
  assert.equal(b.status, 0, b.stderr);
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.webp': 'image/webp' };
  server = http.createServer((q, r) => { const p = q.url!.split('?')[0] === '/' ? 'index.html' : q.url!.split('?')[0]!.slice(1); try { r.setHeader('content-type', types[extname(p)] ?? 'application/octet-stream'); r.end(readFileSync(join(dist, p))); } catch { r.statusCode = 404; r.end(); } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/app.html#/badge/signetguard.xyz`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

type Persona = 'metamask' | 'metamask-mobile' | 'rabby' | 'rabby-unknown' | 'rejects' | 'adds-no-switch';
/// A wallet on Ethereum (0x1). Records every request.
async function open(persona: Persona) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((persona: Persona) => {
    const known = new Set(persona === 'rabby' ? ['0x1', '0xc4'] : ['0x1']);
    let chain = '0x1';
    const subs: ((c: string) => void)[] = [];
    const calls: string[] = ((window as unknown as { __calls: string[] }).__calls = []);
    const err = (code: number, message: string, data?: unknown) => Object.assign(new Error(message), { code, data });
    const setChain = (c: string) => { chain = c; subs.forEach((f) => f(c)); };
    (window as unknown as { ethereum: unknown }).ethereum = {
      on(ev: string, f: (c: string) => void) { if (ev === 'chainChanged') subs.push(f); },
      async request({ method, params }: { method: string; params?: [Record<string, unknown>] }) {
        calls.push(method);
        if (method === 'eth_chainId') return chain;
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['0x0000000000000000000000000000000000000001'];
        if (method === 'wallet_switchEthereumChain') {
          if (persona === 'rejects') throw err(4001, 'User rejected the request.');
          const id = String(params![0]!.chainId);
          if (!known.has(id)) {
            if (persona === 'metamask-mobile') throw err(-32603, 'Internal JSON-RPC error.', { originalError: { code: 4902, message: `Unrecognized chain ID "${id}".` } });
            throw err(4902, `Unrecognized chain ID "${id}". Try adding the chain using wallet_addEthereumChain first.`);
          }
          setChain(id);
          return null;
        }
        if (method === 'wallet_addEthereumChain') {
          // MetaMask's checks (EIP-3085): hex chainId without leading zeros, https RPC, 18-decimal native currency
          const p = params![0] as { chainId: string; chainName: string; rpcUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number }; blockExplorerUrls?: string[] };
          if (!/^0x[1-9a-f][0-9a-f]*$/.test(p.chainId)) throw err(-32602, 'bad chainId');
          if (!p.rpcUrls?.length || !p.rpcUrls.every((u) => u.startsWith('https://'))) throw err(-32602, 'rpcUrls must be https');
          if (p.nativeCurrency?.decimals !== 18 || !/^.{2,6}$/.test(p.nativeCurrency.symbol)) throw err(-32602, 'bad nativeCurrency');
          (window as unknown as { __added: unknown }).__added = p;
          known.add(p.chainId);
          if (persona !== 'adds-no-switch') setChain(p.chainId); // MetaMask and Rabby switch when the user approves the add
          return null;
        }
        return null;
      },
    };
  }, persona);
  const page = await ctx.newPage();
  await page.goto(url);
  return { ctx, page };
}

const bar = (page: import('playwright').Page) => page.locator('#chainbar');

for (const persona of ['metamask', 'metamask-mobile', 'rabby', 'rabby-unknown', 'adds-no-switch'] as const) {
  test(`${persona}: the bar shows on the wrong chain, one click ends on X Layer (196), the bar goes away`, async () => {
    const { ctx, page } = await open(persona);
    await bar(page).waitFor({ state: 'visible' });
    assert.match(await bar(page).innerText(), /chain 1\b[\s\S]*X Layer \(chain 196\)/);
    if (persona === 'metamask' && process.env.SIGNET_SAVE_DEMO) await page.screenshot({ path: fileURLToPath(new URL('../../../docs/demo/ui/dashboard-switch-chain-1280.png', import.meta.url)) });
    await page.click('#switchchain');
    await bar(page).waitFor({ state: 'hidden', timeout: 5000 });
    assert.equal(await page.evaluate(() => (window as unknown as { ethereum: { request(a: unknown): Promise<string> } }).ethereum.request({ method: 'eth_chainId' })), '0xc4');
    assert.match(await page.locator('#toast').innerText(), /switched to X Layer \(chain 196\)/);
    const calls = await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls.filter((c) => c.startsWith('wallet_')));
    if (persona === 'rabby') assert.deepEqual(calls, ['wallet_switchEthereumChain']);
    else {
      assert.ok(calls.includes('wallet_addEthereumChain'), calls.join());
      const added = await page.evaluate(() => (window as unknown as { __added: { chainId: string; rpcUrls: string[]; nativeCurrency: { symbol: string } } }).__added);
      assert.equal(added.chainId, '0xc4');
      assert.deepEqual(added.rpcUrls, ['https://xlayerrpc.okx.com']);
      assert.equal(added.nativeCurrency.symbol, 'OKB');
    }
    await ctx.close();
  });
}

test('the user says no: the bar stays and the toast says why', async () => {
  const { ctx, page } = await open('rejects');
  await bar(page).waitFor({ state: 'visible' });
  await page.click('#switchchain');
  await page.waitForFunction(() => /rejected/i.test(document.getElementById('toast')?.textContent ?? ''));
  assert.ok(await bar(page).isVisible());
  await ctx.close();
});

test('a wallet already on X Layer sees no bar', async () => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { (window as unknown as { ethereum: unknown }).ethereum = { on() {}, async request({ method }: { method: string }) { return method === 'eth_chainId' ? '0xc4' : null; } }; });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForTimeout(800);
  assert.equal(await bar(page).isVisible(), false);
  await ctx.close();
});
