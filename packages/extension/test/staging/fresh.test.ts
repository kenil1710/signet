// Guard 0.3.2 on staging (pnpm staging:up): a page check that doesn't trust a stale browser cache, but still trusts
// what the page ran. Found 2026-11-24 in a real Chrome: the HTTP cache kept release #7's HTML while signetguard.xyz
// served #8, and Guard said "1 file differs". Reproduced here the way it happens: a page delivered by request
// interception (as a debugger-attached extension does) is not written to the cache, so the cache keeps the older copy.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import {
  anvil, net, signet, sealDemoDapp, serveSite, rpcProxy, buildExtension, openBrowser, until, synced, tabIdOf, badge,
  type Project, type Site, type Proxy, type Session,
} from './harness.ts';

const domain = `fresh-${Date.now().toString(36)}.signet.test`;
let project: Project;
let site: Site;
let rpcA: Proxy;
let rpcB: Proxy;
let ext: string;
let origin: string;
const open: Session[] = [];

async function browser(): Promise<Session> {
  const s = await openBrowser(ext, { origin });
  open.push(s);
  await synced(s, domain);
  return s;
}
async function visit(s: Session, page?: Page): Promise<{ page: Page; tab: number }> {
  const p = page ?? s.ctx.pages()[0] ?? (await s.ctx.newPage());
  await p.goto(`${origin}/`, { waitUntil: 'load' });
  return { page: p, tab: await until('the tab to be known to Guard', () => tabIdOf(s, p)) };
}
const light = (s: Session, tab: number, want: string) => until(`badge "${want}"`, async () => (await badge(s, tab)) === want, 20000);
const report = (s: Session, tab: number) => s.sw.evaluate(async (t) => (await chrome.storage.session.get(`tab:${t}`))[`tab:${t}`] as { report: { status: string; files: { url: string; status: string; note?: string }[] } | null }, tab);
const htmlResult = async (s: Session, tab: number) => (await report(s, tab)).report?.files.find((f) => new URL(f.url).pathname === '/');

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

test('a stale browser cache (an older HTML kept while the page shows the sealed one) is not a mismatch: green', async () => {
  const s = await browser();
  // 1. an older, unsealed HTML gets into the cache (Guard rightly reports it at that moment)
  site.html = Buffer.concat([readFileSync(join(project.dist, 'index.html')), Buffer.from('\n<!-- an older deploy -->\n')]);
  const first = await visit(s);
  await light(s, first.tab, '!');
  site.html = undefined;
  await new Promise((r) => setTimeout(r, 3500)); // the cached copy's Date is now clearly older than the next load
  // 2. the sealed HTML is shown through request interception, which is not written to the cache: the cache keeps (1)
  const cdp = await s.ctx.newCDPSession(first.page);
  const sealed = readFileSync(join(project.dist, 'index.html'));
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${origin}/`, resourceType: 'Document', requestStage: 'Request' }] });
  cdp.on('Fetch.requestPaused', (e: { requestId: string }) => void cdp.send('Fetch.fulfillRequest', {
    requestId: e.requestId, responseCode: 200, body: sealed.toString('base64'),
    responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }, { name: 'cache-control', value: 'no-cache' }, { name: 'date', value: new Date().toUTCString() }],
  }));
  const again = await visit(s, first.page);
  await cdp.send('Fetch.disable');
  const cachedNow = await first.page.evaluate(async () => (await fetch('/', { cache: 'only-if-cached', mode: 'same-origin' })).text());
  assert.match(cachedNow, /an older deploy/, 'the browser cache really holds the older HTML (the real-Chrome state)');
  await light(s, again.tab, 'OK');
  const h = await until('the HTML result', () => htmlResult(s, again.tab), 15000).catch(async () => { throw new Error(`no HTML result: ${JSON.stringify(await report(s, again.tab)).slice(0, 1500)}`); });
  assert.equal(h?.status, 'ok');
  assert.match(h?.note ?? '', /browser cache held an older copy/);
  await s.close();
});

test('a hijack served once (the page ran tampered code, the site serves clean code now) is still red', async () => {
  site.tamper = 'once';
  const s = await browser();
  const { tab } = await visit(s);
  await light(s, tab, '!');
  const r = await report(s, tab);
  const bad = r.report!.files.find((f) => f.status === 'mismatch');
  assert.ok(bad, JSON.stringify(r.report?.files));
  assert.match(bad!.note ?? '', /served other bytes than the site serves now/);
  await s.close();
});

test('a page loaded before a new release was published, checked by a Guard that never saw the previous release: "loaded before release #2, reload", grey not red; a reload is green', async () => {
  const s = await browser();
  const { page, tab } = await visit(s);
  await light(s, tab, 'OK');
  // release #2: a code-only change to the HTML, published through the emergency fast lane (3 of 3)
  const dist2 = join(project.dir, 'dist2');
  cpSync(project.dist, dist2, { recursive: true });
  writeFileSync(join(dist2, 'index.html'), readFileSync(join(dist2, 'index.html'), 'utf8').replace('</body>', '<!-- release 2 --></body>'));
  signet(project.dir, ['seal', dist2]);
  const id = signet(project.dir, ['propose', dist2, '--emergency']).match(/Proposed release #(\d+)/)![1]!;
  for (const a of ['approver1', 'approver2', 'approver3']) signet(project.dir, ['approve', id], a);
  signet(project.dir, ['publish', id, dist2], 'user2');
  site.root = dist2;
  // the open page (release #1's HTML) is checked again: it was loaded before #2 was published
  // As in the real case (a fresh Guard install): Guard has never seen release #1, so #1's grace window can't help;
  // and it reads the chain at most once a minute, so let that minute pass (by ageing the cached state)
  await s.sw.evaluate(async (d) => {
    const k = `site:${d}`;
    const v = (await chrome.storage.local.get(k))[k] as object;
    await chrome.storage.local.set({ [k]: { ...v, checkedAt: Date.now() - 120_000, manifests: {} } });
  }, domain);
  // a signature request makes Guard check the page as it is now (it re-checks before every signature)
  await page.click('#approve');
  await until('the page to be re-checked against release #2', async () => (await htmlResult(s, tab))?.status === 'stale-release', 30000).catch(async (e: Error) => {
    const st = await s.sw.evaluate(async (d) => { const v = (await chrome.storage.local.get(`site:${d}`))[`site:${d}`] as { release: number; publishedAt?: number; checkedAt: number }; return { release: v.release, publishedAt: v.publishedAt, checkedAt: v.checkedAt, now: Date.now() }; }, domain);
    throw new Error(`${e.message}: html ${JSON.stringify(await htmlResult(s, tab))}; site ${JSON.stringify(st)}; page loaded ${await page.evaluate(() => performance.timeOrigin)}`);
  });
  assert.equal(await badge(s, tab), '?', 'grey, not red');
  assert.match((await htmlResult(s, tab))?.note ?? '', /loaded before release #\d+ was published: reload/);
  const reloaded = await visit(s, page);
  await light(s, reloaded.tab, 'OK');
  site.root = undefined;
  await s.close();
});
