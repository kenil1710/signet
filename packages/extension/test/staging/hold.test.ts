// Guard 0.3.3 on staging (pnpm staging:up), enforce mode: a page that doesn't match waits for a release that can be
// published now (the team deployed it seconds before the publish), instead of showing the red page at once. Signing
// stays refused while it waits. Built with a 20 s hold (GUARD_HOLD_MS) to keep the suite short; the shipped value is 60 s.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import {
  anvil, net, signet, sealDemoDapp, serveSite, rpcProxy, buildExtension, openBrowser, until, synced, tabIdOf, badge, events, signed, switchToEnforce,
  type Project, type Site, type Proxy, type Session,
} from './harness.ts';

const HOLD_MS = 20_000;
const domain = `hold-${Date.now().toString(36)}.signet.test`;
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
type Report = { status: string; hold?: { release: number; until: number }; files: { url: string; status: string }[] } | null;
const report = (s: Session, tab: number) => s.sw.evaluate(async (t) => ((await chrome.storage.session.get(`tab:${t}`))[`tab:${t}`] as { report: Report } | undefined)?.report ?? null, tab);

/// A new release of the demo dApp (a code-only change: tier 00), proposed, approved by one approver, its 1 h timelock
/// passed on the chain: it can be published now. Not published.
let n = 0;
function readyRelease(): { dir: string; id: string } {
  const dir = join(project.dir, `dist-r${++n}`);
  cpSync(project.dist, dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), readFileSync(join(dir, 'index.html'), 'utf8').replace('</body>', `<!-- release r${n} --></body>`));
  signet(project.dir, ['seal', dir]);
  const id = signet(project.dir, ['propose', dir]).match(/Proposed release #(\d+)/)![1]!;
  signet(project.dir, ['approve', id], 'approver1');
  return { dir, id };
}
async function passTimelock(): Promise<void> {
  await anvil('evm_increaseTime', [`0x${(3600 + 60).toString(16)}`]);
  await anvil('anvil_mine', ['0x1']);
}
async function visit(s: Session): Promise<{ page: Page; tab: number }> {
  const page = s.ctx.pages()[0] ?? (await s.ctx.newPage());
  await page.goto(`${origin}/`, { waitUntil: 'load' }).catch(() => {});
  return { page, tab: await until('the tab to be known to Guard', () => tabIdOf(s, page)) };
}

before(async () => {
  await anvil('anvil_nodeInfo').catch(() => {
    throw new Error(`the staging chain is not running at ${net.rpcUrl}: pnpm staging:up`);
  });
  project = await sealDemoDapp(domain);
  site = await serveSite(project.dist);
  origin = `http://${domain}:${site.port}`;
  [rpcA, rpcB] = [await rpcProxy(), await rpcProxy()];
  process.env.GUARD_HOLD_MS = String(HOLD_MS);
  try {
    ext = buildExtension(rpcA.url, rpcB.url);
  } finally {
    delete process.env.GUARD_HOLD_MS;
  }
  await switchToEnforce(project);
});
after(async () => {
  for (const s of open) await s.close().catch(() => {});
  site?.close();
  rpcA?.close();
  rpcB?.close();
});

test('no release can be published: a page that does not match goes red at once, as before (no hold)', async () => {
  site.tamper = true;
  const s = await browser();
  const t0 = Date.now();
  const { page } = await visit(s);
  await page.waitForURL(/^chrome-extension:.*blocked\.html/, { timeout: 15000 });
  assert.ok(Date.now() - t0 < HOLD_MS, `red after ${Date.now() - t0} ms: it should not wait`);
  site.tamper = false;
  await s.close();
});

test('deployed seconds before the publish: grey while release #N can publish, a signature meanwhile is refused, green once it is published (never red)', async () => {
  const r = readyRelease();
  await passTimelock();
  site.root = r.dir; // the team deploys the new release, then publishes it
  const s = await browser();
  const { page, tab } = await visit(s);
  const held = await until('Guard to hold the page for the release being published', async () => (await report(s, tab))?.hold ?? null, 20000)
    .catch(async (e: Error) => { throw new Error(`${e.message}: ${JSON.stringify(await report(s, tab)).slice(0, 800)}; url ${page.url()}`); });
  assert.equal(String(held.release), r.id);
  assert.equal(await badge(s, tab), '?', 'grey while waiting, not red');
  assert.doesNotMatch(page.url(), /blocked\.html/);
  // signing while the page is held: refused (the page doesn't match the current release)
  await page.click('#approve').catch(() => {});
  await until('the signature to be refused', async () => (await events(s)).some((e) => e.kind === 'sign' && e.refused), 15000);
  assert.deepEqual(signed(s), [], 'nothing reached the wallet while held');
  // the publish lands within the hold
  signet(project.dir, ['publish', r.id, r.dir], 'user2');
  await until('green after the publish', async () => (await badge(s, tab)) === 'OK', HOLD_MS + 10000);
  assert.doesNotMatch(page.url(), /blocked\.html/, 'never sent to the red page');
  assert.equal((await report(s, tab))?.status, 'ok');
  assert.equal((await events(s)).filter((e) => e.kind === 'page').length, 0, 'no page event logged for the held page');
  await s.close();
});

test('a release that can publish but is never published: red after the hold', async () => {
  const r = readyRelease();
  await passTimelock();
  site.root = r.dir; // deployed, but nobody publishes it
  const s = await browser();
  const t0 = Date.now();
  const { page, tab } = await visit(s);
  await until('the hold', async () => (await report(s, tab))?.hold ?? null, 20000);
  await page.waitForURL(/^chrome-extension:.*blocked\.html/, { timeout: HOLD_MS + 20000 });
  const waited = Date.now() - t0;
  assert.ok(waited >= HOLD_MS - 2000, `red after ${waited} ms: it should have waited about ${HOLD_MS} ms`);
  assert.deepEqual(signed(s), []);
  site.root = undefined;
  await s.close();
});
