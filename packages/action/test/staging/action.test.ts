// The action end to end on the staging chain (pnpm staging:up): the composite action's steps run through
// test/runner.ts while this test plays the approvers. Each run uses a fresh domain.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { loadNetwork } from '@signet/contracts/network';
import { gateAbi, siteReadAbi } from '../../../cli/src/abi.ts';
import { loadSealed } from '../../../cli/src/seal.ts';
import { writeBuild, DRAINER } from '../../../cli/test/fixtures.ts';
import { runAction, type RunResult } from '../runner.ts';

const net = loadNetwork('local');
const pub = createPublicClient({ transport: http(net.rpcUrl) });
const rpc = (method: string, params: unknown[] = []) => pub.request({ method, params } as never);
const CLI = fileURLToPath(new URL('../../../cli/src/cli.ts', import.meta.url));
const proj = mkdtempSync(join(tmpdir(), 'signet-action-'));
const dist = join(proj, 'dist');
const marker = join(proj, 'deployed.txt');
const domain = `act-${Date.now().toString(36)}.signet.test`;
let key = '';

function signet(args: string[], as?: string): string {
  const env: NodeJS.ProcessEnv = { ...process.env, SIGNET_NETWORK: 'local' };
  delete env.SIGNET_PRIVATE_KEY;
  delete env.SIGNET_PROPOSER_KEY;
  const r = spawnSync(process.execPath, [CLI, '-C', proj, ...(as ? ['--as', as] : []), ...args], { encoding: 'utf8', env });
  assert.equal(r.status, 0, `signet ${args.join(' ')}\n${r.stdout}${r.stderr}`);
  return r.stdout + r.stderr;
}
const gate = () => (JSON.parse(readFileSync(join(proj, 'signet.config.json'), 'utf8')) as { gate: Address }).gate;
const gateRead = <T>(functionName: string, args: unknown[] = []) => pub.readContract({ address: gate(), abi: gateAbi, functionName, args } as never) as Promise<T>;
const count = async () => Number(await gateRead<bigint>('proposalCount'));

/// Runs the action the way the example workflow does. The deploy command leaves a marker file.
function action(extra: Record<string, string> = {}): Promise<RunResult> {
  return runAction(
    { 'build-dir': 'dist', 'proposer-key': key, deploy: 'echo "deployed release $SIGNET_RELEASE_ID $SIGNET_MANIFEST_HASH" > deployed.txt', 'poll-interval': '1', 'wait-timeout': '60', ...extra },
    { cwd: proj, env: { SIGNET_NETWORK: 'local', SIGNET_CLI: CLI, SIGNET_PRIVATE_KEY: undefined, SIGNET_PROPOSER_KEY: undefined } },
  );
}
async function until<T>(what: string, f: () => Promise<T | null | false>): Promise<T> {
  for (let i = 0; i < 300; i++) {
    const v = await f();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}
/// The id of the proposal the running action just made (the count goes past `before`).
const nextProposal = (beforeCount: number) => until('the action to propose', async () => ((await count()) > beforeCount ? String(beforeCount + 1) : null));

before(async () => {
  await rpc('anvil_nodeInfo').catch(() => {
    throw new Error(`the staging chain is not running at ${net.rpcUrl}: pnpm staging:up`);
  });
  // a project with one published release (v1), set up by hand like a team would
  signet(['init', '--domain', domain, '--approvers', 'approver1,approver2,approver3', '--recovery', 'recovery', '--guardian', 'guardian', '--no-wait'], 'user1');
  await rpc('anvil_mine', ['0x2']);
  signet(['init'], 'user1');
  key = readFileSync(join(proj, '.signet/proposer.key'), 'utf8').trim();
  rmSync(join(proj, '.signet/proposer.key')); // as in real CI: the key exists only as the secret
  await rpc('anvil_setBalance', [await gateRead<Address>('proposer'), '0xde0b6b3a7640000']);
});

test('first release through the action: it proposes, waits while approvers act, uploads the manifest, then deploys', async () => {
  writeBuild(dist, 'v1');
  const n = await count();
  const running = action({ emergency: 'true' });
  const id = await nextProposal(n);
  assert.ok(!existsSync(marker), 'no deploy while the release is only proposed');
  for (const a of ['approver1', 'approver2', 'approver3']) signet(['approve', id], a);
  await new Promise((r) => setTimeout(r, 4000));
  assert.ok(!existsSync(marker), 'approved is not published: still no deploy');
  signet(['publish', id], 'user2'); // anyone publishes; the action only watches the chain
  const r = await running;
  assert.equal(r.code, 0, r.log);
  assert.deepEqual(r.ran, ['Install the Signet CLI', 'Verify, seal, propose, wait until published on-chain', 'Deploy (the release is published on-chain)']);
  assert.match(r.log, /Result: ready to seal/);
  assert.match(r.log, new RegExp(`Proposed release #${id} for ${domain}`));
  assert.match(r.log, /waiting for #\d+ \(tier 10 allowlist changed\): \d of 3 approvals/);
  assert.match(r.log, /Published: this build is the current release/);
  const m = loadSealed(dist).manifest;
  assert.deepEqual([r.outputs['release-id'], r.outputs.tier, r.outputs['manifest-hash']], [id, '2', m.manifestHash]);
  assert.equal(readFileSync(marker, 'utf8'), `deployed release ${id} ${m.manifestHash}\n`);
  assert.equal(await gateRead<Hex>('currentManifestHash'), m.manifestHash);
  // the manifest files were written on-chain by the action (with the proposer key), before the deploy
  for (const f of ['signet/allowlist.json', 'signet/origins.json', 'signet/files.json']) {
    const onchain = (await pub.readContract({ address: net.tapeout.siteRegistry as Address, abi: siteReadAbi, functionName: 'read', args: [net.tapeout.sharedContainer as Address, `projects/${domain}/${f}`] })) as Hex;
    assert.equal(onchain, `0x${readFileSync(join(dist, f)).toString('hex')}`, f);
  }
  // the key never appears in the log except in the mask command GitHub consumes
  assert.equal(r.log.split(key).length - 1, 1);
  assert.match(r.log, new RegExp(`::add-mask::${key}`));
  assert.match(r.summary, /Diff Guard: proposal #1[\s\S]*first release/);
  assert.equal(JSON.parse(readFileSync(r.outputs['diff-json']!, 'utf8')).proposalId, id);
});

test('re-running the job for the same build proposes nothing and deploys at once', async () => {
  rmSync(marker);
  const n = await count();
  const r = await action();
  assert.equal(r.code, 0, r.log);
  assert.equal(await count(), n);
  assert.match(r.log, /already the current release/);
  assert.equal(r.outputs['release-id'], '');
  assert.ok(existsSync(marker));
});

test('code-only release: no deploy during the 1 h timelock; a timed-out job does not deploy and its re-run picks up the same proposal', async () => {
  rmSync(marker);
  writeBuild(dist, 'v2');
  const n = await count();
  const first = action({ 'wait-timeout': '3' });
  const id = await nextProposal(n);
  signet(['approve', id], 'approver2');
  const r1 = await first;
  assert.equal(r1.code, 3, r1.log);
  assert.match(r1.log, /timelock running/);
  assert.match(r1.log, /was not published within 3s[\s\S]*Not deploying/);
  assert.deepEqual(r1.ran.slice(-1), ['Verify, seal, propose, wait until published on-chain']);
  assert.ok(!existsSync(marker));
  assert.match(r1.summary, /RISK TIER 00 CODE ONLY/);

  const second = action();
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(await count(), n + 1, 'the re-run did not propose again');
  assert.ok(!existsSync(marker));
  await rpc('evm_increaseTime', ['0xe10']);
  await rpc('anvil_mine', ['0x1']);
  signet(['publish', id], 'user3');
  const r2 = await second;
  assert.equal(r2.code, 0, r2.log);
  assert.match(r2.log, new RegExp(`already proposed as #${id}`));
  assert.equal(r2.outputs['release-id'], id);
  assert.ok(existsSync(marker));
});

test('poisoned npm package: the action proposes it as tier 10 with the Diff Guard report; an approver cancels; nothing deploys', async () => {
  rmSync(marker);
  writeBuild(dist, 'poisoned');
  const n = await count();
  const running = action();
  const id = await nextProposal(n);
  await until('the action to start waiting', async () => (await gateRead<{ tier: number }>('getProposal', [BigInt(id)])).tier === 2);
  await new Promise((r) => setTimeout(r, 2000));
  signet(['cancel', id], 'approver1');
  const r = await running;
  assert.equal(r.code, 1, r.log);
  assert.match(r.log, /can't be published any more: cancelled\. Not deploying/);
  assert.ok(!r.ran.includes('Deploy (the release is published on-chain)'));
  assert.ok(!existsSync(marker));
  assert.match(r.summary, new RegExp(`! NEW contract ${DRAINER}`));
  assert.match(r.summary, /! NEW external origin https:\/\/cdn\.connect-kit-assets\.example\.net/);
  assert.match(r.summary, /RISK TIER 10 ALLOWLIST CHANGED/);
  assert.equal(r.outputs.tier, '2');
});

test('a build that signet verify rejects is never proposed; a missing key stops before anything is sent', async () => {
  writeBuild(dist, 'v2', { sri: false });
  const n = await count();
  const r = await action();
  assert.equal(r.code, 1);
  assert.match(r.log, /cross-origin script without SRI/);
  writeBuild(dist, 'v2');
  const noKey = await action({ 'proposer-key': '' });
  assert.equal(noKey.code, 1);
  assert.match(noKey.log, /::error::proposer-key is empty/);
  assert.equal(await count(), n);
  assert.ok(!existsSync(marker));
});
