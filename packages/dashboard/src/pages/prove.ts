// /prove: no wallet. Reads the chain from this browser and re-checks Signet's claims: both circuits against their
// published truth tables (all 512 inputs, through eval), the circuit beacon, and every sealed project's release
// (the manifest files in the container must hash to what its gate published).
import { keccak256, sha256, type Abi, type Address, type Hex } from 'viem';
import { NET, read, head, enc, dec, domains, project, releaseLists, releaseOf, domainProof, PROOF_WORDS, watchtowerStatus, watchLine, MC_CHUNK, type WatchStatus } from '../chain.ts';
import policy from '@signet/circuit/artifacts/policy.json';
import guard from '@signet/circuit/artifacts/guard.json';
import { esc, view, $ } from '../ui.ts';
import { RpcRateLimited } from '@signet/extension/src/lib/rpc.ts';

const cpuAbi = [
  { type: 'function', name: 'circuitInfo', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint32' }, { type: 'uint32' }, { type: 'uint32' }, { type: 'uint32' }] },
  { type: 'function', name: 'netlist', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'bytes' }] },
  { type: 'function', name: 'eval', stateMutability: 'view', inputs: [{ type: 'uint256' }, { type: 'bytes' }], outputs: [{ type: 'bytes' }] },
] as const satisfies Abi;
const beaconAbi = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'implementation', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const satisfies Abi;
const T = NET.tapeout as { processor: Address; circuitBeacon: Address; circuitImplementation: Address; processorCodehash: Hex; guardCircuitId?: number; policyCircuitId: number };

type Row = { claim: string; status: 'PASS' | 'FAIL' | 'PENDING' | 'STALE' | 'UNCONFIRMED' | 'NOTRUN' | '…'; detail: string; src: string };
const LABEL: Record<Row['status'], string> = { PASS: 'Verified', FAIL: 'Failed', PENDING: 'Pending deployment', STALE: 'Stale', UNCONFIRMED: 'Not verified', NOTRUN: 'Not checked', '…': 'Checking' };
// OKX Explorer links only for addresses that exist on X Layer mainnet: TapeOut's (the same on staging, a mainnet fork),
// and Signet's own only when this build reads mainnet.
const EXPLORER = 'https://web3.okx.com/explorer/x-layer/evm/address/';
const onMainnet = NET.name === 'mainnet';
const addr = (a: string, name: string, mainnetAddress = true) => mainnetAddress || onMainnet
  ? `${name} <a href="${EXPLORER}${a}" target="_blank" rel="noopener">${a.slice(0, 8)}…${a.slice(-4)} ↗</a>`
  : `${name} <span title="${a}">${a.slice(0, 8)}…${a.slice(-4)}</span> (${esc(NET.name)} only)`;
const todo = (what: string) => `<span class="todo">TODO: ${esc(what)}</span>`;
const repoFile = (f: string) => `repo <code>${f}</code>`;
class Stale extends Error {}
class Unconfirmed extends Error {}

/// All 512 rows of a circuit's truth table, through the processor's `eval`, at one block: 4 Multicall3 calls of 128
/// rows, sent in parallel (one eth_call each per RPC), reporting progress as each comes back.
async function truthTable(id: number, art: { netlistSha256: string; expected: string; nIn: number; nOut: number; gates: number }, block: number, progress: (done: number) => void): Promise<string> {
  const [info, nl] = await read([enc(T.processor, cpuAbi, 'circuitInfo', [BigInt(id)]), enc(T.processor, cpuAbi, 'netlist', [BigInt(id)])], block);
  const [nIn, nOut, , gates] = dec<[number, number, number, number]>(cpuAbi, 'circuitInfo', info!);
  const stored = sha256(dec<Hex>(cpuAbi, 'netlist', nl!));
  if (stored !== art.netlistSha256) throw new Error(`stored netlist ${stored.slice(0, 12)}… is not the reviewed one`);
  if (nIn !== art.nIn || nOut !== art.nOut || gates !== art.gates) throw new Error(`circuitInfo (${nIn}, ${nOut}, ${gates})`);
  const want = art.expected.slice(2);
  const input = (n: number) => `0x${(n & 0xff).toString(16).padStart(2, '0')}${(n >> 8).toString(16).padStart(2, '0')}` as Hex;
  let bad = 0;
  let done = 0;
  await Promise.all(Array.from({ length: 512 / MC_CHUNK }, async (_, c) => {
    const first = c * MC_CHUNK;
    const outs = await read(Array.from({ length: MC_CHUNK }, (_, k) => enc(T.processor, cpuAbi, 'eval', [BigInt(id), input(first + k)])), block);
    outs.forEach((o, k) => {
      if (dec<Hex>(cpuAbi, 'eval', o).slice(2) !== want.slice(2 * (first + k), 2 * (first + k) + 2)) bad++;
    });
    done += MC_CHUNK;
    progress(done);
  }));
  if (bad) throw new Error(`${bad} of 512 rows differ from the truth table`);
  return `${gates} NAND gates, netlist sha256 ${stored.slice(0, 12)}…, all 512 rows equal the published truth table`;
}

const utc = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 120 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
/// The watchtower's last run of this same page (status.json's `prove`), shown at once, clearly dated, while this
/// browser's own check runs. It is the watchtower's word, not this browser's: the live rows below are what count.
function lastVerified(s: WatchStatus | null): string {
  const pr = s?.prove;
  if (!pr) return ''; // nothing to show until the watchtower has run this page once
  const n = (st: string) => pr.rows.filter((r) => r.status === st).length;
  const cls = n('FAIL') ? 'bad' : n('PASS') === pr.rows.filter((r) => r.status !== 'PENDING').length ? 'ok' : 'warnsum';
  return `<details class="lastrun"><summary class="summary ${cls}">Last verified by the watchtower at ${esc(utc(pr.checkedAt))} (${esc(ago(pr.checkedAt))}), block ${pr.block ? Number(pr.block).toLocaleString('en-US') : '?'}: ${esc(pr.summary)} <span class="dim">Show its rows</span></summary>
    <ul class="claims">${pr.rows.map((r) => `<li class="claim"><div><span class="st ${esc(r.status)}">${esc(LABEL[r.status as Row['status']] ?? r.status)}</span></div><div><div class="what">${esc(r.claim)}</div><div class="detail">${esc(r.detail)}</div></div><div class="src"></div></li>`).join('')}</ul></details>`;
}

export async function provePage(): Promise<void> {
  const rows: Row[] = [];
  const t0 = performance.now();
  const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };
  const v = view(`<a class="back" href="#/">← dashboard</a>
    <div class="kicker" style="margin-top:18px">Verification report · no wallet · no Signet server</div>
    <h1>Prove it</h1>
    <p class="lead">Every row below is checked by <b>this browser</b>, reading the chain directly. On-chain values are compared with the reviewed files in the Signet repository.</p>
    <div class="report-meta">
      <div><span class="label">Network</span><b>${esc(NET.name)} · chain ${NET.chainId}</b></div>
      <div><span class="label">Read at block</span><b id="blk">…</b></div>
      <div><span class="label">Node 1</span><b>${esc(host(NET.rpcUrl))}</b></div>
      <div><span class="label">Node 2 (must agree)</span><b>${NET.rpcUrl2 ? esc(host(NET.rpcUrl2)) : 'none'}</b></div>
    </div>
    <div id="last"></div>
    <p id="watch" class="summary dim">Watchtower: …</p>
    <h2>Claims, checked now by this browser</h2>
    <ul class="claims" id="rows"></ul><p id="sum" class="summary">running…</p>`);
  void watchtowerStatus().then((s) => {
    const w = watchLine(s);
    $('#watch', v).className = `summary ${w.cls}`;
    $('#watch', v).textContent = w.text;
    $('#last', v).innerHTML = lastVerified(s);
  });
  const render = () => {
    $('#rows', v).innerHTML = rows.map((r) => `<li class="claim"><div><span class="st ${r.status}">${LABEL[r.status]}</span></div><div><div class="what">${esc(r.claim)}</div><div class="detail">${esc(r.detail)}</div></div><div class="src">${r.src}</div></li>`).join('');
  };
  // Every row is added (in order) at once and runs in parallel; each fills in when its reads come back.
  const check = (claim: string, src: string, f: (r: Row) => Promise<string | null>): Promise<void> => {
    const r: Row = { claim, status: '…', detail: '', src };
    rows.push(r);
    render();
    return (async () => {
      try {
        const d = await f(r);
        Object.assign(r, d === null ? { status: 'PENDING', detail: 'not deployed on this network yet' } : { status: 'PASS', detail: d });
      } catch (e) {
        // a public RPC that is still rate-limiting after the retries says nothing about the claim: "not checked", never "failed"
        if (e instanceof RpcRateLimited) Object.assign(r, { status: 'NOTRUN', detail: `${(e as Error).message}: not checked. Reload this page in a minute.` });
        else Object.assign(r, { status: e instanceof Stale ? 'STALE' : e instanceof Unconfirmed ? 'UNCONFIRMED' : 'FAIL', detail: (e as Error).message.split('\n')[0] });
      }
      render();
    })();
  };
  const progress = (r: Row) => (done: number) => { if (r.status === '…') { r.detail = `row ${done}/512`; render(); } };
  // the chain facts are read at one block, the newest both RPCs have
  let block: number;
  try {
    block = await head();
    $('#blk', v).textContent = block.toLocaleString('en-US');
  } catch (e) {
    $('#blk', v).textContent = 'unknown';
    $('#sum', v).className = 'summary warn';
    $('#sum', v).textContent = `Couldn't read the chain's latest block (${(e as Error).message.split('\n')[0]}). Nothing was checked; reload in a minute.`;
    return;
  }
  const chainSrc = 'on-chain, read at the block above';
  const all: Promise<void>[] = [];
  all.push(check(`The release policy is circuit #${T.policyCircuitId} on processor ${T.processor.slice(0, 8)}…, and it gives the published truth table on all 512 inputs`,
    `${chainSrc}<br>${addr(T.processor, 'processor')}<br>compared with ${repoFile('packages/circuit/artifacts/policy.json')}`, (r) => truthTable(T.policyCircuitId, policy, block, progress(r))));
  all.push(check('The Guard decision circuit gives its published truth table on all 512 inputs',
    `${T.guardCircuitId === undefined ? `${todo('Guard circuit id on mainnet (after tape-out)')}<br>` : `${chainSrc}<br>circuit #${T.guardCircuitId} on ${addr(T.processor, 'processor')}<br>`}compared with ${repoFile('packages/circuit/artifacts/guard.json')}`, async (r) => (T.guardCircuitId === undefined ? null : `circuit #${T.guardCircuitId}: ${await truthTable(T.guardCircuitId, guard, block, progress(r))}`)));
  all.push(check("A taped-out circuit's behavior can't be upgraded (beacon owner 0x0, pinned implementation, pinned processor code)",
    `${chainSrc}<br>${addr(T.circuitBeacon, 'beacon')}<br>${addr(T.circuitImplementation, 'implementation')}<br>pinned in ${repoFile(`packages/contracts/deployments/${NET.name}.json`)}`, async () => {
    const [o, i] = await read([enc(T.circuitBeacon, beaconAbi, 'owner'), enc(T.circuitBeacon, beaconAbi, 'implementation')], block);
    const owner = dec<Address>(beaconAbi, 'owner', o!);
    const impl = dec<Address>(beaconAbi, 'implementation', i!);
    const code = await fetch(NET.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [T.processor, `0x${block.toString(16)}`] }) }).then((r) => r.json());
    const ch = keccak256(code.result as Hex);
    if (BigInt(owner) !== 0n || impl.toLowerCase() !== T.circuitImplementation.toLowerCase() || ch !== T.processorCodehash) throw new Error(`owner ${owner}, implementation ${impl}, code hash ${ch.slice(0, 12)}…`);
    return `owner 0x0, implementation ${impl.slice(0, 10)}…, processor code hash ${ch.slice(0, 12)}…`;
  }));
  let names: string[] = [];
  const projects = check("Signet's registry is deployed and lists its sealed domains",
    NET.registry ? `${chainSrc}<br>${addr(NET.registry, 'registry', false)}${onMainnet ? '' : `<br>mainnet: ${todo('SignetRegistry address (after deploy)')}`}` : todo('SignetRegistry mainnet address (after deploy)'), async () => {
    if (!NET.registry) return null;
    names = await domains();
    return `${names.length} domain(s) in the registry's list`;
  }).then(() => Promise.all(names.slice(-10).reverse().map((d) => check(`${d}: the release files stored on-chain hash to what its gate published`,
    `${chainSrc}<br>files from the TapeOut container (${addr(NET.siteRegistry as string, 'SiteRegistry')})<br>hashes recomputed in this browser`, async () => {
      const p = await project(d);
      if (!p) return 'no longer bound (unbound or moved)';
      if (!p.currentRelease) return 'no release published yet';
      if (p.revoked) return `release #${p.currentRelease} is revoked`;
      const r = await releaseLists(p);
      if (!r.sealed && r.stored) {
        const old = await releaseOf(p, r.stored);
        if (old !== null) throw new Stale(`the container still holds release #${old}'s files: release #${p.currentRelease}'s were never uploaded (Guard shows this site as "could not check")`);
      }
      if (!r.sealed) throw new Error(`${r.why}, and they match no earlier release of this gate either`);
      const proof = await domainProof(d, p.gate);
      if (proof !== 'confirmed') throw new Unconfirmed(PROOF_WORDS[proof]);
      return `release #${p.currentRelease}: filesRoot, allowlistHash and originsHash recomputed here, ${r.sealed.files.length} files listed, ${p.enforced ? 'enforce' : 'observe'} mode`;
    }))));
  all.push(projects.then(() => undefined));
  await Promise.all(all);
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  const fails = rows.filter((r) => r.status === 'FAIL').length;
  const stale = rows.filter((r) => r.status === 'STALE').length;
  const unconfirmed = rows.filter((r) => r.status === 'UNCONFIRMED').length;
  const notRun = rows.filter((r) => r.status === 'NOTRUN').length;
  $('#sum', v).className = `summary ${fails ? 'bad' : notRun ? 'warn' : 'ok'}`;
  $('#sum', v).textContent = (fails ? `${fails} check(s) FAILED.` : notRun ? `${notRun} check(s) not run: a public RPC is rate-limiting this browser. Nothing failed; reload in a minute.` : `All checks passed (${rows.filter((r) => r.status === 'PENDING').length} pending deployment${stale ? `; ${stale} project(s) with a release whose files were not uploaded` : ''}${unconfirmed ? `; ${unconfirmed} project(s) not verified by their domain` : ''}).`) + ` Checked in ${secs} s.`;
  v.dataset.proveDone = String(block);
}
