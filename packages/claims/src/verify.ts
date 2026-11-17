// pnpm verify:claims: checks the claims in CLAIMS.md.
//   mainnet  read-only calls to X Layer mainnet on two independent RPC operators, which must agree
//   repo     facts recomputed from the committed artifacts, and the tests a claim cites exist (run them with pnpm test)
//   pending  a claim about something not deployed yet: shown as PENDING, never as passed
// Sends no transaction and needs no key. Exit code 1 if any check fails.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, keccak256, parseAbi, type Address, type Hex, type PublicClient } from 'viem';
import { artifact, guardArtifact } from '@signet/circuit/scripts/artifact.ts';
import { policy, inputsOf } from '@signet/circuit/src/reference.ts';
import { guardInputsOf } from '@signet/circuit/src/guard-reference.ts';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const read = (p: string) => readFileSync(`${ROOT}${p}`, 'utf8');
const json = (p: string) => JSON.parse(read(p));
const RPCS = (process.env.SIGNET_CLAIMS_RPCS ?? 'https://xlayerrpc.okx.com,https://xlayer.drpc.org').split(',');
const clients = RPCS.map((url) => createPublicClient({ transport: http(url, { retryCount: 6, retryDelay: 800, batch: { batchSize: url.includes('drpc') ? 3 : 10 } }) }) as PublicClient);

const net = json('packages/contracts/deployments/mainnet.json');
const dep6 = json('packages/circuit/artifacts/deployment.json');
const CPU = net.tapeout.processor as Address;
const sha = (hex: Hex) => `0x${createHash('sha256').update(Buffer.from(hex.slice(2), 'hex')).digest('hex')}`;
const cpuAbi = parseAbi([
  'function circuitInfo(uint256) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)',
  'function netlist(uint256) view returns (bytes)', 'function eval(uint256, bytes) view returns (bytes)', 'function ownerOf(uint256) view returns (address)',
]);
const beaconAbi = parseAbi(['function owner() view returns (address)', 'function implementation() view returns (address)']);
const siteAbi = parseAbi(['function read(address, string) view returns (bytes)', 'function fileInfo(address, string) view returns (uint32, string, bytes32, uint40, uint256)']);
const openerAbi = parseAbi(['function accountOf(address, uint256) view returns (address)', 'function isOpened(address, uint256) view returns (bool)']);
const probeAbi = parseAbi(['function lastOut() view returns (bool)', 'function cpu() view returns (address)', 'function circuitId() view returns (uint256)']);

type Result = { status: 'PASS' | 'FAIL' | 'PENDING'; detail: string };
interface Claim { id: string; kind: 'mainnet' | 'repo' | 'pending'; text: string; check: (block: bigint) => Promise<Result> }
const pass = (detail: string): Result => ({ status: 'PASS', detail });
const fail = (detail: string): Result => ({ status: 'FAIL', detail });
const pending = (detail: string): Result => ({ status: 'PENDING', detail });

/// The same read on every RPC at the same block; the answers must be identical.
async function both<T>(f: (c: PublicClient) => Promise<T>): Promise<T> {
  const r = await Promise.all(clients.map(f));
  // canonical form: bigints as strings, object keys sorted (operators return the same receipt in different key orders)
  const canon = (v: unknown): unknown =>
    typeof v === 'bigint' ? v.toString() : Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  const s = (x: unknown) => JSON.stringify(canon(x));
  if (r.some((x) => s(x) !== s(r[0]))) throw new Error(`the RPCs disagree: ${r.map(s).join(' vs ')}`);
  return r[0]!;
}
const call = <T>(block: bigint, address: Address, abi: readonly unknown[], functionName: string, args: unknown[] = []) =>
  both((c) => c.readContract({ address, abi, functionName, args, blockNumber: block } as never) as Promise<T>);

async function all512(block: bigint, id: bigint, expectedHex: string): Promise<Result> {
  const expected = Buffer.from(expectedHex.slice(2), 'hex');
  const packed = (n: number) => `0x${(n & 0xff).toString(16).padStart(2, '0')}${(n >> 8).toString(16).padStart(2, '0')}` as Hex;
  const per = await Promise.all(clients.map(async (c, i) => {
    // a few calls at a time: public RPCs rate-limit bursts
    const width = RPCS[i]!.includes('drpc') ? 3 : 10;
    const outs: Hex[] = [];
    for (let n = 0; n < 512; n += width) {
      const chunk = Array.from({ length: Math.min(width, 512 - n) }, (_, k) => c.readContract({ address: CPU, abi: cpuAbi, functionName: 'eval', args: [id, packed(n + k)], blockNumber: block }));
      outs.push(...(await Promise.all(chunk)));
    }
    return outs.filter((o, n) => o.length !== 4 || parseInt(o.slice(2), 16) !== expected[n]).length;
  }));
  return per.every((x) => x === 0) ? pass(`512/512 rows equal the reviewed truth table on ${clients.length} RPC operators`) : fail(`mismatching rows per operator: ${per.join(', ')}`);
}

const testExists = (file: string, name: string) => read(file).includes(name);

const CLAIMS: Claim[] = [
  {
    id: 'C1', kind: 'mainnet', text: 'The release policy is TapeOut circuit #6 on processor #101 (X Layer mainnet): 9 inputs, 2 outputs, 34 NAND gates, no state',
    check: async (b) => {
      const [nIn, nOut, nState, g] = await call<[number, number, number, number]>(b, CPU, cpuAbi, 'circuitInfo', [6n]);
      return nIn === 9 && nOut === 2 && nState === 0 && g === 34 ? pass(`circuitInfo(6) = (${nIn}, ${nOut}, ${nState}, ${g})`) : fail(`circuitInfo(6) = (${nIn}, ${nOut}, ${nState}, ${g})`);
    },
  },
  {
    id: 'C2', kind: 'mainnet', text: "Circuit #6's stored netlist is the reviewed one in packages/circuit/artifacts/policy.json",
    check: async (b) => {
      const h = sha(await call<Hex>(b, CPU, cpuAbi, 'netlist', [6n]));
      return h === artifact().netlistSha256 ? pass(`sha256 ${h}`) : fail(`stored ${h}, reviewed ${artifact().netlistSha256}`);
    },
  },
  { id: 'C3', kind: 'mainnet', text: 'Circuit #6 gives the published truth table (docs/policy-truth-table.md) on all 512 inputs', check: (b) => all512(b, 6n, artifact().expected) },
  {
    id: 'C4', kind: 'mainnet', text: `Circuit #6 was minted and taped out by the dev wallet in transactions ${dep6.mintTx.slice(0, 10)}… and ${dep6.tapeoutTx.slice(0, 10)}…, and the dev wallet still holds it`,
    check: async (b) => {
      const [m, t] = await Promise.all([dep6.mintTx, dep6.tapeoutTx].map((h: Hex) => both((c) => c.getTransactionReceipt({ hash: h }))));
      const owner = await call<Address>(b, CPU, cpuAbi, 'ownerOf', [6n]);
      const ok = m!.status === 'success' && t!.status === 'success' && t!.to?.toLowerCase() === CPU.toLowerCase() && Number(t!.blockNumber) === dep6.tapeoutBlock && owner.toLowerCase() === dep6.holder.toLowerCase();
      return ok ? pass(`both succeeded; tape-out in block ${t!.blockNumber}; ownerOf(6) = ${owner}`) : fail(`mint ${m!.status}, tape-out ${t!.status} to ${t!.to} block ${t!.blockNumber}, owner ${owner}`);
    },
  },
  {
    id: 'C5', kind: 'mainnet', text: "A taped-out circuit's behavior can't be upgraded through its beacon: the circuit beacon's owner is 0x0, it points at the implementation Signet pins, and the processor's code is the pinned proxy (TapeOut's source is not verified; this is what can be checked on-chain)",
    check: async (b) => {
      const owner = await call<Address>(b, net.tapeout.circuitBeacon, beaconAbi, 'owner');
      const impl = await call<Address>(b, net.tapeout.circuitBeacon, beaconAbi, 'implementation');
      const code = await both((c) => c.getCode({ address: CPU, blockNumber: b }));
      const codehash = keccak256(code!);
      const ok = BigInt(owner) === 0n && impl.toLowerCase() === net.tapeout.circuitImplementation.toLowerCase() && codehash === net.tapeout.processorCodehash;
      return ok ? pass(`owner 0x0, implementation ${impl}, processor codehash ${codehash.slice(0, 10)}…`) : fail(`owner ${owner}, implementation ${impl}, codehash ${codehash}`);
    },
  },
  {
    id: 'C6', kind: 'mainnet', text: "Signet's container is circuit #5's container on processor #101, opened on mainnet, and a file stored in it reads back with the recorded SHA-256 (Spike B)",
    check: async (b) => {
      const container = await call<Address>(b, net.tapeout.containerOpener, openerAbi, 'accountOf', [CPU, 5n]);
      const opened = await call<boolean>(b, net.tapeout.containerOpener, openerAbi, 'isOpened', [CPU, 5n]);
      const bytes = await call<Hex>(b, net.tapeout.siteRegistry, siteAbi, 'read', [container, 'signet/manifest-sample.json']);
      const info = await call<[number, string, Hex, number, bigint]>(b, net.tapeout.siteRegistry, siteAbi, 'fileInfo', [container, 'signet/manifest-sample.json']);
      const local = `0x${createHash('sha256').update(readFileSync(`${ROOT}packages/contracts/spike-data/manifest-sample.json`)).digest('hex')}`;
      const ok = container.toLowerCase() === net.tapeout.sharedContainer.toLowerCase() && opened && sha(bytes) === info[2] && info[2] === local;
      return ok ? pass(`${container}, opened; 422-byte file sha256 ${local.slice(0, 10)}… = fileInfo = the repo copy`) : fail(`container ${container} opened ${opened}; read ${sha(bytes)}, fileInfo ${info[2]}, repo ${local}`);
    },
  },
  {
    id: 'C7', kind: 'mainnet', text: 'A contract can read a TapeOut circuit\'s output inside a transaction (Spike A: probe 0xD127…B7E got AND(1,1) = 1 from circuit #5)',
    check: async (b) => {
      const probe = '0xD12717Fd5604798f66a62554d5AcBB535677DB7E' as Address;
      const [out, cpu, id] = await Promise.all([call<boolean>(b, probe, probeAbi, 'lastOut'), call<Address>(b, probe, probeAbi, 'cpu'), call<bigint>(b, probe, probeAbi, 'circuitId')]);
      const tx = await both((c) => c.getTransactionReceipt({ hash: '0xaa5aae2f2b6f7bf8a6661867a5281fd089dd14406a39b0950f0110cf60c493ad' }));
      return out && cpu.toLowerCase() === CPU.toLowerCase() && id === 5n && tx.status === 'success' ? pass(`lastOut() = true, set by transaction 0xaa5aae2f… (block ${tx.blockNumber})`) : fail(`lastOut ${out}, cpu ${cpu}, id ${id}, tx ${tx.status}`);
    },
  },
  {
    id: 'C8', kind: 'pending', text: "Signet's contracts are on mainnet: SignetRegistry (with its enumerable domain list), SignetFactory, the ReleaseGate implementation and Signet's own site gate",
    check: async (b) => {
      const c = net.contracts ?? {};
      if (!c.registry || !c.factory) return pending('not deployed yet: docs/mainnet-plan.md, waiting for a yes');
      const reg = parseAbi(['function factory() view returns (address)', 'function signetSiteGate() view returns (address)', 'function domainCount() view returns (uint256)']);
      const [f, site, n] = await Promise.all([call<Address>(b, c.registry, reg, 'factory'), call<Address>(b, c.registry, reg, 'signetSiteGate'), call<bigint>(b, c.registry, reg, 'domainCount')]);
      const code = await both((x) => x.getCode({ address: site, blockNumber: b }));
      return f.toLowerCase() === c.factory.toLowerCase() && !!code && code !== '0x' ? pass(`registry ${c.registry}, factory ${f}, site gate ${site}, ${n} domain(s)`) : fail(`registry.factory() = ${f}, site gate code ${code?.length}`);
    },
  },
  {
    id: 'C9', kind: 'pending', text: 'The Guard decision circuit is on mainnet and gives the published truth table (docs/guard-truth-table.md) on all 512 inputs',
    check: async (b) => {
      const id = net.tapeout.guardCircuitId;
      if (id === undefined) return pending('not taped out on mainnet yet: docs/mainnet-plan.md B (taped out and checked 512/512 on staging)');
      const h = sha(await call<Hex>(b, CPU, cpuAbi, 'netlist', [BigInt(id)]));
      if (h !== guardArtifact().netlistSha256) return fail(`circuit ${id} netlist ${h} is not the reviewed one`);
      return all512(b, BigInt(id), guardArtifact().expected);
    },
  },
  {
    id: 'R1', kind: 'repo', text: 'Every release needs at least one human approval: no row of the policy circuit publishes without an approval',
    check: async () => {
      const bad = Array.from({ length: 512 }, (_, n) => inputsOf(n)).filter((x) => !x.a0 && !x.a1 && !x.a2 && policy(x).PUBLISH);
      const e = Buffer.from(artifact().expected.slice(2), 'hex');
      const badArt = Array.from({ length: 512 }, (_, n) => n).filter((n) => (n & 7) === 0 && (e[n]! & 1) === 1);
      return bad.length + badArt.length === 0 ? pass('0 of the 64 rows with no approval have PUBLISH = 1 (and C3 shows mainnet gives the same table)') : fail(`${bad.length + badArt.length} rows publish with no approval`);
    },
  },
  {
    id: 'R2', kind: 'repo', text: 'The Guard decision circuit never blocks in observe mode or when Guard cannot check the release (fail-open)',
    check: async () => {
      const e = Buffer.from(guardArtifact().expected.slice(2), 'hex');
      const bad = Array.from({ length: 512 }, (_, n) => n).filter((n) => { const x = guardInputsOf(n); return (!x.enforceMode || !x.checked) && (e[n]! & 4) === 4; });
      return bad.length === 0 ? pass('0 of the 384 such rows are BLOCK') : fail(`${bad.length} rows block`);
    },
  },
  {
    id: 'R3', kind: 'repo', text: 'The committed circuit artifacts are exactly what the netlist builders produce (no hand edits)',
    check: async () => {
      const ok = JSON.stringify(json('packages/circuit/artifacts/policy.json')) === JSON.stringify(artifact()) && JSON.stringify(json('packages/circuit/artifacts/guard.json')) === JSON.stringify(guardArtifact());
      return ok ? pass('policy.json and guard.json rebuilt and equal') : fail('an artifact differs from its builder');
    },
  },
  {
    id: 'R4', kind: 'repo', text: 'The risk tier is computed on-chain from the hashes, so CI cannot propose a changed allowlist at a lower tier',
    check: async () => (['test_tier_codeOnly_00', 'test_tier_newOrigin_01', 'test_tier_newContract_10', 'test_tier_admin_11', 'test_H1_ciCannotShipNewAllowlistAtALowerTier'].every((t) => testExists('packages/contracts/test/ReleaseGate.t.sol', t)) ? pass('5 Foundry tests in packages/contracts/test/ReleaseGate.t.sol (run: pnpm --filter @signet/contracts test)') : fail('a cited test is missing')),
  },
  {
    id: 'R5', kind: 'repo', text: 'The CI key can propose and call publish, but can never approve, cancel, revoke, freeze, unfreeze, switch modes or propose admin changes',
    check: async () => (['test_threat7_proposerCanOnlyPropose', 'test_row11_proposerKeyCannotProposeAdmin', 'test_unfreeze_guardianAndProposerCannotApprove', 'test_freeze_anyOneApproverOrGuardian_notProposerOrStranger'].every((t) => testExists('packages/contracts/test/ReleaseGate.t.sol', t)) ? pass('4 Foundry tests') : fail('a cited test is missing')),
  },
  {
    id: 'R6', kind: 'repo', text: 'On staging, all 12 attacks against Guard users are blocked, with 0 false blocks on 16 clean sessions; a user without Guard is not protected (a stated limit, not counted as an attack Guard defends against)',
    check: async () => {
      if (!existsSync(`${ROOT}docs/attack-report.md`)) return fail('docs/attack-report.md missing');
      const text = read('docs/attack-report.md');
      const m = text.match(/Blocked (\d+)\/(\d+) attacks against Guard users; false blocks: (\d+) on (\d+) clean sessions/);
      const limit = /no-extension not protected/.test(text);
      return m && m[1] === '12' && m[2] === '12' && m[3] === '0' && m[4] === '16' && limit ? pass(`docs/attack-report.md: ${m[0]} The user without Guard: not protected, as stated. (reproduce: pnpm staging:up && pnpm attacks)`) : fail(`report says: ${m?.[0] ?? 'nothing'}${limit ? '' : '; the no-extension limit is not reported'}`);
    },
  },
  {
    id: 'R9', kind: 'repo', text: 'Against the same attacks on staging, SRI alone blocks 2 of 12, a hash-only checker 7 of 12, and Signet 12 of 12, with 0 false blocks',
    check: async () => {
      if (!existsSync(`${ROOT}docs/benchmark.md`)) return fail('docs/benchmark.md missing');
      const m = read('docs/benchmark.md').match(/SRI alone blocked (\d+), a hash-only checker blocked (\d+), and Signet blocked (\d+), with (\d+) false blocks/);
      return m && m[1] === '2' && m[2] === '7' && m[3] === '12' && m[4] === '0' ? pass(`docs/benchmark.md (reproduce: pnpm staging:up && pnpm benchmark)`) : fail(`benchmark says: ${m?.[0] ?? 'nothing'}`);
    },
  },
  {
    id: 'R10', kind: 'repo', text: 'A real-size bundle (300 KB) can be stored on-chain as the verified copy, one proved 24 KB piece per transaction, each under 16.7M gas',
    check: async () => {
      if (!existsSync(`${ROOT}docs/demo/chunked-upload.json`)) return fail('docs/demo/chunked-upload.json missing');
      const r = json('docs/demo/chunked-upload.json') as { bytes: number; chunks: number; totalGas: number; maxChunkGas: number };
      return r.bytes === 307200 && r.chunks === 13 && r.maxChunkGas < 16_777_216 ? pass(`${r.chunks} transactions, ${r.totalGas.toLocaleString('en-US')} gas in total, at most ${r.maxChunkGas.toLocaleString('en-US')} per transaction (reproduce: packages/gateway/test/staging/chunked.test.ts)`) : fail(JSON.stringify(r));
    },
  },
  {
    id: 'R7', kind: 'repo', text: 'Guard makes no network request on a domain that is not sealed',
    check: async () => (testExists('packages/extension/test/staging/guard.test.ts', 'privacy: on a domain that is not sealed Guard makes no network call') ? pass('staging test in packages/extension/test/staging/guard.test.ts (counts RPC and site requests)') : fail('test missing')),
  },
  {
    id: 'R8', kind: 'repo', text: 'Diff Guard flags a poisoned npm package (new address, new origin, new approve/transferFrom calls) and the chain makes it tier 10',
    check: async () => {
      const t = existsSync(`${ROOT}docs/demo/diff-guard-poisoned.txt`) ? read('docs/demo/diff-guard-poisoned.txt') : '';
      return /RISK TIER 10/.test(t) && /NEW contract 0xBAD0/.test(t) && /NEW external origin/.test(t) && /NEW ERC-20 approve/.test(t) ? pass('docs/demo/diff-guard-poisoned.txt (from the staging e2e test)') : fail('the saved output does not show it');
    },
  },
];

const args = process.argv.slice(2);
const writeJson = args.includes('--write-json');
const only = args.filter((a) => !a.startsWith('--'));
const blockOf = await Promise.all(clients.map((c) => c.getBlockNumber()));
const block = blockOf.reduce((a, b) => (a < b ? a : b));
console.log(`Signet claims, checked against X Layer mainnet at block ${block} on ${RPCS.join(' and ')} (read-only)\n`);
let failed = 0;
const results: { id: string; kind: string; claim: string; status: string; detail: string }[] = [];
for (const c of CLAIMS.filter((x) => only.length === 0 || only.includes(x.id))) {
  let r: Result;
  try {
    r = await c.check(block);
  } catch (e) {
    r = fail(`error: ${(e as Error).message.split('\n')[0]}`);
  }
  if (r.status === 'FAIL') failed++;
  results.push({ id: c.id, kind: c.kind, claim: c.text, status: r.status, detail: r.detail });
  console.log(`${r.status.padEnd(7)} ${c.id} [${c.kind}] ${c.text}\n        ${r.detail}`);
}
// every claim id must also be in CLAIMS.md
const md = read('CLAIMS.md');
const missing = CLAIMS.filter((c) => !md.includes(`| ${c.id} |`)).map((c) => c.id);
if (missing.length) {
  failed++;
  console.log(`FAIL    CLAIMS.md does not list ${missing.join(', ')}`);
}
const counts = (s: string) => CLAIMS.filter((c) => c.kind === s).length;
console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} FAILED`} (${counts('mainnet')} on mainnet, ${counts('repo')} from the repo, ${counts('pending')} pending deployment)`);
if (writeJson) {
  // claims.json at the repo root: the same claims, their kind, and the result of this run (CLAIMS.md has the evidence)
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${ROOT}claims.json`, JSON.stringify({
    project: 'Signet', checkedAt: new Date().toISOString(), chain: 'X Layer mainnet (196)', block: String(block), rpcs: RPCS,
    reproduce: 'pnpm install && pnpm verify:claims', evidence: 'CLAIMS.md', summary: failed === 0 ? 'all checks passed' : `${failed} failed`, claims: results,
  }, null, 2) + '\n');
  console.log('wrote claims.json');
}
process.exit(failed === 0 ? 0 : 1);
