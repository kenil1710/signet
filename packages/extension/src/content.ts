// Guard content script (isolated world, document_start, top frame).
//  1. Asks the service worker whether this host is a sealed domain. If not: stops. No fetch, nothing else.
//  2. Page check: every script, stylesheet and the HTML document are read from the browser's HTTP cache
//     (fetch with cache: 'only-if-cached' never touches the network), hashed, and compared with the sealed
//     release. Cross-origin scripts can't be read that way: their SRI attribute is compared with the sealed one.
//  3. Passes signing requests from the in-page wrapper to the service worker and shows why one was refused.
// Server-rendered releases (page mode "ssr"): the HTML is not sealed; every script file must be, and every inline
// script must be a sealed hash or a data template (@signet/cli/src/inline.ts). Scripts are recorded from
// document_start by a MutationObserver (also those that remove themselves), and before every signature Guard takes
// the pending records synchronously and runs a fresh full check, so a script that runs and signs at once is seen.
import { pathOfUrl, sealedPathFor } from './lib/sealed.ts';
import { classifyInline, inlineHash, runs } from '@signet/cli/src/inline.ts';
import type { Decision, FileResult, PageInfo, PageReport } from './lib/types.ts';

(() => {
  if (window.top !== window || !/^https?:$/.test(location.protocol)) return;

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
  mo.observe(document, { childList: true, subtree: true, characterData: true });
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
    const m = JSON.parse((e as CustomEvent).detail as string) as { type: string; id: number; req: unknown };
    if (m.type === 'ack') linked = true;
    else if (m.type === 'sign') void onSign(m.id, m.req);
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

  let info: PageInfo | null = null;
  let last: PageReport | null = null;
  let redirecting = false;
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
    if (!valid) return scripty || isDocument ? { url: u.href, status: 'unknown', note: 'not in the sealed release' } : null;
    if (!globalThis.crypto?.subtle) return { url: u.href, status: 'no-crypto', note: 'not a secure context' };
    // On the gateway, site files come from its service worker and never enter the HTTP cache, and a content
    // script's fetch doesn't pass through a page's worker. What Guard can read and pin are the gateway's own
    // files; when the worker in control is /sw.js (pinned, checked like any script) it has verified the rest.
    const byWorker = (): FileResult | null =>
      gw && !(path === 'sw.js' || path === '.signet/boot.js') && navigator.serviceWorker?.controller?.scriptURL === `${location.origin}/sw.js`
        ? { url: u.href, status: 'ok-gateway', note: "served and verified by the gateway's pinned worker" } : null;
    try {
      const res = await fetch(u.href, { cache: 'only-if-cached', mode: 'same-origin', credentials: 'same-origin' });
      if (!res.ok) return byWorker() ?? { url: u.href, status: 'not-cached', note: `cache answered ${res.status}` };
      const h = hex(await crypto.subtle.digest('SHA-256', await res.arrayBuffer()));
      return { url: u.href, sha256: h, status: valid.includes(h) ? 'ok' : 'mismatch' };
    } catch {
      return byWorker() ?? { url: u.href, status: 'not-cached', note: 'not in the browser cache (no-store?)' };
    }
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
    if (prev && !(el && prev.status === 'cross-origin')) return;
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
    const ssr = !!info!.pages;
    // ssr: the document itself is not sealed (its scripts are); static: the HTML is a sealed file
    const jobs: Promise<void>[] = ssr ? [] : [checkOne(location.href, false, null, true)];
    if (ssr) {
      results.set(location.href.split('#')[0]!, { url: location.href.split('#')[0]!, status: 'ok-ssr', note: 'server-rendered page: its scripts are checked, not its HTML' });
      checkInline();
    }
    for (const s of document.scripts) if (s.src) jobs.push(checkOne(s.src, true, s));
    for (const src of seenSrc) jobs.push(checkOne(src, true, [...document.scripts].find((s) => s.src === src) ?? null));
    for (const l of document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href], link[rel~="modulepreload"][href], link[rel~="preload"][as="script"][href]')) jobs.push(checkOne(l.href, !l.rel.includes('stylesheet'), null));
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
    const files = [...results.values()];
    const status = files.some((f) => BAD.includes(f.status)) ? 'tampered' : files.some((f) => !['ok', 'ok-sri', 'ok-gateway', 'ok-inline', 'ok-ssr'].includes(f.status)) ? 'unverified' : 'ok';
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
  async function onSign(id: number, req: unknown): Promise<void> {
    scanNow(); // synchronously, before anything else: a script that inserted itself and signed at once is now recorded
    if (!info) return void down({ type: 'decision', id, refused: false });
    await Promise.race([first, new Promise((r) => setTimeout(r, 5000))]);
    await Promise.race([checkFresh(), new Promise((r) => setTimeout(r, 8000))]); // the page as it is at signing time
    const d = await ask<Decision>({ type: 'sign', req });
    if (!d) {
      // No answer: the extension is gone, or Guard itself is taking the tab to the warning page and the answer was
      // lost with the page. Fail-open only if nothing here is known to be wrong.
      const known = redirecting || (info.enforce && (info.site === 'revoked' || last?.status === 'tampered'));
      return void down({ type: 'decision', id, refused: known, message: known ? "This page doesn't match its sealed release. Don't sign." : '' });
    }
    if (d.refused && !redirecting) showRefusal(d);
    down({ type: 'decision', id, refused: d.refused, message: `${d.title}. ${d.reason}` });
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
          <button id="copy">Open verified copy</button>
          <button id="wrong">Report wrong block</button>
          <p class="small" id="msg" aria-live="polite"></p>
        </div>
      </div>`;
    root.getElementById('close')!.addEventListener('click', () => host.remove());
    root.getElementById('copy')!.addEventListener('click', () => void ask({ type: 'open-copy', domain: info!.domain }));
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
    info = await ask<PageInfo>({ type: 'site', host: location.hostname, url: location.href });
    // tell the page's wallet wrapper at once: on a sealed domain every signature waits for Guard's decision, which
    // waits for the first check below (so for the domain proof too). Never a fail-open window while the proof loads.
    down({ type: 'state', sealed: !!info });
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
