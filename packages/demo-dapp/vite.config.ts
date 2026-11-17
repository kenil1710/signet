// Injects the chosen Signet network (SIGNET_NETWORK=mainnet|local) into the app at build/dev time.
// Only the name and the chain id: the app needs nothing else, and every address in the bundle ends up in the
// sealed allowlist.
import { defineConfig } from "vite";
import { loadNetwork } from "@signet/contracts/network";

const { name, chainId } = loadNetwork();
export default defineConfig({
  define: { __SIGNET_NETWORK__: JSON.stringify({ name, chainId }) },
});
