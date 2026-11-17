// /prove: no wallet. Reads the chain from this browser and re-checks Signet's claims: both circuits against their
// published truth tables (all 512 inputs, through eval), the circuit beacon, and every sealed project's release
// (the manifest files in the container must hash to what its gate published).
import { keccak256, sha256, type Abi, type Address, type Hex } from 'viem';
import { NET, read, enc, dec, domains, project, releaseLists, releaseOf } from '../chain.ts';
import policy from '@signet/circuit/artifacts/policy.json';
import guard from '@signet/circuit/artifacts/guard.json';
import { esc, view, $ } from '../ui.ts';

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

type Row = { claim: string; status: 'PASS' | 'FAIL' | 'PENDING' | 'STALE' | '…'; detail: string };
class Stale extends Error {}

async function truthTable(id: number, art: { netlistSha256: string; expected: string; nIn: number; nOut: number; gates: number }): Promise<string> {
  const [info, nl] = await read([enc(T.processor, cpuAbi, 'circuitInfo', [BigInt(id)]), enc(T.processor, cpuAbi, 'netlist', [BigInt(id)])]);
  const [nIn, nOut, , gates] = dec<[number, number, number, number]>(cpuAbi, 'circuitInfo', info!);
  const stored = sha256(dec<Hex>(cpuAbi, 'netlist', nl!));
  if (stored !== art.netlistSha256) throw new Error(`stored netlist ${stored.slice(0, 12)}… is not the reviewed one`);
  if (nIn !== art.nIn || nOut !== art.nOut || gates !== art.gates) throw new Error(`circuitInfo (${nIn}, ${nOut}, ${gates})`);
  const want = art.expected.slice(2);
  let bad = 0;
  for (let n = 0; n < 512; n += 32) {
    const calls = Array.from({ length: 32 }, (_, k) => enc(T.processor, cpuAbi, 'eval', [BigInt(id), `0x${((n + k) & 0xff).toString(16).padStart(2, '0')}${((n + k) >> 8).toString(16).padStart(2, '0')}` as Hex]));
    const outs = await read(calls);
    outs.forEach((o, k) => {
      const b = dec<Hex>(cpuAbi, 'eval', o);
      if (b.slice(2) !== want.slice(2 * (n + k), 2 * (n + k) + 2)) bad++;
    });
  }
  if (bad) throw new Error(`${bad} of 512 rows differ from the truth table`);
  return `${gates} NAND gates, netlist sha256 ${stored.slice(0, 12)}…, all 512 rows equal the published truth table`;
}

export async function provePage(): Promise<void> {
  const rows: Row[] = [];
  const v = view(`<p><a href="#/">← dashboard</a></p><h1>Prove it</h1>
    <p>Everything below is read from the chain by <b>this browser</b> (${esc(NET.rpcUrl)}${NET.rpcUrl2 ? ` and ${esc(NET.rpcUrl2)}, which must agree` : ''}), with no wallet and no Signet server. Network: <b>${esc(NET.name)}</b>.</p>
    <table class="claims"><tbody id="rows"></tbody></table><p id="sum" class="dim">running…</p>`);
  const render = () => {
    $('#rows', v).innerHTML = rows.map((r) => `<tr><td class="st ${r.status}">${r.status}</td><td>${esc(r.claim)}<div class="dim">${esc(r.detail)}</div></td></tr>`).join('');
  };
  const check = async (claim: string, f: () => Promise<string | null>) => {
    const r: Row = { claim, status: '…', detail: '' };
    rows.push(r);
    render();
    try {
      const d = await f();
      Object.assign(r, d === null ? { status: 'PENDING', detail: 'not deployed on this network yet' } : { status: 'PASS', detail: d });
    } catch (e) {
      Object.assign(r, { status: e instanceof Stale ? 'STALE' : 'FAIL', detail: (e as Error).message.split('\n')[0] });
    }
    render();
  };
  await check(`The release policy is circuit #${T.policyCircuitId} on processor ${T.processor.slice(0, 8)}…, and it gives the published truth table on all 512 inputs`, () => truthTable(T.policyCircuitId, policy));
  await check('The Guard decision circuit gives its published truth table on all 512 inputs', async () => (T.guardCircuitId === undefined ? null : `circuit #${T.guardCircuitId}: ${await truthTable(T.guardCircuitId, guard)}`));
  await check("A taped-out circuit's behavior can't be upgraded (beacon owner 0x0, pinned implementation, pinned processor code)", async () => {
    const [o, i] = await read([enc(T.circuitBeacon, beaconAbi, 'owner'), enc(T.circuitBeacon, beaconAbi, 'implementation')]);
    const owner = dec<Address>(beaconAbi, 'owner', o!);
    const impl = dec<Address>(beaconAbi, 'implementation', i!);
    const code = await fetch(NET.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [T.processor, 'latest'] }) }).then((r) => r.json());
    const ch = keccak256(code.result as Hex);
    if (BigInt(owner) !== 0n || impl.toLowerCase() !== T.circuitImplementation.toLowerCase() || ch !== T.processorCodehash) throw new Error(`owner ${owner}, implementation ${impl}, code hash ${ch.slice(0, 12)}…`);
    return `owner 0x0, implementation ${impl.slice(0, 10)}…, processor code hash ${ch.slice(0, 12)}…`;
  });
  let names: string[] = [];
  await check("Signet's registry is deployed and lists its sealed domains", async () => {
    if (!NET.registry) return null;
    names = await domains();
    return `${names.length} domain(s) in the registry's list`;
  });
  for (const d of names.slice(-10).reverse()) {
    await check(`${d}: the release files stored on-chain hash to what its gate published`, async () => {
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
      return `release #${p.currentRelease}: filesRoot, allowlistHash and originsHash recomputed here, ${r.sealed.files.length} files listed, ${p.enforced ? 'enforce' : 'observe'} mode`;
    });
  }
  const fails = rows.filter((r) => r.status === 'FAIL').length;
  const stale = rows.filter((r) => r.status === 'STALE').length;
  $('#sum', v).textContent = fails ? `${fails} check(s) FAILED.` : `All checks passed (${rows.filter((r) => r.status === 'PENDING').length} pending deployment${stale ? `; ${stale} project(s) with a release whose files were not uploaded` : ''}).`;
}
