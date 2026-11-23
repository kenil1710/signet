// Crawls the staged deployment for `seal --crawl` / `--crawl-browser` (page mode "ssr").
// A Vercel deployment behind Deployment Protection is read with VERCEL_AUTOMATION_BYPASS_SECRET, sent as the
// x-vercel-protection-bypass header ONLY to the deployment's own origin: never to a third-party origin the page loads,
// and never across a redirect to another origin. It is never logged. (CLI 0.2.0 sent it on every request.)
import { join } from 'node:path';
import { SignetError } from './chain.ts';

export const BYPASS_HEADER = 'x-vercel-protection-bypass';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 signet-seal';
const MAX_REDIRECTS = 10;

export type Log = (line?: string) => void;
export interface CrawledPage { path: string; html: string }
export interface BrowserPage extends CrawledPage { runtime: string[] }

const originOf = (u: string) => new URL(u).origin;
const urlOf = (base: string, p: string) => new URL(p, base.endsWith('/') ? base : `${base}/`).href;

/// The headers for one request: the bypass secret only when the request goes to the deployment's own origin.
export function bypassFor(url: string, base: string, secret: string | undefined): Record<string, string> {
  return secret && originOf(url) === originOf(base) ? { [BYPASS_HEADER]: secret } : {};
}

/// GET with redirects followed by hand, so each hop decides again whether it may carry the secret.
async function get(url: string, base: string, secret: string | undefined): Promise<{ res: Response; url: string }> {
  let hop = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await fetch(hop, {
      headers: { 'user-agent': UA, accept: 'text/html', ...bypassFor(hop, base, secret) },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    const loc = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !loc) return { res, url: hop };
    await res.body?.cancel();
    hop = new URL(loc, hop).href;
  }
  throw new SignetError('crawl', `${url}: more than ${MAX_REDIRECTS} redirects`);
}

/// Fetches each path of the staged deployment as a browser would (some CDN features only act for browsers).
export async function crawl(base: string, paths: string[], log: Log, secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET): Promise<CrawledPage[]> {
  const out: CrawledPage[] = [];
  for (const p of paths) {
    const url = urlOf(base, p);
    const { res } = await get(url, base, secret);
    // a 404 page is a page users reach too (its scripts must be sealed); only a server error stops the seal
    if (res.status >= 500) throw new SignetError('crawl', `${url} answered HTTP ${res.status}`);
    out.push({ path: new URL(url).pathname, html: await res.text() });
    log(`  crawled ${new URL(url).pathname}${res.ok ? '' : ` (HTTP ${res.status})`}`);
  }
  return out;
}

/// Each path in headless Chromium: the served HTML, plus every inline script the page creates while it runs (React
/// inserts some during hydration from the flight data; Guard sees those too). Uses the project's own playwright.
/// `launch`: extra Chromium launch options (tests).
export async function crawlBrowser(project: string, base: string, paths: string[], log: Log, secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET, launch: object = {}): Promise<BrowserPage[]> {
  let pw: { chromium: { launch(o: object): Promise<any> } };
  try {
    const { createRequire } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    const req = createRequire(join(project, 'package.json'));
    // playwright, or @playwright/test (what most projects have for e2e tests): both export chromium
    const name = ['playwright', '@playwright/test'].find((m) => { try { req.resolve(m); return true; } catch { return false; } });
    if (!name) throw new Error('no playwright');
    const mod = await import(pathToFileURL(req.resolve(name)).href);
    pw = mod.chromium ? mod : mod.default; // CommonJS: the exports are under default
  } catch {
    throw new SignetError('crawl', `--crawl-browser needs playwright or @playwright/test in ${project} (npm i -D playwright && npx playwright install chromium)`);
  }
  const browser = await pw.chromium.launch({ headless: true, ...launch });
  const out: BrowserPage[] = [];
  try {
    const ctx = await browser.newContext();
    if (secret) {
      // every request is decided on its own URL: the secret goes to the deployment's origin only. Playwright keeps
      // headers set by route.continue() across redirects (also to another origin), and doesn't route the hops after
      // route.fulfill(); so a deployment request is fetched here hop by hop: same-origin redirects are followed with
      // the secret, a redirect to another origin is handed to the browser, which follows it without the secret.
      await ctx.route('**/*', async (route: any) => {
        const req = route.request();
        if (!Object.keys(bypassFor(req.url(), base, secret)).length) return route.continue();
        let url: string = req.url();
        let response: any;
        for (let i = 0; i <= MAX_REDIRECTS; i++) {
          response = await route.fetch({ url, headers: { ...req.headers(), ...bypassFor(url, base, secret) }, maxRedirects: 0 });
          const loc = response.headers()['location'];
          if (response.status() < 300 || response.status() >= 400 || !loc) break;
          const next = new URL(loc, url).href;
          if (originOf(next) !== originOf(base)) break;
          url = next;
        }
        await route.fulfill({ response });
      });
    }
    // runs in the page (a string: this package has no DOM types)
    // keeps every inline script element (also those that remove themselves) and reads their final text at the end: a
    // text seen at insertion can be partial (React inserts the element, then its text), Guard ignores those too
    await ctx.addInitScript({ content: `window.__signetEls = new Set(); new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes)
      if (n instanceof HTMLScriptElement && !n.src && !n.noModule) window.__signetEls.add(n); }).observe(document, { childList: true, subtree: true });` });
    const page = await ctx.newPage();
    for (const p of paths) {
      const url = urlOf(base, p);
      const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
      if (!res || res.status() >= 500) throw new SignetError('crawl', `${url} answered HTTP ${res?.status()}`); // 404 pages are pages too
      await page.waitForTimeout(1500);
      const html = await res.text();
      const runtime = (await page.evaluate('[...window.__signetEls].map((e) => e.text)')) as string[];
      const path = new URL(url).pathname;
      out.push({ path, html, runtime });
      log(`  crawled ${path} in Chromium (${runtime.length} inline script(s) seen while it ran)`);
    }
  } finally {
    await browser.close();
  }
  return out;
}
