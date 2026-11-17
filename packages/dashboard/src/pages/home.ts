import { NET, domains } from '../chain.ts';
import { esc, view, $ } from '../ui.ts';

export async function home(): Promise<void> {
  const v = view(`<h1>Signet dashboard</h1>
    <p class="dim">Network: <b>${esc(NET.name)}</b> (chain ${NET.chainId}) · registry <code>${esc(NET.registry ?? 'not deployed')}</code></p>
    <p><a class="btn" href="#/prove">Prove it: check Signet's claims against the chain, in your browser</a></p>
    <form id="go"><input id="d" placeholder="app.example.org" autocomplete="off" spellcheck="false" required> <button>Open project</button></form>
    <h2>Sealed domains</h2><ul id="list"><li class="dim">reading the registry…</li></ul>`);
  $('#go', v).addEventListener('submit', (e) => {
    e.preventDefault();
    location.hash = `#/p/${($('#d', v) as HTMLInputElement).value.trim().toLowerCase()}`;
  });
  try {
    const all = await domains();
    $('#list', v).innerHTML = all.length ? all.slice().reverse().map((d) => `<li><a href="#/p/${esc(d)}">${esc(d)}</a></li>`).join('') : '<li class="dim">none yet</li>';
  } catch (e) {
    $('#list', v).innerHTML = `<li class="bad">Could not read the registry: ${esc((e as Error).message)}</li>`;
  }
}
