// A project: its release, roles and state; its proposals with approve / withdraw / cancel / publish; freeze,
// unfreeze and revoke. Every action goes through the connected wallet; the contract and the circuit decide.
import { project, status, span, TIERS, count, GATE_ABI, one, type Project } from '../chain.ts';
import { connect, send, account } from '../wallet.ts';
import { esc, short, view, $, action } from '../ui.ts';

let timer: number | undefined;

export async function projectPage(domain: string): Promise<void> {
  clearInterval(timer);
  view(`<p class="dim">reading ${esc(domain)} from the chain…</p>`);
  let p: Project | null;
  try {
    p = await project(domain);
  } catch (e) {
    view(`<h1>${esc(domain)}</h1><p class="bad">Could not read the chain: ${esc((e as Error).message)}</p>`);
    return;
  }
  if (!p) {
    view(`<h1>${esc(domain)}</h1><p>This domain is not sealed: the registry binds it to no gate.</p>`);
    return;
  }
  const s = p;
  const state = s.revoked ? '<span class="pill bad">release revoked</span>' : s.frozen ? '<span class="pill bad">FROZEN</span>' : '<span class="pill ok">active</span>';
  const mode = s.enforced ? '<span class="pill ok">enforce</span>' : '<span class="pill">observe</span>';
  const me = (a: string) => (account && a.toLowerCase() === account.toLowerCase() ? ' <b>(you)</b>' : '');
  const open = s.proposals.map((x) => ({ x, st: status(x, s) })).filter((r) => r.st.open);
  const done = s.proposals.map((x) => ({ x, st: status(x, s) })).filter((r) => !r.st.open).slice(0, 8);
  const row = ({ x, st }: (typeof open)[number]) => `<tr data-id="${x.id}"><td>#${x.id}</td><td>${x.kind === 1 ? 'release' : 'admin'}${x.emergency ? ', emergency' : ''}</td>
    <td>tier ${TIERS[x.tier]}</td><td>${[0, 1, 2].map((i) => `<span title="${esc(s.approvers[i])}">${(x.approvals >> i) & 1 ? '✓' : '·'}</span>`).join(' ')}</td>
    <td>${esc(st.text)} ${st.at && st.at > s.chainTime ? `<b class="cd" data-at="${st.at}">${span(st.at - s.chainTime)}</b>` : ''}</td>
    <td>${st.open ? `${x.kind === 1 ? `<a href="#/p/${esc(s.domain)}/proposal/${x.id}">Diff Guard</a> ` : ''}<button data-a="approve">Approve</button> <button data-a="withdrawApproval">Withdraw</button> <button data-a="cancel">Cancel</button> <button data-a="publish" ${st.publishable ? '' : 'disabled'}>Publish</button>` : ''}</td></tr>`;
  const v = view(`<p><a href="#/">← all projects</a></p>
    <h1>${esc(s.domain)} ${state} ${mode}</h1>
    <table class="kv">
      <tr><td>release</td><td>${s.currentRelease ? `#${s.currentRelease} · manifest <code>${esc(s.manifest)}</code>` : 'none published yet'}</td></tr>
      <tr><td>gate</td><td><code>${esc(s.gate)}</code></td></tr>
      <tr><td>files</td><td><code>${esc(s.container)}</code> / <code>${esc(s.prefix)}</code></td></tr>
      <tr><td>approvers</td><td>${s.approvers.map((a, i) => `${i + 1}. <code>${esc(a)}</code>${me(a)}`).join('<br>')}</td></tr>
      <tr><td>CI proposer</td><td><code>${esc(s.proposer)}</code> (can propose and publish; never approve)</td></tr>
      <tr><td>recovery · guardian</td><td><code>${esc(short(s.recovery))}</code> · <code>${esc(s.guardian === '0x0000000000000000000000000000000000000000' ? 'none' : short(s.guardian))}</code>${me(s.guardian)}</td></tr>
      <tr><td>timelocks</td><td>${span(s.shortDelay)} (tiers 00, 01) · ${span(s.longDelay)} (tiers 10, 11) · grace ${span(s.graceWindow)}</td></tr>
    </table>
    <p><button id="connect">${account ? `Wallet ${short(account)}` : 'Connect wallet'}</button>
      <button id="freeze" ${s.frozen ? 'disabled' : ''}>Freeze</button>
      <button id="unfreeze" ${s.frozen ? '' : 'disabled'}>Unfreeze (${count(s.unfreezeApprovals)} of 2)</button>
      <button id="revoke" ${s.currentRelease && !s.revoked ? '' : 'disabled'}>Revoke release #${s.currentRelease}</button>
      <a href="#/badge/${esc(s.domain)}">Badge</a></p>
    <h2>Open proposals</h2>${open.length ? `<table class="props"><tbody>${open.map(row).join('')}</tbody></table>` : '<p class="dim">none</p>'}
    <h2>Recent</h2>${done.length ? `<table class="props"><tbody>${done.map(row).join('')}</tbody></table>` : '<p class="dim">none</p>'}`);
  const reload = () => void projectPage(domain);
  action($('#connect', v) as HTMLButtonElement, async () => `connected ${short(await connect())}`, reload);
  action($('#freeze', v) as HTMLButtonElement, async () => `frozen (tx ${short(await send(s.gate, 'freeze'))})`, reload);
  action($('#revoke', v) as HTMLButtonElement, async () => `revoked (tx ${short(await send(s.gate, 'revoke', [BigInt(s.currentRelease)]))})`, reload);
  action($('#unfreeze', v) as HTMLButtonElement, async () => {
    const me = await connect();
    const slot = s.approvers.findIndex((a) => a.toLowerCase() === me.toLowerCase());
    // read the approvals now, not from when the page was drawn
    let approvals = Number(await one<number>(s.gate, GATE_ABI, 'unfreezeApprovals'));
    if (slot >= 0 && !((approvals >> slot) & 1)) {
      await send(s.gate, 'approveUnfreeze');
      approvals = Number(await one<number>(s.gate, GATE_ABI, 'unfreezeApprovals'));
    }
    if (count(approvals) < 2) return `unfreeze approved (${count(approvals)} of 2): one more approver needed`;
    return `unfrozen (tx ${short(await send(s.gate, 'unfreeze', [], true))})`;
  }, reload);
  for (const b of v.querySelectorAll<HTMLButtonElement>('table.props button')) {
    const id = BigInt(b.closest('tr')!.dataset.id!);
    const fn = b.dataset.a!;
    action(b, async () => `${fn === 'withdrawApproval' ? 'withdrawn' : fn === 'publish' ? 'published' : `${fn}d`} (tx ${short(await send(s.gate, fn, [id], fn === 'publish'))})`, reload);
  }
  // countdowns tick in the browser; the chain is re-read when one reaches zero
  const startedAt = Date.now();
  timer = window.setInterval(() => {
    for (const el of v.querySelectorAll<HTMLElement>('.cd')) {
      const left = Number(el.dataset.at) - (s.chainTime + (Date.now() - startedAt) / 1000);
      el.textContent = left > 0 ? span(left) : 'now';
      if (left <= 0) reload();
    }
  }, 1000);
  void GATE_ABI;
}
