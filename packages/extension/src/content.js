// Spike C content script. For a sealed origin: collect every script the page loaded, read the bytes the
// browser actually has in its HTTP cache (fetch cache:'only-if-cached', which never touches the network),
// SHA-256 them and compare with the sealed manifest bundled in the extension.
// Unsealed origins: return before any fetch (privacy rule: no network calls for unsealed domains).
(async () => {
  // The service worker holds the sealed manifest and returns only this origin's entry (or null).
  // Not web-accessible, so pages can't fingerprint the extension by fetching it.
  const site = await chrome.runtime.sendMessage({ type: 'signet-site', origin: location.origin });
  if (!site) {
    chrome.runtime.sendMessage({ type: 'signet-report', report: { status: 'unsealed', url: location.href, files: [] } });
    return;
  }
  const allowedOrigins = new Set(site.origins ?? []);
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const sha = async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes));
  const done = new Map(); // url -> result

  async function checkUrl(url) {
    const u = new URL(url, location.href);
    u.hash = '';
    const key = u.href;
    if (done.has(key)) return;
    done.set(key, { url: key, status: 'pending' });
    let r;
    if (u.origin !== location.origin) {
      // only-if-cached is only allowed with mode 'same-origin', so cross-origin bytes can't be read from cache.
      r = { url: key, status: allowedOrigins.has(u.origin) ? 'cross-origin' : 'unknown-origin' };
    } else {
      try {
        const res = await fetch(key, { cache: 'only-if-cached', mode: 'same-origin', credentials: 'same-origin' });
        if (!res.ok) r = { url: key, status: 'not-cached', http: res.status };
        else {
          const h = await sha(await res.arrayBuffer());
          const want = site.files[key];
          r = { url: key, sha256: h, status: !want ? 'unknown' : want === h ? 'ok' : 'mismatch' };
        }
      } catch (e) {
        r = { url: key, status: 'not-cached', error: String(e) };
      }
    }
    done.set(key, r);
  }

  async function checkInline() {
    for (const s of document.querySelectorAll('script:not([src])')) {
      const h = await sha(new TextEncoder().encode(s.textContent));
      const key = `inline:${h.slice(0, 12)}`;
      done.set(key, { url: key, sha256: h, status: site.inline.includes(h) ? 'ok' : 'unknown' });
    }
  }

  function report() {
    const files = [...done.values()].filter((f) => f.status !== 'pending');
    const bad = files.some((f) => ['mismatch', 'unknown', 'unknown-origin'].includes(f.status));
    const unread = files.some((f) => ['not-cached', 'cross-origin'].includes(f.status));
    const status = bad ? 'tampered' : unread ? 'unverified' : 'ok';
    chrome.runtime.sendMessage({ type: 'signet-report', report: { status, url: location.href, files } });
  }

  const scriptUrls = () => [
    location.href, // the HTML document itself
    ...[...document.scripts].filter((s) => s.src).map((s) => s.src),
    ...performance
      .getEntriesByType('resource')
      .filter((e) => e.initiatorType === 'script' || e.initiatorType === 'link' || /\.m?js(\?|$)/.test(e.name))
      .map((e) => e.name),
  ];

  await checkInline();
  await Promise.all(scriptUrls().map(checkUrl));
  report();

  // Scripts loaded later (lazy chunks, injected scripts) show up as new resource entries.
  new PerformanceObserver(async () => {
    await Promise.all(scriptUrls().map(checkUrl));
    report();
  }).observe({ type: 'resource', buffered: false });
})();
