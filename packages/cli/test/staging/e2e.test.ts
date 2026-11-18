// End-to-end test of every command against the local staging chain (pnpm staging:up, then
// pnpm --filter @signet/cli test:staging). Each run uses a fresh domain, so it can be repeated on one chain.
// The CLI runs as a real subprocess; the test only reads the chain and moves its clock.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { loadNetwork } from '@signet/contracts/network';
import { gateAbi, registryAbi, siteReadAbi } from '../../src/abi.ts';
import { loadSealed } from '../../src/seal.ts';
import { writeBuild, CDN_SRI, DRAINER } from '../fixtures.ts';

const net = loadNetwork('local');
const pub = createPublicClient({ transport: http(net.rpcUrl) });
const rpc = (method: string, params: unknown[] = []) => pub.request({ method, params } as never);
const CLI = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const proj = mkdtempSync(join(tmpdir(), 'signet-e2e-'));
const dist = join(proj, 'dist');
const domain = `e2e-${Date.now().toString(36)}.signet.test`;
const sites = net.tapeout.siteRegistry as Address;

function signet(args: string[], as?: string): { code: number; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, SIGNET_NETWORK: 'local' };
  delete env.SIGNET_PRIVATE_KEY;
  delete env.SIGNET_PROPOSER_KEY;
  const r = spawnSync(process.execPath, [CLI, '-C', proj, ...(as ? ['--as', as] : []), ...args], { encoding: 'utf8', env });
  return { code: r.status ?? -1, out: r.stdout + r.stderr };
}
function ok(args: string[], as?: string): string {
  const r = signet(args, as);
  assert.equal(r.code, 0, `signet ${args.join(' ')}\n${r.out}`);
  return r.out;
}
function fails(args: string[], as: string | undefined, pattern: RegExp): string {
  const r = signet(args, as);
  assert.equal(r.code, 1, `expected failure: signet ${args.join(' ')}\n${r.out}`);
  assert.match(r.out, pattern);
  return r.out;
}
const config = () => JSON.parse(readFileSync(join(proj, 'signet.config.json'), 'utf8')) as { gate: Address; domain: string };
const gateRead = <T>(functionName: string, args: unknown[] = []) => pub.readContract({ address: config().gate, abi: gateAbi, functionName, args } as never) as Promise<T>;
const idOf = (out: string) => out.match(/Proposed release #(\d+)/)![1]!;

before(async () => {
  await rpc('anvil_nodeInfo').catch(() => {
    throw new Error(`the staging chain is not running at ${net.rpcUrl}: pnpm staging:up`);
  });
});

test('init: commit, CommitExists counts as success, reveal 2 blocks later creates the gate and binds the domain', async () => {
  fails(['init', '--domain', 'Not_A_Domain', '--approvers', 'approver1,approver2,approver3', '--recovery', 'recovery'], 'user1', /lowercase domain/);
  fails(['init', '--domain', domain, '--approvers', 'approver1,approver2', '--recovery', 'recovery'], 'user1', /exactly 3/);
  fails(['init', '--domain', domain, '--approvers', 'approver1,approver2,approver3', '--recovery', 'approver1'], 'user1', /must all be different/);

  const first = ok(['init', '--domain', domain, '--approvers', 'approver1,approver2,approver3', '--recovery', 'recovery', '--guardian', 'guardian', '--no-wait'], 'user1');
  assert.match(first, /1\/2 commitment sent/);
  assert.match(first, /Run "signet init" again/);
  assert.ok(!existsSync(join(proj, 'signet.config.json')));

  // the commitment is already there: the CLI must go on, not fail
  const second = ok(['init', '--no-wait'], 'user1');
  assert.match(second, /already on-chain \(CommitExists\): continuing/);
  // too early (the commit is not 2 blocks old) and the wrong key are both refused before anything is sent
  fails(['init', '--wait-seconds', '1'], 'user1', /still waiting for 2 blocks/);
  fails(['init'], 'user2', /finish it with the same key/);

  await rpc('anvil_mine', ['0x2']);
  const third = ok(['init'], 'user1');
  assert.match(third, /CommitExists/);
  assert.match(third, /2\/2 gate created and domain bound/);
  assert.match(third, new RegExp(`_signet\\.${domain.replace(/\./g, '\\.')}\\s+TXT`));

  const cfg = config();
  assert.equal(cfg.domain, domain);
  const [gate, container, prefix] = (await pub.readContract({ address: net.contracts.registry as Address, abi: registryAbi, functionName: 'bindingOf', args: [domain] })) as [Address, Address, string];
  assert.equal(gate, cfg.gate);
  assert.equal(container, net.tapeout.sharedContainer);
  assert.equal(prefix, `projects/${domain}/`);
  const a = net.accounts!;
  assert.deepEqual((await gateRead<Address[]>('getApprovers')).map((x) => x.toLowerCase()), a.approvers);
  assert.equal((await gateRead<Address>('recovery')).toLowerCase(), a.recovery);
  assert.equal((await gateRead<Address>('guardian')).toLowerCase(), a.guardian);

  // the CI key: created in a private, git-ignored file; never printed; the salt is gone after the reveal
  const keyFile = join(proj, '.signet/proposer.key');
  const key = readFileSync(keyFile, 'utf8').trim();
  assert.equal(statSync(keyFile).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(proj, '.signet/.gitignore'), 'utf8'), '*\n');
  for (const out of [first, second, third]) assert.ok(!out.includes(key) && !out.includes(key.slice(2)));
  assert.ok(!readFileSync(join(proj, '.signet/init.json'), 'utf8').includes('salt'));
  const proposer = await gateRead<Address>('proposer');
  assert.match(third, new RegExp(proposer));
  await rpc('anvil_setBalance', [proposer, '0xde0b6b3a7640000']); // gas money for the CI key

  assert.match(ok(['init'], 'user1'), /Already set up/);
});

test('verify + seal: the build is ready and sealed for this domain', () => {
  writeBuild(dist, 'v1', { sri: false });
  fails(['verify', dist], undefined, /cross-origin script without SRI/);
  writeBuild(dist, 'v1');
  assert.match(ok(['verify', dist]), /Result: ready to seal/);
  fails(['propose', dist], undefined, /Run: signet seal/);
  const out = ok(['seal', dist]);
  assert.match(out, /Sealed 7 files/);
  assert.match(out, /0x5FbDB2315678afecb367f032d93F642f64180aa3 {2}\[target\]/);
  assert.equal(loadSealed(dist).manifest.domain, domain);
});

test('first release: tier 10, 3 of 3 on the fast lane, every file written with its Merkle proof', async () => {
  const out = ok(['propose', dist, '--emergency']); // signed with .signet/proposer.key
  assert.match(out, /risk tier {2}10 allowlist changed/);
  const id = idOf(out);
  fails(['approve', id], 'proposer', /NotApprover/); // the staging "proposer" account is not an approver here either
  fails(['approve', id], 'user3', /NotApprover/);
  assert.match(ok(['approve', id], 'approver1'), /needs 1 more approval/);
  fails(['approve', id], 'approver1', /AlreadyApproved/);
  fails(['publish', id, dist], 'user2', /Not yet: the policy circuit refused[\s\S]*needs 1 more approval/);
  assert.match(ok(['approve', id], 'approver2'), /timelock running: can publish at .* \(in 1d\)/);
  fails(['publish', id, dist], 'user2', /timelock running/);
  assert.match(ok(['approve', id], 'approver3'), /emergency fast lane: can publish now/);

  const pubOut = ok(['publish', id, dist, '--full'], 'user2');
  assert.match(pubOut, /Published release #/);
  assert.match(pubOut, /decided by the TapeOut policy circuit/);
  assert.match(pubOut, /wrote   assets\/chunk-vendor-51b0e7d4\.js  \(\d+ bytes in 4 transactions, gas \d+; read back: matches\)/); // over 48 KB: chunked
  assert.match(pubOut, /read back .*signet\/files\.json: matches/);

  // on-chain: the gate's release is this manifest, and SiteRegistry holds the exact bytes
  const b = loadSealed(dist);
  assert.equal(await gateRead<Hex>('currentManifestHash'), b.manifest.manifestHash);
  assert.equal(await gateRead<boolean>('isValidManifest', [b.manifest.manifestHash]), true);
  for (const f of ['index.html', 'signet/allowlist.json', 'signet/origins.json', 'signet/files.json', ...b.files.map((x) => x.path)]) {
    const onchain = (await pub.readContract({ address: sites, abi: siteReadAbi, functionName: 'read', args: [net.tapeout.sharedContainer as Address, `projects/${domain}/${f}`] })) as Hex;
    assert.equal(onchain, `0x${b.bytes(f).toString('hex')}`, f);
  }
  const again = ok(['upload', dist, '--full'], 'user2');
  assert.ok(!/wrote |chunk {3}/.test(again) && /same {4}index\.html/.test(again) && /same {4}assets\/chunk-vendor-51b0e7d4\.js {2}\(4 chunks\)/.test(again), 'a second upload writes nothing');
});

test('code-only release: tier 00, 1 approval, refused until the 1 h timelock is over', async () => {
  writeBuild(dist, 'v2');
  ok(['seal', dist]);
  fails(['upload', dist], 'user2', /not the gate's current release/); // sealed but not published: the registry would refuse it
  const out = ok(['propose', dist]);
  assert.match(out, /risk tier {2}00 code only/);
  assert.match(out, /needs {6}1 approval \+ 1h timelock/);
  const id = idOf(out);
  assert.match(ok(['approve', id], 'approver2'), /1 of 3 approvals, timelock running: can publish at .* \(in 1h\)/);
  assert.match(ok(['status']), new RegExp(`#${id}  release  tier 00 code only[\\s\\S]*timelock running`));

  fails(['publish', id, dist], 'user2', /Not yet[\s\S]*timelock running/);
  await rpc('evm_increaseTime', ['0xe06']); // 59 m 50 s
  await rpc('anvil_mine', ['0x1']);
  fails(['publish', id, dist], 'user2', /Not yet[\s\S]*\(in \d+s\)/);
  await rpc('evm_increaseTime', ['0xa']); // the hour is up
  await rpc('anvil_mine', ['0x1']);
  assert.match(ok(['status']), /timelock over: can publish now/);
  const pubOut = ok(['publish', id, dist], 'user2');
  assert.match(pubOut, /Published release #/);
  assert.match(pubOut, /Writing 3 file\(s\)/); // manifest-only by default
  assert.match(pubOut, /same {4}signet\/allowlist\.json/); // unchanged since release 1
  assert.equal(await gateRead<Hex>('currentManifestHash'), loadSealed(dist).manifest.manifestHash);
  assert.match(ok(['status', dist]), /IS the current release/);
});

test('the tier is computed on-chain: a new address is tier 10, a new origin tier 01; cancel; a changed build is refused', async () => {
  writeBuild(dist, 'v3');
  assert.match(ok(['seal', dist]), /0x9FE46736679D2d9a65F3992F2428666E704Bd4A8 {2}\[target\]/);
  const t10 = ok(['propose', dist]);
  assert.match(t10, /risk tier {2}10 allowlist changed/);
  assert.match(t10, /needs {6}2 approvals \+ 1d timelock/);
  fails(['cancel', idOf(t10)], 'user3', /NotApprover/);
  assert.match(ok(['cancel', idOf(t10)], 'approver3'), /Cancelled/);
  fails(['approve', idOf(t10)], 'approver1', /NotLive/);

  writeBuild(dist, 'v4');
  ok(['seal', dist]);
  const t01 = ok(['propose', dist]);
  assert.match(t01, /risk tier {2}01 new external origin/);
  assert.match(t01, /needs {6}2 approvals \+ 1h timelock/);
  ok(['cancel', idOf(t01)], 'approver1');

  writeFileSync(join(dist, 'assets/injected.js'), 'fetch("https://evil.example.net")');
  fails(['propose', dist], undefined, /changed since the build was sealed/);
  assert.match(ok(['status']), /No open proposals/);
});

test('a changed SRI hash is tier 01 on-chain; Diff Guard shows the old and the new hash', async () => {
  writeBuild(dist, 'v2');
  const OTHER = 'sha384-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  writeFileSync(join(dist, 'index.html'), readFileSync(join(dist, 'index.html'), 'utf8').replace(CDN_SRI, OTHER));
  assert.match(ok(['seal', dist]), /changed SRI hash counts as an origins change/);
  const out = ok(['propose', dist]);
  assert.match(out, /risk tier {2}01 new external origin/);
  assert.match(out, /needs {6}2 approvals \+ 1h timelock/);
  const d = ok(['diff', idOf(out), dist]);
  assert.match(d, /compared with release #2/);
  assert.match(d, /checked: release #2's allowlist, origins and file list \(read from the chain\) hash to its on-chain values/);
  assert.match(d, /RISK TIER 01 NEW EXTERNAL ORIGIN[\s\S]*computed on-chain and matches these files/);
  assert.match(d, new RegExp(`~ CHANGED SRI {2}\\S+\\n\\s+was ${CDN_SRI.replace(/[+/]/g, '\\$&')}\\n\\s+now ${OTHER}`));
  ok(['cancel', idOf(out)], 'approver2');
});

test('Diff Guard on a build with a poisoned npm package: new address, new origin, new approve call, tier 10', async () => {
  writeBuild(dist, 'poisoned');
  ok(['seal', dist]);
  fails(['propose', dist, '--emergency'], undefined, /FastLaneNotAllowed/); // allowlist + origins changed: no fast lane
  const out = ok(['propose', dist]);
  assert.match(out, /risk tier {2}10 allowlist changed/);
  const id = idOf(out);
  // --reuse: the same build is not proposed twice
  const again = JSON.parse(signet(['propose', dist, '--reuse', '--json']).out.split('\n').filter((l) => l.startsWith('{')).pop()!);
  assert.deepEqual([again.id, again.reused, again.current], [id, true, false]);

  const text = ok(['diff', id, dist]);
  assert.match(text, /LOOK AT THESE FIRST/);
  assert.match(text, new RegExp(`! NEW contract ${DRAINER} on chain 196, found in assets/chunk-vendor-`));
  assert.match(text, /! NEW external origin https:\/\/cdn\.connect-kit-assets\.example\.net/);
  assert.match(text, /! NEW ERC-20 approve in the code: 1 \(was 0\)/);
  assert.match(text, /RISK TIER 10 ALLOWLIST CHANGED/);
  assert.match(text, /To publish: 2 approvals \+ 1d timelock/);
  assert.match(text, /Now: 0 of 3 approvals: needs 2 more approvals\./);
  assert.match(text, /Files: 1 changed, 0 added, 0 removed, 5 unchanged/);

  const j = JSON.parse(ok(['diff', id, dist, '--json']));
  assert.equal(j.proposalId, id);
  assert.deepEqual([j.onchain.tier, j.tier.expected, j.onchain.matchesExpected], [2, 2, true]);
  assert.deepEqual(j.allowlist.added.map((a: { address: string }) => a.address), [DRAINER]);
  assert.deepEqual(j.origins.added.map((o: { origin: string }) => o.origin), ['https://cdn.connect-kit-assets.example.net']);
  assert.deepEqual(j.calls.added.map((c: { kind: string }) => c.kind), ['approve', 'transferFrom']);
  assert.equal(j.base.release, '2');
  if (process.env.SIGNET_SAVE_DEMO) {
    const demo = fileURLToPath(new URL('../../../../docs/demo/', import.meta.url));
    mkdirSync(demo, { recursive: true });
    writeFileSync(join(demo, "diff-guard-poisoned.txt"), `$ signet diff ${id} dist\n${text.replaceAll(dist, "dist")}`);
    writeFileSync(join(demo, 'diff-guard-poisoned.json'), JSON.stringify(j, null, 2) + '\n');
  }

  // a different build than the one proposed is refused, and so is a base that is not the release on-chain
  const other = writeBuild(join(proj, 'other'), 'v3');
  ok(['seal', other]);
  fails(['diff', id, other], undefined, /is not the build that was proposed as #/);
  fails(['diff', id, dist, '--base', other], undefined, /do not hash to release #2/);
  ok(['cancel', id], 'approver1');
});

test('freeze stops publishing; 2 approvers unfreeze', async () => {
  writeBuild(dist, 'v2');
  // v2 is the current release already; make a code-only v2b so there is something to publish
  writeFileSync(join(dist, 'robots.txt'), 'User-agent: *\nDisallow: /admin\n');
  ok(['seal', dist]);
  const id = idOf(ok(['propose', dist]));
  ok(['approve', id], 'approver1');
  await rpc('evm_increaseTime', ['0xe10']);
  await rpc('anvil_mine', ['0x1']);

  fails(['freeze'], 'user3', /NotFreezer/);
  assert.match(ok(['freeze'], 'guardian'), /FROZEN by guardian/);
  assert.equal(await gateRead<boolean>('frozen'), true);
  fails(['freeze'], 'approver1', /AlreadyFrozen/);
  assert.match(ok(['status']), /state {6}FROZEN \(0 of 2 unfreeze approvals\)/);
  fails(['publish', id, dist], 'user2', /Not yet[\s\S]*FROZEN/);

  fails(['unfreeze'], 'guardian', /NotApprover/); // the guardian can only freeze
  assert.match(ok(['unfreeze'], 'approver1'), /1 of 2[\s\S]*Still frozen/);
  assert.equal(await gateRead<boolean>('frozen'), true);
  const un = ok(['unfreeze'], 'approver2');
  assert.match(un, /Unfrozen/);
  assert.match(un, /decided by the TapeOut policy circuit/);
  assert.equal(await gateRead<boolean>('frozen'), false);
  assert.match(ok(['publish', id, dist], 'user2'), /Published release #/);
});

test('guards: no key, wrong network, --as outside staging', () => {
  fails(['approve', '1'], undefined, /No signing key/);
  const r = spawnSync(process.execPath, [CLI, '-C', proj, 'status'], { encoding: 'utf8', env: { ...process.env, SIGNET_NETWORK: 'mainnet' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is for network "local" but SIGNET_NETWORK is "mainnet"/);
  const fresh = mkdtempSync(join(tmpdir(), 'signet-e2e-'));
  const m = spawnSync(process.execPath, [CLI, '-C', fresh, '--as', 'user1', 'init', '--domain', 'x.example.org', '--approvers', 'a,b,c', '--recovery', 'd'], { encoding: 'utf8', env: { ...process.env, SIGNET_NETWORK: 'mainnet' } });
  assert.equal(m.status, 1);
  // Signet is on mainnet now (docs/mainnet.md), so the guard that stops it is --as (test accounts exist only on staging)
  assert.match(m.stderr, /--as works only on the local staging chain/);
});
