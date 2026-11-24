// The dashboard is static: everything it knows about the network is injected here, at build time.
//   SIGNET_NETWORK=local SIGNET_RPC_URL2=http://127.0.0.1:8546 pnpm --filter @signet/dashboard build
// Two RPCs that must agree, as in Guard. base "./" so it works from any path (a DeWEB container, a subfolder).
import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyLinksHtml, linksFor } from './src/landing/config.ts';
import { loadNetwork } from '@signet/contracts/network';

const n = loadNetwork();
const net = {
  name: n.name, chainId: n.chainId, rpcUrl: n.rpcUrl, rpcUrl2: process.env.SIGNET_RPC_URL2 || n.rpcUrl2 || null,
  registry: n.contracts.registry ?? null, factory: n.contracts.factory ?? null, siteRegistry: n.tapeout.siteRegistry, tapeout: n.tapeout,
};
// Static HTML that reads the same without JavaScript (crawlers, AI judges, reader modes): every outside link is
// written into the HTML at build time, {{ORIGIN}} is filled in, and the trust documents are served by the site.
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DOCS: Record<string, string> = { 'docs/THREAT_MODEL.md': 'THREAT_MODEL.md', 'docs/CLAIMS.md': 'CLAIMS.md', 'docs/benchmark.md': 'docs/benchmark.md', 'llms.txt': 'llms.txt' };
function staticSite(): Plugin {
  const links = linksFor(process.env.SIGNET_REPO_PUBLIC === '1');
  return {
    name: 'signet-static-site',
    transformIndexHtml(html) {
      const out = applyLinksHtml(html, links);
      // Cloudflare's Email Obfuscation rewrites anything that looks like an email (it broke release 3's seal once):
      // write the @ as &#64; in such text
      const email = out.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/);
      if (email) throw new Error(`email-like text "${email[0]}" in the HTML: Cloudflare would rewrite it; write the @ as &#64;`);
      return n.name === 'mainnet' ? out.replaceAll('{{ORIGIN}}', links.domain) : out;
    },
    generateBundle() {
      for (const [to, from] of Object.entries(DOCS)) this.emitFile({ type: 'asset', fileName: to, source: readFileSync(ROOT + from, 'utf8') });
    },
  };
}
// Two pages: index.html is the landing page (no viem, no chain reads); app.html is the dashboard and /prove.
export default defineConfig({
  base: './',
  plugins: [staticSite()],
  define: { __SIGNET_NET__: JSON.stringify(net), __SIGNET_PROOF_ORIGIN__: JSON.stringify(process.env.SIGNET_PROOF_ORIGIN || 'https://{domain}'), __SIGNET_WATCHTOWER_STATUS__: JSON.stringify(process.env.SIGNET_WATCHTOWER_STATUS ?? (n.name === 'mainnet' ? 'api/watchtower' : '')) },
  build: { target: 'es2022', rollupOptions: { input: { index: 'index.html', app: 'app.html', start: 'start.html', check: 'check.html' } } },
});
