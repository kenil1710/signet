// "Sealed by Signet": a live status card for a domain, and the snippets a project can put on its site.
// The badge on a site proves nothing by itself (an attacker can copy it); it links to this page, which reads the chain.
import { project } from '../chain.ts';
import { esc, view } from '../ui.ts';

export async function badgePage(domain: string, embed: boolean): Promise<void> {
  const p = await project(domain).catch(() => null);
  const ok = !!p && p.currentRelease > 0 && !p.revoked;
  const card = `<a class="badge ${ok ? 'ok' : 'no'}" href="${esc(location.origin + location.pathname)}#/p/${esc(domain)}" target="_blank" rel="noopener">
    <span class="dot"></span><span><b>${ok ? 'Sealed by Signet' : 'Not sealed'}</b><br><small>${esc(domain)}${ok ? ` · release #${p!.currentRelease} · ${p!.enforced ? 'enforce' : 'observe'}${p!.frozen ? ' · frozen' : ''}` : p?.revoked ? ' · release revoked' : ''}</small></span></a>`;
  if (embed) {
    document.body.classList.add('embed');
    view(card);
    return;
  }
  const here = `${location.origin}${location.pathname}`;
  const link = `<a href="${here}#/p/${domain}" target="_blank" rel="noopener" style="display:inline-flex;gap:6px;align-items:center;padding:4px 10px;border:1px solid #15803d;border-radius:999px;color:#15803d;font:600 13px system-ui;text-decoration:none">● Sealed by Signet · verify</a>`;
  const frame = `<iframe src="${here}#/badge/${domain}?embed" title="Signet seal status" width="260" height="56" style="border:0" loading="lazy"></iframe>`;
  view(`<a class="back" href="#/p/${esc(domain)}">← ${esc(domain)}</a><h1>Badge</h1>
    <p>Live status, read from the chain now:</p>${card}
    <h2>1. Link badge (recommended)</h2><p>Static HTML, no script. Clicking it opens this dashboard, which checks the chain.</p>
    <pre>${esc(link)}</pre><div>${link}</div>
    <h2>2. Live badge</h2><p>An iframe that reads the chain from the dashboard's origin. Your site's CSP must allow it as a <code>frame-src</code>.</p>
    <pre>${esc(frame)}</pre>
    <p class="dim">A badge is not protection: anyone can copy it onto a fake site. It is a way for users to check. Guard and the watchtower are the checks.</p>`);
}
