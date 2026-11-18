// The full red page a tab is sent to when a sealed site, in enforce mode, doesn't match its sealed release.
import { esc, send, reportWrongBlock, type TabInfo } from './shared.ts';

void (async () => {
  const q = new URLSearchParams(location.hash.slice(1));
  const tabId = Number(q.get('tab'));
  const domain = q.get('domain') ?? '';
  const url = q.get('url') ?? '';
  const i = await send<TabInfo | null>({ type: 'tab-info', tabId });
  const wrong = (i?.tab.report?.files ?? []).filter((f) => ['mismatch', 'unknown', 'unknown-origin', 'sri-mismatch'].includes(f.status));
  const revoked = i?.site.status === 'revoked';
  const root = document.getElementById('root')!;
  root.innerHTML = `
    <div class="tag">Signet Guard · ${esc(domain)}</div>
    <svg class="icon" width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 4a28 28 0 1 0 0 56" fill="none" stroke="#FFF6F3" stroke-width="3"/><path d="M36 4.3A28 28 0 0 1 36 59.7" fill="none" stroke="#FFF6F3" stroke-width="3" opacity=".5"/><path d="M33 2l-4 14 6 6-6 10 5 8-4 22" fill="none" stroke="#FFF6F3" stroke-width="2.5" stroke-linejoin="round"/></svg>
    <h1>${revoked ? "Stop. This site's release was revoked." : "Stop. This site's seal is broken."}</h1>
    <p>Signet stopped this page from asking your wallet to sign. Nothing was sent.</p>
    <p>${revoked
      ? 'The team that runs this site withdrew the release it had published. Until they publish a new one, nothing here can be trusted.'
      : `The code this page loaded is different from what the team sealed${i ? ` as release #${i.site.release}` : ''}. This is what a hijacked website looks like: the address is right, the code is not.`}</p>
    <div class="bb">
      <button class="main" id="copy">Open the verified copy</button>
      <button id="leave">Leave this site</button>
    </div>
    ${wrong.length ? `<details open><summary>What changed</summary><ul class="mono">${wrong.map((f) => `<li>${esc(f.status === 'mismatch' ? 'changed' : 'not sealed')} · ${esc(f.url)}</li>`).join('')}</ul></details>` : ''}
    <div class="sub"><button class="link" id="back">Go back to the site (signing stays blocked)</button><button class="link" id="wrong">Report wrong block</button></div>
    <p class="dim" id="msg" aria-live="polite"></p>
    <p class="note">Your wallet was not asked for anything. If you signed something on this site recently, check your token approvals.</p>`;
  document.getElementById('copy')!.onclick = () => void send({ type: 'open-copy', domain });
  document.getElementById('wrong')!.onclick = () => void reportWrongBlock(domain, `page blocked: ${wrong.map((f) => f.url).join(', ')}`, document.getElementById('msg')!);
  // "Leave this site": a new tab page in this tab, away from the broken site (nothing is sent, nothing is unblocked)
  document.getElementById('leave')!.onclick = () => void chrome.tabs.update(tabId, { url: 'chrome://newtab/' }).catch(() => location.replace('about:blank'));
  document.getElementById('back')!.onclick = () => void send({ type: 'bypass', tabId, domain, url });
})();
