// Run before MainnetDeploy step1. Checks the settings step2 will need (step1 can't be undone, step2 reads the roles),
// the dev wallet's balance and nonce, and the gas price. Read-only.
import { readFileSync } from 'node:fs';
import { createPublicClient, http, isAddress, getAddress, formatEther } from 'viem';
import { isValidDomain } from '../../cli/src/seal.ts';

const DEV = '0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE';
const e = process.env;
const errors = [];
const notes = [];
const domain = e.SIGNET_SITE_DOMAIN ?? '';
if (!isValidDomain(domain)) errors.push(`SIGNET_SITE_DOMAIN "${domain}" is not a valid lowercase domain`);
if (!/^0x[0-9a-fA-F]{64}$/.test(e.SIGNET_SITE_SALT ?? '')) errors.push('SIGNET_SITE_SALT must be 0x + 64 hex characters');
const approvers = (e.SIGNET_SITE_APPROVERS ?? '').split(',').map((a) => a.trim()).filter(Boolean);
if (approvers.length !== 3) errors.push(`SIGNET_SITE_APPROVERS needs 3 addresses (got ${approvers.length})`);
const roles = { approver1: approvers[0], approver2: approvers[1], approver3: approvers[2], proposer: e.SIGNET_SITE_PROPOSER, recovery: e.SIGNET_SITE_RECOVERY, guardian: e.SIGNET_SITE_GUARDIAN };
for (const [k, v] of Object.entries(roles)) if (!v || !isAddress(v) || BigInt(v) === 0n) errors.push(`${k}: "${v ?? ''}" is not an address`);
if (!errors.some((x) => x.includes('not an address'))) {
  const all = Object.values(roles).map((a) => getAddress(a));
  if (new Set(all).size !== all.length) errors.push('the 3 approvers, the proposer, the recovery address and the guardian must all be different');
  for (const [k, v] of Object.entries(roles)) if (getAddress(v) === DEV) (k === 'guardian' ? notes : errors).push(`${k} is the dev wallet (signet-dev)${k === 'guardian' ? ': allowed; it can only freeze, but it is the same key that holds circuits #5 and #6' : ''}`);
}
const net = JSON.parse(readFileSync(new URL('../deployments/mainnet.json', import.meta.url), 'utf8'));
if (net.contracts?.registry) errors.push(`deployments/mainnet.json already names a registry (${net.contracts.registry}): already deployed?`);
const c = createPublicClient({ transport: http(net.rpcUrl) });
const [bal, nonce, gas] = await Promise.all([c.getBalance({ address: DEV }), c.getTransactionCount({ address: DEV }), c.getGasPrice()]);
console.log(`dev wallet ${DEV}: ${formatEther(bal)} OKB, nonce ${nonce}; gas price ${Number(gas) / 1e9} gwei`);
if (bal < 2_500_000_000_000_000n) errors.push('balance below 0.0025 OKB: not enough for both steps with margin');
if (gas > 100_000_000n) errors.push(`gas price ${Number(gas) / 1e9} gwei is 5x the planned 0.02 gwei: wait, or re-estimate`);
console.log(`domain ${domain}; approvers ${approvers.join(', ')}; proposer ${roles.proposer}; recovery ${roles.recovery}; guardian ${roles.guardian}`);
for (const n of notes) console.log(`note: ${n}`);
for (const x of errors) console.log(`ERROR: ${x}`);
console.log(errors.length ? 'STOP: fix the settings above before step 1.' : 'preflight OK: settings are complete and valid.');
process.exit(errors.length ? 1 : 0);
