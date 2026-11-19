// The network module of the published CLI (signetguard on npm, or the tarball on the site): X Layer mainnet only,
// with the deployment embedded at build time (the monorepo version reads packages/contracts/deployments/*.json).
// SIGNET_RPC_URL overrides the RPC, as in the monorepo.
import mainnet from '../../contracts/deployments/mainnet.json';

export function loadNetwork(name = process.env.SIGNET_NETWORK || 'mainnet') {
  if (name !== 'mainnet') throw new Error(`This build of the signet CLI knows only X Layer mainnet (SIGNET_NETWORK is "${name}")`);
  const net = JSON.parse(JSON.stringify(mainnet));
  if (process.env.SIGNET_RPC_URL) net.rpcUrl = process.env.SIGNET_RPC_URL;
  return net;
}
