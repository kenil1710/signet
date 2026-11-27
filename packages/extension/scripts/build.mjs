// Builds the extension into dist/ (load that folder unpacked, or zip it for the store).
//   SIGNET_NETWORK=local node scripts/build.mjs        staging; SIGNET_RPC_URL / SIGNET_RPC_URL2 override the RPCs
// Content scripts can't be ES modules, so every entry is bundled on its own as one file.
import { build } from 'vite';
import { rmSync, mkdirSync, copyFileSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadNetwork } from '@signet/contracts/network';
import { execFileSync } from 'node:child_process';

/// git commit (+ "-dirty" if the tree has changes) and the UTC build time, e.g. "f1d68f4-dirty 2026-11-28 08:12Z"
function build_id() {
  let git = 'nogit';
  try {
    git = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    if (execFileSync('git', ['status', '--porcelain', '--', '.'], { cwd: root, encoding: 'utf8' }).trim()) git += '-dirty';
  } catch { /* not a git checkout */ }
  return `${git} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`;
}

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.env.GUARD_OUT || `${root}dist`;
const n = loadNetwork();
const net = {
  name: n.name, chainId: n.chainId, rpcUrl: n.rpcUrl, rpcUrl2: process.env.SIGNET_RPC_URL2 || n.rpcUrl2 || null,
  registry: n.contracts.registry ?? null, siteRegistry: n.tapeout.siteRegistry,
};
// "Open verified copy" goes to the gateway when one is configured: SIGNET_GATEWAY_URL (e.g. http://localhost:8097
// on staging) and the gateway build whose files Guard pins (SIGNET_GATEWAY_DIST, default ../gateway/dist).
if (process.env.SIGNET_GATEWAY_URL) {
  const pins = `${process.env.SIGNET_GATEWAY_DIST || `${root}../gateway/dist`}/.signet/hashes.json`;
  if (!existsSync(pins)) throw new Error(`SIGNET_GATEWAY_URL is set but ${pins} does not exist. Build the gateway first: pnpm --filter @signet/gateway build`);
  net.gateway = { url: process.env.SIGNET_GATEWAY_URL.replace(/\/+$/, ''), pins: JSON.parse(readFileSync(pins, 'utf8')) };
}
// The Guard decision circuit, when it is taped out on this network (deployments/<network>.json tapeout.guardCircuitId)
if (n.tapeout.guardCircuitId !== undefined) {
  const art = JSON.parse(readFileSync(`${root}../circuit/artifacts/guard.json`, 'utf8'));
  net.guardCircuit = { processor: n.tapeout.processor, id: n.tapeout.guardCircuitId, netlistSha256: art.netlistSha256, beacon: n.tapeout.circuitBeacon, implementation: n.tapeout.circuitImplementation };
}
// Other chains a sealed factory rule may need (two independent RPCs each, fixed here: a release can't pick them).
// Mainnet build: Arc mainnet and testnet, Circle + dRPC (both checked 2026-11-23: same factory code on each).
// SIGNET_CHAINS='{"196":{"rpcUrl":"…","rpcUrl2":"…"}}' replaces the list (staging).
const ARC = {
  5042: { rpcUrl: 'https://rpc.mainnet.arc.io', rpcUrl2: 'https://arc-mainnet.drpc.org' },
  5042002: { rpcUrl: 'https://rpc.testnet.arc.io', rpcUrl2: 'https://arc-testnet.drpc.org' },
};
net.chains = process.env.SIGNET_CHAINS ? JSON.parse(process.env.SIGNET_CHAINS) : n.name === 'mainnet' ? ARC : {};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const entries = { background: 'src/background.ts', content: 'src/content.ts', inpage: 'src/inpage.ts', popup: 'src/pages/popup.ts', blocked: 'src/pages/blocked.ts', copy: 'src/pages/copy.ts' };
for (const [name, entry] of Object.entries(entries)) {
  await build({
    root, configFile: false, logLevel: 'warn',
    define: { __NET__: JSON.stringify(net), __HASH_ONLY__: JSON.stringify(process.env.GUARD_MODE === 'hash-only'), __HOLD_MS__: JSON.stringify(Number(process.env.GUARD_HOLD_MS) || 0) },
    build: {
      outDir: out, emptyOutDir: false, minify: false, target: 'chrome120', sourcemap: false,
      lib: { entry: `${root}${entry}`, formats: [name === 'background' ? 'es' : 'iife'], name: `signetGuard_${name}`, fileName: () => `${name}.js` },
    },
  });
}
for (const f of ['popup.html', 'blocked.html', 'copy.html', 'sandbox.html', 'pages.css']) copyFileSync(`${root}src/pages/${f}`, `${out}/${f}`);
// fonts and the seal image, bundled (the pages make no network request)
mkdirSync(`${out}/assets`, { recursive: true });
for (const f of ['archivo-subset.woff2', 'ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-latin-500-normal.woff2', 'seal-still.webp']) copyFileSync(`${root}src/pages/assets/${f}`, `${out}/assets/${f}`);

const rpcHosts = [...new Set([net.rpcUrl, net.rpcUrl2, ...Object.values(net.chains).flatMap((c) => [c.rpcUrl, c.rpcUrl2])].filter(Boolean).map((u) => `${new URL(u).origin}/*`))];
const manifest = {
  manifest_version: 3,
  name: 'Signet Guard',
  version: JSON.parse(readFileSync(`${root}package.json`, 'utf8')).version,
  // shown in chrome://extensions: which build is loaded (an unpacked extension keeps running the files it loaded
  // until it is reloaded, and every 0.3.6 build has the same version)
  version_name: `${JSON.parse(readFileSync(`${root}package.json`, 'utf8')).version} (build ${build_id()})`,
  description: "Checks a sealed dApp's website against the release its team published on X Layer, and refuses signatures the team never sealed.",
  minimum_chrome_version: '120',
  background: { service_worker: 'background.js', type: 'module' },
  action: { default_title: 'Signet Guard', default_popup: 'popup.html' },
  permissions: ['storage', 'alarms'],
  host_permissions: rpcHosts, // only the RPCs (X Layer, and per chain for factory rules); pages are reached through content scripts
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
console.log(`Guard built for ${net.name}${process.env.GUARD_MODE === 'hash-only' ? ' (HASH-ONLY benchmark build: signing-time allowlist OFF)' : ''}: ${out}\n  RPCs ${net.rpcUrl} + ${net.rpcUrl2 ?? '(none: Guard will not be able to check)'}\n  registry ${net.registry ?? 'not deployed'}\n  Guard circuit: ${net.guardCircuit ? `processor ${net.guardCircuit.processor} circuit ${net.guardCircuit.id}` : 'none: the local mirror decides'}\n  verified copy: ${net.gateway ? `gateway ${net.gateway.url}` : 'preview inside the extension (no gateway configured)'}`);
