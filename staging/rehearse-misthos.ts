// Rehearses sealing misthos.world (Signet v2: page mode ssr + the Misthos vault factory rule) on a FORK of X Layer
// mainnet, then loads the real https://misthos.world in Chromium with Guard 0.3.0 pointed at that fork.
// Nothing is sent to mainnet: every transaction goes to the local fork; X Layer mainnet and Arc are only read.
//
//   node staging/rehearse-misthos.ts [--pages /,/docs,...]
//
// The files sealed are the ones misthos.world serves now (every /_next/static file its pages reference, followed
// through the JS until no new one appears), so this measures exact costs and false warnings on the real site. The
// real release seals the Vercel build output instead (/start, "Next.js with server-rendered pages").
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(join(ROOT, 'packages/extension/package.json'));
const { chromium } = req('playwright');
const DOMAIN = 'misthos.world';
const SITE = `https://${DOMAIN}`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PAGES = (process.argv.includes('--pages') ? process.argv[process.argv.indexOf('--pages') + 1]! : '/,/campaigns,/c,/docs,/docs/quickstart,/p/kency-arc-creators,/no-such-page,/docs/no-such-page').split(',');
const VISIT = [...PAGES, '/docs/faq', '/docs/security', '/docs/architecture', '/app', '/p/kency-arc-creators/rounds/1', '/p/no-such-program', '/another-missing-page', '/campaigns?x=1'];
const A = '0xB9ef367A86DE5150a5390c4148073901587d2416', B = '0x3280887C6ed2c0C43679918654f72222b767e6dc', C = '0x1C4704480E258bdBF8719ffba1679dD0e158c74c';
const RECOVERY = '0x69400a5f15F6b2D84AAB70989B32266010E6cD93';
const ANVIL_KEY0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // anvil's default account, fork only
const PORT = 8650;
const FORK = `http://127.0.0.1:${PORT}`;
const gas: { what: string; gas: number }[] = [];
const sh = (cmd: string, args: string[], env: NodeJS.ProcessEnv = {}, cwd = ROOT) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}\n${r.stdout}${r.stderr}`);
  return r.stdout + r.stderr;
};
const cast = (...a: string[]) => sh('cast', [...a, '--rpc-url', FORK]).trim();

// ---------------------------------------------------------------- 1. the files misthos.world serves now
async function fetchText(url: string): Promise<{ ok: boolean; body: Buffer; type: string }> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: AbortSignal.timeout(30_000) });
      return { ok: r.ok, body: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') ?? '' };
    } catch (e) {
      if (i >= 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
}
async function collect(siteDir: string): Promise<number> {
  const seen = new Set<string>();
  const queue: string[] = [];
  const add = (text: string) => {
    for (const m of text.matchAll(/(?:\/_next\/)?(static\/[A-Za-z0-9_\-./]+?\.(?:js|css|woff2?|svg|png|ico|txt))(?=["'\s)\\?#]|$)/g)) {
      const p = `_next/${m[1]}`;
      if (!seen.has(p)) { seen.add(p); queue.push(p); }
    }
  };
  for (const p of VISIT) add((await fetchText(`${SITE}${p}`)).body.toString('utf8'));
  while (queue.length) {
    const p = queue.shift()!;
    const r = await fetchText(`${SITE}/${p}`);
    if (!r.ok) continue; // a path that only looked like a file
    mkdirSync(dirname(join(siteDir, p)), { recursive: true });
    writeFileSync(join(siteDir, p), r.body);
    if (/\.(js|css)$/.test(p)) add(r.body.toString('utf8'));
  }
  return seen.size;
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'misthos-rehearsal-'));
  const siteDir = join(dir, 'site');
  mkdirSync(siteDir, { recursive: true });
  console.log(`1. collecting the files ${SITE} serves now…`);
  console.log(`   ${await collect(siteDir)} static paths followed`);

  // ---------------------------------------------------------------- 2. a fork of X Layer mainnet
  console.log('2. forking X Layer mainnet (local only)…');
  const anvil = spawn('anvil', ['--fork-url', 'https://xlayerrpc.okx.com', '--port', String(PORT), '--chain-id', '196', '--silent'], { stdio: 'ignore' });
  for (let i = 0; i < 80 && !(await fetch(FORK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' }).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
  const cli = (args: string[], key = ANVIL_KEY0) => sh(process.execPath, [join(ROOT, 'packages/cli/src/cli.ts'), '-C', dir, ...args], { SIGNET_NETWORK: 'mainnet', SIGNET_RPC_URL: FORK, SIGNET_PRIVATE_KEY: key, SIGNET_PROPOSER_KEY: '' });
  const txGas = (out: string, what: string) => { for (const m of out.matchAll(/tx\s+(0x[0-9a-f]{64})[^\n]*?gas (\d+)/g)) gas.push({ what, gas: Number(m[2]) }); };
  try {
    // the gate: commit, then createGate (the CLI's init with role flags; the dashboard sends the same two calls)
    let out = cli(['init', '--domain', DOMAIN, '--approvers', `${A},${B},${C}`, '--recovery', RECOVERY, '--guardian', 'none', '--no-wait']);
    for (let i = 0; i < 3; i++) cast('rpc', 'evm_mine');
    out += cli(['init']);
    for (const m of out.matchAll(/tx (0x[0-9a-f]{64})/g)) gas.push({ what: gas.length === 0 ? 'factory.commit (gate creator)' : 'factory.createGate (gate creator)', gas: Number(cast('receipt', m[1]!, 'gasUsed')) });
    const cfgFile = join(dir, 'signet.config.json');
    const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
    const rule = (factory: string) => ({ factory, predict: 'predictVaultAddress(address,bytes32)', id: 'programId()', roles: ['owner()', 'guardian()'] });
    writeFileSync(cfgFile, JSON.stringify({
      ...cfg, chainId: 5042,
      pages: { mode: 'ssr', crawl: PAGES },
      allowlist: {
        '5042': { targets: ['0x3600000000000000000000000000000000000000', '0x9075CbB50639216C2e4E32013514baa01f2b0C1b'], factories: [rule('0x9075CbB50639216C2e4E32013514baa01f2b0C1b')], exclude: ['0x19afd6fCeb49A333B3b3b455A26e6ee43db8849b', '0xbB016FeB193c9F1151e77444a2145c5dfAA965D7', '0x49cd73fC60f61A3eb1a8194effdC6FD88035fBa9'] },
        '5042002': { targets: ['0x3600000000000000000000000000000000000000', '0x19afd6fCeb49A333B3b3b455A26e6ee43db8849b'], factories: [rule('0x19afd6fCeb49A333B3b3b455A26e6ee43db8849b')] },
      },
    }, null, 2));
    cli(['domain', siteDir]);
    console.log('3. sealing (crawling the live pages for their inline scripts)…');
    // --crawl-browser uses the project's playwright: link Signet's own into this throwaway project
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"private":true}');
    for (const m of ['playwright']) symlinkSync(realpathSync(join(ROOT, 'packages/extension/node_modules', m)), join(dir, 'node_modules', m));
    out = cli(['seal', siteDir, '--crawl-browser', SITE]);
    console.log(out.split('\n').filter((l) => /Sealed|allowlistHash|originsHash|chain |factory|Server-rendered|inline 0x|origins the site/.test(l)).map((l) => `   ${l.trim()}`).join('\n'));
    const proposer = cast('call', cfg.gate, 'proposer()(address)');
    cast('rpc', 'anvil_setBalance', proposer, '0xde0b6b3a7640000');
    const proposerKey = readFileSync(join(dir, '.signet/proposer.key'), 'utf8').trim();
    out = cli(['propose', siteDir], proposerKey);
    txGas(out, 'proposeRelease #1 (CI key)');
    const id = out.match(/Proposed release #(\d+)/)![1]!;
    console.log(`   ${out.match(/risk tier.*/)?.[0]}`);
    for (const [name, who] of [['A', A], ['B', B]] as const) {
      cast('rpc', 'anvil_impersonateAccount', who);
      cast('rpc', 'anvil_setBalance', who, '0xde0b6b3a7640000');
      const r = JSON.parse(sh('cast', ['send', cfg.gate, 'approve(uint64)', id, '--from', who, '--unlocked', '--json', '--rpc-url', FORK]));
      gas.push({ what: `approve(#${id}) by ${name}`, gas: parseInt(r.gasUsed, 16) });
    }
    cast('rpc', 'evm_increaseTime', String(24 * 3600 + 60));
    cast('rpc', 'evm_mine');
    out = cli(['publish', id, siteDir], proposerKey);
    for (const m of out.matchAll(/Published[^\n]*?gas (\d+)/g)) gas.push({ what: 'publish(#1) (CI key)', gas: Number(m[1]) });
    for (const m of out.matchAll(/wrote\s+(\S+)\s+\((\d+) bytes, gas (\d+)\)/g)) gas.push({ what: `upload ${m[1]} (${m[2]} B)`, gas: Number(m[3]) });
    for (const m of out.matchAll(/chunk\s+(\S+)\s+(\d+)\/(\d+)\s+\((\d+) bytes, gas (\d+)\)/g)) gas.push({ what: `upload ${m[1]} chunk ${m[2]}/${m[3]} (${m[4]} B)`, gas: Number(m[5]) });
    console.log(`   ${out.match(/Published[^\n]*/)?.[0]}`);

    // ---------------------------------------------------------------- 4. Guard on the real site
    console.log('4. Guard 0.3.0 (reading the fork) on the real misthos.world pages…');
    const ext = mkdtempSync(join(tmpdir(), 'guard-ext-'));
    sh(process.execPath, [join(ROOT, 'packages/extension/scripts/build.mjs')], { SIGNET_NETWORK: 'mainnet', SIGNET_RPC_URL: FORK, SIGNET_RPC_URL2: FORK, GUARD_OUT: ext }, join(ROOT, 'packages/extension'));
    const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'guard-profile-')), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
    const isGuard = (w: { url(): string }) => w.url().startsWith('chrome-extension://');
    const sw = ctx.serviceWorkers().find(isGuard) ?? (await ctx.waitForEvent('serviceworker', { predicate: isGuard, timeout: 90000 }));
    for (let i = 0; i < 60 && !(await sw.evaluate(() => typeof chrome !== 'undefined' && !!chrome.storage?.local).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 500));
    for (let i = 0; i < 180; i++) {
      if (await sw.evaluate(async (d: string) => (((await chrome.storage.local.get('domains')).domains as { list?: string[] } | undefined)?.list ?? []).includes(d), DOMAIN).catch(() => false)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await sw.evaluate(async ([d, g]: string[]) => chrome.storage.local.set({ proofs: { [d!]: g!.toLowerCase() } }), [DOMAIN, cfg.gate]); // misthos.world doesn't serve the proof yet
    const page = await ctx.newPage();
    const results: { path: string; badge: string; bad: unknown[] }[] = [];
    for (const p of VISIT) {
      await page.goto(`${SITE}${p}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(2500);
      const tab = await sw.evaluate(async () => Math.max(-1, ...(await chrome.tabs.query({})).map((t) => t.id ?? -1))); // the newest tab (no "tabs" permission: no URLs)
      const badge = tab >= 0 ? await sw.evaluate((t: number) => chrome.action.getBadgeText({ tabId: t }), tab) : '(no tab)';
      const rep = tab >= 0 ? await sw.evaluate(async (t: number) => (await chrome.storage.session.get(`tab:${t}`))[`tab:${t}`], tab) as { report?: { files: { status: string; url: string; note?: string }[] } } : undefined;
      results.push({ path: p, badge, bad: (rep?.report?.files ?? []).filter((f) => !['ok', 'ok-sri', 'ok-inline', 'ok-ssr'].includes(f.status)).map((f) => `${f.status} ${f.url.slice(0, 100)} ${f.note ?? ''}`.slice(0, 220)) });
    }
    const events = await sw.evaluate(async () => (await chrome.storage.local.get('events')).events ?? []);
    await ctx.close();
    for (const r of results) console.log(`   ${r.path.padEnd(26)} badge ${JSON.stringify(r.badge)}${r.bad.length ? `  NOT OK: ${JSON.stringify(r.bad)}` : ''}`);
    console.log(`   Guard events (warnings, refusals, page reports): ${JSON.stringify(events).slice(0, 800)}`);

    console.log('\n5. Gas on the fork (X Layer mainnet state):');
    let total = 0;
    for (const g of gas) { console.log(`   ${g.what.padEnd(52)} ${String(g.gas).padStart(10)}`); total += g.gas; }
    console.log(`   ${'total'.padEnd(52)} ${String(total).padStart(10)}`);
    console.log(`   at 0.020000001 gwei: ${(total * 20000001e-18).toFixed(9)} OKB; at 0.0286 gwei (what Rabby paid): ${(total * 2.86e-11).toFixed(9)} OKB`);
    console.log(`\nproject folder (fork only): ${dir}`);
  } finally {
    anvil.kill();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
