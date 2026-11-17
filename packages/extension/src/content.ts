// Guard content script (isolated world, document_start, top frame).
//  1. Asks the service worker whether this host is a sealed domain. If not: stops. No fetch, nothing else.
//  2. Page check: every script, stylesheet and the HTML document are read from the browser's HTTP cache
//     (fetch with cache: 'only-if-cached' never touches the network), hashed, and compared with the sealed
//     release. Cross-origin scripts can't be read that way: their SRI attribute is compared with the sealed one.
//  3. Passes signing requests from the in-page wrapper to the service worker and shows why one was refused.
import { pathOfUrl } from './lib/sealed.ts';
import type { Decision, FileResult, PageInfo, PageReport } from './lib/types.ts';

(() => {
  if (window.top !== window || !/^https?:$/.test(location.protocol)) return;

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
  const BAD = ['mismatch', 'unknown', 'unknown-origin', 'sri-mismatch'];
  const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

  async function checkSameOrigin(u: URL, scripty: boolean, isDocument: boolean): Promise<FileResult | null> {
    const path = pathOfUrl(u.pathname);
    const gw = info!.gateway;
    let valid: string[] | undefined;
    if (gw && (path === 'sw.js' || path === '.signet/boot.js')) valid = gw[path] ? [gw[path]!] : undefined; // the gateway's own files, pinned
    else if (gw && isDocument && path.startsWith('.signet/')) return { url: u.href, status: 'not-cached', note: "a page made by the gateway's worker" };
    // a route of a single-page app (no file extension) is the app's index.html
    else valid = info!.hashes[path] ?? (isDocument && !/\.[a-z0-9]+$/i.test(path) ? info!.hashes['index.html'] : undefined);
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

  async function pass(): Promise<void> {
    const jobs: Promise<void>[] = [checkOne(location.href, false, null, true)];
    for (const s of document.scripts) if (s.src) jobs.push(checkOne(s.src, true, s));
    for (const l of document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href], link[rel~="modulepreload"][href]')) jobs.push(checkOne(l.href, l.rel.includes('modulepreload'), null));
    for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      const js = e.initiatorType === 'script' || /\.m?js$/i.test(new URL(e.name).pathname);
      if (js || e.initiatorType === 'link' || e.initiatorType === 'css') jobs.push(checkOne(e.name, js, null));
    }
    try {
      for (const reg of (await navigator.serviceWorker?.getRegistrations()) ?? []) {
        const sw = reg.active ?? reg.waiting ?? reg.installing;
        if (sw) jobs.push(checkOne(sw.scriptURL, true, null));
      }
    } catch { /* no service workers here */ }
    await Promise.all(jobs);
    const files = [...results.values()];
    const status = files.some((f) => BAD.includes(f.status)) ? 'tampered' : files.some((f) => !['ok', 'ok-sri', 'ok-gateway'].includes(f.status)) ? 'unverified' : 'ok';
    last = { url: location.href, status, files };
    const r = await ask<{ redirect: boolean }>({ type: 'report', report: last });
    redirecting = !!r?.redirect;
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
    if (!info) return void down({ type: 'decision', id, refused: false });
    await Promise.race([first, new Promise((r) => setTimeout(r, 5000))]);
    const d = await ask<Decision>({ type: 'sign', req });
    if (d?.refused && !redirecting) showRefusal(d);
    down({ type: 'decision', id, refused: !!d?.refused, message: d ? `${d.title}. ${d.reason}` : '' });
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
    down({ type: 'state', sealed: !!info });
    if (!info) return firstDone(); // not a sealed domain: nothing else happens on this page
    const start = () => void check().then(firstDone);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
    window.addEventListener('load', () => void check(), { once: true });
    // scripts loaded later (lazy chunks, injected scripts) appear as new resource entries
    new PerformanceObserver(() => void check()).observe({ type: 'resource', buffered: false });
  })();
})();
