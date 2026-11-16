// Writes signet-network.json next to the extension's manifest, for the service worker to load.
// SIGNET_NETWORK=local pnpm --filter @signet/extension network
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadNetwork } from '@signet/contracts/network';

const n = loadNetwork();
writeFileSync(fileURLToPath(new URL('../signet-network.json', import.meta.url)), JSON.stringify(n, null, 2) + '\n');
console.log(`extension network: ${n.name} (${n.rpcUrl}), registry ${n.contracts.registry ?? 'not deployed'}`);
