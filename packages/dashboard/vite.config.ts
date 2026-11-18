// The dashboard is static: everything it knows about the network is injected here, at build time.
//   SIGNET_NETWORK=local SIGNET_RPC_URL2=http://127.0.0.1:8546 pnpm --filter @signet/dashboard build
// Two RPCs that must agree, as in Guard. base "./" so it works from any path (a DeWEB container, a subfolder).
import { defineConfig } from 'vite';
import { loadNetwork } from '@signet/contracts/network';

const n = loadNetwork();
const net = {
  name: n.name, chainId: n.chainId, rpcUrl: n.rpcUrl, rpcUrl2: process.env.SIGNET_RPC_URL2 || n.rpcUrl2 || null,
  registry: n.contracts.registry ?? null, siteRegistry: n.tapeout.siteRegistry, tapeout: n.tapeout,
};
// Two pages: index.html is the landing page (no viem, no chain reads); app.html is the dashboard and /prove.
export default defineConfig({
  base: './',
  define: { __SIGNET_NET__: JSON.stringify(net) },
  build: { target: 'es2022', rollupOptions: { input: { index: 'index.html', app: 'app.html' } } },
});
