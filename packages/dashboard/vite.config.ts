// Injects the chosen Signet network (SIGNET_NETWORK=mainnet|local) into the app at build/dev time.
import { defineConfig } from "vite";
import { loadNetwork } from "@signet/contracts/network";

export default defineConfig({
  define: { __SIGNET_NETWORK__: JSON.stringify(loadNetwork()) },
});
