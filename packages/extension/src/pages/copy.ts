// "Open verified copy": the sealed release as it is stored in the project's container on-chain. Every file is
// read from the chain and counts only if its bytes hash to the sealed value. The preview runs in a sandboxed
// frame without a wallet: it shows the real app, but signing from it is not possible yet (v1 limit).
import { esc, send } from './shared.ts';

interface List { ok: boolean; reason?: string; domain: string; release: number; manifest: string; container: string; prefix: string; files: { path: string; contentType: string; sha256: string; size: number }[] }
type Got = { ok: true; contentType: string; base64: string } | { ok: false; why: string };

void (async () => {
  const domain = new URLSearchParams(location.hash.slice(1)).get('domain') ?? '';
  const root = document.getElementById('root')!;
  const list = await send<List>({ type: 'copy', domain });
  if (!list?.ok) {
    root.innerHTML = `<h1>No verified copy for ${esc(domain)}</h1><p>${esc(list?.reason ?? 'Guard could not read the release.')}</p>`;
    return;
  }
  root.innerHTML = `
    <h1>Verified copy of ${esc(list.domain)}</h1>
    <p>Release #${list.release}, read from the project's container on X Layer and checked file by file against the sealed hashes.</p>
    <p class="dim mono">manifest ${esc(list.manifest)} · container ${esc(list.container)} / ${esc(list.prefix)}</p>
    <p id="sum" class="dim">Reading ${list.files.length} files…</p>
    <h2>Preview</h2><p class="dim">Runs without a wallet. To use the app, wait for the team to fix the site.</p><div id="frame"></div>
    <h2>Files</h2><table><tbody id="rows"></tbody></table>`;
  const rows = document.getElementById('rows')!;
  const got = new Map<string, { contentType: string; bytes: Uint8Array }>();
  let stored = 0;
  for (const f of list.files) {
    const r = await send<Got>({ type: 'copy-file', domain, path: f.path });
    if (r?.ok) {
      got.set(f.path, { contentType: r.contentType, bytes: Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0)) });
      stored++;
    }
    rows.insertAdjacentHTML('beforeend', `<tr><td class="mono">${esc(f.path)}</td><td>${f.size} bytes</td><td class="${r?.ok ? 'ok' : 'no'}">${r?.ok ? 'verified copy on-chain' : esc(r?.why ?? 'not read')}</td></tr>`);
  }
  document.getElementById('sum')!.textContent = `${stored} of ${list.files.length} files are stored on-chain and match their sealed hash.`;
  const index = got.get('index.html');
  if (!index) {
    document.getElementById('frame')!.innerHTML = '<p>This release has no full copy on-chain (only its manifest), so there is nothing to preview.</p>';
    return;
  }
  const frame = document.createElement('iframe');
  frame.title = `Verified copy of ${list.domain}`;
  frame.src = chrome.runtime.getURL('sandbox.html');
  addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow || !e.data?.ready) return;
    // the sandboxed frame builds the page from the verified bytes (see sandbox.html)
    frame.contentWindow!.postMessage({ files: [...got].map(([path, f]) => ({ path, contentType: f.contentType, bytes: f.bytes.buffer })) }, '*');
  });
  document.getElementById('frame')!.append(frame);
})();
