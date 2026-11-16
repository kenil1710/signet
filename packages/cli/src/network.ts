// The CLI's chain config. SIGNET_NETWORK=local points every command at the staging chain.
import { loadNetwork } from '@signet/contracts/network';

export { loadNetwork };

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = loadNetwork();
  console.log(JSON.stringify({ network: n.name, chainId: n.chainId, rpcUrl: n.rpcUrl, contracts: n.contracts, gates: n.gates }, null, 2));
}
