// Which chain a Signet package talks to. One switch for every package:
//   SIGNET_NETWORK=mainnet (default)  X Layer mainnet. Signet's own contracts are not deployed there yet.
//   SIGNET_NETWORK=local              the staging chain from `pnpm staging:up` (anvil fork of mainnet)
// SIGNET_RPC_URL overrides the RPC URL. Node only (reads deployments/<name>.json); browser packages get the
// result injected at build time by their vite.config.ts.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadNetwork(name = process.env.SIGNET_NETWORK || 'mainnet') {
  const file = fileURLToPath(new URL(`./deployments/${name}.json`, import.meta.url));
  if (!existsSync(file)) {
    throw new Error(name === 'local' ? 'No local deployment found. Start the staging chain first: pnpm staging:up' : `Unknown SIGNET_NETWORK "${name}"`);
  }
  const net = JSON.parse(readFileSync(file, 'utf8'));
  if (process.env.SIGNET_RPC_URL) net.rpcUrl = process.env.SIGNET_RPC_URL;
  return net;
}
