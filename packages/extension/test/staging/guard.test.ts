// Guard, headless, against the staging chain (pnpm staging:up): the demo dApp is sealed with the real CLI and
// served on a made-up domain; each scenario runs in a fresh browser profile with the built extension.
// SIGNET_SAVE_DEMO=1 also writes the screenshots to docs/demo/.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFunctionResult, encodeFunctionResult, parseAbi, toHex, hexToString } from 'viem';
import type { Page } from 'playwright';
import { encodeLabel } from '../../src/lib/label.ts';
import {
  anvil, net, sealDemoDapp, switchToEnforce, serveSite, rpcProxy, buildExtension, startGateway, openBrowser, until, synced, tabIdOf, badge, events, siteState, signed,
  DEMO_DIR, DRAINER, DRAIN_DATA, ROUTER, type Project, type Site, type Proxy, type Session,
} from './harness.ts';

const domain = `guard-${Date.now().toString(36)}.signet.test`;
let project: Project;
let site: Site;
let rpcA: Proxy;
let rpcB: Proxy;
let ext: string;
let gateway: Awaited<ReturnType<typeof startGateway>>;
let origin: string;
const open: Session[] = [];

async function browser(o: { late?: boolean } = {}): Promise<Session> {
  const s = await openBrowser(ext, { origin, late: o.late });
  open.push(s);
  await synced(s, domain);
  return s;
}
async function visit(s: Session, path = '/'): Promise<{ page: Page; tab: number }> {
  const page = s.ctx.pages()[0] ?? (await s.ctx.newPage());
  await page.goto(`${origin}${path}`, { waitUntil: 'load' });
  return { page, tab: await until('the tab to be known to Guard', () => tabIdOf(s, page)) };
}
async function light(s: Session, tab: number, want: string): Promise<void> {
  await until(`badge "${want}"`, async () => (await badge(s, tab)) === want).catch(async (e: Error) => {
    const state = await s.sw.evaluate(async (t) => JSON.stringify([await chrome.action.getBadgeText({ tabId: t }), (await chrome.storage.session.get(`tab:${t}`))[`tab:${t}`]]), tab);
    throw new Error(`${e.message}; Guard has: ${state.slice(0, 1500)} / site: ${JSON.stringify(await siteState(s, domain))?.slice(0, 300)}`);
  });
}
const status = (page: Page) => page.locator('#status').textContent();
async function click(page: Page, id: string, state: 'ok' | 'error'): Promise<string> {
  await page.click(`#${id}`);
  if (id === 'swap') await page.click('#confirm-swap'); // the swap has a review step before the wallet is asked
  await page.waitForSelector(`#status[data-state="${state}"]`, { timeout: 10000 });
  const t = (await status(page))!;
  await page.evaluate(() => (document.getElementById('status')!.dataset.state = 'idle'));
  return t;
}
async function shot(page: Page, name: string): Promise<void> {
  if (!process.env.SIGNET_SAVE_DEMO) return;
  const dir = process.env.SIGNET_DEMO_DIR ?? DEMO_DIR; // e.g. docs/demo/ui for the UI screenshots
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, name) });
}
async function popupShot(s: Session, tab: number, name: string): Promise<string> {
  const p = await s.ctx.newPage();
  // the real popup: 360 wide (pages.css), as tall as its content up to Chrome's 600 px cap
  await p.setViewportSize({ width: 360, height: 600 });
  await p.goto(`chrome-extension://${s.extId}/popup.html?tab=${tab}`);
  await p.waitForSelector('h1');
  await p.evaluate(() => document.fonts.ready);
  const size = await p.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth }));
  assert.ok(size.w <= 360, `the popup is ${size.w}px wide: it must fit 360`);
  await p.setViewportSize({ width: 360, height: Math.min(600, size.h) });
  const text = (await p.locator('#root').innerText()).replace(/\s+/g, ' ');
  // Guard doesn't read how many approved a release: the popup must never claim an approval count
  assert.doesNotMatch(text, /approved by|\d+ of \d+ approved|\d+ approvers?\b(?! on this gate)/i, text);
  await shot(p, name);
  await p.close();
  return text;
}

before(async () => {
  await anvil('anvil_nodeInfo').catch(() => {
    throw new Error(`the staging chain is not running at ${net.rpcUrl}: pnpm staging:up`);
  });
  project = await sealDemoDapp(domain);
  site = await serveSite(project.dist);
  origin = `http://${domain}:${site.port}`;
  [rpcA, rpcB] = [await rpcProxy(), await rpcProxy()];
  gateway = await startGateway(rpcA.url, rpcB.url);
  ext = buildExtension(rpcA.url, rpcB.url, gateway);
});
beforeEach(() => {
  site.tamper = false;
  rpcA.down = rpcB.down = false;
  rpcA.lie = rpcB.lie = null;
});
after(async () => {
  for (const s of open) await s.close().catch(() => {});
  site?.close();
  gateway?.close();
  rpcA?.close();
  rpcB?.close();
});

test('observe mode, clean site: green badge, every signature reaches the wallet', async () => {
  const s = await browser();
  const { page, tab } = await visit(s);
  await light(s, tab, 'OK');
  assert.match(await click(page, 'approve', 'ok'), /Approve: done/);
  assert.match(await click(page, 'swap', 'ok'), /Swap: done/);
  assert.match(await click(page, 'permit', 'ok'), /Permit2: done/);
  assert.match(await click(page, 'stake', 'ok'), /Stake: done/);
  assert.deepEqual(signed(s).map((c) => c.method), ['eth_sendTransaction', 'eth_sendTransaction', 'eth_signTypedData_v4', 'eth_sendTransaction']);
  assert.deepEqual(await events(s), []);
  const st = (await siteState(s, domain))!;
  assert.deepEqual([st.status, st.enforced], ['sealed', false]);
  assert.match(await popupShot(s, tab, 'guard-popup-sealed.png'), /Sealed .* Release #1 · this page matches .* Approvers on this gate 3 .* Mode: observe/i);
  await s.close();
});

test('observe mode never blocks: a tampered bundle and an unsealed spender are reported, not refused', async () => {
  site.tamper = true;
  const s = await browser();
  const { page, tab } = await visit(s);
  await light(s, tab, '!');
  assert.ok(page.url().startsWith(origin), 'the page is not replaced in observe mode');
  await until('the drainer call to reach the wallet', () => signed(s).some((c) => c.params.includes(DRAIN_DATA)));
  const ev = await until('both reports', async () => ((await events(s)).length >= 2 ? events(s) : null));
  assert.ok(ev.every((e) => !e.refused));
  assert.ok(ev.some((e) => e.kind === 'page' && /doesn't match its sealed release/.test(e.title)));
  assert.ok(ev.some((e) => e.kind === 'sign'));
  assert.match(await popupShot(s, tab, 'guard-popup-observe-mismatch.png'), /Doesn't match the sealed release .* \(reported only\)/i);
  await s.close();
  site.tamper = false;

  const s2 = await browser();
  const v = await visit(s2, `/?spender=${DRAINER}`);
  await light(s2, v.tab, 'OK');
  assert.match(await click(v.page, 'approve', 'ok'), /Approve: done/);
  assert.equal(signed(s2).length, 1);
  assert.deepEqual((await events(s2)).map((e) => [e.kind, e.refused, e.title]), [['sign', false, 'Spender not in the sealed allowlist']]);
  await s2.close();
});

test('the gate switches to enforce mode', async () => {
  await switchToEnforce(project);
});

test('enforce mode, clean site: green, sealed signatures go through (wallet installed early or late, EIP-6963 or window.ethereum)', async () => {
  for (const late of [false, true]) {
    const s = await browser({ late });
    const { page, tab } = await visit(s);
    await light(s, tab, 'OK');
    assert.equal((await siteState(s, domain))!.enforced, true);
    for (const b of ['approve', 'swap', 'permit', 'stake']) await click(page, b, 'ok');
    assert.equal(signed(s).length, 4);
    assert.ok(signed(s).every((c) => c.provider === 'eip6963'));
    const direct = await page.evaluate(() => (window as unknown as { ethereum: { request(a: unknown): Promise<string> } }).ethereum.request({ method: 'personal_sign', params: ['0x68656c6c6f', '0x1111111111111111111111111111111111111111'] }));
    assert.match(direct, /^0xcd/);
    assert.deepEqual(await events(s), []);
    if (!late) {
      await shot(page, 'guard-clean-site.png');
      assert.match(await popupShot(s, tab, 'guard-popup-enforce-sealed.png'), /Sealed .* Mode: enforce/i);
    }
    await s.close();
  }
});

test('enforce mode, clean code but an unsealed spender: the signature is refused before the wallet sees it', async () => {
  for (const late of [false, true]) {
    const s = await browser({ late });
    const { page, tab } = await visit(s, `/?spender=${DRAINER}`);
    await light(s, tab, 'OK');
    const msg = await click(page, 'approve', 'error');
    assert.match(msg, /Approve: refused \[4001\]: Signet Guard refused this signature: Spender not in the sealed allowlist/);
    assert.match(msg, new RegExp(DRAINER));
    assert.equal(await page.locator('#signet-guard-notice').count(), 1, 'the full-page notice is shown');
    if (!late) await shot(page, 'guard-signature-refused.png');
    await page.evaluate(() => document.getElementById('signet-guard-notice')!.remove());
    assert.match(await click(page, 'permit', 'error'), /Permit2: refused \[4001\].*Spender not in the sealed allowlist/);
    await page.evaluate(() => document.getElementById('signet-guard-notice')!.remove());
    // the same through window.ethereum, the legacy sendAsync, and a transfer to someone else
    const tries = await page.evaluate(async ({ drainer, router }) => {
      const eth = (window as unknown as { ethereum: { request(a: unknown): Promise<unknown>; sendAsync(p: unknown, cb: (e: { message: string } | null, r: unknown) => void): void } }).ethereum;
      const word = (a: string) => a.toLowerCase().slice(2).padStart(64, '0');
      const tx = (to: string, data: string) => ({ method: 'eth_sendTransaction', params: [{ from: '0x1111111111111111111111111111111111111111', to, data }] });
      const token = '0x1E4a5963aBFD975d8c9021ce480b42188849D41d';
      const out: string[] = [];
      const attempt = async (name: string, f: () => Promise<unknown>) => out.push(`${name}: ${await f().then(() => 'SENT', (e: { message: string }) => e.message)}`);
      await attempt('approve', () => eth.request(tx(token, `0x095ea7b3${word(drainer)}${'f'.repeat(64)}`)));
      await attempt('sendAsync', () => new Promise((res, rej) => eth.sendAsync({ id: 1, ...tx(token, `0x095ea7b3${word(drainer)}${'f'.repeat(64)}`) }, (e, r) => (e ? rej(e) : res(r)))));
      await attempt('transfer', () => eth.request(tx(token, `0xa9059cbb${word(drainer)}${word('0x05')}`)));
      await attempt('unknown contract', () => eth.request(tx(drainer, '0xa694fc3a' + word('0x05'))));
      await attempt('sealed spender', () => eth.request(tx(token, `0x095ea7b3${word(router)}${word('0x05')}`)));
      return out;
    }, { drainer: DRAINER, router: ROUTER });
    assert.match(tries[0]!, /approve: Signet Guard refused.*Spender not in the sealed allowlist/);
    assert.match(tries[1]!, /sendAsync: Signet Guard refused/);
    assert.match(tries[2]!, /transfer: Signet Guard refused.*Recipient is not you/);
    assert.match(tries[3]!, /unknown contract: Signet Guard refused.*Contract not in the sealed allowlist/);
    assert.equal(tries[4], 'sealed spender: SENT');
    assert.deepEqual(signed(s).map((c) => c.params.includes(ROUTER.toLowerCase().slice(2))), [true], 'only the sealed approve reached the wallet');
    const refusedEv = (await events(s)).filter((e) => e.refused);
    assert.ok(refusedEv.length >= 5);
    // every refusal was decided by the Guard decision circuit on-chain (an eval call), not by extension code
    assert.ok(refusedEv.every((e) => e.details.some((d) => /^decided by the Guard circuit, row 0x[0-9a-f]{3}/.test(d))), JSON.stringify(refusedEv.map((e) => e.details.at(-1))));
    if (!late) {
      // the same kind of request again: the answer comes from the cache, with no new eval call
      const evals = () => [...rpcA.log, ...rpcB.log].filter((c) => c.method === 'eth_call' && c.body.includes('934d06ea')).length;
      const before = evals();
      await page.evaluate(() => document.getElementById('signet-guard-notice')?.remove());
      await click(page, 'approve', 'error');
      assert.equal(evals(), before);
      assert.match((await events(s))[0]!.details.at(-1)!, /, cached$/);
    }
    await s.close();
  }
});

test('enforce mode, tampered bundle: red badge, full red page, the drainer never reaches the wallet; verified copy opens', async () => {
  site.tamper = true;
  const s = await browser();
  const page = s.ctx.pages()[0]!;
  const consoleLines: string[] = [];
  page.on('console', (m) => consoleLines.push(m.text()));
  await page.goto(`${origin}/`, { waitUntil: 'load' }).catch(() => {}); // the navigation may be cut short by the redirect
  await page.waitForURL(/^chrome-extension:.*blocked\.html/, { timeout: 15000 });
  const tab = await tabIdOf(s, page);
  await page.waitForSelector('h1');
  await light(s, tab, '!');
  const text = await page.locator('#root').innerText();
  assert.match(text, /Stop\. This site's seal is broken\./i); // h1 is uppercase in CSS
  assert.match(text, /Nothing was sent\./);
  assert.match(text, /changed · http:\/\/guard-.*\/assets\/index-.*\.js/);
  await shot(page, 'guard-blocked.png');
  if (process.env.SIGNET_SAVE_DEMO) {
    const vp = page.viewportSize();
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h });
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(sw <= w, `the red page scrolls sideways at ${w}`);
      await shot(page, `guard-blocked-${w}.png`);
    }
    if (vp) await page.setViewportSize(vp);
  }
  assert.deepEqual(signed(s), [], 'nothing reached the wallet');

  // "Open verified copy": the gateway's page for this domain, a normal origin where the wallet works
  const [copy] = await Promise.all([s.ctx.waitForEvent('page'), page.click('#copy')]);
  const copyLog: string[] = [];
  copy.on('console', (m) => copyLog.push(m.text()));
  copy.on('pageerror', (e) => copyLog.push(String(e)));
  await copy.waitForSelector('#app[data-lazy="loaded"]', { timeout: 30000 }).catch(async (e: Error) => {
    throw new Error(`${e.message}\n${copy.url()}\n${(await copy.locator('body').innerText()).slice(0, 500)}\n${copyLog.join('\n')}`);
  });
  assert.equal(new URL(copy.url()).origin, `http://${encodeLabel(domain)}.localhost:${gateway.port}`);
  const copyTab = await until('Guard to know the copy tab', () => tabIdOf(s, copy));
  await light(s, copyTab, 'OK'); // Guard checked the copy against the same sealed release, and the gateway's own files against its pins
  assert.match(await click(copy, 'approve', 'ok'), /Approve: done/); // the user keeps using the app while the real site is hijacked
  assert.equal(signed(s).length, 1);
  assert.match(await popupShot(s, copyTab, 'guard-popup-verified-copy.png'), new RegExp(`Sealed ${domain} Release #1`, 'i'));
  await shot(copy, 'guard-verified-copy.png');
  // the sealed allowlist is enforced on the copy too
  await copy.goto(`${copy.url()}?spender=${DRAINER}`);
  await copy.waitForSelector('#app[data-lazy="loaded"]');
  assert.match(await click(copy, 'approve', 'error'), /Spender not in the sealed allowlist/);
  assert.equal(signed(s).length, 1);
  await copy.close();

  // "Report wrong block": a local report, nothing sent
  const before = rpcA.log.length + rpcB.log.length + site.log.length;
  await page.click('#wrong');
  await page.waitForFunction(() => (document.getElementById('msg')?.textContent ?? '').length > 0);
  const reports = await s.sw.evaluate(async () => (await chrome.storage.local.get('reports')).reports as { kind: string; domain: string; release: number; events: unknown[] }[]);
  assert.deepEqual([reports[0]!.kind, reports[0]!.domain, reports[0]!.release], ['signet-guard-wrong-block', domain, 1]);
  assert.equal(rpcA.log.length + rpcB.log.length + site.log.length, before);

  // "Go back to the site": the page loads, but every signature is refused
  await page.click('#back');
  await page.waitForURL(`${origin}/`);
  await until('the drainer to be refused', () => consoleLines.some((l) => /DRAINER refused: Signet Guard refused this signature: This page doesn't match its sealed release/.test(l)));
  assert.ok(!consoleLines.some((l) => l.startsWith('DRAINER got')));
  await page.evaluate(() => document.getElementById('signet-guard-notice')?.remove());
  assert.match(await click(page, 'approve', 'error'), /refused \[4001\].*doesn't match its sealed release/);
  assert.equal(signed(s).length, 1, 'the only signature the wallet ever saw is the sealed approve made on the verified copy');
  assert.equal(await badge(s, await tabIdOf(s, page)), '!');
  await s.close();
  site.tamper = false;
});

test('a gateway whose worker is not the pinned one is red; without a gateway the copy is the preview inside the extension', async () => {
  const swFile = join(gateway.dist, 'sw.js');
  const original = readFileSync(swFile);
  writeFileSync(swFile, Buffer.concat([original, Buffer.from('\n// changed on the gateway server\n')]));
  try {
    const s = await browser();
    // the copy can't confirm its own gate (its files come from the chain): the real domain does, as when a user
    // reaches the copy from the real site
    const { page } = await visit(s);
    await page.goto(`http://${encodeLabel(domain)}.localhost:${gateway.port}/`).catch(() => {});
    await until('the tab to be taken to the warning page', () => page.url().startsWith('chrome-extension:') && page.url().includes('blocked.html'), 30000).catch(async (e) => {
      const tab = await tabIdOf(s, page).catch(() => -1);
      const dump = await s.sw.evaluate(async (t) => JSON.stringify((await chrome.storage.session.get(`tab:${t}`))[`tab:${t}`]), tab);
      throw new Error(`${e.message}; url ${page.url()}; report ${dump?.slice(0, 2500)}`);
    }); // enforce mode
    await page.waitForSelector('h1');
    assert.match(await page.locator('#root').innerText(), /changed · http:\/\/.*\.localhost:\d+\/sw\.js/);
    await light(s, await tabIdOf(s, page), '!');
    // the preview page still exists for builds without a gateway
    const preview = await s.ctx.newPage();
    await preview.goto(`chrome-extension://${s.extId}/copy.html#domain=${domain}`);
    await preview.waitForFunction(() => /files are stored on-chain and match/.test(document.getElementById('sum')?.textContent ?? ''), null, { timeout: 20000 });
    const frame = await until('the preview frame', () => preview.frames().find((f) => f.url().includes('sandbox.html')));
    await frame.waitForSelector('#app[data-lazy="loaded"]', { timeout: 10000 });
    await s.close();
  } finally {
    writeFileSync(swFile, original);
  }
});

test('a Guard circuit whose stored netlist is not the reviewed one is not trusted: Guard fails safe (at least a warning), still refuses, and the popup says so', async () => {
  rpcA.lie = rpcB.lie = (method, params, result) => {
    const data = (params[0] as { data?: string })?.data ?? '';
    if (method !== 'eth_call' || !data.startsWith('0x3fc4be56')) return result; // netlist(uint256)
    return (result as string).replace(/(.{140})../, '$1ff'); // one byte of the stored netlist changed
  };
  const s = await browser();
  const { page, tab } = await visit(s, `/?spender=${DRAINER}`);
  await light(s, tab, 'OK');
  assert.match(await click(page, 'approve', 'error'), /Spender not in the sealed allowlist/);
  assert.match((await events(s))[0]!.details.at(-1)!, /decided fail-safe, at least a warning \(the circuit on-chain is not the reviewed netlist\)/);
  assert.equal(signed(s).length, 0);
  assert.match(await popupShot(s, tab, 'guard-popup-circuit-not-trusted.png'), /fail-safe \(warn or block\): circuit answer not trusted/);
  await s.close();
});

test('the two RPCs disagree on the circuit answer (circuit unreachable): the local mirror decides, still refuses, and the popup says so', async () => {
  rpcA.lie = (method, params, result) => {
    const data = (params[0] as { data?: string })?.data ?? '';
    if (method !== 'eth_call' || !data.startsWith('0x934d06ea')) return result; // eval(uint256,bytes): only on RPC A
    return (result as string).replace(/(.{130})..(.*)$/, '$102$2');
  };
  const s = await browser();
  const { page, tab } = await visit(s, `/?spender=${DRAINER}`);
  await light(s, tab, 'OK');
  assert.match(await click(page, 'approve', 'error'), /Spender not in the sealed allowlist/);
  assert.match((await events(s))[0]!.details.at(-1)!, /decided by the local mirror \(the Guard circuit is unreachable: /);
  assert.equal(signed(s).length, 0);
  assert.match(await popupShot(s, tab, 'guard-popup-circuit-unreachable.png'), /local mirror: circuit unreachable/);
  await s.close();
});

// ---- domain proof (docs/domain-ownership.md): a gate the domain doesn't confirm is ignored
async function notVerified(s: Session, tab: number, page: Page): Promise<void> {
  await light(s, tab, '?'); // grey: never "OK", never "!"
  const text = await popupShot(s, tab, 'guard-popup-not-verified.png');
  assert.match(text, /Not verified: this site hasn't confirmed this gate/i, text);
  assert.ok(!page.url().includes('blocked.html'), 'never sent to the red page');
  // no verified copy for an unconfirmed gate
  const copy = await s.ctx.newPage();
  await copy.goto(`chrome-extension://${s.extId}/copy.html#domain=${domain}`);
  await copy.waitForSelector('h1');
  assert.match(await copy.locator('h1').innerText(), /No verified copy/i);
  await copy.close();
}

test("squatting: a gate bound to a domain that doesn't serve the proof is ignored (never Sealed, never red, no copy, nothing blocked even in enforce mode)", async () => {
  site.proof = 'drop'; // the real owner's site never confirmed this gate
  site.tamper = true; // and its code is not what the squatter sealed
  try {
    const s = await browser();
    const { page, tab } = await visit(s);
    await notVerified(s, tab, page);
    // the squatter's gate is in enforce mode, yet nothing is refused: fail-open, as for any unchecked site
    assert.match(await click(page, 'approve', 'ok'), /Approve: done/);
    assert.ok(signed(s).length >= 1, 'the signature reached the wallet');
    await s.close();
  } finally {
    site.proof = undefined;
    site.tamper = false;
  }
});

test("squatting: a proof naming another gate doesn't confirm this one", async () => {
  site.proof = JSON.stringify({ signet: 1, chainId: 196, gate: '0x000000000000000000000000000000000000dEaD' });
  site.tamper = true;
  try {
    const s = await browser();
    const { page, tab } = await visit(s);
    await notVerified(s, tab, page);
    await s.close();
  } finally {
    site.proof = undefined;
    site.tamper = false;
  }
});

test('a domain Guard has confirmed stays protected when a later hijack removes the proof', async () => {
  const s = await browser();
  const { page, tab } = await visit(s); // the real site: the proof is served, Guard pins the gate
  await light(s, tab, 'OK');
  site.proof = 'drop';
  site.tamper = true;
  try {
    // the demo server lets the browser cache scripts for an hour: drop the cache so the reload gets the hijacked bundle
    await (await s.ctx.newCDPSession(page)).send('Network.clearBrowserCache');
    await page.goto(`${origin}/`, { waitUntil: 'load' }).catch(() => {});
    await until('the tab to go to the red page', () => page.url().includes('blocked.html'), 30000);
    await s.close();
  } finally {
    site.proof = undefined;
    site.tamper = false;
  }
});

test('honest limit: a first-time visitor during a hijack that also removes the proof is not protected (fail-open)', async () => {
  site.proof = 'drop';
  site.tamper = true;
  try {
    const s = await browser();
    const { page, tab } = await visit(s);
    await light(s, tab, '?');
    assert.ok(!page.url().includes('blocked.html'));
    await s.close();
  } finally {
    site.proof = undefined;
    site.tamper = false;
  }
});

test('privacy: on a domain that is not sealed Guard makes no network call and stays out of the way', async () => {
  const s = await browser();
  await new Promise((r) => setTimeout(r, 500));
  const [a, b, w] = [rpcA.log.length, rpcB.log.length, site.log.length];
  const page = s.ctx.pages()[0]!;
  await page.goto(`http://unsealed.example.test:${site.port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.title.startsWith('sent'));
  await new Promise((r) => setTimeout(r, 1500));
  assert.deepEqual([rpcA.log.length - a, rpcB.log.length - b], [0, 0], 'no RPC request was caused by the visit');
  assert.deepEqual(site.log.slice(w).filter((u) => !u.endsWith('/favicon.ico')), ['unsealed.example.test/', 'unsealed.example.test/app.js'], 'the site saw only its own two requests');
  assert.equal(signed(s).length, 1, 'the wallet call went straight through');
  assert.equal(await badge(s, await tabIdOf(s, page)), '');
  const kept = await s.sw.evaluate(async () => JSON.stringify([await chrome.storage.local.get(null), await chrome.storage.session.get(null)]));
  assert.ok(!kept.includes('unsealed.example.test'), 'nothing about the visit is stored');
  await s.close();
});

test('fail-open: RPCs that disagree, or are down, give a grey badge and nothing is blocked', async () => {
  // one RPC lies about the gate (says the release is a different one)
  rpcB.lie = (method, _p, result) => (method === 'eth_call' && typeof result === 'string' && result.length === 258 ? `${result.slice(0, 60)}ff${result.slice(62)}` : result);
  const s = await browser();
  const { page, tab } = await visit(s, `/?spender=${DRAINER}`);
  await light(s, tab, '?');
  const st = (await siteState(s, domain));
  assert.equal(st, undefined, 'an unverified answer is not cached as a release');
  assert.match(await click(page, 'approve', 'ok'), /Approve: done/);
  assert.match(await popupShot(s, tab, 'guard-popup-could-not-check.png'), /Could not check .* the two RPCs disagree .* does not block/i);
  await s.close();
  rpcB.lie = null;

  rpcA.down = rpcB.down = true;
  const s2 = await openBrowser(ext, { origin });
  open.push(s2);
  // the list of sealed domains can't be downloaded either: the domain is not even known, so nothing happens
  const page2 = s2.ctx.pages()[0]!;
  await page2.goto(`${origin}/?spender=${DRAINER}`, { waitUntil: 'load' });
  assert.match(await click(page2, 'approve', 'ok'), /Approve: done/);
  await s2.close();
  rpcA.down = rpcB.down = false;
});

test('a release checked earlier is used for up to 24 h when the RPCs are down, and still enforced', async () => {
  const s = await browser();
  const { tab } = await visit(s);
  await light(s, tab, 'OK');
  await s.sw.evaluate(async (d) => {
    const k = `site:${d}`;
    const v = (await chrome.storage.local.get(k))[k];
    await chrome.storage.local.set({ [k]: { ...(v as object), checkedAt: Date.now() - 3 * 3600_000 } }); // checked 3 hours ago
  }, domain);
  rpcA.down = rpcB.down = true;
  const v2 = await visit(s, `/?spender=${DRAINER}`);
  await light(s, v2.tab, 'OK');
  assert.match(await click(v2.page, 'approve', 'error'), /Spender not in the sealed allowlist/);
  await s.sw.evaluate(async (d) => {
    const k = `site:${d}`;
    const v = (await chrome.storage.local.get(k))[k];
    await chrome.storage.local.set({ [k]: { ...(v as object), checkedAt: Date.now() - 25 * 3600_000 } }); // older than 24 hours
  }, domain);
  const v3 = await visit(s, `/?spender=${DRAINER}`);
  await light(s, v3.tab, '?');
  assert.match(await click(v3.page, 'approve', 'ok'), /Approve: done/);
  rpcA.down = rpcB.down = false;
  await s.close();
});

test('manifest files that do not hash to the on-chain release are rejected (H-1, off-chain half)', async () => {
  // both RPCs serve a forged allowlist.json that adds the drainer as a spender
  const read = parseAbi(['function read(address,string) view returns (bytes)']);
  const forge: Proxy['lie'] = (method, params, result) => {
    const data = (params[0] as { data?: string })?.data ?? '';
    if (method !== 'eth_call' || !data.startsWith('0xccaa7afb') || !data.includes(toHex('signet/allowlist.json').slice(2))) return result;
    const json = hexToString(decodeFunctionResult({ abi: read, functionName: 'read', data: result as `0x${string}` }));
    return encodeFunctionResult({ abi: read, functionName: 'read', result: toHex(json.replace('"spenders":[', `"spenders":["${DRAINER}",`)) });
  };
  rpcA.lie = rpcB.lie = forge;
  const s = await browser();
  const { tab } = await visit(s);
  await light(s, tab, '?');
  const info = await s.sw.evaluate((t) => chrome.runtime.getURL(`popup.html?tab=${t}`), tab);
  const p = await s.ctx.newPage();
  await p.goto(info);
  await p.waitForSelector('h1');
  assert.match((await p.locator('#root').innerText()).replace(/\s+/g, ' '), /Could not check .* do not hash to the release published on-chain\. They were rejected\./i);
  rpcA.lie = rpcB.lie = null;
  await s.close();
});
