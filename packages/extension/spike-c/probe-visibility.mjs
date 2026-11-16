// Spike C probe: does the extension cause server traffic, and can the page see its cache reads?
import { chromium } from 'playwright';
import path from 'node:path'; import os from 'node:os'; import { mkdtemp } from 'node:fs/promises';
const EXT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { start, SEALED } = await import('./server.mjs');
const server = await start();
for (const withExt of [false, true]) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'signet-probe-'));
  const args = withExt ? [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] : [];
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args });
  const before = server.state.log.length;
  const page = await ctx.newPage();
  await page.goto(`${SEALED}/edge.html`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const entries = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => `${e.initiatorType} ${e.name}`));
  const reqs = server.state.log.slice(before).filter((u) => !u.endsWith('favicon.ico'));
  console.log(`\n== extension ${withExt ? 'ON' : 'OFF'}: server requests ${reqs.length}`); reqs.forEach((r) => console.log('   req', r));
  console.log(`   page-visible resource entries ${entries.length}`); entries.forEach((e) => console.log('   ', e));
  await ctx.close();
}
server.close();
