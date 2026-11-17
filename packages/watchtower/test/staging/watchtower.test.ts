// The watchtower on the staging chain (pnpm staging:up): the demo dApp is sealed with the real CLI and served
// locally; a switch on the test server plays the hijack. Telegram is a local stand-in that records what it gets.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { createWalletClient, encodeAbiParameters, encodeFunctionData, http as viemHttp, type Address } from 'viem';
import { gateAbi } from '@signet/cli/src/abi.ts';
import { writeBuild } from '@signet/cli/test/fixtures.ts';
import { anvil, net, pub, sealDemoDapp, serveSite, signet, until, type Project, type Site } from '@signet/extension/test/staging/harness.ts';
import { allOf, consoleAlerter, telegramAlerter } from '../../src/alerts.ts';
import { tick, type Config } from '../../src/watchtower.ts';
import { domainCount } from '../../src/chain.ts';
import { netFromEnv } from '../../src/cli.ts';

const domain = `tower-${Date.now().toString(36)}.signet.test`;
const TOKEN = '7000000001:TEST-ONLY-not-a-real-token';
const lines: string[] = [];
const telegram: { path: string; chat_id: string; text: string }[] = [];
let project: Project;
let site: Site;
let browser: Browser;
let tg: http.Server;
let config: Config;
let tgUrl = '';
let fromIndex = 0;
const state = join(mkdtempSync(join(tmpdir(), 'tower-')), 'state.json');
const round = async () => {
  const before = { lines: lines.length, telegram: telegram.length };
  const r = await tick(config, browser);
  return { ...r, said: lines.slice(before.lines).join('\n'), sent: telegram.slice(before.telegram) };
};
const bundleLoads = () => site.log.filter((u) => /\/assets\/index-.*\.js$/.test(u)).length;

before(async () => {
  await anvil('anvil_nodeInfo').catch(() => {
    throw new Error(`the staging chain is not running at ${net.rpcUrl}: pnpm staging:up`);
  });
  fromIndex = await domainCount(netFromEnv({ SIGNET_NETWORK: 'local' })); // only domains claimed from here on
  project = await sealDemoDapp(domain);
  site = await serveSite(project.dist);
  tg = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    telegram.push({ path: req.url!, ...JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    res.setHeader('content-type', 'application/json');
    res.end('{"ok":true}');
  });
  await new Promise<void>((r) => tg.listen(0, '127.0.0.1', r));
  tgUrl = `http://127.0.0.1:${(tg.address() as { port: number }).port}`;
  browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP *.signet.test 127.0.0.1'] });
  const log = (l: string) => void lines.push(l);
  config = {
    net: netFromEnv({ SIGNET_NETWORK: 'local' }), fromIndex,
    alert: allOf(consoleAlerter(log), telegramAlerter({ token: TOKEN, chatId: '-1001', publicChatId: '-1002', apiUrl: tgUrl }, log)),
    statePath: state, urlFor: (d) => `http://${d}:${site.port}/`, confirmDelayMs: 200, log,
  };
});
after(async () => {
  await browser?.close();
  site?.close();
  tg?.close();
});

test('first round: the new binding is posted, the site is loaded and matches, nobody is alerted', async () => {
  const r = await round();
  assert.deepEqual([r.domains, r.checked, r.alerts, r.posts], [1, 1, 0, 1]);
  assert.match(r.said, new RegExp(`\\[public\\] New sealed domain: ${domain}`));
  assert.match(r.said, new RegExp(`Gate ${project.gate}`));
  assert.equal(r.sent.length, 1);
  assert.deepEqual([r.sent[0]!.path, r.sent[0]!.chat_id], [`/bot${TOKEN}/sendMessage`, '-1002']); // public posts go to the public chat
  assert.equal(bundleLoads(), 1);
  const again = await round();
  assert.deepEqual([again.checked, again.alerts, again.posts], [1, 0, 0], 'nothing is posted twice');
});

test('one bad load that is clean on the second load is not an alert', async () => {
  site.tamper = 'once';
  const n = bundleLoads();
  const r = await round();
  assert.deepEqual([r.alerts, r.posts], [0, 0]);
  assert.equal(bundleLoads() - n, 2, 'the site was loaded a second time to confirm');
  assert.match(r.said, /mismatch on one load, clean on the next\. Not confirmed, no alert\./);
  assert.equal(r.sent.length, 0);
});

test('hijack: the tampered bundle is seen on two loads in a row, then the team gets one private alert', async () => {
  site.tamper = true;
  const n = bundleLoads();
  const r = await round();
  assert.equal(bundleLoads() - n, 2);
  assert.deepEqual([r.alerts, r.posts], [1, 0]);
  assert.match(r.said, new RegExp(`\\[private\\] ALERT: ${domain} does not match its sealed release`));
  assert.match(r.said, /differs from release #1, on two loads in a row/);
  assert.match(r.said, /- changed: http:\/\/tower-.*\/assets\/index-.*\.js \(sha256 [0-9a-f]{16}… is not the sealed [0-9a-f]{16}…\)/);
  assert.match(r.said, /observe mode: Guard is not blocking users/);
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0]!.chat_id, '-1001', 'the alert goes to the private chat');
  assert.match(r.sent[0]!.text, /^ALERT: tower-.* does not match its sealed release\n/);
  // still hijacked a minute later: the team was already told
  const next = await round();
  assert.deepEqual([next.checked, next.alerts, next.sent.length], [1, 0, 0]);
});

test('the site is fixed: one "recovered" message', async () => {
  site.tamper = false;
  const r = await round();
  assert.deepEqual([r.alerts, r.sent.length], [1, 1]);
  assert.match(r.said, new RegExp(`Recovered: ${domain} matches its sealed release again`));
  assert.equal((await round()).alerts, 0);
});

test('a site that stops answering is alerted after two failed loads', async () => {
  const dead: Config = { ...config, urlFor: (d) => `http://${d}:9/` };
  const before = lines.length;
  const r = await tick(dead, browser);
  assert.equal(r.alerts, 1);
  assert.match(lines.slice(before).join('\n'), new RegExp(`ALERT: ${domain} can't be loaded`));
  assert.equal((await round()).alerts, 1, 'and "recovered" when it is back');
});

test('pending tier-10 and tier-11 proposals are posted once; a code-only proposal is not', async () => {
  // tier 00: the same app with one more static file
  const codeOnly = join(project.dir, 'code-only');
  cpSync(project.dist, codeOnly, { recursive: true });
  writeFileSync(join(codeOnly, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  signet(project.dir, ['seal', codeOnly]);
  assert.match(signet(project.dir, ['propose', codeOnly]), /risk tier {2}00 code only/);
  // tier 10: a build with other contract addresses
  const other = writeBuild(join(project.dir, 'other'), 'poisoned');
  signet(project.dir, ['seal', other]);
  assert.match(signet(project.dir, ['propose', other]), /risk tier {2}10 allowlist changed/);
  signet(project.dir, ['approve', '3'], 'approver2');
  // tier 11: an approver proposes a new guardian
  const wallet = createWalletClient({ transport: viemHttp(net.rpcUrl) });
  const args = encodeAbiParameters([{ type: 'address' }], [net.accounts!.users[2] as Address]);
  const hash = await wallet.sendTransaction({ account: net.accounts!.approvers[0] as Address, to: project.gate, chain: null, data: encodeFunctionData({ abi: gateAbi, functionName: 'proposeAdmin', args: [4, args] }) });
  await until('the admin proposal', () => pub.getTransactionReceipt({ hash }));

  const r = await round();
  assert.deepEqual([r.alerts, r.posts], [0, 2]);
  assert.ok(!/proposal #2/.test(r.said), 'tier 00 is not posted');
  assert.match(r.said, new RegExp(`\\[public\\] Pending tier-10 change on ${domain}: proposal #3`));
  assert.match(r.said, /A release that changes the allowlist of contracts and spenders was proposed/);
  assert.match(r.said, /1 of 3 approvals so far\. It needs 2 of 3 and a 24 h timelock\./);
  assert.match(r.said, /The timelock has not started yet\./);
  assert.match(r.said, new RegExp(`\\[public\\] Pending tier-11 change on ${domain}: proposal #4`));
  assert.match(r.said, /It needs 3 of 3 and a 24 h timelock\./);
  assert.deepEqual(r.sent.map((m) => m.chat_id), ['-1002', '-1002']);
  assert.equal((await round()).posts, 0, 'not posted again');
  // a restart reads the state file and stays quiet too
  assert.ok(Object.keys(JSON.parse(readFileSync(state, 'utf8')).domains).includes(domain));
});

test('a domain bound later is posted when it appears; without a release there is nothing to check', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tower-second-'));
  const second = `tower2-${Date.now().toString(36)}.signet.test`;
  signet(dir, ['init', '--domain', second, '--approvers', 'approver1,approver2,approver3', '--recovery', 'recovery', '--no-wait'], 'user2');
  await anvil('anvil_mine', ['0x2']);
  signet(dir, ['init'], 'user2');
  const r = await round();
  assert.deepEqual([r.domains, r.checked, r.posts, r.alerts], [2, 1, 1, 0]);
  assert.match(r.said, new RegExp(`New sealed domain: ${second}`));
});

test('the command: one round from the environment; the Telegram token never reaches the output', async () => {
  const cli = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
  // async: this process also runs the site and the Telegram stand-in, so it must not block
  const run = (extra: NodeJS.ProcessEnv) => new Promise<{ status: number | null; stdout: string; stderr: string }>((res) => {
    const c = spawn(process.execPath, [cli, '--once'], {
      env: {
        ...process.env, SIGNET_NETWORK: 'local', WATCHTOWER_ONLY: domain, WATCHTOWER_FROM_INDEX: String(fromIndex), WATCHTOWER_URL_TEMPLATE: `http://{domain}:${site.port}/`,
        WATCHTOWER_HOST_RULES: 'MAP *.signet.test 127.0.0.1', WATCHTOWER_STATE: join(mkdtempSync(join(tmpdir(), 'tower-cli-')), 's.json'), TELEGRAM_API_URL: tgUrl, ...extra,
      },
    });
    const out = { status: null as number | null, stdout: '', stderr: '' };
    c.stdout.on('data', (d) => (out.stdout += d));
    c.stderr.on('data', (d) => (out.stderr += d));
    c.on('close', (code) => res({ ...out, status: code }));
  });
  const n = telegram.length;
  site.tamper = true;
  const r = await run({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '-1001' });
  site.tamper = false;
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /watchtower on local \(chain 196\)/);
  assert.match(r.stdout, new RegExp(`New sealed domain: ${domain}`));
  assert.match(r.stdout, /ALERT: .* does not match its sealed release/);
  assert.match(r.stdout, /round done: 1 domain\(s\), 1 site\(s\) loaded, 1 alert\(s\), 3 post\(s\)/); // binding + the two pending proposals
  assert.ok(!(r.stdout + r.stderr).includes(TOKEN) && !(r.stdout + r.stderr).includes('TEST-ONLY'));
  assert.equal(telegram.length - n, 4);
  // without a token: console only
  const quiet = await run({ TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' });
  assert.equal(quiet.status, 0, quiet.stdout + quiet.stderr);
  assert.match(quiet.stdout, /New sealed domain/);
  assert.equal(telegram.length - n, 4);
  if (process.env.SIGNET_SAVE_DEMO) writeFileSync(fileURLToPath(new URL('../../../../docs/demo/watchtower-hijack.txt', import.meta.url)), r.stdout.replaceAll(domain, 'demo.signet.test'));
});
