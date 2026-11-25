import { NET, domains } from '../chain.ts';
import { esc, view, $ } from '../ui.ts';

export async function home(): Promise<void> {
  const v = view(`<div class="kicker">Dashboard · ${esc(NET.name)} · chain ${NET.chainId}</div>
    <h1>Sealed projects</h1>
    <p class="lead">Releases, approvals, timelocks and freezes for every domain sealed with Signet. Everything here is read from the chain; actions go through your own wallet.</p>
    <div class="actions"><a class="btn btn-wax" href="#/new">Protect a site</a><a class="btn" href="#/prove">Prove it: check Signet's claims in your browser</a>
      <form id="go"><input id="d" placeholder="app.example.org" autocomplete="off" spellcheck="false" required> <button>Open project</button></form></div>
    <p class="mono dim">registry ${esc(NET.registry ?? 'not deployed')}</p>
    <h2>Sealed domains</h2><ul id="list" class="domains" aria-busy="true"><li class="skel"><span class="sk" style="--w:34%"></span></li><li class="skel"><span class="sk" style="--w:26%"></span></li><li class="skel"><span class="sk" style="--w:30%"></span></li></ul>
    <p class="loading-note" id="listnote">Reading the registry on X Layer…</p>`);
  $('#go', v).addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = `#/p/${($('#d', v) as HTMLInputElement).value.trim().toLowerCase()}`;
  });
  try {
    const all = await domains();
    $('#listnote', v).remove(); $('#list', v).removeAttribute('aria-busy');
    $('#list', v).innerHTML = all.length ? all.slice().reverse().map((d) => `<li><a href="#/p/${esc(d)}">${esc(d)}</a></li>`).join('') : '<li class="dim">none yet</li>';
  } catch (e) {
    $('#listnote', v)?.remove(); $('#list', v).removeAttribute('aria-busy');
    $('#list', v).innerHTML = `<li class="bad">Could not read the registry: ${esc((e as Error).message)}</li>`;
  }
}
