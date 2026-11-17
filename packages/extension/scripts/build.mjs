// Builds the extension into dist/ (load that folder unpacked, or zip it for the store).
//   SIGNET_NETWORK=local node scripts/build.mjs        staging; SIGNET_RPC_URL / SIGNET_RPC_URL2 override the RPCs
// Content scripts can't be ES modules, so every entry is bundled on its own as one file.
import { build } from 'vite';
import { rmSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadNetwork } from '@signet/contracts/network';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.env.GUARD_OUT || `${root}dist`;
const n = loadNetwork();
const net = {
  name: n.name, chainId: n.chainId, rpcUrl: n.rpcUrl, rpcUrl2: process.env.SIGNET_RPC_URL2 || n.rpcUrl2 || null,
  registry: n.contracts.registry ?? null, siteRegistry: n.tapeout.siteRegistry,
  fromBlock: Number(process.env.SIGNET_FROM_BLOCK ?? n.deployBlock ?? n.forkBlock ?? 0),
};
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const entries = { background: 'src/background.ts', content: 'src/content.ts', inpage: 'src/inpage.ts', popup: 'src/pages/popup.ts', blocked: 'src/pages/blocked.ts', copy: 'src/pages/copy.ts' };
for (const [name, entry] of Object.entries(entries)) {
  await build({
    root, configFile: false, logLevel: 'warn',
    define: { __NET__: JSON.stringify(net) },
    build: {
      outDir: out, emptyOutDir: false, minify: false, target: 'chrome120', sourcemap: false,
      lib: { entry: `${root}${entry}`, formats: [name === 'background' ? 'es' : 'iife'], name: `signetGuard_${name}`, fileName: () => `${name}.js` },
    },
  });
}
for (const f of ['popup.html', 'blocked.html', 'copy.html', 'sandbox.html', 'pages.css']) copyFileSync(`${root}src/pages/${f}`, `${out}/${f}`);

const rpcHosts = [...new Set([net.rpcUrl, net.rpcUrl2].filter(Boolean).map((u) => `${new URL(u).origin}/*`))];
const manifest = {
  manifest_version: 3,
  name: 'Signet Guard',
  version: '0.1.0',
  description: "Checks a sealed dApp's website against the release its team published on X Layer, and refuses signatures the team never sealed.",
  minimum_chrome_version: '120',
  background: { service_worker: 'background.js', type: 'module' },
  action: { default_title: 'Signet Guard', default_popup: 'popup.html' },
  permissions: ['storage', 'alarms'],
  host_permissions: rpcHosts, // only the two RPCs; pages are reached through content scripts
  content_scripts: [
    { matches: ['http://*/*', 'https://*/*'], js: ['content.js'], run_at: 'document_start' },
    { matches: ['http://*/*', 'https://*/*'], js: ['inpage.js'], run_at: 'document_start', world: 'MAIN' },
  ],
  sandbox: { pages: ['sandbox.html'] },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'; frame-src 'self'",
    sandbox: "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' blob:; img-src blob: data:; font-src blob: data:",
  },
};
writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Guard built for ${net.name}: ${out}\n  RPCs ${net.rpcUrl} + ${net.rpcUrl2 ?? '(none: Guard will not be able to check)'}\n  registry ${net.registry ?? 'not deployed'} from block ${net.fromBlock}`);
