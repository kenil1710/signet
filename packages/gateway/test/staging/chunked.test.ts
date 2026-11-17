// A real-size bundle (300 KB) stored on-chain in chunks, then served by the gateway: the verified copy of a site whose
// JS is far over the 48,000-byte single-transaction limit. Records the gas per chunk in docs/demo/chunked-upload.json.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { loadNetwork } from '@signet/contracts/network';
import { siteReadAbi } from '@signet/cli/src/abi.ts';
import { writeBuild } from '@signet/cli/test/fixtures.ts';
import { rpcProxy, startGateway, type Proxy } from '@signet/extension/test/staging/harness.ts';
import { encodeLabel } from '@signet/extension/src/lib/label.ts';

const net = loadNetwork('local');
const pub = createPublicClient({ transport: http(net.rpcUrl) });
const rpc = (method: string, params: unknown[] = []) => pub.request({ method, params } as never);
const CLI = fileURLToPath(new URL('../../../cli/src/cli.ts', import.meta.url));
const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const proj = mkdtempSync(join(tmpdir(), 'signet-chunked-'));
const dist = join(proj, 'dist');
const domain = `big-${Date.now().toString(36)}.signet.test`;
const SIZE = 300 * 1024;
let rpc2: Proxy;
let browser: Browser;

function signet(args: string[], as?: string): string {
  const env: NodeJS.ProcessEnv = { ...process.env, SIGNET_NETWORK: 'local' };
  delete env.SIGNET_PRIVATE_KEY;
  delete env.SIGNET_PROPOSER_KEY;
  const r = spawnSync(process.execPath, [CLI, '-C', proj, ...(as ? ['--as', as] : []), ...args], { encoding: 'utf8', env });
  assert.equal(r.status, 0, `signet ${args.join(' ')}\n${r.stdout}${r.stderr}`);
  return r.stdout + r.stderr;
}

before(async () => {
  await rpc('anvil_nodeInfo');
  spawnSync('bash', [join(ROOT, 'staging/renew-operator.sh')]);
  signet(['init', '--domain', domain, '--approvers', 'approver1,approver2,approver3', '--recovery', 'recovery', '--no-wait'], 'user1');
  await rpc('anvil_mine', ['0x2']);
  signet(['init'], 'user1');
  const cfg = JSON.parse(readFileSync(join(proj, 'signet.config.json'), 'utf8')) as { gate: Address };
  const proposer = await pub.readContract({ address: cfg.gate, abi: [{ type: 'function', name: 'proposer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }], functionName: 'proposer' });
  await rpc('anvil_setBalance', [proposer, '0xde0b6b3a7640000']); // gas money for the CI key
  writeBuild(dist, 'v1');
  // a 300 KB bundle, like a real dApp's main chunk (not compressible: random base64 inside a JS string)
  mkdirSync(join(dist, 'assets'), { recursive: true });
  const body = `export const big=${JSON.stringify(randomBytes(Math.ceil((SIZE - 40) * 3 / 4)).toString('base64').slice(0, SIZE - 40))};\n`;
  writeFileSync(join(dist, 'assets/big-bundle.js'), body.padEnd(SIZE, ' '));
  writeFileSync(join(dist, 'index.html'), readFileSync(join(dist, 'index.html'), 'utf8').replace('</body>', '<script type="module">import("/assets/big-bundle.js").then((m) => (document.title = "big " + m.big.length))</script></body>'));
  rpc2 = await rpcProxy();
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  rpc2?.close();
});

test('a 300 KB bundle is sealed in 13 chunks, written one transaction per chunk, reads back whole, and the gateway serves it', { timeout: 600_000 }, async () => {
  const sealOut = signet(['seal', dist]);
  assert.match(sealOut, /assets\/big-bundle\.js: 307200 bytes, over 48000: stored on-chain in 13 chunks/);
  const id = signet(['propose', dist, '--emergency']).match(/Proposed release #(\d+)/)![1]!;
  for (const a of ['approver1', 'approver2', 'approver3']) signet(['approve', id], a);
  const out = signet(['publish', id, dist, '--full'], 'user2');
  const gas = [...out.matchAll(/chunk {3}assets\/big-bundle\.js {2}(\d+)\/13 {2}\((\d+) bytes, gas (\d+)\)/g)].map((m) => ({ chunk: Number(m[1]), bytes: Number(m[2]), gas: Number(m[3]) }));
  assert.equal(gas.length, 13, out);
  assert.match(out, /wrote {3}assets\/big-bundle\.js {2}\(307200 bytes in 13 transactions, gas \d+; read back: matches\)/);
  const [, container, prefix] = (await pub.readContract({ address: net.contracts.registry as Address, abi: [{ type: 'function', name: 'bindingOf', stateMutability: 'view', inputs: [{ type: 'string' }], outputs: [{ type: 'address' }, { type: 'address' }, { type: 'string' }] }], functionName: 'bindingOf', args: [domain] })) as [Address, Address, string];
  const stored = (await pub.readContract({ address: net.tapeout.siteRegistry as Address, abi: siteReadAbi, functionName: 'read', args: [container, `${prefix}assets/big-bundle.js`] })) as Hex;
  const want = `0x${createHash('sha256').update(readFileSync(join(dist, 'assets/big-bundle.js'))).digest('hex')}`;
  assert.equal(`0x${createHash('sha256').update(Buffer.from(stored.slice(2), 'hex')).digest('hex')}`, want);
  // a second upload writes nothing
  assert.match(signet(['upload', dist, '--full'], 'user2'), /same {4}assets\/big-bundle\.js {2}\(13 chunks\)/);

  // the verified copy through the gateway: the page imports the 300 KB bundle, checked against its sealed hash
  const gw = await startGateway(net.rpcUrl, rpc2.url);
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`http://${encodeLabel(domain)}.localhost:${gw.port}/`);
    await page.waitForFunction(() => document.title.startsWith('big '), null, { timeout: 60_000 });
    const served = await page.evaluate(async () => {
      const r = await fetch('/assets/big-bundle.js');
      const b = await r.arrayBuffer();
      return [r.status, b.byteLength, r.headers.get('x-signet-sha256')];
    });
    assert.deepEqual(served, [200, SIZE, want]);
  } finally {
    gw.close();
  }

  const total = gas.reduce((n, g) => n + g.gas, 0);
  const gasPrice = 21_000_000; // mainnet, 2026-11-17
  const report = { bytes: SIZE, chunks: 13, perChunk: gas, totalGas: total, maxChunkGas: Math.max(...gas.map((g) => g.gas)), okbAt0_021gwei: (total * gasPrice) / 1e18 };
  writeFileSync(join(ROOT, 'docs/demo/chunked-upload.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`300 KB in 13 chunks: total gas ${total}, largest chunk ${report.maxChunkGas}, ≈ ${report.okbAt0_021gwei.toFixed(6)} OKB at 0.021 gwei`);
});
