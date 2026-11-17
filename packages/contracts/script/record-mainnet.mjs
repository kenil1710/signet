// After the mainnet deployment (docs/mainnet-plan.md): writes what is now on X Layer into the repo, so Guard, the
// CLI, the watchtower and `pnpm verify:claims` use it. Read-only: it sends nothing.
//   node packages/contracts/script/record-mainnet.mjs [contracts|circuit|all]
// Every transaction hash it records is first fetched from BOTH mainnet RPCs and must have succeeded there, so a
// rehearsal or staging run (same chain id 196 in forge's broadcast folder) can never be recorded by mistake.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, parseAbi, getAddress } from 'viem';

const C = fileURLToPath(new URL('..', import.meta.url)); // packages/contracts/
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const what = process.argv[2] ?? 'all';
const NET_FILE = `${C}deployments/mainnet.json`;
const net = JSON.parse(readFileSync(NET_FILE, 'utf8'));
const RPCS = [net.rpcUrl, net.rpcUrl2];
const clients = RPCS.map((url) => createPublicClient({ transport: http(url, { retryCount: 5, retryDelay: 800 }) }));
const DEV = '0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE';
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const fail = (m) => {
  console.error(`record-mainnet: ${m}`);
  process.exit(1);
};

/// The receipt of a transaction on both mainnet RPCs; it must exist, have succeeded and come from the dev wallet.
async function onMainnet(hash) {
  const rs = await Promise.all(clients.map((c) => c.getTransactionReceipt({ hash }).catch(() => null)));
  if (rs.some((r) => !r)) fail(`transaction ${hash} is not on mainnet (a rehearsal or staging run?). Nothing written.`);
  if (rs.some((r) => r.status !== 'success')) fail(`transaction ${hash} failed on mainnet`);
  if (rs[0].from.toLowerCase() !== DEV.toLowerCase()) fail(`transaction ${hash} was not sent by the dev wallet`);
  if (rs[0].blockNumber !== rs[1].blockNumber) fail(`the two RPCs disagree about ${hash}`);
  return rs[0];
}
const txsOf = (file) => (existsSync(file) ? json(file).receipts.map((r) => r.transactionHash) : fail(`${file} not found: run the forge command first`));

if (what === 'contracts' || what === 'all') {
  const dep = json(`${C}deployments/mainnet-deploy.json`);
  if (!dep.siteGate) fail('deployments/mainnet-deploy.json has no siteGate: run step2 first');
  const hashes = [...txsOf(`${C}broadcast/MainnetDeploy.s.sol/196/step1-latest.json`), ...txsOf(`${C}broadcast/MainnetDeploy.s.sol/196/step2-latest.json`)];
  const receipts = [];
  for (const h of hashes) receipts.push(await onMainnet(h));
  const reg = parseAbi(['function factory() view returns (address)', 'function signetSiteGate() view returns (address)', 'function domainCount() view returns (uint256)', 'function domainsRange(uint256,uint256) view returns (string[])', 'function bindingOf(string) view returns (address, address, string)']);
  const c = clients[0];
  const [factory, siteGate, n] = await Promise.all(['factory', 'signetSiteGate', 'domainCount'].map((f) => c.readContract({ address: dep.registry, abi: reg, functionName: f })));
  if (getAddress(factory) !== getAddress(dep.factory) || getAddress(siteGate) !== getAddress(dep.siteGate) || n !== 1n) fail(`the registry on mainnet doesn't match: factory ${factory}, site gate ${siteGate}, ${n} domains`);
  const [domain] = await c.readContract({ address: dep.registry, abi: reg, functionName: 'domainsRange', args: [0n, 1n] });
  const [, , prefix] = await c.readContract({ address: dep.registry, abi: reg, functionName: 'bindingOf', args: [domain] });
  net.contracts = { registry: getAddress(dep.registry), factory: getAddress(dep.factory), gateImplementation: getAddress(dep.gateImplementation) };
  net.deployBlock = Number(receipts[0].blockNumber);
  net.gates = { ...net.gates, site: { address: getAddress(dep.siteGate), domain, prefix } };
  net.deployTxs = hashes;
  writeFileSync(NET_FILE, JSON.stringify(net, null, 2) + '\n');
  console.log(`recorded the contracts: registry ${net.contracts.registry}, factory ${net.contracts.factory}, site gate ${dep.siteGate} for ${domain}, ${hashes.length} transactions (from block ${net.deployBlock})`);
}

if (what === 'circuit' || what === 'all') {
  const out = `${C}deployments/guard-tapeout.json`;
  if (!existsSync(out)) fail('deployments/guard-tapeout.json not found: run the GuardTapeout forge command first');
  const id = json(out).guardCircuitId;
  const [mintTx, tapeoutTx] = txsOf(`${C}broadcast/GuardTapeout.s.sol/196/run-latest.json`);
  if (!tapeoutTx) fail('expected two transactions (mint, tape-out)');
  await onMainnet(mintTx);
  const t = await onMainnet(tapeoutTx);
  if (getAddress(t.to) !== getAddress(net.tapeout.processor)) fail('the tape-out was not sent to processor #101');
  // the 512-row check, on both RPCs, before anything is recorded as verified
  const v = spawnSync(process.execPath, [`${ROOT}packages/circuit/scripts/verify-mainnet.ts`, net.tapeout.processor, String(id), 'guard'], { encoding: 'utf8' });
  process.stdout.write(v.stdout);
  if (v.status !== 0) fail(`verify-mainnet failed:\n${v.stderr}`);
  const block = Number(v.stdout.match(/pinned block (\d+)/)[1]);
  const art = json(`${ROOT}packages/circuit/artifacts/guard.json`);
  writeFileSync(`${ROOT}packages/circuit/artifacts/guard-deployment.json`, JSON.stringify({
    chainId: 196, network: 'X Layer mainnet', processor: net.tapeout.processor, processorIndex: 101, circuitId: id, netlistSha256: art.netlistSha256, holder: DEV,
    mintTx, tapeoutTx, tapeoutBlock: Number(t.blockNumber), verifiedAtBlock: block,
    verifiedWith: 'scripts/verify-mainnet.ts guard: 512/512 eval() eth_calls match on xlayerrpc.okx.com and xlayer.drpc.org',
  }, null, 2) + '\n');
  net.tapeout.guardCircuitId = id;
  writeFileSync(NET_FILE, JSON.stringify(net, null, 2) + '\n');
  const g = spawnSync('pnpm', ['--filter', '@signet/circuit', 'gen'], { cwd: ROOT, encoding: 'utf8' });
  if (g.status !== 0) fail(`truth-table regeneration failed:\n${g.stdout}${g.stderr}`);
  console.log(`recorded the Guard decision circuit: #${id}, tape-out ${tapeoutTx} (block ${t.blockNumber}); docs/guard-truth-table.md now names it`);
}
