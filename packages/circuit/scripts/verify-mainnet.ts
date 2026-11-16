// Verifies the taped-out policy circuit on X Layer mainnet: one eth_call to eval() per input (all 512),
// at one pinned block, on two independent RPC operators, compared with artifacts/policy.json.
// Read-only. Usage: node scripts/verify-mainnet.ts <processor> <circuitId>
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [cpu, idArg] = process.argv.slice(2);
if (!cpu || !idArg) throw new Error('usage: verify-mainnet.ts <processor> <circuitId>');
const art = JSON.parse(readFileSync(fileURLToPath(new URL('../artifacts/policy.json', import.meta.url)), 'utf8'));
const expected = Buffer.from(art.expected.slice(2), 'hex');
const NODES = [
  { url: 'https://xlayerrpc.okx.com', batch: 10 },
  { url: 'https://xlayer.drpc.org', batch: 3 },
];

const word = (n: bigint) => n.toString(16).padStart(64, '0');
// eval(uint256,bytes) = 0x934d06ea; input n packed little-endian into 2 bytes (TAP-02 §5)
const evalData = (id: bigint, n: number) =>
  '0x934d06ea' + word(id) + word(64n) + word(2n) + ((n & 0xff).toString(16).padStart(2, '0') + (n >> 8).toString(16).padStart(2, '0')).padEnd(64, '0');

async function rpc(url: string, body: unknown): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) return r.json();
    if (attempt >= 4) throw new Error(`${url}: HTTP ${r.status}`);
    await new Promise((s) => setTimeout(s, 500 * 2 ** attempt));
  }
}

const id = BigInt(idArg);
const head = await rpc(NODES[0]!.url, { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] });
const block = head.result as string;
console.log(`processor ${cpu}, circuit ${id}, pinned block ${BigInt(block)} (${block})`);

let failures = 0;
for (const node of NODES) {
  const outs: number[] = new Array(512);
  for (let start = 0; start < 512; start += node.batch) {
    const reqs = [];
    for (let n = start; n < Math.min(512, start + node.batch); n++)
      reqs.push({ jsonrpc: '2.0', id: n, method: 'eth_call', params: [{ to: cpu, data: evalData(id, n) }, block] });
    const res: any[] = await rpc(node.url, reqs);
    for (const r of res) {
      if (r.error) throw new Error(`${node.url} input ${r.id}: ${JSON.stringify(r.error)}`);
      const hex = (r.result as string).slice(2);
      const len = Number(BigInt('0x' + hex.slice(64, 128)));
      if (len !== 1) throw new Error(`input ${r.id}: output length ${len}`);
      outs[r.id] = parseInt(hex.slice(128, 130), 16);
    }
  }
  const bad = outs.map((o, n) => (o === expected[n] ? -1 : n)).filter((n) => n >= 0);
  failures += bad.length;
  const publish = outs.filter((o) => o & 1).length;
  console.log(`${node.url}: ${512 - bad.length}/512 match, PUBLISH=1 on ${publish} rows${bad.length ? `, MISMATCH at ${bad.join(',')}` : ''}`);
}
console.log(failures === 0 ? 'ALL 512 ROWS VERIFIED ON MAINNET (both operators)' : `${failures} MISMATCHES`);
process.exit(failures === 0 ? 0 : 1);
