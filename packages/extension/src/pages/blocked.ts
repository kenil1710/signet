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
    <h1>${revoked ? 'This site’s release was revoked.' : 'This site doesn’t match its sealed release.'} Don’t sign.</h1>
    <p>${revoked
      ? 'The team that runs this site withdrew the release it had published. Until they publish a new one, nothing here can be trusted.'
      : `The code this page loaded is different from what the team sealed${i ? ` as release #${i.site.release}` : ''}. This is what a hijacked website looks like: the address is right, the code is not.`}</p>
    ${wrong.length ? `<ul class="mono">${wrong.map((f) => `<li>${esc(f.status === 'mismatch' ? 'changed' : 'not sealed')} · ${esc(f.url)}</li>`).join('')}</ul>` : ''}
    <div>
      <button class="main" id="copy">Open verified copy</button>
      <button id="wrong">Report wrong block</button>
      <button id="back">Go back to the site (signing stays blocked)</button>
    </div>
    <p class="dim" id="msg" aria-live="polite"></p>
    <p class="dim">Your wallet was not asked for anything. If you signed something on this site recently, check your token approvals.</p>`;
  document.getElementById('copy')!.onclick = () => void send({ type: 'open-copy', domain });
  document.getElementById('wrong')!.onclick = () => void reportWrongBlock(domain, `page blocked: ${wrong.map((f) => f.url).join(', ')}`, document.getElementById('msg')!);
  document.getElementById('back')!.onclick = () => void send({ type: 'bypass', tabId, domain, url });
})();
