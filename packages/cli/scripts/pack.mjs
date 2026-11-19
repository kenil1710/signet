// Builds the stand-alone CLI package `signetguard` (bin: signet): one bundled ESM file, no dependencies, Node >= 18,
// X Layer mainnet embedded. Output: packages/cli/release/signetguard-<version>.tgz (and its unpacked folder).
//   node scripts/pack.mjs
import { build } from 'vite';
import { rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VERSION = '0.1.0';
const out = `${ROOT}release/pkg`;
rmSync(`${ROOT}release`, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await build({
  root: ROOT, configFile: false, logLevel: 'warn',
  resolve: { alias: { '@signet/contracts/network': `${ROOT}scripts/network-embedded.mjs` } },
  define: { __SIGNET_CLI_VERSION__: JSON.stringify(VERSION) },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: `${ROOT}src/cli.ts`, outDir: out, emptyOutDir: false, target: 'node18', minify: false,
    rollupOptions: { output: { format: 'es', entryFileNames: 'signet.mjs', inlineDynamicImports: true } },
  },
});
const js = readFileSync(`${out}/signet.mjs`, 'utf8');
if (!js.startsWith('#!')) writeFileSync(`${out}/signet.mjs`, `#!/usr/bin/env node\n${js}`);
chmodSync(`${out}/signet.mjs`, 0o755);
writeFileSync(`${out}/package.json`, JSON.stringify({
  name: 'signetguard', version: VERSION, description: "Signet CLI: seal each release of your dApp's website on X Layer; a TapeOut circuit decides when it goes live.",
  license: 'MIT', type: 'module', bin: { signet: './signet.mjs' }, files: ['signet.mjs', 'README.md'], engines: { node: '>=18' },
  keywords: ['x-layer', 'tapeout', 'release', 'supply-chain', 'web3', 'security'],
}, null, 2) + '\n');
writeFileSync(`${out}/README.md`, `# signetguard\n\nThe \`signet\` CLI: seal each release of your dApp's website on X Layer (chain 196). Setup guide: https://signetguard.xyz/start\n`);
const p = spawnSync('npm', ['pack', '--pack-destination', `${ROOT}release`], { cwd: out, encoding: 'utf8' });
if (p.status !== 0) throw new Error(p.stderr);
// the site serves it for /start until it is on npm
copyFileSync(`${ROOT}release/signetguard-${VERSION}.tgz`, `${ROOT}../dashboard/public/signetguard-${VERSION}.tgz`);
console.log(`built ${ROOT}release/signetguard-${VERSION}.tgz (${readFileSync(`${ROOT}release/signetguard-${VERSION}.tgz`).length} bytes)`);
