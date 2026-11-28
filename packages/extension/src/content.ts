// Guard content script (isolated world, document_start, top frame; 0.3.7: also same-origin iframes, signing only).
//  1. Asks the service worker whether this host is a sealed domain. If not: stops. No fetch, nothing else.
//  2. Page check: every script, stylesheet and the HTML document are read from the browser's HTTP cache
//     (fetch with cache: 'only-if-cached' never touches the network), hashed, and compared with the sealed
//     release. Cross-origin scripts can't be read that way: their SRI attribute is compared with the sealed one.
//  3. Passes signing requests from the in-page wrapper to the service worker and shows why one was refused.
// Server-rendered releases (page mode "ssr"): the HTML is not sealed; every script file must be, and every inline
// script must be a sealed hash or a data template (@signet/cli/src/inline.ts). Scripts are recorded from
// document_start by a MutationObserver (also those that remove themselves), and before every signature Guard takes
// the pending records synchronously and runs a fresh full check, so a script that runs and signs at once is seen.
import { notFoundPath, pathOfUrl, sealedPathFor } from './lib/sealed.ts';
import { decideRecheck } from './lib/recheck.ts';
import { copyOffer } from './lib/copy.ts';
import { requestKey, signRequestIn, type WireRequest } from './lib/wire.ts';
import { HOLD_MS, POLL_MS } from './lib/hold.ts';
import { classifyInline, inlineHash, runs } from '@signet/cli/src/inline.ts';
import type { Decision, FileResult, PageInfo, PageReport } from './lib/types.ts';

(() => {
  if (!/^https?:$/.test(location.protocol)) return;
  // 0.3.7: in an iframe whose every ancestor has this page's origin, Guard guards signing only. The wallet shows such a
  // frame's requests under the sealed site's name, so they are decided like the top frame's (the tab's sealed site,
  // its allowlist and the top frame's page check). The page check, its report and the tab state belong to the top
  // frame alone. Any other iframe: nothing at all (it must not touch the tab's state).
  const TOP = window.top === window;
  if (!TOP && ![...location.ancestorOrigins].every((o) => o === location.origin)) return;

  // ---- every <script> the page ever has, from document_start (local only: nothing leaves this tab)
  // Each inline script element keeps every text it was seen with (strong refs: also scripts that removed themselves).
  // A text later extended by the same element was the parser still streaming it in; every other text must be allowed,
  // so a script can't run and then rewrite itself into something allowed.
  const seenInline = new Map<HTMLScriptElement, { runs: boolean; texts: string[] }>();
  const seenSrc = new Set<string>();
  const MAX_SEEN = 5000;
  let overflow = false;
  const record = (n: Node) => {
    if (!(n instanceof HTMLScriptElement)) {
      if (n instanceof Element && n.querySelectorAll) for (const sc of n.querySelectorAll('script')) record(sc);
      return;
    }
    // <script nomodule>: never fetched or run by a browser with ES modules (every Chrome Guard runs in, 120+)
    if (n.noModule) return;
    if (n.src) {
      if (seenSrc.size < MAX_SEEN) seenSrc.add(n.src);
      else overflow = true;
      return;
    }
    let e = seenInline.get(n);
    if (!e) {
      if (seenInline.size >= MAX_SEEN) return void (overflow = true);
      seenInline.set(n, (e = { runs: false, texts: [] }));
    }
    const text = n.text;
    if (e.texts.at(-1) !== text) e.texts.push(text);
    if (e.texts.length > 32) e.texts.splice(1, e.texts.length - 32); // keep the first and the latest
    e.runs ||= runs(n.type); // code if it ever had a type that runs: changing the type afterwards hides nothing
  };
  /// The texts of one element that count: all but those a later text of the same element extends.
  const finalTexts = (texts: string[]) => texts.filter((t, i) => !texts.slice(i + 1).some((later) => later.length > t.length && later.startsWith(t)));
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      for (const n of m.addedNodes) record(n);
      if (m.type === 'characterData' || m.type === 'childList') if (m.target instanceof HTMLScriptElement) record(m.target);
    }
  });
  if (TOP) mo.observe(document, { childList: true, subtree: true, characterData: true });
  /// Synchronously: the records not delivered yet, and every script in the DOM now.
  const scanNow = () => {
    for (const m of mo.takeRecords()) for (const n of m.addedNodes) record(n);
    for (const sc of document.scripts) record(sc);
  };

  // ---- link to the in-page wrapper (see inpage.ts)
  const secret = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
  let linked = false;
  const down = (m: unknown) => document.dispatchEvent(new CustomEvent(`sg:${secret}:down`, { detail: JSON.stringify(m) }));
  const offer = () => document.dispatchEvent(new CustomEvent('signet-guard:init', { detail: secret }));
  document.addEventListener(`sg:${secret}:up`, (e) => {
    const m = JSON.parse((e as CustomEvent).detail as string) as { type: string; id: number; req: unknown; chainId?: string | null; accounts?: string[] };
    if (m.type === 'ack') linked = true;
    else if (m.type === 'sign') void onSign(m.id, m.req);
    else if (m.type === 'wallet-info') walletAsks.get(m.id)?.({ chainId: m.chainId ?? null, accounts: Array.isArray(m.accounts) ? m.accounts : [] });
  });
  document.addEventListener('signet-guard:hello', () => {
    if (!linked) offer();
  });
  offer();

  const ask = async <T>(msg: unknown): Promise<T | null> => {
    try {
      return (await chrome.runtime.sendMessage(msg)) as T | null;
    } catch {
      return null; // the extension was reloaded or removed
    }
  };

  // ---- Guard 0.3.6: the wallet's own channel (lib/wire.ts). A wallet's page script hands each request to its
  // content script with window.postMessage. This capture listener runs before the wallet's listener (measured with
  // OKX 4.26.0 in both load orders), holds a signing request until Guard decides, and posts the frame again if it is
  // allowed. It covers wallets whose provider object can't be wrapped (OKX). On a domain that isn't sealed it does
  // nothing once that is known; until then (the first few milliseconds) a signing frame waits for that answer.
  const decided = new Map<string, number>(); // requests the page-world wrapper got "allowed" for: key -> time
  const passOnce = new Map<string, number>(); // frames Guard posts again after an allow
  let passUnkeyed = 0; // the same, for a frame that isn't JSON (only ever allowed in observe mode)
  const walletAsks = new Map<number, (v: { chainId: string | null; accounts: string[] }) => void>();
  let nextWalletAsk = 1;
  const targetOrigin = location.origin === 'null' ? '*' : location.origin;
  const frameKey = (data: unknown): string | null => {
    try {
      return JSON.stringify(data);
    } catch {
      return null;
    }
  };
  /// The chain and accounts of the wallet behind a frame, read by the page-world script (a non-signing call)
  const walletInfo = (wallet: string | null) => new Promise<{ chainId: string | null; accounts: string[] }>((res) => {
    const id = nextWalletAsk++;
    walletAsks.set(id, (v) => { walletAsks.delete(id); res(v); });
    setTimeout(() => { if (walletAsks.delete(id)) res({ chainId: null, accounts: [] }); }, 3000);
    down({ type: 'wallet-info', id, wallet });
  });
  const repost = (data: unknown, key: string | null) => {
    if (key) passOnce.set(key, (passOnce.get(key) ?? 0) + 1);
    else passUnkeyed++;
    window.postMessage(data, targetOrigin);
  };
  window.addEventListener('message', (e) => {
    if (e.source !== window) return; // wallets only take frames a page posts to itself
    if (infoKnown && !info) return; // not a sealed domain: Guard stays out of the way
    const req = signRequestIn(e.data);
    if (!req) return;
    const key = frameKey(e.data);
    if (key ? (passOnce.get(key) ?? 0) > 0 : passUnkeyed > 0) {
      if (key) passOnce.set(key, passOnce.get(key)! - 1);
      else passUnkeyed--;
      return; // Guard's own repost of an allowed frame
    }
    const rk = requestKey(req.method, req.params);
    const at = rk ? decided.get(rk) : undefined;
    if (rk && at !== undefined && Date.now() - at < 60_000) {
      decided.delete(rk);
      return; // the page-world wrapper already got this exact request allowed
    }
    e.stopImmediatePropagation();
    void onWire(e.data, key, req);
  }, true);

  async function onWire(data: unknown, key: string | null, req: WireRequest): Promise<void> {
    await infoReady;
    if (!info) return repost(data, key);
    const w = await walletInfo(req.wallet);
    const readable = requestKey(req.method, req.params) !== null;
    const r = await decideSign({ method: req.method, params: readable ? req.params : [], chainId: w.chainId, accounts: w.accounts });
    if (!r.refused) return repost(data, key);
    // refused: the wallet never sees it; the page gets a 4001 when the wallet's reply format is known
    if (req.reply) window.postMessage(req.reply(4001, `Signet Guard refused this signature: ${r.message}`), targetOrigin);
    r.show();
  }

  let info: PageInfo | null = null;
  let infoKnown = false; // the first answer to "is this a sealed domain?" arrived
  let infoReadyDone: () => void = () => {};
  const infoReady = new Promise<void>((r) => (infoReadyDone = r));
  let last: PageReport | null = null;
  let redirecting = false;
  let rechecked = false;
  let held = false; // 0.3.3: the page waited once for a release being published
  let firstDone: () => void = () => {};
  const first = new Promise<void>((r) => (firstDone = r));

  // ---- page check
  const results = new Map<string, FileResult>();
  const BAD = ['mismatch', 'unknown', 'unknown-origin', 'sri-mismatch', 'injected'];
  const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

  async function checkSameOrigin(u: URL, scripty: boolean, isDocument: boolean): Promise<FileResult | null> {
    const path = pathOfUrl(u.pathname);
    const gw = info!.gateway;
    let valid: string[] | undefined;
    if (gw && (path === 'sw.js' || path === '.signet/boot.js')) valid = gw[path] ? [gw[path]!] : undefined; // the gateway's own files, pinned
    else if (gw && isDocument && path.startsWith('.signet/')) return { url: u.href, status: 'not-cached', note: "a page made by the gateway's worker" };
    // the exact path; a clean URL (/app → app.html); or a single-page-app route (→ index.html): sealedPathFor
    else {
      const want = sealedPathFor(path, isDocument, (p) => !!info!.hashes[p]);
      valid = want === null ? undefined : info!.hashes[want];
    }
    // on the gateway the document is the pinned boot page until its worker takes over, then the sealed file
    if (gw && isDocument && gw['index.html']) valid = [...(valid ?? []), gw['index.html']];
    // an unknown path answered with HTTP 404: the sealed 404.html (lib/sealed.ts notFoundPath)
    const nf = notFoundPath(path, isDocument, (p) => !!info!.hashes[p]);
    const valid404 = nf ? info!.hashes[nf] : undefined;
    if (!valid && !valid404) return scripty || isDocument ? { url: u.href, status: 'unknown', note: 'not in the sealed release' } : null;
    if (!globalThis.crypto?.subtle) return { url: u.href, status: 'no-crypto', note: 'not a secure context' };
    // On the gateway, site files come from its service worker and never enter the HTTP cache, and a content
    // script's fetch doesn't pass through a page's worker. What Guard can read and pin are the gateway's own
    // files; when the worker in control is /sw.js (pinned, checked like any script) it has verified the rest.
    const byWorker = (): FileResult | null =>
      gw && !(path === 'sw.js' || path === '.signet/boot.js') && navigator.serviceWorker?.controller?.scriptURL === `${location.origin}/sw.js`
        ? { url: u.href, status: 'ok-gateway', note: "served and verified by the gateway's pinned worker" } : null;
    // Hosts send their 404 page with Cache-Control: no-store (Cloudflare Pages does), so the browser keeps no copy to
    // read. For that page only, check a fresh download: it must be HTTP 404 with the sealed 404.html. (The scripts and
    // styles it loads are still read from the cache like any file.)
    const fresh404 = async (): Promise<FileResult | null> => {
      if (!valid404) return null;
      try {
        const f = await fetch(u.href, { cache: 'no-store', credentials: 'same-origin' });
        if (f.status !== 404) return null;
        const h = hex(await crypto.subtle.digest('SHA-256', await f.arrayBuffer()));
        return valid404.includes(h)
          ? { url: u.href, sha256: h, status: 'ok', note: "the site's 404 page (not cached by the browser): a fresh copy matches the sealed 404.html" }
          : { url: u.href, sha256: h, status: 'mismatch', note: "the site's 404 page doesn't match the sealed 404.html" };
      } catch {
        return null;
      }
    };
    try {
      const res = await fetch(u.href, { cache: 'only-if-cached', mode: 'same-origin', credentials: 'same-origin' });
      const want = res.status === 404 && valid404 ? valid404 : valid;
      if (!res.ok && want !== valid404) return byWorker() ?? (await fresh404()) ?? { url: u.href, status: 'not-cached', note: `cache answered ${res.status}` };
      if (!want) return { url: u.href, status: 'unknown', note: 'not in the sealed release' };
      const h = hex(await crypto.subtle.digest('SHA-256', await res.arrayBuffer()));
      if (want.includes(h)) return { url: u.href, sha256: h, status: 'ok' };
      return await recheck(u, h, res.headers.get('date'), want, want === valid404);
    } catch {
      return byWorker() ?? (await fresh404()) ?? { url: u.href, status: 'not-cached', note: 'not in the browser cache (no-store?)' };
    }
  }

  /// The cached copy doesn't match: check the copy the site serves now before deciding (lib/recheck.ts).
  async function recheck(u: URL, cachedHash: string, cachedDate: string | null, valid: string[], notFound = false): Promise<FileResult> {
    let fresh: { hash: string; date: number } | null = null;
    try {
      const f = await fetch(u.href, { cache: 'no-store', credentials: 'same-origin' });
      if (notFound ? f.status === 404 : f.ok) fresh = { hash: hex(await crypto.subtle.digest('SHA-256', await f.arrayBuffer())), date: Date.parse(f.headers.get('date') ?? '') };
    } catch { /* the network copy can't be read: decide on the cached copy */ }
    const r = decideRecheck({ cachedHash, cachedDate: Date.parse(cachedDate ?? ''), fresh, sinceLoad: performance.now(), valid, release: info!.release, loadedLocal: performance.timeOrigin, publishedLocal: info!.publishedAt });
    return { url: u.href, ...r };
  }

  function checkCrossOrigin(u: URL, el: HTMLScriptElement | null): FileResult {
    const sealed = info!.scripts.filter((s) => s.url === u.href);
    if (el) {
      if (sealed.length === 0) return { url: u.href, status: info!.origins.includes(u.origin) ? 'unknown' : 'unknown-origin', note: 'a cross-origin script that is not in the sealed release' };
      const ok = !!el.integrity && sealed.some((s) => s.integrity === el.integrity);
      return { url: u.href, status: ok ? 'ok-sri' : 'sri-mismatch', note: ok ? 'the browser enforces the sealed SRI hash' : `integrity is "${el.integrity}", sealed is "${sealed[0]!.integrity}"` };
    }
    // seen only in resource timing (no element to read the integrity from)
    if (!info!.origins.includes(u.origin)) return { url: u.href, status: 'unknown-origin', note: 'loaded from an origin that is not sealed' };
    return { url: u.href, status: 'cross-origin', note: 'cross-origin: bytes not readable' };
  }

  async function checkOne(raw: string, scripty: boolean, el: HTMLScriptElement | null, isDocument = false): Promise<void> {
    let u: URL;
    try {
      u = new URL(raw, location.href);
    } catch {
      return;
    }
    if (!/^https?:$/.test(u.protocol)) return; // blob:, data:, extension URLs
    u.hash = '';
    const prev = results.get(u.href);
    // done, unless it wasn't loaded yet last time (an async script, a lazy chunk) or an element now shows its integrity
    if (prev && prev.status !== 'not-cached' && !(el && prev.status === 'cross-origin')) return;
    results.set(u.href, { url: u.href, status: 'not-cached', note: 'checking' });
    const r = u.origin === location.origin ? await checkSameOrigin(u, scripty, isDocument) : scripty ? checkCrossOrigin(u, el) : null;
    if (r) results.set(u.href, r);
    else results.delete(u.href);
  }

  /// ssr mode: inline scripts (sealed hash or template), event-handler attributes and javascript: URLs.
  function checkInline(): void {
    const sealed = new Set(info!.pages!.inline);
    if (overflow) results.set('inline:overflow', { url: 'inline:overflow', status: 'injected', note: `more than ${MAX_SEEN} scripts on one page` });
    for (const [, e] of seenInline) {
      if (!e.runs) continue;
      for (const text of finalTexts(e.texts)) {
        const h = inlineHash(text);
        const key = `inline:${h}`;
        const kind = classifyInline({ text, type: '' }, sealed);
        if (results.get(key)?.status === 'injected') continue;
        results.set(key, kind === 'injected'
          ? { url: key, sha256: h.slice(2), status: 'injected', note: `an inline script that is not in the sealed release: ${text.slice(0, 120)}` }
          : { url: key, sha256: h.slice(2), status: 'ok-inline', note: kind });
      }
    }
    const attrs = document.evaluate("//@*[starts-with(translate(name(),'ON','on'),'on')]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < Math.min(attrs.snapshotLength, 50); i++) {
      const a = attrs.snapshotItem(i) as Attr;
      const key = `handler:${a.ownerElement?.tagName.toLowerCase()}[${a.name}]`;
      results.set(key, { url: key, status: 'injected', note: `an inline event handler ${a.name}="${a.value.slice(0, 80)}": code that is not in the sealed release` });
    }
    for (const el of document.querySelectorAll<HTMLElement>('a[href],area[href],iframe[src],form[action]')) {
      const v = el.getAttribute('href') ?? el.getAttribute('src') ?? el.getAttribute('action') ?? '';
      if (/^\s*javascript:/i.test(v)) results.set(`jsurl:${v.slice(0, 60)}`, { url: `jsurl:${v.slice(0, 60)}`, status: 'injected', note: 'a javascript: URL: code that is not in the sealed release' });
    }
  }

  async function checkWorker(scriptURL: string): Promise<void> {
    let u: URL;
    try {
      u = new URL(scriptURL);
    } catch {
      return;
    }
    const key = `worker:${u.href}`;
    const path = pathOfUrl(u.pathname);
    const allowed = info!.pages ? info!.pages.serviceWorkers.includes(path) : !!info!.hashes[path] || !!info!.gateway;
    if (u.origin !== location.origin || !allowed) {
      results.set(key, { url: u.href, status: 'unknown', note: 'a service worker that is not in the sealed release' });
      return;
    }
    if (info!.gateway) return void (await checkOne(u.href, true, null)); // the gateway's own pinned worker
    const valid = info!.hashes[path] ?? [];
    try {
      // the bytes the worker was installed from: the HTTP cache, else the same URL from the server now
      let res = await fetch(u.href, { cache: 'only-if-cached', mode: 'same-origin', credentials: 'same-origin' }).catch(() => null);
      if (!res?.ok) res = await fetch(u.href, { cache: 'no-cache', credentials: 'same-origin' });
      const h = hex(await crypto.subtle.digest('SHA-256', await res.arrayBuffer()));
      results.set(key, { url: u.href, sha256: h, status: valid.includes(h) ? 'ok' : 'mismatch', note: 'service worker' });
    } catch {
      results.set(key, { url: u.href, status: 'not-cached', note: 'service worker: could not read its bytes' });
    }
  }

  async function pass(): Promise<void> {
    scanNow();
    // the releases this page may match can change while it is open (a new release, the previous one's grace ending):
    // then every file is checked again against them, not only files seen for the first time
    const now = await ask<PageInfo>({ type: 'site', host: location.hostname, url: location.href, again: true });
    if (now && now.site === info!.site) {
      if (now.release !== info!.release || now.manifests.join() !== info!.manifests.join()) results.clear();
      info = { ...now, proof: info!.proof };
    }
    const ssr = !!info!.pages;
    // ssr: the document itself is not sealed (its scripts are); static: the HTML is a sealed file
    const jobs: Promise<void>[] = ssr ? [] : [checkOne(location.href, false, null, true)];
    if (ssr) {
      results.set(location.href.split('#')[0]!, { url: location.href.split('#')[0]!, status: 'ok-ssr', note: 'server-rendered page: its scripts are checked, not its HTML' });
      checkInline();
    }
    for (const s of document.scripts) if (s.src && !s.noModule) jobs.push(checkOne(s.src, true, s));
    for (const src of seenSrc) jobs.push(checkOne(src, true, [...document.scripts].find((s) => s.src === src) ?? null));
    // preloads count once the browser actually fetched them (a hint never fetched runs nothing)
    const fetched = new Set((performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map((e) => e.name.split('#')[0]));
    for (const l of document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href], link[rel~="modulepreload"][href], link[rel~="preload"][as="script"][href]')) {
      const preload = !l.rel.includes('stylesheet');
      if (preload && !fetched.has(l.href.split('#')[0]!)) continue;
      jobs.push(checkOne(l.href, preload, null));
    }
    for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      const js = e.initiatorType === 'script' || /\.m?js$/i.test(new URL(e.name).pathname);
      if (js || e.initiatorType === 'link' || e.initiatorType === 'css') jobs.push(checkOne(e.name, js, null));
    }
    try {
      for (const reg of (await navigator.serviceWorker?.getRegistrations()) ?? []) {
        for (const sw of [reg.active, reg.waiting, reg.installing]) if (sw) jobs.push(checkWorker(sw.scriptURL));
      }
      const ctl = navigator.serviceWorker?.controller;
      if (ctl) jobs.push(checkWorker(ctl.scriptURL));
    } catch { /* no service workers here */ }
    await Promise.all(jobs);
    let files = [...results.values()];
    if (!rechecked && files.some((f) => f.status === 'mismatch')) {
      // a new release may have been published since Guard last read the chain (it reads at most once a minute): read
      // it now, then check again, once per page
      rechecked = true;
      const now = await ask<PageInfo>({ type: 'site', host: location.hostname, url: location.href, fresh: true, again: true });
      if (now) {
        info = now;
        for (const [k, f] of results) if (f.status === 'mismatch') results.delete(k);
        return pass();
      }
    }
    files = [...results.values()];
    const status = files.some((f) => BAD.includes(f.status)) ? 'tampered' : files.some((f) => !['ok', 'ok-sri', 'ok-gateway', 'ok-inline', 'ok-ssr'].includes(f.status)) ? 'unverified' : 'ok';
    if (info!.enforce && status === 'tampered' && !held && !info!.bypass) {
      // 0.3.3: the team may have deployed a release seconds before publishing it. If a release proposal of this gate
      // can be published now, report the page as not matching (signing stays refused) but hold the red page, and
      // re-read the chain every few seconds for up to a minute. Once per page; then the normal answer.
      held = true;
      const p = await ask<{ release: number } | null>({ type: 'publishing' });
      if (p) {
        const until = Date.now() + HOLD_MS;
        last = { url: location.href, status, files, hold: { release: p.release, until } };
        await ask({ type: 'report', report: last });
        while (Date.now() < until) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          const now = await ask<PageInfo>({ type: 'site', host: location.hostname, url: location.href, fresh: true, again: true });
          if (now && now.site === info!.site && now.release !== info!.release) {
            info = { ...now, proof: info!.proof };
            results.clear();
            return pass();
          }
        }
      }
    }
    last = { url: location.href, status, files };
    if (info!.enforce && status === 'tampered') redirecting = true; // known before the answer arrives
    const r = await ask<{ redirect: boolean }>({ type: 'report', report: last });
    redirecting = redirecting || !!r?.redirect;
  }

  /// A full check that starts after this call (waits out one already running): the state at signing time.
  async function checkFresh(): Promise<void> {
    if (running) await running.catch(() => {});
    await check();
  }

  let running: Promise<void> | null = null;
  let again = false;
  function check(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = pass().finally(() => {
      running = null;
      if (again) {
        again = false;
        void check();
      }
    });
    return running;
  }

  // ---- signing requests
  /// Guard's decision on one signing request (from the page-world wrapper or the wallet's channel). `show` draws the
  /// refusal notice; callers answer the page first, then call it.
  async function decideSign(req: unknown): Promise<{ refused: boolean; message: string; show: () => void }> {
    const none = () => {};
    if (TOP) scanNow(); // synchronously, before anything else: a script that inserted itself and signed at once is now recorded
    if (!info) return { refused: false, message: '', show: none };
    if (TOP) {
      await Promise.race([first, new Promise((r) => setTimeout(r, 5000))]);
      await Promise.race([checkFresh(), new Promise((r) => setTimeout(r, 8000))]); // the page as it is at signing time
    }
    const d = await ask<Decision>({ type: 'sign', req });
    if (!d) {
      // No answer: the extension is gone, or Guard itself is taking the tab to the warning page and the answer was
      // lost with the page. Fail-open only if nothing here is known to be wrong.
      const known = redirecting || (info.enforce && (info.site === 'revoked' || last?.status === 'tampered'));
      return { refused: known, message: known ? "This page doesn't match its sealed release. Don't sign." : '', show: none };
    }
    const show = () => {
      if (!d.refused || redirecting) return;
      try {
        showRefusal(d);
      } catch { /* the notice is a courtesy; the refusal already happened */ }
    };
    return { refused: d.refused, message: `${d.title}. ${d.reason}`, show };
  }

  async function onSign(id: number, req: unknown): Promise<void> {
    const r = await decideSign(req);
    if (!r.refused) {
      // allowed: when the same request now travels on the wallet's channel, it isn't asked about again
      const q = req as { method?: string; params?: unknown };
      const rk = typeof q?.method === 'string' ? requestKey(q.method, q.params) : null;
      if (rk) decided.set(rk, Date.now());
    }
    // the page's promise is answered first: a refused request always rejects with 4001, whatever the notice does
    down({ type: 'decision', id, refused: r.refused, message: r.message });
    r.show();
  }

  // ---- the full-page notice for a refused signature
  function showRefusal(d: Decision): void {
    document.getElementById('signet-guard-notice')?.remove();
    const host = document.createElement('div');
    host.id = 'signet-guard-notice';
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    root.innerHTML = `
      <style>
        .back{position:fixed;inset:0;background:#7f1d1d;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;color:#fff;padding:24px;box-sizing:border-box}
        .card{max-width:640px;width:100%}
        h1{font-size:28px;margin:0 0 4px} .tag{font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.8}
        p{margin:12px 0} ul{margin:12px 0;padding:12px 16px;list-style:none;background:#0003;border-radius:8px;font:13px/1.6 ui-monospace,monospace;overflow-wrap:anywhere}
        button{font:inherit;padding:10px 16px;border-radius:8px;border:1px solid #fff8;background:transparent;color:#fff;cursor:pointer;margin:8px 8px 0 0}
        button.main{background:#fff;color:#7f1d1d;border-color:#fff;font-weight:600} .small{font-size:13px;opacity:.85}
      </style>
      <div class="back" role="alertdialog" aria-labelledby="t">
        <div class="card">
          <div class="tag">Signet Guard · ${esc(info!.domain)}</div>
          <h1 id="t">Signature refused</h1>
          <p><strong>${esc(d.title)}.</strong> ${esc(d.reason)}</p>
          <ul>${d.details.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          <p class="small">Nothing was sent to your wallet. The team that runs this site sealed a list of contracts it may ask you to sign for; this request is outside that list.</p>
          <button class="main" id="close">Back to the site</button>
          <span id="copyslot" class="small">Verified copy: checking…</span>
          <button id="wrong">Report wrong block</button>
          <p class="small" id="msg" aria-live="polite"></p>
        </div>
      </div>`;
    root.getElementById('close')!.addEventListener('click', () => host.remove());
    // the same rule as the popup and the warning page (lib/copy.ts): a button only for a copy the wallet can use
    void ask<Parameters<typeof copyOffer>[0]>({ type: 'copy-state', domain: info!.domain }).then((st) => {
      const slot = root.getElementById('copyslot');
      if (!slot) return;
      const offer = copyOffer(st);
      if (!offer.button) {
        slot.textContent = offer.text;
        slot.title = offer.title;
        return;
      }
      const b = document.createElement('button');
      b.id = 'copy';
      b.textContent = offer.text;
      b.title = offer.title;
      b.addEventListener('click', () => void ask({ type: 'open-copy', domain: info!.domain }));
      slot.replaceWith(b);
    });
    root.getElementById('wrong')!.addEventListener('click', async () => {
      const text = await ask<string>({ type: 'wrong-block', domain: info!.domain, note: `${d.title}: ${d.details.join('; ')}` });
      try {
        await navigator.clipboard.writeText(text ?? '');
        root.getElementById('msg')!.textContent = 'Report copied. Send it to the team that runs this site; Guard itself sends nothing.';
      } catch {
        root.getElementById('msg')!.textContent = 'Report saved in Guard (open the Guard popup to copy it).';
      }
    });
    (document.body ?? document.documentElement).appendChild(host);
  }

  // ---- start
  void (async () => {
    // a subframe only reads (again: true): the tab's state and report stay the top frame's
    info = await ask<PageInfo>({ type: 'site', host: location.hostname, url: location.href, ...(TOP ? {} : { again: true }) });
    infoKnown = true;
    infoReadyDone();
    // tell the page's wallet wrapper at once: on a sealed domain every signature waits for Guard's decision, which
    // waits for the first check below (so for the domain proof too). Never a fail-open window while the proof loads.
    down({ type: 'state', sealed: !!info });
    if (!TOP) return firstDone(); // signing only: the top frame checks the page and confirms the domain
    if (info?.proof) {
      // this domain is sealed but hasn't confirmed its gate yet: read its own /.well-known/signet.json (same origin)
      let body: string | null = null;
      try {
        const r = await fetch(info.proof.url, { cache: 'no-store', credentials: 'omit', redirect: 'error' });
        if (r.ok) body = (await r.text()).slice(0, 4096);
      } catch { /* missing: stays unconfirmed */ }
      const p = await ask<{ confirmed: boolean }>({ type: 'proof', host: location.hostname, body });
      if (p?.confirmed) info = await ask<PageInfo>({ type: 'site', host: location.hostname, url: location.href });
    }
    if (!info) return firstDone(); // not a sealed domain: nothing else happens on this page
    const start = () => void check().then(firstDone);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
    window.addEventListener('load', () => void check(), { once: true });
    // scripts loaded later (lazy chunks, injected scripts) appear as new resource entries
    new PerformanceObserver(() => void check()).observe({ type: 'resource', buffered: false });
  })();
})();
