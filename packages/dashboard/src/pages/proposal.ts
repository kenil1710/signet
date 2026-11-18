// Diff Guard in the browser. A proposal is only three hashes on-chain, so the reviewer gives the dashboard the build
// CI proposed (its artifact folder). Nothing is taken on trust: the folder must hash to the proposal's on-chain
// values and every file to its sealed hash; the current release's lists are read from the chain and hash-checked.
import { sha256, type Hex } from 'viem';
import { project, releaseLists, status, TIERS, span } from '../chain.ts';
import { send } from '../wallet.ts';
import { parseSealed, FILES_PATH, ALLOWLIST_PATH, ORIGINS_PATH } from '@signet/extension/src/lib/sealed.ts';
import { diffSealed, formatDiff } from '@signet/cli/src/diff.ts';
import type { SealedLists } from '@signet/cli/src/seal.ts';
import { esc, short, view, $, action } from '../ui.ts';

export async function proposalPage(domain: string, id: number): Promise<void> {
  const p = await project(domain);
  const x = p?.proposals.find((q) => q.id === id);
  if (!p || !x) {
    view(`<a class="back" href="#/p/${esc(domain)}">← ${esc(domain)}</a><p>No proposal #${id} on this gate (the dashboard shows the last 25).</p>`);
    return;
  }
  const st = status(x, p);
  const v = view(`<a class="back" href="#/p/${esc(domain)}">← ${esc(domain)}</a>
    <h1>Diff Guard: proposal #${id}</h1>
    <div class="glance">
      <div><span class="label">Risk tier (on-chain)</span><b class="${x.tier >= 2 ? 'bad' : ''}">${TIERS[x.tier]!.split(' ')[0]}</b></div>
      <div style="grid-column:span 3"><span class="label">Status</span><b style="font-size:16px;font-stretch:100%;text-transform:none;letter-spacing:0">${esc(st.text)}${st.at && st.at > p.chainTime ? ` · ${span(st.at - p.chainTime)} left` : ''}</b></div>
    </div>
    <p>Risk tier computed on-chain: <b>${TIERS[x.tier]}</b>${x.emergency ? ' (emergency fast lane requested)' : ''}. ${esc(st.text)}${st.at && st.at > p.chainTime ? ` Publishable in ${span(st.at - p.chainTime)}.` : ''}</p>
    <table class="kv"><tr><td>filesRoot</td><td><code>${x.filesRoot}</code></td></tr><tr><td>allowlistHash</td><td><code>${x.allowlistHash}</code></td></tr><tr><td>originsHash</td><td><code>${x.originsHash}</code></td></tr></table>
    <p><b>Choose the build folder CI proposed</b> (the sealed <code>dist</code> with its <code>signet/</code> files; the GitHub Action's artifact). It stays in your browser.</p>
    <div class="actions"><input type="file" id="dir" webkitdirectory multiple></div>
    <div id="result"></div>
    <div class="actions">${st.open ? '<button data-a="approve">Approve</button> <button data-a="withdrawApproval">Withdraw</button> <button data-a="cancel">Cancel</button>' : ''} ${st.publishable ? '<button data-a="publish" class="primary">Publish</button>' : ''}</div>`);
  for (const b of v.querySelectorAll<HTMLButtonElement>('button[data-a]')) action(b, async () => `${b.dataset.a} sent (tx ${short(await send(p.gate, b.dataset.a!, [BigInt(id)], b.dataset.a === 'publish'))})`, () => void proposalPage(domain, id));
  ($('#dir', v) as HTMLInputElement).onchange = async (e) => {
    const out = $('#result', v);
    out.innerHTML = '<p class="dim">checking…</p>';
    try {
      out.innerHTML = await review((e.target as HTMLInputElement).files!, domain, x, p);
    } catch (err) {
      out.innerHTML = `<p class="bad">${esc((err as Error).message)}</p>`;
    }
  };
}

async function review(list: FileList, domain: string, x: { filesRoot: Hex; allowlistHash: Hex; originsHash: Hex; baseline: bigint }, p: NonNullable<Awaited<ReturnType<typeof project>>>): Promise<string> {
  const files = new Map<string, Uint8Array>();
  // the build root is the folder that holds signet/files.json, whichever folder (or parent) the user picked
  const all = Array.from(list);
  const marker = all.map((f) => f.webkitRelativePath).find((p) => p === FILES_PATH || p.endsWith(`/${FILES_PATH}`));
  if (!marker) throw new Error(`${FILES_PATH} is not in the folder: choose the sealed build (it has a signet/ folder)`);
  const root = marker.slice(0, marker.length - FILES_PATH.length);
  for (const f of all) if (f.webkitRelativePath.startsWith(root)) files.set(f.webkitRelativePath.slice(root.length), new Uint8Array(await f.arrayBuffer()));
  const need = (path: string) => files.get(path) ?? (() => { throw new Error(`${path} is not in the folder: choose the sealed build (it has a signet/ folder)`); })();
  const next = parseSealed(domain, need(ALLOWLIST_PATH), need(ORIGINS_PATH), need(FILES_PATH));
  if (next.filesRoot !== x.filesRoot || next.allowlistHash !== x.allowlistHash || next.originsHash !== x.originsHash) {
    return `<p class="bad"><b>This folder is not the build proposed as #${'' + x.filesRoot.slice(0, 0)}…</b> Its hashes differ from the proposal's on-chain values. Do not approve on the basis of this folder.</p>`;
  }
  const bad = next.files.filter((f) => !files.has(f.path) || sha256(files.get(f.path)!) !== f.sha256).map((f) => f.path);
  if (bad.length) return `<p class="bad">These files don't match the sealed list: ${bad.map(esc).join(', ')}</p>`;
  let base: (SealedLists & { release: string }) | null = null;
  let baseNote = 'first release: nothing to compare with';
  if (x.baseline !== 0n) {
    if (x.baseline !== BigInt(p.currentRelease)) baseNote = `the base release #${x.baseline} is not the current release, so its lists aren't in the container`;
    else {
      const r = await releaseLists(p);
      if (!r.sealed) throw new Error(`release #${x.baseline}: ${r.why}`);
      base = { ...(r.sealed as SealedLists), calls: r.sealed.calls ?? null, release: String(x.baseline) };
      baseNote = `release #${x.baseline}, read from the chain and hash-checked`;
    }
  }
  const text = new TextDecoder();
  const report = diffSealed(domain, base, { ...(next as SealedLists), calls: next.calls ?? null }, (path) => text.decode(files.get(path) ?? new Uint8Array()));
  const head = [`Checked in your browser: the folder hashes to the proposal's on-chain values, and all ${next.files.length} files match their sealed hashes.`, `Compared with: ${baseNote}.`];
  if (report.flags.length) head.push('', 'LOOK AT THESE FIRST', ...report.flags.map((f) => `  ! ${f}`));
  else head.push('', 'Nothing new that a wallet could be asked to sign, and no new place the site talks to.');
  const mismatch = base && report.tier.expected !== (x as unknown as { tier: number }).tier;
  return `<pre class="diff">${esc(formatDiff(report, head, mismatch ? ['  THE CHAIN COMPUTED A DIFFERENT TIER: do not approve, report this.'] : []))}</pre>`;
}
