// "Protect a site": create a project's gate from the browser, with the team's own wallet.
// 1. commit(commitmentOf(domain, salt, you)): hides the domain so the claim can't be copied from the mempool
// 2. two blocks later, createGate(approvers, CI proposer, recovery, guardian, [domain]): binds the domain
// Then it shows the exact next commands (/start). The salt stays in this browser until step 2.
import { isAddress, getAddress, zeroAddress, type Address, type Hex } from 'viem';
import { NET, FACTORY_ABI, one } from '../chain.ts';
import { registryAbi } from '@signet/extension/src/lib/abi.ts';
import { connect, sendTx, account } from '../wallet.ts';
import { createdGate } from '../created.ts';
import { esc, view, $, action } from '../ui.ts';

const FACTORY = ((NET as unknown as { factory?: string | null }).factory ?? undefined) as Address | undefined;
const REGISTRY = NET.registry as Address | null;
const KEY = (domain: string, who: string) => `signet:new:${domain}:${who.toLowerCase()}`;
const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

interface Form { domain: string; a: string; b: string; c: string; proposer: string; recovery: string; guardian: string }
interface Saved { form: Form; salt: Hex; committedAt: number }

function check(f: Form): string | null {
  if (!DOMAIN_RE.test(f.domain)) return 'The domain must be lowercase, like app.example.org (no https://, no path).';
  const roles: [string, string][] = [['Approver A', f.a], ['Approver B', f.b], ['Approver C', f.c], ['CI proposer', f.proposer], ['Recovery', f.recovery]];
  if (f.guardian) roles.push(['Guardian', f.guardian]);
  for (const [n, v] of roles) if (!isAddress(v) || BigInt(v) === 0n) return `${n}: "${v}" is not an address.`;
  const all = roles.map(([, v]) => getAddress(v));
  if (new Set(all).size !== all.length) return 'The 3 approvers, the CI proposer, the recovery address and the guardian must all be different.';
  return null;
}

export async function newPage(): Promise<void> {
  if (!FACTORY || !REGISTRY) {
    view('<h1>Protect a site</h1><p class="bad">Signet is not deployed on this network.</p>');
    return;
  }
  const field = (id: string, label: string, ph: string, hint = '') => `<label class="fld"><span class="label">${label}</span><input id="${id}" placeholder="${ph}" autocomplete="off" spellcheck="false">${hint ? `<small class="dim">${hint}</small>` : ''}</label>`;
  const v = view(`<a class="back" href="#/">← projects</a>
    <div class="kicker" style="margin-top:18px">Protect a site · ${esc(NET.name)} · chain ${NET.chainId}</div>
    <h1>Create your gate</h1>
    <p class="lead">Two transactions from your wallet (≈ 0.000013 OKB of gas at 0.02 gwei). After that, no single key can publish your site: the CI key only proposes, your approvers approve, and TapeOut circuit #6 decides when it goes live. Full guide: <a href="../start">/start</a>.</p>
    <div class="formgrid">
      ${field('f-domain', 'Domain', 'app.example.org', 'Exactly the host your users open. First come, first served: claim it before someone else does.')}
      ${field('f-a', 'Approver A', '0x…')}${field('f-b', 'Approver B', '0x…')}${field('f-c', 'Approver C', '0x…', 'Ideally three different people, each on their own device. A code-only release needs 1 approval; a new origin, contract or spender needs 2; admin changes need all 3.')}
      ${field('f-proposer', 'CI proposer', '0x…', 'From <code>signet keygen</code>. It can propose and publish, never approve.')}
      ${field('f-recovery', 'Recovery', '0x…', 'A key kept offline; it can replace lost approvers (3 of 3 + 24 h).')}
      ${field('f-guardian', 'Guardian (optional)', '0x… or empty', 'Can only freeze, e.g. your watchtower. Leave empty for none.')}
    </div>
    <div class="actions"><button id="connect">${account ? 'Wallet connected' : 'Connect wallet'}</button><button id="commit" class="primary">1. Reserve the domain</button><button id="create" disabled>2. Create the gate</button></div>
    <p id="st" class="mono dim"></p>
    <div id="next"></div>`);
  const ids = ['domain', 'a', 'b', 'c', 'proposer', 'recovery', 'guardian'] as const;
  const form = (): Form => Object.fromEntries(ids.map((k) => [k, ($(`#f-${k}`, v) as HTMLInputElement).value.trim()])) as unknown as Form;
  const fill = (f: Form) => ids.forEach((k) => (($(`#f-${k}`, v) as HTMLInputElement).value = f[k]));
  const st = $('#st', v);
  const createBtn = $('#create', v) as HTMLButtonElement;

  // a reservation already made in this browser (the page was reloaded between the two steps)
  const resume = async () => {
    const who = account ?? (await connect().catch(() => null));
    if (!who) return null;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith('signet:new:') && k.endsWith(who.toLowerCase())) {
        const s = JSON.parse(localStorage.getItem(k)!) as Saved;
        fill(s.form);
        return s;
      }
    }
    return null;
  };
  // read when first needed, so the buttons work the moment they are drawn
  let minBlocks: number | null = null;
  const minBlocksNow = async () => (minBlocks ??= Number(await one<bigint>(FACTORY, FACTORY_ABI, 'MIN_COMMIT_BLOCKS')));
  const blockNow = async () => Number(BigInt(await fetch(NET.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) }).then((r) => r.json()).then((j) => j.result)));
  let timer = 0;
  const watchReady = (s: Saved) => {
    clearInterval(timer);
    const tick = async () => {
      const left = s.committedAt + (await minBlocksNow()) - (await blockNow());
      createBtn.disabled = left > 0;
      st.textContent = left > 0 ? `Reserved. Step 2 opens in ${left} block(s)…` : `Reserved (block ${s.committedAt}). Step 2 is ready.`;
      if (left <= 0) clearInterval(timer);
    };
    void tick();
    timer = window.setInterval(() => void tick(), 1500);
  };

  action($('#connect', v) as HTMLButtonElement, async () => {
    const who = await connect();
    const s = await resume();
    if (s) watchReady(s);
    return `connected ${who.slice(0, 6)}…${who.slice(-4)}${s ? `; found your reservation of ${s.form.domain}` : ''}`;
  });

  action($('#commit', v) as HTMLButtonElement, async () => {
    const f = form();
    const bad = check(f);
    if (bad) throw new Error(bad);
    const who = await connect();
    const [bound] = await one<[Address, Address, string]>(REGISTRY, registryAbi as never, 'bindingOf', [f.domain]);
    if (bound !== zeroAddress) throw new Error(`${f.domain} is already bound to gate ${bound}.`);
    const salt = `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
    const commitment = await one<Hex>(FACTORY, FACTORY_ABI, 'commitmentOf', [f.domain, salt, who]);
    const { hash: tx, receipt } = await sendTx(FACTORY, 'commit', [commitment], false, FACTORY_ABI);
    const s: Saved = { form: f, salt, committedAt: parseInt(receipt.blockNumber, 16) }; // the commit's own block
    localStorage.setItem(KEY(f.domain, who), JSON.stringify(s));
    watchReady(s);
    return `reserved ${f.domain} (tx ${tx.slice(0, 10)}…). Keep this tab: step 2 needs this browser.`;
  });

  action(createBtn, async () => {
    const who = await connect();
    const f = form();
    const raw = localStorage.getItem(KEY(f.domain, who));
    if (!raw) throw new Error('No reservation for this domain from this wallet in this browser. Do step 1 first (same wallet).');
    const s = JSON.parse(raw) as Saved;
    const g = s.form;
    const { hash: tx, receipt } = await sendTx(FACTORY, 'createGate', [[getAddress(g.a), getAddress(g.b), getAddress(g.c)], getAddress(g.proposer), getAddress(g.recovery), g.guardian ? getAddress(g.guardian) : zeroAddress, [{ domain: g.domain, salt: s.salt, circuits: zeroAddress, tokenId: 0n }]], true, FACTORY_ABI);
    localStorage.removeItem(KEY(g.domain, who)); // mined: the reservation is used whatever the reads below say
    st.textContent = 'Gate created. Confirming the domain binding on both RPCs…';
    // the gate from the transaction's own GateCreated event, confirmed by the registry at a block no older than it
    const gate = await createdGate(NET, receipt, FACTORY, who, g.domain, tx);
    const origin = location.origin + location.pathname.replace(/\/app(\.html)?$/, '');
    $('#next', v).innerHTML = `<h2>Your gate</h2>
      <p><b class="ok">${esc(g.domain)}</b> is bound to gate <code>${esc(gate)}</code> (tx <code>${esc(tx.slice(0, 10))}…</code>). It starts in observe mode: Guard reports, never blocks, until you switch to enforce.</p>
      <h2>Next, in your project folder</h2>
      <pre>signet link ${esc(g.domain)} ${esc(gate)}
signet domain public        # writes public/.well-known/signet.json; deploy it with your site
signet domain --check       # after the deploy: the live domain names this gate</pre>
      <p>Then add the GitHub workflow and propose your first release: <a href="${esc(origin)}/start#ci">/start, step 4</a>.</p>
      <p><a class="btn" href="#/p/${esc(g.domain)}">Open ${esc(g.domain)}</a></p>`;
    st.textContent = '';
    return `gate ${gate} created`;
  });

  const s = account ? await resume() : null;
  if (s) watchReady(s);
}
