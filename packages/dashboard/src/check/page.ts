// /check: calls the read-only risk check (functions/api/check.ts) and renders its report.
import '../style.css';
import type { Report } from './risk.ts';

const out = document.getElementById('out')!;
const input = document.getElementById('d') as HTMLInputElement;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const ICON: Record<string, string> = { ok: 'OK', warn: 'Warning', risk: 'Risk', info: 'Note' };

function render(r: Report): string {
  const order = { risk: 0, warn: 1, info: 2, ok: 3 } as const;
  const f = [...r.findings].sort((a, b) => order[a.level] - order[b.level]);
  const risks = f.filter((x) => x.level === 'risk').length, warns = f.filter((x) => x.level === 'warn').length;
  return `<section class="report">
    <h2>${esc(r.domain)}</h2>
    <p class="dim">${esc(r.url)} · HTTP ${r.status} · checked ${esc(new Date(r.checkedAt).toUTCString())}</p>
    <p class="summary ${risks ? 'bad' : warns ? 'warnsum' : 'ok'}">${risks} risk(s), ${warns} warning(s)</p>
    <ul class="findings">${f.map((x) => `<li class="fd ${x.level}"><b>${ICON[x.level]}</b> <span class="area">${esc(x.area)}</span> ${esc(x.text)}</li>`).join('')}</ul>
    ${r.scripts.length ? `<details><summary>Scripts in the HTML (${r.scripts.length})</summary><ul>${r.scripts.map((s) => `<li><code>${esc(s.src)}</code>${s.preload ? ' · preloaded module' : ''} ${s.sameOrigin ? '' : s.sri ? '· SRI' : '· <b>no SRI</b>'}</li>`).join('')}</ul></details>` : ''}
    ${r.dns ? `<details><summary>DNS and registrar</summary><ul><li>Name servers: ${esc(r.dns.ns.join(', ') || 'unknown')}</li><li>CAA: ${esc(r.dns.caa.join('; ') || 'none')}</li><li>DNSSEC validated: ${r.dns.dnssec === null ? 'unknown' : r.dns.dnssec ? 'yes' : 'no'}</li>${r.registrar ? `<li>Registrar: ${esc(r.registrar.name ?? 'unknown')}; transfer lock: ${r.registrar.locked === null ? 'unknown' : r.registrar.locked ? 'on' : 'off'}${r.registrar.expires ? `; expires ${esc(r.registrar.expires.slice(0, 10))}` : ''}</li>` : ''}</ul></details>` : ''}
    <p class="dim">Not seen by this check: ${r.cannotSee.map(esc).join('; ')}.</p>
    ${r.sealed ? '' : '<p><a class="btn" href="start">Seal your releases: free setup</a></p>'}
  </section>`;
}

async function run(domain: string): Promise<void> {
  out.innerHTML = `<p class="dim">Checking ${esc(domain)}…</p>`;
  try {
    const res = await fetch(`api/check?domain=${encodeURIComponent(domain)}`);
    const j = await res.json();
    out.innerHTML = res.ok ? render(j as Report) : `<p class="bad">${esc((j as { error: string }).error)}</p>`;
  } catch (e) {
    out.innerHTML = `<p class="bad">The check couldn't run: ${esc((e as Error).message)}</p>`;
  }
}

document.getElementById('f')!.addEventListener('submit', (e) => {
  e.preventDefault();
  const d = input.value.trim();
  if (!d) return;
  history.replaceState(null, '', `?domain=${encodeURIComponent(d)}`);
  void run(d);
});
const q = new URLSearchParams(location.search).get('domain');
if (q) {
  input.value = q;
  void run(q);
}
