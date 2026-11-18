import { esc, send, reportWrongBlock, headline, type TabInfo } from './shared.ts';
import type { Net } from '../lib/types.ts';

declare const __NET__: Net;
const host = (u: string | null | undefined) => { try { return u ? new URL(u).host : null; } catch { return u ?? null; } };
const LOGO = '<svg width="20" height="20" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="13" fill="#C8452F"/><circle cx="14" cy="14" r="10" fill="none" stroke="#8E2B1C" stroke-width="1" stroke-dasharray="2 2"/><path d="M17.5 9.5c-.8-1.3-2.1-2-3.6-2-2.2 0-3.7 1.3-3.7 3.1 0 1.8 1.4 2.6 3.9 3.2 1.9.5 2.8 1 2.8 2.2 0 1.2-1.2 2-2.8 2-1.7 0-3-.8-3.6-2.1" fill="none" stroke="#FFF4EC" stroke-width="2" stroke-linecap="round"/></svg>';
const BROKEN = '<svg width="44" height="44" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 4a28 28 0 1 0 0 56" fill="none" stroke="#FF8E77" stroke-width="3"/><path d="M36 4.3A28 28 0 0 1 36 59.7" fill="none" stroke="#FF8E77" stroke-width="3" opacity=".5"/><path d="M33 2l-4 14 6 6-6 10 5 8-4 22" fill="none" stroke="#FF8E77" stroke-width="2.5" stroke-linejoin="round"/></svg>';
const head = () => `<div class="pp-head"><span class="pp-brand">${LOGO} Signet Guard</span><span class="pp-net">X Layer · ${__NET__.chainId}</span></div>`;

void (async () => {
  const root = document.getElementById('root')!;
  // ?tab=<id> shows a given tab (used by tests and screenshots); otherwise the active tab
  const fixed = new URLSearchParams(location.search).get('tab');
  const tabId = fixed ? Number(fixed) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  const i = tabId === undefined ? null : await send<TabInfo | null>({ type: 'tab-info', tabId });
  if (!i) {
    root.innerHTML = `${head()}<div class="pp-body"><div class="light"><span class="dot"></span><div><h1>Not a sealed site</h1></div></div><p class="dim">Guard does nothing on this page and sends nothing about it.</p></div>`;
    return;
  }
  const h = headline(i);
  const files = i.tab.report?.files ?? [];
  const bad = files.filter((f) => !['ok', 'ok-sri', 'ok-gateway'].includes(f.status));
  root.className = `popup ${i.light}`;
  const mark = i.light === 'green' ? `<span class="mark"><img src="assets/seal-still.webp" alt="" width="56" height="56"></span>` : i.light === 'red' ? `<span class="mark">${BROKEN}</span>` : '<span class="dot"></span>';
  const nodes = [host(__NET__.rpcUrl), host(__NET__.rpcUrl2)].filter(Boolean);
  root.innerHTML = `${head()}<div class="pp-body">
    <div class="light">${mark}<div><h1>${esc(h.title)}</h1><div class="mono">${esc(i.site.domain)}</div></div></div>
    <p>${esc(h.text)}</p>
    <dl class="facts">
      <dt>Release</dt><dd>${i.site.release ? `#${i.site.release}` : '-'}</dd>
      <dt>Approvers on this gate</dt><dd>${i.site.approvers.length}</dd>
      <dt>Files matched</dt><dd class="${bad.length ? 'bad' : 'good'}">${files.length - bad.length} / ${files.length} loaded · ${i.files} sealed</dd>
      <dt>Allowed contracts</dt><dd>${i.contracts ?? '-'}</dd>
      <dt>Nodes</dt><dd>${nodes.length ? nodes.map(esc).join(' + ') : 'none'}${nodes.length === 2 ? ' (must agree)' : ''}</dd>
    </dl>
    <p class="pp-mode">Mode: <strong>${i.site.enforced ? 'enforce' : 'observe'}</strong> ${i.site.enforced ? '(Guard blocks)' : '(Guard reports, never blocks)'}${i.site.frozen ? ' · gate frozen' : ''}${i.site.stale ? ' · using the release checked earlier' : ''}</p>
    ${bad.length ? `<h2>Page check</h2><ul class="mono">${bad.map((f) => `<li>${esc(f.status)} · ${esc(f.url)}</li>`).join('')}</ul>` : ''}
    ${i.events.length ? `<h2>Recent</h2><ul>${i.events.slice(0, 5).map((e) => `<li><strong>${esc(e.title)}</strong> ${e.refused ? '(refused)' : '(reported only)'}<div class="dim">${esc(e.reason)}</div></li>`).join('')}</ul>` : ''}
    <div class="pp-actions"><button id="copy">Open the verified copy</button><button id="wrong">Report wrong block</button></div>
    <p class="dim" id="msg" aria-live="polite"></p>
    <p class="dim mono foot">gate ${esc(i.site.gate ?? '-')}</p></div>`;
  document.getElementById('copy')!.onclick = () => void send({ type: 'open-copy', domain: i.site.domain });
  document.getElementById('wrong')!.onclick = () => void reportWrongBlock(i.site.domain, 'reported from the popup', document.getElementById('msg')!);
})();
