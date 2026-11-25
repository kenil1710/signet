// Guard 0.3.4 on staging: (1) a sealed 404.html, served with HTTP 404 for unknown paths (as Cloudflare Pages does),
// is checked like any page: the sealed bytes are OK, other bytes are not; (2) the popup offers "Open the verified copy"
// only when the current release is stored on-chain in full, and says "Verified copy: available with Pro" otherwise.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { anvil, net, signet, sealDemoDapp, serveSite, rpcProxy, buildExtension, openBrowser, until, synced, tabIdOf, badge, type Project, type Site, type Proxy, type Session } from './harness.ts';

const domain = `notfound-${Date.now().toString(36)}.signet.test`;
const NOT_FOUND = '<!doctype html><title>Not found</title><h1>There is no page here</h1><a href="/">home</a>\n';
let project: Project;
let site: Site;
let rpcA: Proxy;
let rpcB: Proxy;
let ext: string;
let origin: string;
const open: Session[] = [];

type Report = { status: string; files: { url: string; status: string }[] } | null;
const report = (s: Session, tab: number) => s.sw.evaluate(async (t) => ((await chrome.storage.session.get(`tab:${t}`))[`tab:${t}`] as { report: Report } | undefined)?.report ?? null, tab);

/// a new release of the demo dApp with a 404.html (a code-only change: tier 00), approved, timelock passed, published
let n = 0;
async function release(o: { full: boolean }): Promise<string> {
  const dir = join(project.dir, `dist-nf${++n}`);
  cpSync(project.dist, dir, { recursive: true });
  writeFileSync(join(dir, '404.html'), NOT_FOUND);
  writeFileSync(join(dir, 'index.html'), readFileSync(join(dir, 'index.html'), 'utf8').replace('</body>', `<!-- r${n} --></body>`));
  signet(project.dir, ['seal', dir]);
  const id = signet(project.dir, ['propose', dir]).match(/Proposed release #(\d+)/)![1]!;
  signet(project.dir, ['approve', id], 'approver1');
  await anvil('evm_increaseTime', [`0x${(3600 + 60).toString(16)}`]);
  await anvil('anvil_mine', ['0x1']);
  signet(project.dir, ['publish', id, dir, ...(o.full ? ['--full'] : [])], 'user2');
  site.root = dir;
  return id;
}
async function browser(): Promise<Session> {
  const s = await openBrowser(ext, { origin });
  open.push(s);
  await synced(s, domain);
  return s;
}
async function visit(s: Session, path: string): Promise<{ page: Page; tab: number; status: number }> {
  const page = s.ctx.pages()[0] ?? (await s.ctx.newPage());
  const r = await page.goto(`${origin}${path}`, { waitUntil: 'load' });
  return { page, tab: await until('the tab to be known to Guard', () => tabIdOf(s, page)), status: r?.status() ?? 0 };
}
async function popupCopy(s: Session, tab: number): Promise<{ button: boolean; text: string }> {
  const p = await s.ctx.newPage();
  await p.goto(`chrome-extension://${s.extId}/popup.html?tab=${tab}`);
  await p.waitForSelector('h1');
  await until('the verified-copy check', async () => !/checking/.test(await p.locator('.pp-actions').innerText()), 20000);
  const r = { button: (await p.locator('#copy').count()) > 0, text: (await p.locator('.pp-actions').innerText()).replace(/\s+/g, ' ') };
  await p.close();
  return r;
}

before(async () => {
  await anvil('anvil_nodeInfo').catch(() => {
    throw new Error(`the staging chain is not running at ${net.rpcUrl}: pnpm staging:up`);
  });
  project = await sealDemoDapp(domain);
  site = await serveSite(project.dist);
  origin = `http://${domain}:${site.port}`;
  [rpcA, rpcB] = [await rpcProxy(), await rpcProxy()];
  ext = buildExtension(rpcA.url, rpcB.url);
});
after(async () => {
  for (const s of open) await s.close().catch(() => {});
  site?.close();
  rpcA?.close();
  rpcB?.close();
});

test('a release stored in full (publish --full): the popup offers "Open the verified copy"', async () => {
  await release({ full: true });
  const s = await browser();
  const { tab } = await visit(s, '/');
  await until('green', async () => (await badge(s, tab)) === 'OK', 20000);
  const c = await popupCopy(s, tab);
  assert.ok(c.button, c.text);
  await s.close();
});

test('an unknown path: HTTP 404 with the sealed 404.html is green; other bytes at 404 are not', async () => {
  const s = await browser();
  const { tab, status } = await visit(s, '/nonexistent-page-xyz');
  assert.equal(status, 404);
  await until('the 404 page to be checked OK', async () => (await report(s, tab))?.status === 'ok' && (await badge(s, tab)) === 'OK', 20000)
    .catch(async (e: Error) => { throw new Error(`${e.message}: ${JSON.stringify(await report(s, tab)).slice(0, 600)}`); });
  // a deeper unknown path too
  const deep = await visit(s, '/a/b/c');
  assert.equal(deep.status, 404);
  await until('the deep 404 page OK', async () => (await report(s, deep.tab))?.status === 'ok', 20000);
  // the server answers 404 with bytes that aren't the sealed 404.html
  site.notFound = Buffer.from(NOT_FOUND.replace('</h1>', '</h1><script>window.x=1</script>'));
  const bad = await visit(s, '/another-missing-page');
  await until('the changed 404 page not to pass', async () => { const r = await report(s, bad.tab); return r && r.status !== 'ok' && r.files.some((f) => f.status === 'mismatch') ? r : null; }, 20000)
    .catch(async (e: Error) => { throw new Error(`${e.message}: ${JSON.stringify(await report(s, bad.tab)).slice(0, 600)}`); });
  site.notFound = undefined;
  await s.close();
});

test('a release not stored in full: no button, the popup says "Verified copy: available with Pro"', async () => {
  await release({ full: false });
  const s = await browser();
  const { tab } = await visit(s, '/');
  await until('green', async () => (await badge(s, tab)) === 'OK', 20000);
  const c = await popupCopy(s, tab);
  assert.equal(c.button, false, c.text);
  assert.match(c.text, /Verified copy: available with Pro/);
  await s.close();
});
