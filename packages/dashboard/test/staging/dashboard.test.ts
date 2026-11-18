// The dashboard on the staging chain (pnpm staging:up). Real headless Chromium, the real build, and a test wallet
// that sends through the staging chain's unlocked accounts, so every click is a real transaction on the fork.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, appendFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { anvil, net, sealDemoDapp, signet, rpcProxy, DEMO_DIR, type Project, type Proxy } from '@signet/extension/test/staging/harness.ts';
import { POISON } from '@signet/cli/test/fixtures.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const domain = `dash-${Date.now().toString(36)}.signet.test`;
let p: Project;
let rpc2: Proxy;
let server: http.Server;
let url = '';
let browser: Browser;
let page: Page;
let published = ''; // the code-only release published through the dashboard (its id = the proposal's id)
const A = net.accounts!;
const mainOf = (dist: string) => `assets/${readdirSync(join(dist, 'assets')).find((f) => /^index-.*\.js$/.test(f))}`;
const as = (who: string) => page.evaluate((a) => ((window as unknown as { __acct: string }).__acct = a), who);
const go = async (hash: string) => {
  // the same #/… address again is not a navigation: reload so the page reads the chain again
  if (page.url() === `${url}#${hash}`) await page.reload();
  else await page.goto(`${url}#${hash}`);
  await page.waitForLoadState('load');
};
const until = (re: RegExp) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('app')!.innerText), re.source, { timeout: 30000 });
async function clickAndWait(sel: string, re: RegExp): Promise<string> {
  await page.evaluate(() => (document.getElementById('toast')!.textContent = ''));
  await page.locator(sel).first().click();
  const t = page.locator('#toast');
  await page.waitForFunction((src) => new RegExp(src).test(document.getElementById('toast')!.textContent ?? ''), re.source, { timeout: 30000 }).catch(async () => {
    throw new Error(`after clicking ${sel}: ${await t.textContent()}`);
  });
  return (await t.textContent())!;
}
const text = () => page.locator('#app').innerText();

before(async () => {
  await anvil('anvil_nodeInfo').catch(() => {
    throw new Error(`the staging chain is not running at ${net.rpcUrl}: pnpm staging:up`);
  });
  spawnSync('bash', [join(ROOT, '../../staging/renew-operator.sh')]);
  p = await sealDemoDapp(domain);
  rpc2 = await rpcProxy();
  const dist = mkdtempSync(join(tmpdir(), 'dash-dist-'));
  const b = spawnSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SIGNET_NETWORK: 'local', SIGNET_RPC_URL2: rpc2.url } });
  assert.equal(b.status, 0, b.stdout + b.stderr);
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  server = http.createServer((req, res) => {
    const rel = req.url!.split('?')[0] === '/' ? 'app.html' : req.url!.split('?')[0]!.slice(1);
    const f = join(dist, rel);
    if (!existsSync(f)) return void ((res.statusCode = 404), res.end());
    res.setHeader('content-type', types[extname(f)] ?? 'application/octet-stream');
    res.end(readFileSync(f));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  await ctx.addInitScript(({ rpc, acct }) => {
    (window as unknown as { __acct: string }).__acct = acct;
    (window as unknown as { ethereum: unknown }).ethereum = {
      async request({ method, params }: { method: string; params?: unknown[] }) {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [(window as unknown as { __acct: string }).__acct];
        const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }) });
        const j = await r.json();
        if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
        return j.result;
      },
    };
  }, { rpc: net.rpcUrl, acct: A.approvers[0]! });
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && console.log(`[console] ${m.text()}`));
});
after(async () => {
  await browser?.close();
  server?.close();
  rpc2?.close();
});

test('home lists the sealed domain; the project page shows release, roles, mode and state', async () => {
  await go('/');
  await page.locator(`a[href="#/p/${domain}"]`).waitFor();
  await page.click(`a[href="#/p/${domain}"]`);
  await page.locator('h1').filter({ hasText: domain }).waitFor();
  const t = await text();
  assert.match(t, /release\s+#1 · manifest 0x[0-9a-f]{64}/i); // labels are uppercase in CSS
  assert.match(t, new RegExp(p.gate));
  for (const a of A.approvers) assert.ok(t.toLowerCase().includes(a.toLowerCase()), a);
  assert.match(t, /active/i);
  assert.match(t, /observe/i);
  assert.match(t, /can propose and publish; never approve/);
  if (process.env.SIGNET_SAVE_DEMO) await page.screenshot({ path: join(DEMO_DIR, 'dashboard-project.png'), fullPage: true });
});

test('Diff Guard in the browser: the poisoned build is checked against the chain and its new address, origin and calls are flagged; a different folder is refused', async () => {
  const poisoned = join(p.dir, 'upload', 'dist');
  mkdirSync(join(p.dir, 'upload'), { recursive: true });
  cpSync(p.dist, poisoned, { recursive: true });
  appendFileSync(join(poisoned, mainOf(poisoned)), POISON);
  signet(p.dir, ['seal', poisoned]);
  const id = signet(p.dir, ['propose', poisoned]).match(/Proposed release #(\d+)/)![1]!;
  await go(`/p/${domain}/proposal/${id}`);
  await page.locator('h1').filter({ hasText: `proposal #${id}` }).waitFor();
  assert.match(await text(), /Risk tier computed on-chain: 10 allowlist changed/);
  await page.setInputFiles('#dir', join(p.dir, 'upload'));
  await page.locator('pre.diff').waitFor({ timeout: 30000 }).catch(async (e: Error) => {
    throw new Error(`${e.message}\n#result: ${await page.locator('#result').innerText()}`);
  });
  const d = await page.locator('pre.diff').innerText();
  assert.match(d, /the folder hashes to the proposal's on-chain values, and all \d+ files match their sealed hashes/);
  assert.match(d, /Compared with: release #1, read from the chain and hash-checked/);
  assert.match(d, /! NEW contract 0xBAD0C0fFeE5BAD0c0ffEe5baD0c0ffeE5baD0C0F/);
  assert.match(d, /! NEW external origin https:\/\/cdn\.connect-kit-assets\.example\.net/);
  assert.match(d, /! NEW ERC-20 approve in the code/);
  assert.match(d, /RISK TIER 10 ALLOWLIST CHANGED/);
  assert.ok(!/DIFFERENT TIER/.test(d));
  if (process.env.SIGNET_SAVE_DEMO) await page.screenshot({ path: join(DEMO_DIR, 'dashboard-diff-guard.png'), fullPage: true });
  // the first release's folder is not this proposal
  const other = join(p.dir, 'other');
  mkdirSync(other, { recursive: true });
  cpSync(p.dist, join(other, 'dist'), { recursive: true });
  await page.setInputFiles('#dir', other);
  await page.locator('#result .bad').waitFor();
  assert.match(await page.locator('#result').innerText(), /is not the build proposed/);

  // approve (approver 2), withdraw, then cancel (approver 3): all through the wallet
  await as(A.approvers[1]!);
  assert.match(await clickAndWait('button[data-a="approve"]', /sent|refused/), /approve sent/);
  await until(/1 of 3 approvals: needs 1 more/);
  assert.match(await clickAndWait('button[data-a="approve"]', /sent|refused/), /refused by the contract: AlreadyApproved/);
  assert.match(await clickAndWait('button[data-a="withdrawApproval"]', /sent|refused/), /withdrawApproval sent/);
  await as(A.approvers[2]!);
  assert.match(await clickAndWait('button[data-a="cancel"]', /sent|refused/), /cancel sent/);
  await page.waitForFunction(() => !document.querySelector('button[data-a="approve"]'));
  // a key that is not an approver is refused by the contract
  await as(A.users[1]!);
});

test('a code-only release: approve, the timelock counts down, publish through the wallet', async () => {
  const v2 = join(p.dir, 'v2');
  cpSync(p.dist, v2, { recursive: true });
  writeFileSync(join(v2, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  signet(p.dir, ['seal', v2]);
  const id = signet(p.dir, ['propose', v2]).match(/Proposed release #(\d+)/)![1]!;
  await as(A.approvers[0]!);
  await go(`/p/${domain}`);
  await page.locator(`tr[data-id="${id}"]`).waitFor();
  assert.ok(await page.locator(`tr[data-id="${id}"] button[data-a="publish"]`).isDisabled());
  await clickAndWait(`tr[data-id="${id}"] button[data-a="approve"]`, /approved|refused/);
  await page.locator(`tr[data-id="${id}"] .cd`).waitFor();
  assert.match(await page.locator(`tr[data-id="${id}"]`).innerText(), /1 of 3, timelock running\. (\d+h )?\d+m/);
  await anvil('evm_increaseTime', ['0xe10']);
  await anvil('anvil_mine', ['0x1']);
  await go(`/p/${domain}`);
  await page.locator(`tr[data-id="${id}"] button[data-a="publish"]:not([disabled])`).waitFor();
  await as(A.users[0]!); // anyone may publish; the policy circuit decides
  await clickAndWait(`tr[data-id="${id}"] button[data-a="publish"]`, /published|refused/);
  await page.locator('h1').filter({ hasText: domain }).waitFor();
  await until(new RegExp(`release\\s+#${id}`));
  published = id;
  signet(p.dir, ['upload', v2], 'user2'); // the manifest files of release #2 (what the action does)
});

test('the badge: live card, link and iframe snippets; the embed shows only the card', async () => {
  await go(`/badge/${domain}`);
  await page.locator('h1', { hasText: 'Badge' }).waitFor();
  const t = await text();
  assert.match(t, new RegExp(`Sealed by Signet\\s+${domain.replace(/\./g, '\\.')} · release #${published} · observe`));
  assert.match(t, /Sealed by Signet · verify/);
  assert.match(t, /iframe src=/);
  if (process.env.SIGNET_SAVE_DEMO) await page.screenshot({ path: join(DEMO_DIR, 'dashboard-badge.png') });
  await go(`/badge/${domain}?embed`);
  await page.waitForFunction(() => !document.querySelector('h1') && !!document.querySelector('.badge'));
});

test('freeze (one approver), unfreeze (two), revoke', async () => {
  await as(A.approvers[0]!);
  await go(`/p/${domain}`);
  await clickAndWait('#freeze', /frozen|refused/);
  await page.locator('.pill.bad', { hasText: 'FROZEN' }).waitFor();
  await clickAndWait('#unfreeze', /one more|unfrozen|refused/);
  assert.match(await page.locator('#unfreeze').innerText(), /1 of 2/);
  await as(A.approvers[1]!);
  await clickAndWait('#unfreeze', /unfrozen|refused/);
  await page.locator('.pill.ok', { hasText: 'active' }).waitFor();
  await clickAndWait('#revoke', /revoked|refused/);
  await page.locator('.pill.bad', { hasText: 'release revoked' }).waitFor();
});

test('/prove, with no wallet: both circuits re-checked on all 512 inputs, the beacon, and every recent release recomputed in the browser', { timeout: 300_000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 1000 } }); // no wallet at all
  const pg = await ctx.newPage();
  await pg.goto(`${url}#/prove`);
  await pg.waitForFunction(() => /All checks passed|FAILED/.test(document.getElementById('sum')?.textContent ?? ''), null, { timeout: 280_000 });
  const t = await pg.locator('#app').innerText();
  assert.match(t, /All checks passed/);
  assert.match(t, /Verified\s+The release policy is circuit #6[\s\S]*34 NAND gates[\s\S]*all 512 rows equal the published truth table/i);
  assert.match(t, /Verified\s+The Guard decision circuit[\s\S]*circuit #7: 22 NAND gates[\s\S]*all 512 rows/i);
  assert.match(t, /Verified\s+A taped-out circuit's behavior can't be upgraded/i);
  assert.match(t, new RegExp(`Verified\\s+${domain.replace(/\./g, '\\.')}: the release files stored on-chain hash to what its gate published\\s+release #${published} is revoked`, 'i'));
  if (process.env.SIGNET_SAVE_DEMO) await pg.screenshot({ path: join(DEMO_DIR, 'dashboard-prove.png'), fullPage: true });
  await ctx.close();
});

