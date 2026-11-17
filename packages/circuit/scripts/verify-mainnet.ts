// Verifies a taped-out Signet circuit on X Layer mainnet: one eth_call to eval() per input (all 512), at one
// pinned block, on two independent RPC operators, compared with the reviewed artifact.
// Read-only. Usage: node scripts/verify-mainnet.ts <processor> <circuitId> [policy|guard]
//   SIGNET_VERIFY_RPCS=url1,url2 checks another chain instead (the staging fork, for example).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [cpu, idArg, which = 'policy'] = process.argv.slice(2);
if (!cpu || !idArg || !['policy', 'guard'].includes(which)) throw new Error('usage: verify-mainnet.ts <processor> <circuitId> [policy|guard]');
const art = JSON.parse(readFileSync(fileURLToPath(new URL(`../artifacts/${which}.json`, import.meta.url)), 'utf8'));
const expected = Buffer.from(art.expected.slice(2), 'hex');
const NODES = process.env.SIGNET_VERIFY_RPCS
  ? process.env.SIGNET_VERIFY_RPCS.split(',').map((url) => ({ url, batch: 16 }))
  : [
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
console.log(`${art.name}: processor ${cpu}, circuit ${id}, pinned block ${BigInt(block)} (${block})`);
// the stored netlist must be the reviewed one
const nl = await rpc(NODES[0]!.url, { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: cpu, data: '0x3fc4be56' + word(id) }, block] }); // netlist(uint256), docs/tapeout-interfaces.md §2
const storedHex = '0x' + (nl.result as string).slice(130, 130 + 2 * Number(BigInt('0x' + (nl.result as string).slice(66, 130)))); // abi: offset, length, bytes
const { createHash } = await import('node:crypto');
const storedSha = '0x' + createHash('sha256').update(Buffer.from(storedHex.slice(2), 'hex')).digest('hex');
console.log(`stored netlist sha256 ${storedSha} ${storedSha === art.netlistSha256 ? '= the reviewed artifact' : 'DIFFERS FROM THE REVIEWED ARTIFACT'}`);
if (storedSha !== art.netlistSha256) process.exit(1);

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
  const first = outs.filter((o) => o & 1).length;
  console.log(`${node.url}: ${512 - bad.length}/512 match, ${art.outputs[0]}=1 on ${first} rows${bad.length ? `, MISMATCH at ${bad.join(',')}` : ''}`);
}
console.log(failures === 0 ? `ALL 512 ROWS VERIFIED (${NODES.length} operator${NODES.length > 1 ? 's' : ''})` : `${failures} MISMATCHES`);
process.exit(failures === 0 ? 0 : 1);
