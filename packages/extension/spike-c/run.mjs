// Spike C runner: loads the unpacked extension in Playwright's Chromium, opens the demo app under several
// scenarios and checks the badge each time. Every scenario uses a fresh browser profile (empty HTTP cache).
// Run: pnpm --filter @signet/extension spike:c   (builds the demo app and regenerates the manifest first)
import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { start, SEALED, OTHER, sha256 } from './server.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await start();
let failures = 0;

async function withBrowser(fn) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'signet-spike-c-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', // new headless mode: supports extensions
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
    return await fn(ctx, sw);
  } finally {
    await ctx.close();
  }
}

async function reportFor(sw, url, settleMs = 1500) {
  const deadline = Date.now() + 10_000;
  let last;
  while (Date.now() < deadline) {
    last = await sw.evaluate((u) => Object.values(globalThis.results).find((r) => r.url === u), url);
    if (last) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, settleMs)); // let the lazy chunk / observer report land
  last = await sw.evaluate((u) => Object.values(globalThis.results).find((r) => r.url === u), url);
  const badge = last ? await sw.evaluate((t) => chrome.action.getBadgeText({ tabId: t }), last.tabId) : null;
  return { ...last, badge };
}

function show(name, rep, expectBadge, extra = '') {
  const pass = rep.badge === expectBadge;
  if (!pass) failures++;
  console.log(`\n${pass ? 'PASS' : 'FAIL'}  ${name}: badge "${rep.badge}" (expected "${expectBadge}"), status ${rep.status} ${extra}`);
  for (const f of rep.files ?? []) console.log(`        ${f.status.padEnd(14)} ${f.url}${f.http ? ` (http ${f.http})` : ''}`);
}

const visit = (url) => withBrowser(async (ctx, sw) => {
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log(`        [page console] ${m.text()}`));
  await page.goto(url, { waitUntil: 'load' });
  return { rep: await reportFor(sw, url), page };
});

try {
  await fetch(`${SEALED}/__mode?tamper=off`, { method: 'POST' });
  let { rep } = await visit(`${SEALED}/`);
  show('1. clean build', rep, 'OK');

  ({ rep } = await visit(`${SEALED}/edge.html`));
  show('2. edge cases (no-cache, no-store, cross-origin)', rep, '?');

  await fetch(`${SEALED}/__mode?tamper=always`, { method: 'POST' });
  ({ rep } = await visit(`${SEALED}/`));
  show('3. main bundle tampered on every request', rep, '!');

  await fetch(`${SEALED}/__mode?tamper=once`, { method: 'POST' });
  ({ rep } = await visit(`${SEALED}/`));
  const now = Buffer.from(await (await fetch(server.mainUrl)).arrayBuffer());
  const sealedMain = rep.files?.find((f) => f.url === server.mainUrl);
  show('4. tampered ONCE, then served clean (targeted attack)', rep, '!',
    `\n        network re-download now: sha256 ${sha256(now).slice(0, 16)}… (clean); cached bytes the page ran: ${sealedMain?.sha256?.slice(0, 16)}…`);

  await fetch(`${SEALED}/__mode?tamper=off`, { method: 'POST' });
  const before = server.state.log.length;
  const r5 = await withBrowser(async (ctx, sw) => {
    const page = await ctx.newPage();
    await page.goto(`${OTHER}/`, { waitUntil: 'load' });
    const rep = await reportFor(sw, `${OTHER}/`);
    // favicon.ico is requested by the browser itself, not by the extension.
    return { rep, requests: server.state.log.slice(before).filter((u) => !u.endsWith('/favicon.ico')) };
  });
  const noExtra = r5.requests.length === 1 && r5.requests[0] === `${OTHER}/`;
  if (!noExtra) failures++;
  show('5. unsealed origin', r5.rep, '', `\n        requests seen by servers: ${JSON.stringify(r5.requests)} → ${noExtra ? 'no extra network calls' : 'EXTRA CALLS'}`);
} finally {
  server.close();
}
console.log(`\n${failures === 0 ? 'ALL SCENARIOS PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
