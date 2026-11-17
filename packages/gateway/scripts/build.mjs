// Builds the gateway into dist/: three static files, the same for every project.
//   /index.html          the boot page, returned for every path the gateway's server doesn't know
//   /sw.js               the service worker
//   /.signet/boot.js     the boot page's script
//   /.signet/hashes.json SHA-256 of the three, so Guard can pin them
// SIGNET_NETWORK=local node scripts/build.mjs   (SIGNET_RPC_URL / SIGNET_RPC_URL2 override the RPCs)
import { build } from 'vite';
import { rmSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadNetwork } from '@signet/contracts/network';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.env.GATEWAY_OUT || `${root}dist`;
const n = loadNetwork();
const net = { name: n.name, chainId: n.chainId, rpcUrl: n.rpcUrl, rpcUrl2: process.env.SIGNET_RPC_URL2 || n.rpcUrl2 || null, registry: n.contracts.registry ?? null, siteRegistry: n.tapeout.siteRegistry };
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/.signet`, { recursive: true });
for (const [name, entry, file] of [['sw', 'src/sw.ts', 'sw.js'], ['boot', 'src/boot.ts', '.signet/boot.js']]) {
  await build({
    root, configFile: false, logLevel: 'warn', define: { __NET__: JSON.stringify(net) },
    build: { outDir: out, emptyOutDir: false, minify: false, target: 'chrome120', lib: { entry: `${root}${entry}`, formats: ['iife'], name: `signetGateway_${name}`, fileName: () => file } },
  });
}
copyFileSync(`${root}src/index.html`, `${out}/index.html`);
const sha = (f) => createHash('sha256').update(readFileSync(`${out}/${f}`)).digest('hex');
const hashes = { 'index.html': sha('index.html'), 'sw.js': sha('sw.js'), '.signet/boot.js': sha('.signet/boot.js') };
writeFileSync(`${out}/.signet/hashes.json`, JSON.stringify(hashes, null, 2) + '\n');
console.log(`gateway built for ${net.name}: ${out}\n  RPCs ${net.rpcUrl} + ${net.rpcUrl2 ?? '(none: the worker will refuse to show anything)'}\n  sw.js sha256 ${hashes['sw.js']}`);
