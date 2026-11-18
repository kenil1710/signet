// Loads a sealed site in headless Chromium, like a visitor would, and compares what the server sent with the
// sealed release: the HTML, every script and stylesheet by SHA-256, cross-origin scripts by their sealed SRI
// hash, and every origin the page talked to against the sealed origins.
import { createHash } from 'node:crypto';
import type { Browser } from 'playwright';
import { pathOfUrl, sealedPathFor } from '@signet/extension/src/lib/sealed.ts';
import type { Sealed } from './chain.ts';

export interface Finding { kind: 'changed' | 'not-sealed' | 'sri' | 'origin'; url: string; note: string }
export interface SiteCheck { status: 'ok' | 'mismatch' | 'unreachable'; url: string; findings: Finding[]; checked: number; error?: string }

/// `valid`: the releases a visitor may be served right now (the current one, and the previous one in its grace window).
export async function checkSite(browser: Browser, url: string, valid: Sealed[], timeoutMs = 20000): Promise<SiteCheck> {
  const ctx = await browser.newContext(); // a fresh context each time: empty cache, no cookies
  const page = await ctx.newPage();
  const origin = new URL(url).origin;
  const hashes = new Map<string, Set<string>>();
  for (const s of valid) for (const f of s.files) (hashes.get(f.path) ?? hashes.set(f.path, new Set()).get(f.path)!).add(f.sha256.slice(2));
  const origins = new Set(valid.flatMap((s) => s.origins));
  const scripts = valid.flatMap((s) => s.scripts);
  const findings = new Map<string, Finding>();
  const add = (f: Finding) => findings.set(`${f.kind}:${f.url}`, f);
  const bodies: Promise<void>[] = [];
  let checked = 0;

  page.on('request', (req) => {
    let u: URL;
    try {
      u = new URL(req.url());
    } catch {
      return;
    }
    if (!/^(https?|wss?):$/.test(u.protocol) || u.origin === origin) return;
    const o = `${u.protocol}//${u.host}`;
    if (!origins.has(o)) add({ kind: 'origin', url: o, note: `the page contacted ${o} (${req.resourceType()}), which is not a sealed origin` });
  });
  page.on('response', (res) => {
    const req = res.request();
    const type = req.resourceType();
    const u = new URL(res.url());
    if (u.origin !== origin || !['document', 'script', 'stylesheet'].includes(type) || res.status() >= 300) return;
    if (type === 'document' && req.frame() !== page.mainFrame()) return;
    const path = pathOfUrl(u.pathname);
    // the exact path, a clean URL (/app → app.html) or a single-page-app route (→ index.html), as Guard decides
    const sp = sealedPathFor(path, type === 'document', (p) => hashes.has(p));
    const want = sp === null ? undefined : hashes.get(sp);
    if (!want) {
      if (type !== 'stylesheet') add({ kind: 'not-sealed', url: res.url(), note: `${type} is not part of the sealed release` });
      return;
    }
    bodies.push(res.body().then((b) => {
      checked++;
      const h = createHash('sha256').update(b).digest('hex');
      if (!want.has(h)) add({ kind: 'changed', url: res.url(), note: `sha256 ${h.slice(0, 16)}… is not the sealed ${[...want][0]!.slice(0, 16)}…` });
    }, () => {}));
  });

  try {
    await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await Promise.all(bodies);
    // cross-origin scripts: the browser enforces SRI, so the attribute must be the sealed one
    const external = await page.evaluate(() => [...document.scripts].filter((s) => s.src && new URL(s.src).origin !== location.origin).map((s) => ({ src: s.src, integrity: s.integrity })));
    for (const s of external) {
      const sealed = scripts.filter((x) => x.url === s.src);
      if (sealed.length === 0) add({ kind: 'not-sealed', url: s.src, note: 'a cross-origin script that is not in the sealed release' });
      else if (!s.integrity || !sealed.some((x) => x.integrity === s.integrity)) add({ kind: 'sri', url: s.src, note: `integrity is "${s.integrity}", sealed is "${sealed[0]!.integrity}"` });
    }
    if (checked === 0 && findings.size === 0) return { status: 'unreachable', url, findings: [], checked, error: 'the page loaded but served nothing that could be compared' };
    return { status: findings.size ? 'mismatch' : 'ok', url, findings: [...findings.values()], checked };
  } catch (e) {
    return { status: 'unreachable', url, findings: [], checked, error: (e as Error).message.split('\n')[0] };
  } finally {
    await ctx.close();
  }
}
