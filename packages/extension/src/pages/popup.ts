import { esc, send, reportWrongBlock, headline, type TabInfo } from './shared.ts';

void (async () => {
  const root = document.getElementById('root')!;
  // ?tab=<id> shows a given tab (used by tests and screenshots); otherwise the active tab
  const fixed = new URLSearchParams(location.search).get('tab');
  const tabId = fixed ? Number(fixed) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  const i = tabId === undefined ? null : await send<TabInfo | null>({ type: 'tab-info', tabId });
  if (!i) {
    root.innerHTML = '<div class="light"><span class="dot"></span><div><h1>Not a sealed site</h1><p class="dim">Guard does nothing on this page and sends nothing about it.</p></div></div>';
    return;
  }
  const h = headline(i);
  const files = i.tab.report?.files ?? [];
  const bad = files.filter((f) => !['ok', 'ok-sri', 'ok-gateway'].includes(f.status));
  root.className = `popup ${i.light}`;
  root.innerHTML = `
    <div class="light"><span class="dot"></span><div><h1>${esc(h.title)}</h1><div class="mono">${esc(i.site.domain)}</div></div></div>
    <p>${esc(h.text)}</p>
    <p class="dim">Mode: <strong>${i.site.enforced ? 'enforce' : 'observe'}</strong> ${i.site.enforced ? '(Guard blocks)' : '(Guard reports, never blocks)'}${i.site.frozen ? ' · gate frozen' : ''}${i.site.stale ? ' · using the release checked earlier' : ''}</p>
    <h2>Page check</h2>
    <p>${files.length - bad.length} of ${files.length} loaded files match the sealed release (${i.files} files sealed).</p>
    <ul class="mono">${bad.map((f) => `<li>${esc(f.status)} · ${esc(f.url)}</li>`).join('')}</ul>
    ${i.events.length ? `<h2>Recent</h2><ul>${i.events.slice(0, 5).map((e) => `<li><strong>${esc(e.title)}</strong> ${e.refused ? '(refused)' : '(reported only)'}<div class="dim">${esc(e.reason)}</div></li>`).join('')}</ul>` : ''}
    <div><button id="copy">Open verified copy</button><button id="wrong">Report wrong block</button></div>
    <p class="dim" id="msg" aria-live="polite"></p>
    <p class="dim mono">gate ${esc(i.site.gate ?? '-')}</p>`;
  document.getElementById('copy')!.onclick = () => void send({ type: 'open-copy', domain: i.site.domain });
  document.getElementById('wrong')!.onclick = () => void reportWrongBlock(i.site.domain, 'reported from the popup', document.getElementById('msg')!);
})();
