// Builds the stand-alone CLI package `signetguard` (bin: signet): one bundled ESM file, no dependencies, Node >= 18,
// X Layer mainnet embedded. Output: packages/cli/release/signetguard-<version>.tgz (and its unpacked folder).
//   node scripts/pack.mjs
import { build } from 'vite';
import { rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VERSION = '0.1.3';
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
  name: 'signetguard', version: VERSION, description: "Signet CLI: seal each release of your dApp's website on X Layer, so Signet Guard refuses any wallet signature your team didn't seal. A TapeOut circuit decides when a release goes live.",
  license: 'MIT', type: 'module', bin: { signet: 'signet.mjs' }, files: ['signet.mjs', 'README.md', 'LICENSE'], engines: { node: '>=18' },
  homepage: 'https://signetguard.xyz/start',
  repository: { type: 'git', url: 'git+https://github.com/kenil1710/signet.git', directory: 'packages/cli' },
  bugs: { url: 'https://github.com/kenil1710/signet/issues' },
  keywords: ['x-layer', 'tapeout', 'release', 'supply-chain', 'web3', 'security'],
}, null, 2) + '\n');
writeFileSync(`${out}/README.md`, `# signetguard

The \`signet\` CLI for [Signet](https://signetguard.xyz): **Signet Guard refuses any wallet signature your dApp's team
didn't seal.** This CLI seals each release of your website on X Layer (every file's hash, the contracts and spenders
the site may ask a wallet to sign for, the outside origins it uses), proposes it from CI, and publishes it once your
approvers and the on-chain rule (TapeOut circuit #6) allow. The CI key can propose and publish, never approve.

\`\`\`
npm install -g signetguard
npx signetguard init           # interactive setup: proposer key, gate, domain proof, host headers, workflow
# or step by step:
signet keygen                  # the CI proposer key (it can propose and publish, never approve)
signet link <domain> <gate>    # after creating your gate in the dashboard
signet domain public           # the domain proof: public/.well-known/signet.json
signet verify dist && signet seal dist && signet propose dist --reuse
signet wait dist --publish     # waits for approvals + timelock, publishes, stores the manifest Guard reads
\`\`\`

Setup guide: https://signetguard.xyz/start · Dashboard: https://signetguard.xyz/app ·
Proof page (re-checks the circuits on X Layer in your browser, no wallet): https://signetguard.xyz/app#/prove

## The rule

| Tier | What changed (computed on-chain) | To publish |
|---|---|---|
| 00 | Code only | 1 approval + 1 h, or 3 of 3 with the emergency flag |
| 01 | A new external origin, or a changed SRI hash of a cross-origin script | 2 approvals + 1 h |
| 10 | A new contract or spender (every first release) | 2 approvals + 24 h, or 3 of 3 with the emergency flag |
| 11 | Admin: approvers, timelocks, domain, circuit copy | 3 of 3 + 24 h |

## Live contracts (X Layer mainnet, chain 196)

| | |
|---|---|
| SignetRegistry | [0x98dB5B6B1545D0fb374da40a02045B93398E0589](https://web3.okx.com/explorer/x-layer/evm/address/0x98dB5B6B1545D0fb374da40a02045B93398E0589) |
| SignetFactory | [0xc5e12ffe9D5bE7085441bD955724A6FAff9f7986](https://web3.okx.com/explorer/x-layer/evm/address/0xc5e12ffe9D5bE7085441bD955724A6FAff9f7986) |
| ReleaseGate implementation (each gate is a non-upgradeable clone) | [0xD14697C1dFEAdA3A117Ff8CD5358c80743453B3D](https://web3.okx.com/explorer/x-layer/evm/address/0xD14697C1dFEAdA3A117Ff8CD5358c80743453B3D) |
| TapeOut processor #101 (circuit #6: release policy; #7: Guard decision) | [0x73153e5fd2Acac604D49d6ca9fea27b750718F22](https://web3.okx.com/explorer/x-layer/evm/address/0x73153e5fd2Acac604D49d6ca9fea27b750718F22) |
| Signet's own site gate (signetguard.xyz) | [0xa3d4dfb5fB47D2CcF9b4a0a0fcC64Ac3fFef4503](https://web3.okx.com/explorer/x-layer/evm/address/0xa3d4dfb5fB47D2CcF9b4a0a0fcC64Ac3fFef4503) |

## Source

\`signet.mjs\` is a single **unminified** bundle (no dependencies at install time) built from
[\`packages/cli\`](https://github.com/kenil1710/signet/tree/main/packages/cli) by \`scripts/pack.mjs\`; read it as
it is. Every release passes an install test (a clean \`npm install -g\`, then \`signet --version\` and \`--help\`).
MIT license.
`);
copyFileSync(`${ROOT}../../LICENSE`, `${out}/LICENSE`);
const p = spawnSync('npm', ['pack', '--pack-destination', `${ROOT}release`], { cwd: out, encoding: 'utf8' });
if (p.status !== 0) throw new Error(p.stderr);
// the site serves it for /start until it is on npm
copyFileSync(`${ROOT}release/signetguard-${VERSION}.tgz`, `${ROOT}../dashboard/public/signetguard-${VERSION}.tgz`);
console.log(`built ${ROOT}release/signetguard-${VERSION}.tgz (${readFileSync(`${ROOT}release/signetguard-${VERSION}.tgz`).length} bytes)`);
// release gate: a clean global install of the tarball must give a working `signet` (see docs/npm-release.md)
const t = spawnSync(process.execPath, [`${ROOT}scripts/install-test.mjs`, `${ROOT}release/signetguard-${VERSION}.tgz`], { stdio: 'inherit' });
if (t.status !== 0) process.exit(1);
