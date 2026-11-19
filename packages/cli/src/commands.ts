// The commands that talk to the chain: init, propose, approve, publish (+ upload), status, freeze, unfreeze, cancel.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseEventLogs, getAddress, isAddress, zeroAddress, formatEther, type Address, type Hex, type TransactionReceipt } from 'viem';
import { gateAbi, factoryAbi, registryAbi, siteReadAbi } from './abi.ts';
import {
  SignetError, CONFIG_NAME, needDeployed, needProject, signerFor, resolveAddress, newKeyFile, addressOfKeyFile, statePath,
  read, send, errorName, chainTime, fmtTime, fmtSpan, showPath, type Ctx, type ProjectConfig, type Signer,
} from './chain.ts';
import { sha256Hex } from './merkle.ts';
import { loadSealed, parseSealed, isValidDomain, isOnchainPath, ALLOWLIST_PATH, ORIGINS_PATH, FILES_PATH, MAX_ONCHAIN_BYTES, MAX_CHUNKS, type SealedBuild, type SealedLists } from './seal.ts';
import { CHUNK_BYTES } from './merkle.ts';
import { diffSealed, formatDiff, type DiffReport } from './diff.ts';

type Log = (line?: string) => void;
const KEYS = ['SIGNET_PRIVATE_KEY'];
const TIERS = ['00 code only', '01 new external origin', '10 allowlist changed', '11 admin change']; // 01 also covers a changed SRI hash
const NEED = [1, 2, 2, 3];
const popcount = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1);

// ---------------------------------------------------------------- init

export interface InitOptions { domain?: string; approvers?: string; proposer?: string; recovery?: string; guardian?: string; wait?: boolean; waitSeconds?: number }
interface InitState {
  network: string; domain: string; claimant: Address; salt: Hex; commitment: Hex;
  approvers: Address[]; proposer: Address; recovery: Address; guardian: Address; gate?: Address;
}

export async function init(ctx: Ctx, o: InitOptions, log: Log): Promise<{ gate: Address | null; waiting: boolean }> {
  const { factory, registry } = needDeployed(ctx);
  const stateFile = statePath(ctx.dir, 'init.json');
  const keyFile = statePath(ctx.dir, 'proposer.key');
  let st: InitState | null = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, 'utf8')) as InitState) : null;
  if (st && (st.network !== ctx.net.name || (o.domain && o.domain !== st.domain))) st = null; // a different project: start over
  const signer = await signerFor(ctx, KEYS);

  if (st?.gate || ctx.config?.gate) {
    log(`Already set up: ${st?.domain ?? ctx.config!.domain} is protected by gate ${st?.gate ?? ctx.config!.gate} (${CONFIG_NAME}).`);
    return { gate: (st?.gate ?? ctx.config!.gate) as Address, waiting: false };
  }

  if (!st) {
    const domain = o.domain;
    if (!domain || !isValidDomain(domain)) throw new SignetError('domain', `--domain must be a lowercase domain name like app.example.org (got "${domain ?? ''}")`);
    const approvers = (o.approvers ?? '').split(',').filter(Boolean).map((a) => resolveAddress(ctx.net, a.trim()));
    if (approvers.length !== 3) throw new SignetError('approvers', '--approvers needs exactly 3 addresses, separated by commas');
    if (!o.recovery) throw new SignetError('recovery', '--recovery <address> is required (a key kept offline that can replace the approvers after 7 days)');
    const recovery = resolveAddress(ctx.net, o.recovery);
    const guardian = !o.guardian || o.guardian === 'none' ? zeroAddress : resolveAddress(ctx.net, o.guardian);
    let proposer: Address;
    if (o.proposer) proposer = resolveAddress(ctx.net, o.proposer);
    else {
      proposer = existsSync(keyFile) ? addressOfKeyFile(keyFile) : newKeyFile(keyFile);
      log(`CI proposer key: created a new key for ${proposer}. It can only propose releases.`);
      log(`  saved to ${showPath(keyFile)} (git-ignored, readable only by you; the key is never printed)`);
    }
    const roles = [...approvers, proposer, recovery, ...(guardian === zeroAddress ? [] : [guardian])];
    if (new Set(roles.map((a) => a.toLowerCase())).size !== roles.length) throw new SignetError('roles', 'the 3 approvers, the proposer, the recovery address and the guardian must all be different addresses');
    const salt = `0x${randomBytes(32).toString('hex')}` as Hex;
    const commitment = await read<Hex>(ctx, { address: factory, abi: factoryAbi, functionName: 'commitmentOf', args: [domain, salt, signer.address] });
    st = { network: ctx.net.name, domain, claimant: signer.address, salt, commitment, approvers, proposer, recovery, guardian };
    writeFileSync(stateFile, JSON.stringify(st, null, 2) + '\n'); // saved before the commit is sent, so a rerun can finish it
  }
  if (st.claimant.toLowerCase() !== signer.address.toLowerCase()) throw new SignetError('claimant', `this setup was started by ${st.claimant}; finish it with the same key (you are ${signer.address})`);

  const bound = await read<Address>(ctx, { address: registry, abi: registryAbi, functionName: 'gateOf', args: [st.domain] });
  if (bound !== zeroAddress) throw new SignetError('AlreadyBound', `${st.domain} is already bound to gate ${bound}. If that is your gate, put it in ${CONFIG_NAME}.`);

  log(`Setting up ${st.domain} on ${ctx.net.name} (chain ${ctx.net.chainId}) as ${signer.label}`);
  // Step 1: commit. The hash hides the domain, so nobody can copy the claim out of the mempool.
  try {
    const r = await send(ctx, signer, { address: factory, abi: factoryAbi, functionName: 'commit', args: [st.commitment] });
    log(`1/2 commitment sent (tx ${r.transactionHash}, block ${r.blockNumber}). The domain stays hidden until step 2.`);
  } catch (e) {
    if (!(e instanceof SignetError) || e.code !== 'CommitExists') throw e;
    log('1/2 commitment is already on-chain (CommitExists): continuing to the reveal.'); // success, not an error
  }
  const [commitBlock, commitTime] = await read<[bigint, bigint]>(ctx, { address: factory, abi: factoryAbi, functionName: 'commits', args: [st.commitment] });
  if (commitBlock === 0n) throw new SignetError('NoCommit', 'the commitment is not on-chain. Run signet init again.');
  if ((await chainTime(ctx)) > Number(commitTime) + 7 * 86400) {
    writeFileSync(stateFile, JSON.stringify({ ...st, salt: undefined }, null, 2));
    throw new SignetError('CommitExpired', `the commitment is older than 7 days. Delete ${stateFile} and run signet init again.`);
  }

  // Step 2 must be mined at least 2 blocks after the commit.
  const ready = async () => (await ctx.pub.getBlockNumber()) >= commitBlock + 2n;
  if (!(await ready())) {
    if (o.wait === false) {
      log(`    The reveal needs 2 more blocks. Run "signet init" again to finish${ctx.net.name === 'local' ? ' (staging: pnpm staging:time blocks 2)' : ''}.`);
      return { gate: null, waiting: true };
    }
    log('    waiting for 2 blocks...');
    const deadline = Date.now() + (o.waitSeconds ?? 120) * 1000;
    while (!(await ready())) {
      if (Date.now() > deadline) throw new SignetError('wait', `still waiting for 2 blocks after the commit. Run "signet init" again to finish${ctx.net.name === 'local' ? ' (staging mines only on demand: pnpm staging:time blocks 2)' : ''}.`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Step 2: one transaction deploys the gate, sets the roles and binds the domain.
  const receipt = await send(ctx, signer, {
    address: factory, abi: factoryAbi, functionName: 'createGate',
    args: [st.approvers, st.proposer, st.recovery, st.guardian, [{ domain: st.domain, salt: st.salt, circuits: zeroAddress, tokenId: 0n }]],
  });
  const created = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: 'GateCreated' })[0];
  if (!created) throw new SignetError('init', `createGate succeeded but no GateCreated event was found (tx ${receipt.transactionHash})`);
  const gate = getAddress(created.args.gate);
  st.gate = gate;
  writeFileSync(stateFile, JSON.stringify({ ...st, salt: undefined }, null, 2) + '\n');
  const config: ProjectConfig = { network: ctx.net.name, chainId: ctx.net.chainId, domain: st.domain, gate };
  writeFileSync(join(ctx.dir, CONFIG_NAME), JSON.stringify(config, null, 2) + '\n');
  const [, container, prefix] = await read<[Address, Address, string]>(ctx, { address: registry, abi: registryAbi, functionName: 'bindingOf', args: [st.domain] });

  log(`2/2 gate created and domain bound (tx ${receipt.transactionHash}, gas ${receipt.gasUsed})`);
  log();
  log(`  gate        ${gate}`);
  log(`  domain      ${st.domain}  ->  ${container} / ${prefix}`);
  st.approvers.forEach((a, i) => log(`  approver ${i + 1}  ${a}`));
  log(`  proposer    ${st.proposer}  (CI: can only propose)`);
  log(`  recovery    ${st.recovery}`);
  log(`  guardian    ${st.guardian === zeroAddress ? 'none' : `${st.guardian}  (can only freeze)`}`);
  log(`  mode        observe (Guard reports, never blocks, until you turn enforcement on)`);
  log(`  wrote       ${CONFIG_NAME}`);
  log();
  log('Next steps');
  log(`  1. Prove the domain is yours: add the DNS record   _signet.${st.domain}  TXT  "gate=${gate}; chain=${ctx.net.chainId}"`);
  log('  2. Check your build:        signet verify <buildDir>      (then: signet verify https://' + st.domain + ' --build <buildDir>)');
  log('  3. Seal it:                 signet seal <buildDir>        and review the allowlist it prints');
  log('  4. Propose the release:     signet propose <buildDir>');
  log('  5. Approvers:               signet approve <id>, then signet publish <id> <buildDir>');
  if (!o.proposer) log(`  6. CI: add the content of ${showPath(keyFile)} as the secret SIGNET_PROPOSER_KEY, fund ${st.proposer} with a little OKB for gas, then delete the file`);
  else log('  6. CI: add the proposer key as the secret SIGNET_PROPOSER_KEY');
  return { gate, waiting: false };
}

// ---------------------------------------------------------------- gate state

interface Proposal {
  kind: number; tier: number; emergency: boolean; executed: boolean; cancelled: boolean; approvals: number; proposerSlot: number;
  proposedAt: number; readyAt: number; baseRelease: bigint; baseline: bigint; approverSet: bigint;
  filesRoot: Hex; allowlistHash: Hex; originsHash: Hex; adminData: Hex;
}
interface GateState {
  approvers: readonly Address[]; proposer: Address; recovery: Address; guardian: Address; frozen: boolean; enforced: boolean;
  shortDelay: number; longDelay: number; graceWindow: number; proposalCount: bigint; currentRelease: bigint; approverSet: bigint; unfreezeApprovals: number;
}

async function gateState(ctx: Ctx, gate: Address): Promise<GateState> {
  const g = <T>(functionName: string) => read<T>(ctx, { address: gate, abi: gateAbi, functionName });
  const [approvers, proposer, recovery, guardian, frozen, enforced, shortDelay, longDelay, graceWindow, proposalCount, currentRelease, approverSet, unfreezeApprovals] = await Promise.all([
    g<readonly Address[]>('getApprovers'), g<Address>('proposer'), g<Address>('recovery'), g<Address>('guardian'), g<boolean>('frozen'), g<boolean>('enforced'),
    g<number>('shortDelay'), g<number>('longDelay'), g<number>('graceWindow'), g<bigint>('proposalCount'), g<bigint>('currentRelease'), g<bigint>('approverSet'), g<number>('unfreezeApprovals'),
  ]);
  return { approvers, proposer, recovery, guardian, frozen, enforced, shortDelay, longDelay, graceWindow, proposalCount, currentRelease, approverSet, unfreezeApprovals };
}

async function getProposal(ctx: Ctx, gate: Address, id: bigint): Promise<Proposal> {
  const p = await read<Proposal>(ctx, { address: gate, abi: gateAbi, functionName: 'getProposal', args: [id] });
  if (Number(p.kind) === 0) throw new SignetError('NotLive', `there is no proposal #${id} on this gate`);
  return { ...p, proposedAt: Number(p.proposedAt), readyAt: Number(p.readyAt) };
}

/// Where a proposal stands, in words. The contract (through the policy circuit) has the last word; this explains it.
export function describeProposal(p: Proposal, s: GateState, now: number): { open: boolean; publishable: boolean; text: string } {
  const count = popcount(p.approvals);
  const need = NEED[p.tier]!;
  const votes = `${count} of 3 approvals`;
  if (p.executed) return { open: false, publishable: false, text: p.kind === 1 ? 'published' : 'executed' };
  if (p.cancelled) return { open: false, publishable: false, text: 'cancelled' };
  if (p.approverSet !== s.approverSet) return { open: false, publishable: false, text: 'void (the approvers changed)' };
  if (now > p.proposedAt + 7 * 86400) return { open: false, publishable: false, text: 'expired' };
  if (p.kind === 1 && p.baseRelease !== s.currentRelease) return { open: false, publishable: false, text: 'stale (another release was published since): propose again' };
  const frozen = s.frozen ? ' The gate is FROZEN: nothing publishes until 2 approvers unfreeze.' : '';
  if (p.emergency && count === 3 && (p.tier === 0 || p.tier === 2)) return { open: true, publishable: !s.frozen, text: `${votes}, emergency fast lane: can publish now.${frozen}` };
  if (p.readyAt === 0) {
    const fast = p.emergency && (p.tier === 0 || p.tier === 2) ? ' (or 3 of 3 to publish at once)' : '';
    return { open: true, publishable: false, text: `${votes}: needs ${need - count} more approval${need - count > 1 ? 's' : ''}${fast}.${frozen}` };
  }
  const at = p.readyAt + (p.tier <= 1 ? s.shortDelay : s.longDelay);
  if (now >= at) return { open: true, publishable: !s.frozen, text: `${votes}, timelock over: can publish now.${frozen}` };
  return { open: true, publishable: false, text: `${votes}, timelock running: can publish at ${fmtTime(at)} (in ${fmtSpan(at - now)}).${frozen}` };
}

function ruleOf(tier: number, s: GateState, emergency: boolean): string {
  const fast = emergency && (tier === 0 || tier === 2) ? ', or 3 of 3 approvals at once (emergency fast lane)' : '';
  return `${NEED[tier]} approval${NEED[tier]! > 1 ? 's' : ''} + ${fmtSpan(tier <= 1 ? s.shortDelay : s.longDelay)} timelock${fast}`;
}

function checkBuild(build: SealedBuild, cfg: ProjectConfig): void {
  if (build.manifest.domain !== cfg.domain) throw new SignetError('domain', `this build was sealed for ${build.manifest.domain}, but the project is ${cfg.domain}`);
}

// ---------------------------------------------------------------- propose / approve / cancel

export interface ProposeResult { id: bigint | null; reused: boolean; current: boolean; tier: number | null; manifestHash: Hex }

const sameHashes = (a: { filesRoot: Hex; allowlistHash: Hex; originsHash: Hex }, b: { filesRoot: Hex; allowlistHash: Hex; originsHash: Hex }) =>
  a.filesRoot === b.filesRoot && a.allowlistHash === b.allowlistHash && a.originsHash === b.originsHash;

/// The newest open release proposal for exactly these three hashes, if any (looks at the last 25 proposals).
async function findOpenProposal(ctx: Ctx, gate: Address, m: { filesRoot: Hex; allowlistHash: Hex; originsHash: Hex }): Promise<{ id: bigint; p: Proposal } | null> {
  const [s, now] = [await gateState(ctx, gate), await chainTime(ctx)];
  for (let id = s.proposalCount; id >= 1n && id > s.proposalCount - 25n; id--) {
    const p = await getProposal(ctx, gate, id);
    if (p.kind === 1 && sameHashes(p, m) && describeProposal(p, s, now).open) return { id, p };
  }
  return null;
}

async function isCurrentRelease(ctx: Ctx, gate: Address, m: { filesRoot: Hex; allowlistHash: Hex; originsHash: Hex }): Promise<boolean> {
  const [filesRoot, allowlistHash, originsHash, ok] = await read<[Hex, Hex, Hex, boolean]>(ctx, { address: gate, abi: gateAbi, functionName: 'activeRelease' });
  return ok && sameHashes({ filesRoot, allowlistHash, originsHash }, m);
}

/// `reuse` (what CI uses, so a re-run job doesn't propose twice): if this exact build is already the current
/// release, or already has an open proposal, nothing is sent.
export async function propose(ctx: Ctx, buildDir: string, o: { emergency?: boolean; reuse?: boolean }, log: Log): Promise<ProposeResult> {
  const cfg = needProject(ctx);
  const build = loadSealed(buildDir);
  checkBuild(build, cfg);
  const m = build.manifest;
  if (o.reuse) {
    if (await isCurrentRelease(ctx, cfg.gate, m)) {
      log(`This build is already the current release of ${cfg.domain} (manifest ${m.manifestHash}). Nothing to propose.`);
      return { id: null, reused: false, current: true, tier: null, manifestHash: m.manifestHash };
    }
    const open = await findOpenProposal(ctx, cfg.gate, m);
    if (open) {
      const d = describeProposal(open.p, await gateState(ctx, cfg.gate), await chainTime(ctx));
      log(`This build is already proposed as #${open.id} (tier ${TIERS[open.p.tier]}): ${d.text}`);
      return { id: open.id, reused: true, current: false, tier: open.p.tier, manifestHash: m.manifestHash };
    }
  }
  const signer = await signerFor(ctx, ['SIGNET_PROPOSER_KEY', ...KEYS], statePath(ctx.dir, 'proposer.key'));
  const receipt = await send(ctx, signer, { address: cfg.gate, abi: gateAbi, functionName: 'proposeRelease', args: [m.filesRoot, m.allowlistHash, m.originsHash, !!o.emergency] });
  const ev = parseEventLogs({ abi: gateAbi, logs: receipt.logs, eventName: 'Proposed' })[0]!;
  const s = await gateState(ctx, cfg.gate);
  log(`Proposed release #${ev.args.id} for ${cfg.domain} as ${signer.label}`);
  log(`  manifest   ${ev.args.manifestHash}`);
  log(`  risk tier  ${TIERS[ev.args.tier]} (computed on-chain from the allowlist and origins hashes)`);
  log(`  needs      ${ruleOf(ev.args.tier, s, ev.args.emergency)}`);
  log(`  tx         ${receipt.transactionHash} (gas ${receipt.gasUsed})`);
  log(`Next: an approver runs  signet diff ${ev.args.id} ${buildDir}  and then  signet approve ${ev.args.id}`);
  return { id: ev.args.id, reused: false, current: false, tier: ev.args.tier, manifestHash: m.manifestHash };
}

// ---------------------------------------------------------------- wait (CI)

export const WAIT_TIMEOUT = 3; // exit code: not published in time (the proposal may still be open)

/// Polls until this exact build is the gate's current release. Throws when the proposal can't publish any more
/// (cancelled, expired, stale) or on timeout. Without `publish` it sends nothing and needs no key.
/// With `publish` (what the GitHub Action uses) it also sends the `publish` call as soon as the approvals and
/// the timelock are there. Anyone may send that call and the policy circuit decides: it gives the key no say
/// over what gets published, and a call sent too early is simply refused.
export async function wait(ctx: Ctx, buildDir: string, o: { timeout: number; interval: number; publish?: boolean }, log: Log): Promise<void> {
  const cfg = needProject(ctx);
  const build = loadSealed(buildDir);
  checkBuild(build, cfg);
  const m = build.manifest;
  const started = Date.now();
  let last = '';
  const say = (line: string) => {
    if (line !== last) log(line);
    last = line;
  };
  for (;;) {
    if (await isCurrentRelease(ctx, cfg.gate, m)) {
      log(`Published: this build is the current release of ${cfg.domain} (manifest ${m.manifestHash}).`);
      return;
    }
    const s = await gateState(ctx, cfg.gate);
    let mine: { id: bigint; p: Proposal } | null = null;
    for (let id = s.proposalCount; id >= 1n && id > s.proposalCount - 25n && !mine; id--) {
      const p = await getProposal(ctx, cfg.gate, id);
      if (p.kind === 1 && sameHashes(p, m)) mine = { id, p };
    }
    if (!mine) throw new SignetError('NotProposed', `this build has not been proposed. Run: signet propose ${buildDir}`);
    const d = describeProposal(mine.p, s, await chainTime(ctx));
    if (mine.p.executed) throw new SignetError('NotCurrent', `#${mine.id} was published, but it is not the gate's valid current release (revoked, or replaced by a newer release). Not deploying.`);
    if (!d.open) throw new SignetError('Closed', `#${mine.id} can't be published any more: ${d.text}. Not deploying.`);
    say(`waiting for #${mine.id} (tier ${TIERS[mine.p.tier]}): ${d.text}`);
    if (o.publish && d.publishable) {
      const signer = await signerFor(ctx, ['SIGNET_PROPOSER_KEY', ...KEYS], statePath(ctx.dir, 'proposer.key'));
      try {
        const receipt = await send(ctx, signer, { address: cfg.gate, abi: gateAbi, functionName: 'publish', args: [mine.id] }, { pad: true });
        log(`Published release #${mine.id} as ${signer.label} (tx ${receipt.transactionHash}, gas ${receipt.gasUsed})`);
        fallbackNote(receipt, log);
        continue; // the next look at the chain confirms it
      } catch (e) {
        // refused (someone withdrew an approval, froze, or published first): keep watching; anything else is a real error
        if (!(e instanceof SignetError) || !['PolicyDenied', 'NotLive', 'StaleBase', 'Expired'].includes(e.code)) throw e;
        say(`publish was refused just now (${e.code}); still watching #${mine.id}`);
      }
    }
    if (Date.now() - started > o.timeout * 1000) {
      const e = new SignetError('timeout', `#${mine.id} was not published within ${fmtSpan(o.timeout)}. It is still open: ${d.text}\n  Not deploying. Run this again (re-run the CI job) once it is published; the same proposal is picked up.`);
      (e as SignetError & { exitCode?: number }).exitCode = WAIT_TIMEOUT;
      throw e;
    }
    await new Promise((r) => setTimeout(r, o.interval * 1000));
  }
}

// ---------------------------------------------------------------- diff (Diff Guard)

async function siteBytes(ctx: Ctx, container: Address, path: string): Promise<Buffer | null> {
  try {
    const hex = await ctx.pub.readContract({ address: ctx.net.tapeout.siteRegistry as Address, abi: siteReadAbi, functionName: 'read', args: [container, path] });
    return hex === '0x' ? null : Buffer.from(hex.slice(2), 'hex');
  } catch {
    return null; // NoSuchFile
  }
}

export interface DiffResult extends DiffReport {
  gate: Address;
  proposalId: string;
  onchain: { tier: number; tierName: string; matchesExpected: boolean; emergency: boolean; rule: string; status: string; open: boolean; publishable: boolean; proposedAt: number; expiresAt: number };
  checked: string[];
}

/// Compares proposal #id with the release its tier was computed against. Nothing here is taken on trust:
/// the build must hash to the proposal's on-chain values, and the base release's lists (read from the chain, or
/// from --base <sealed dir>) must hash to that release's on-chain values.
export async function diff(ctx: Ctx, id: bigint, buildDir: string, o: { base?: string; json?: boolean }, log: Log): Promise<DiffResult> {
  const cfg = needProject(ctx);
  const { registry } = needDeployed(ctx);
  const p = await getProposal(ctx, cfg.gate, id);
  if (p.kind !== 1) throw new SignetError('admin', `#${id} is an admin change (tier 11), not a release: there are no files to compare`);
  const build = loadSealed(buildDir);
  checkBuild(build, cfg);
  if (!sameHashes(p, build.manifest)) {
    throw new SignetError('build', `${buildDir} is not the build that was proposed as #${id}.\n  proposal  filesRoot ${p.filesRoot}\n  this dir  filesRoot ${build.manifest.filesRoot}\n  Review the exact bytes CI proposed (its build artifact), or rebuild the same commit.`);
  }
  const checked = [`${buildDir} hashes to proposal #${id}'s filesRoot, allowlistHash and originsHash on-chain`];

  let base: (SealedLists & { release: string }) | null = null;
  if (p.baseline !== 0n) {
    const [manifestHash, filesRoot, allowlistHash, originsHash] = await read<[Hex, Hex, Hex, Hex, number, bigint]>(ctx, { address: cfg.gate, abi: gateAbi, functionName: 'releases', args: [p.baseline] });
    let lists: SealedLists;
    let source: string;
    if (o.base) {
      lists = loadSealed(o.base).sealed;
      source = o.base;
    } else {
      const [, container, prefix] = await read<[Address, Address, string]>(ctx, { address: registry, abi: registryAbi, functionName: 'bindingOf', args: [cfg.domain] });
      const got = await Promise.all([ALLOWLIST_PATH, ORIGINS_PATH, FILES_PATH].map((f) => siteBytes(ctx, container, prefix + f)));
      if (got.some((b) => b === null)) throw new SignetError('base', `release #${p.baseline}'s sealed lists are not on-chain (was "signet upload" run for it?). Pass --base <its sealed build dir>.`);
      lists = parseSealed(cfg.domain, got[0]!, got[1]!, got[2]!);
      source = 'read from the chain';
    }
    if (lists.manifestHash !== manifestHash || !sameHashes(lists, { filesRoot, allowlistHash, originsHash })) {
      throw new SignetError('base', `the sealed lists ${o.base ? `in ${o.base}` : 'stored on-chain'} do not hash to release #${p.baseline} (the files of a different release?). ${o.base ? '' : 'Pass --base <the sealed build dir of that release>.'}`);
    }
    checked.push(`release #${p.baseline}'s allowlist, origins and file list (${source}) hash to its on-chain values`);
    base = { ...lists, release: String(p.baseline) };
  }

  const report = diffSealed(cfg.domain, base, build.sealed, (path) => build.bytes(path).toString('utf8'));
  const [s, now] = [await gateState(ctx, cfg.gate), await chainTime(ctx)];
  const d = describeProposal(p, s, now);
  const result: DiffResult = {
    ...report,
    gate: cfg.gate,
    proposalId: String(id),
    onchain: {
      tier: p.tier, tierName: TIERS[p.tier]!, matchesExpected: p.tier === report.tier.expected, emergency: p.emergency, rule: ruleOf(p.tier, s, p.emergency),
      status: d.text, open: d.open, publishable: d.publishable, proposedAt: p.proposedAt, expiresAt: p.proposedAt + 7 * 86400,
    },
    checked,
  };
  if (!result.onchain.matchesExpected) result.flags.unshift(`The chain says tier ${TIERS[p.tier]}, but these files give tier ${report.tier.name}. Do not approve; report this.`);
  if (o.json) log(JSON.stringify(result, null, 2));
  else {
    const head = [
      `Diff Guard: proposal #${id} for ${cfg.domain}, compared with ${base ? `release #${base.release}` : 'nothing (first release)'}`,
      ...checked.map((c) => `  checked: ${c}`),
    ];
    const tail = [
      `  The tier was computed on-chain${result.onchain.matchesExpected ? ' and matches these files' : `: ${TIERS[p.tier]}. IT DOES NOT MATCH THESE FILES`}.`,
      `  To publish: ${result.onchain.rule}`,
      `  Now: ${d.text}`,
    ];
    if (result.flags.length) head.push('', 'LOOK AT THESE FIRST', ...result.flags.map((f) => `  ! ${f}`));
    else head.push('', 'Nothing new that a wallet could be asked to sign, and no new place the site talks to.');
    log(formatDiff(report, head, tail));
  }
  return result;
}

export async function approve(ctx: Ctx, id: bigint, log: Log): Promise<void> {
  const cfg = needProject(ctx);
  const signer = await signerFor(ctx, KEYS);
  await getProposal(ctx, cfg.gate, id);
  const receipt = await send(ctx, signer, { address: cfg.gate, abi: gateAbi, functionName: 'approve', args: [id] });
  const [p, s, now] = [await getProposal(ctx, cfg.gate, id), await gateState(ctx, cfg.gate), await chainTime(ctx)];
  log(`Approved #${id} as ${signer.label} (tx ${receipt.transactionHash})`);
  log(`  tier ${TIERS[p.tier]}: ${describeProposal(p, s, now).text}`);
}

export async function cancel(ctx: Ctx, id: bigint, log: Log): Promise<void> {
  const cfg = needProject(ctx);
  const signer = await signerFor(ctx, KEYS);
  const receipt = await send(ctx, signer, { address: cfg.gate, abi: gateAbi, functionName: 'cancel', args: [id] });
  log(`Cancelled #${id} as ${signer.label} (tx ${receipt.transactionHash})`);
}

// ---------------------------------------------------------------- publish + upload

function fallbackNote(receipt: TransactionReceipt, log: Log): void {
  const logs = parseEventLogs({ abi: gateAbi, logs: receipt.logs });
  if (logs.some((l) => l.eventName === 'PolicyFallbackBeaconChanged' || l.eventName === 'PolicyFallbackEvalFailed')) {
    log('  note: the policy circuit could not be read in this transaction; the on-chain Solidity mirror of the same policy decided.');
  } else log('  decided by the TapeOut policy circuit');
}

export async function publish(ctx: Ctx, id: bigint, buildDir: string | undefined, o: { full?: boolean; upload?: boolean }, log: Log): Promise<void> {
  const cfg = needProject(ctx);
  const signer = await signerFor(ctx, KEYS); // anyone may publish; the circuit decides
  const before = await getProposal(ctx, cfg.gate, id);
  let build: SealedBuild | null = null;
  if (before.kind === 1 && buildDir) {
    build = loadSealed(buildDir);
    checkBuild(build, cfg);
    const m = build.manifest;
    if (m.filesRoot !== before.filesRoot || m.allowlistHash !== before.allowlistHash || m.originsHash !== before.originsHash) {
      throw new SignetError('build', `${buildDir} is not the build that was proposed as #${id}`);
    }
  }
  let receipt: TransactionReceipt;
  try {
    receipt = await send(ctx, signer, { address: cfg.gate, abi: gateAbi, functionName: 'publish', args: [id] }, { pad: true });
  } catch (e) {
    if (e instanceof SignetError && e.code === 'PolicyDenied') {
      const d = describeProposal(before, await gateState(ctx, cfg.gate), await chainTime(ctx));
      throw new SignetError('PolicyDenied', `Not yet: the policy circuit refused to publish #${id}.\n  tier ${TIERS[before.tier]}: ${d.text}`);
    }
    throw e;
  }
  log(`Published ${before.kind === 1 ? 'release' : 'admin change'} #${id} (tx ${receipt.transactionHash}, gas ${receipt.gasUsed})`);
  fallbackNote(receipt, log);
  if (before.kind !== 1) return;
  if (!build) log(`  The release is live on-chain. Guard also needs its files: signet upload <buildDir>`);
  else if (o.upload !== false) await upload(ctx, buildDir!, { full: o.full }, log);
}

/// Writes the release's files through SignetRegistry, which accepts only bytes of the gate's current release.
/// Default: the three manifest files (what Guard reads). --full: every file that fits on-chain (the verified copy).
export async function upload(ctx: Ctx, buildDir: string, o: { full?: boolean }, log: Log): Promise<void> {
  const cfg = needProject(ctx);
  const { registry } = needDeployed(ctx);
  const build = loadSealed(buildDir);
  checkBuild(build, cfg);
  const m = build.manifest;
  const [filesRoot, allowlistHash, originsHash, ok] = await read<[Hex, Hex, Hex, boolean]>(ctx, { address: cfg.gate, abi: gateAbi, functionName: 'activeRelease' });
  if (!ok || filesRoot !== m.filesRoot || allowlistHash !== m.allowlistHash || originsHash !== m.originsHash) {
    throw new SignetError('NotApproved', `${buildDir} is not the gate's current release, so its files can't be written. Publish it first.`);
  }
  const [, container, prefix] = await read<[Address, Address, string]>(ctx, { address: registry, abi: registryAbi, functionName: 'bindingOf', args: [cfg.domain] });
  if (container === zeroAddress) throw new SignetError('NotBoundGate', `${cfg.domain} has no valid container binding`);
  const sites = ctx.net.tapeout.siteRegistry as Address;
  // anyone may relay these bytes (the registry checks them against the current release), so CI's key works too
  const signer = await signerFor(ctx, [...KEYS, 'SIGNET_PROPOSER_KEY']);

  const wanted: { path: string; contentType: string; proof: Hex[] }[] = [
    { path: ALLOWLIST_PATH, contentType: 'application/json', proof: [] },
    { path: ORIGINS_PATH, contentType: 'application/json', proof: [] },
  ];
  const skipped: string[] = [];
  const chunked: typeof build.files = [];
  for (const f of build.files) {
    if (f.path !== FILES_PATH && !o.full) continue;
    if (f.chunks) chunked.push(f); // over MAX_ONCHAIN_BYTES: one transaction per chunk (writeChunk)
    else if (f.size === 0 || f.size > MAX_ONCHAIN_BYTES || !isOnchainPath(f.path)) skipped.push(f.path);
    else wanted.push({ path: f.path, contentType: f.contentType, proof: build.proof(f.path) });
  }
  log(`Writing ${wanted.length} file(s)${chunked.length ? ` and ${chunked.length} chunked file(s)` : ''} to ${container} under ${prefix || '(container root)'}`);
  let gas = 0n;
  let fee = 0n;
  for (const w of wanted) {
    const data = build.bytes(w.path);
    const want = sha256Hex(data);
    const info = await read<[number, string, Hex, number, bigint]>(ctx, { address: sites, abi: siteReadAbi, functionName: 'fileInfo', args: [container, prefix + w.path] });
    if (info[4] > 0n && info[2] === want && info[1] === w.contentType) {
      log(`  same    ${w.path}`);
      continue;
    }
    const r = await send(ctx, signer, { address: registry, abi: registryAbi, functionName: 'writeFile', args: [{ domain: cfg.domain, path: w.path, contentType: w.contentType, data: `0x${data.toString('hex')}`, proof: w.proof }] });
    gas += r.gasUsed;
    fee += r.gasUsed * r.effectiveGasPrice;
    log(`  wrote   ${w.path}  (${data.length} bytes, gas ${r.gasUsed})`);
  }
  for (const f of chunked) {
    const data = build.bytes(f.path);
    const n = f.chunks!.length;
    const info = await read<[number, string, Hex, number, bigint]>(ctx, { address: sites, abi: siteReadAbi, functionName: 'fileInfo', args: [container, prefix + f.path] });
    // a partial upload of this same file is resumed where it stopped (SiteRegistry keeps the declared hash and the chunk count)
    const done = info[2] === f.sha256 && info[1] === f.contentType ? Number(info[4]) : 0;
    if (done === n) {
      log(`  same    ${f.path}  (${n} chunks)`);
      continue;
    }
    let fileGas = 0n;
    for (let i = done; i < n; i++) {
      const piece = data.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
      const r = await send(ctx, signer, { address: registry, abi: registryAbi, functionName: 'writeChunk', args: [{ domain: cfg.domain, path: f.path, contentType: f.contentType, fileSha256: f.sha256, index: BigInt(i), data: `0x${piece.toString('hex')}`, fileProof: i === 0 ? build.proof(f.path) : [], chunkProof: build.chunkProof(f.path, i) }] });
      gas += r.gasUsed;
      fileGas += r.gasUsed;
      fee += r.gasUsed * r.effectiveGasPrice;
      log(`  chunk   ${f.path}  ${i + 1}/${n}  (${piece.length} bytes, gas ${r.gasUsed})`);
    }
    const stored = await read<Hex>(ctx, { address: sites, abi: siteReadAbi, functionName: 'read', args: [container, prefix + f.path] });
    if (sha256Hex(Buffer.from(stored.slice(2), 'hex')) !== f.sha256) throw new SignetError('read-back', `${f.path} read back from the chain does not hash to its sealed value`);
    log(`  wrote   ${f.path}  (${data.length} bytes in ${n - done} transactions, gas ${fileGas}; read back: matches)`);
  }
  for (const p of skipped) log(`  skipped ${p}  (empty, more than ${MAX_CHUNKS} chunks, or a path that can't be stored on-chain)`);
  const back = await read<Hex>(ctx, { address: sites, abi: siteReadAbi, functionName: 'read', args: [container, prefix + FILES_PATH] });
  if (back !== `0x${build.bytes(FILES_PATH).toString('hex')}`) throw new SignetError('read-back', `${FILES_PATH} read back from the chain does not match`);
  log(`  read back ${prefix}${FILES_PATH}: matches. Total gas ${gas} (${formatEther(fee)} OKB).`);
}

// ---------------------------------------------------------------- status

export async function status(ctx: Ctx, buildDir: string | undefined, log: Log): Promise<void> {
  const cfg = needProject(ctx);
  const { registry } = needDeployed(ctx);
  const [s, now] = [await gateState(ctx, cfg.gate), await chainTime(ctx)];
  const [boundGate, container, prefix] = await read<[Address, Address, string]>(ctx, { address: registry, abi: registryAbi, functionName: 'bindingOf', args: [cfg.domain] });
  log(`${cfg.domain} on ${ctx.net.name} (chain ${ctx.net.chainId}), chain time ${fmtTime(now)}`);
  log(`  gate       ${cfg.gate}${boundGate.toLowerCase() === cfg.gate.toLowerCase() ? '' : '   WARNING: the registry does not bind this domain to this gate'}`);
  log(`  files      ${container} / ${prefix}`);
  log(`  state      ${s.frozen ? `FROZEN (${popcount(s.unfreezeApprovals)} of 2 unfreeze approvals)` : 'active'}, ${s.enforced ? 'enforce mode' : 'observe mode'}`);
  log(`  timelocks  ${fmtSpan(s.shortDelay)} (tiers 00, 01), ${fmtSpan(s.longDelay)} (tiers 10, 11), grace ${fmtSpan(s.graceWindow)}`);
  log(`  approvers  ${s.approvers.join(', ')}`);
  log(`  proposer   ${s.proposer}   recovery ${s.recovery}   guardian ${s.guardian === zeroAddress ? 'none' : s.guardian}`);
  if (s.currentRelease === 0n) log('  release    none yet');
  else {
    const [manifestHash, , , , publishedAt] = await read<[Hex, Hex, Hex, Hex, number, bigint]>(ctx, { address: cfg.gate, abi: gateAbi, functionName: 'releases', args: [s.currentRelease] });
    const valid = await read<boolean>(ctx, { address: cfg.gate, abi: gateAbi, functionName: 'isValidManifest', args: [manifestHash] });
    log(`  release    #${s.currentRelease}, published ${fmtTime(Number(publishedAt))}${valid ? '' : '   REVOKED'}`);
    log(`             manifest ${manifestHash}`);
    if (buildDir) {
      const m = loadSealed(buildDir).manifest;
      log(`             ${buildDir} ${m.manifestHash === manifestHash ? 'IS the current release' : 'is NOT the current release'}`);
    }
  }
  const open: string[] = [];
  for (let id = s.proposalCount; id >= 1n && id > s.proposalCount - 25n; id--) {
    const p = await getProposal(ctx, cfg.gate, id);
    const d = describeProposal(p, s, now);
    if (d.open) open.push(`  #${id}  ${p.kind === 1 ? 'release' : 'admin  '}  tier ${TIERS[p.tier]}${p.emergency ? ', emergency' : ''}\n      ${d.text}\n      expires ${fmtTime(p.proposedAt + 7 * 86400)}`);
  }
  log(open.length === 0 ? 'No open proposals.' : `Open proposals (${open.length}):`);
  for (const line of open) log(line);
}

// ---------------------------------------------------------------- freeze / unfreeze

export async function freeze(ctx: Ctx, log: Log): Promise<void> {
  const cfg = needProject(ctx);
  const signer = await signerFor(ctx, KEYS);
  const receipt = await send(ctx, signer, { address: cfg.gate, abi: gateAbi, functionName: 'freeze' });
  log(`FROZEN by ${signer.label} (tx ${receipt.transactionHash})`);
  log('  Nothing can be published until 2 of the 3 approvers run: signet unfreeze');
}

export async function unfreeze(ctx: Ctx, log: Log): Promise<void> {
  const cfg = needProject(ctx);
  const signer = await signerFor(ctx, KEYS);
  let s = await gateState(ctx, cfg.gate);
  if (!s.frozen) throw new SignetError('NotFrozen', 'the gate is not frozen');
  const slot = s.approvers.findIndex((a) => a.toLowerCase() === signer.address.toLowerCase());
  if (slot >= 0 && (s.unfreezeApprovals & (1 << slot)) === 0) {
    await send(ctx, signer, { address: cfg.gate, abi: gateAbi, functionName: 'approveUnfreeze' });
    s = await gateState(ctx, cfg.gate);
    log(`Unfreeze approved by ${signer.label}: ${popcount(s.unfreezeApprovals)} of 2`);
  }
  if (slot < 0 && popcount(s.unfreezeApprovals) < 2) throw new SignetError('NotApprover', `only the 3 approvers can approve an unfreeze (${popcount(s.unfreezeApprovals)} of 2 so far) [NotApprover]`);
  if (popcount(s.unfreezeApprovals) < 2) {
    log(`  Still frozen: ${2 - popcount(s.unfreezeApprovals)} more approver(s) must run signet unfreeze.`);
    return;
  }
  try {
    const receipt = await send(ctx, signer, { address: cfg.gate, abi: gateAbi, functionName: 'unfreeze' }, { pad: true });
    log(`Unfrozen (tx ${receipt.transactionHash})`);
    fallbackNote(receipt, log);
  } catch (e) {
    if (errorName(e) === 'PolicyDenied' || (e instanceof SignetError && e.code === 'PolicyDenied')) throw new SignetError('PolicyDenied', 'the policy circuit refused to unfreeze: it needs 2 of 3 approvers');
    throw e;
  }
}

// ---------------------------------------------------------------- link and domain proof (onboarding)

/// For a gate made in the dashboard's "Protect a site" wizard: write signet.config.json after checking that the
/// registry binds `domain` to `gate`.
export async function link(ctx: Ctx, domain: string, gate: Address, log: Log): Promise<void> {
  const { registry } = needDeployed(ctx);
  if (!isAddress(gate)) throw new SignetError('gate', `"${gate}" is not an address`);
  const [bound] = await read<[Address, Address, string]>(ctx, { address: registry, abi: registryAbi, functionName: 'bindingOf', args: [domain] });
  if (bound === zeroAddress) throw new SignetError('NotBound', `${domain} is not bound to any gate on ${ctx.net.name}. Create the gate first (dashboard: Protect a site).`);
  if (getAddress(bound) !== getAddress(gate)) throw new SignetError('OtherGate', `${domain} is bound to ${bound}, not ${gate}.`);
  const file = join(ctx.dir, CONFIG_NAME);
  if (existsSync(file)) throw new SignetError('exists', `${showPath(file)} already exists. Nothing changed.`);
  writeFileSync(file, JSON.stringify({ network: ctx.net.name, chainId: ctx.net.chainId, domain, gate: getAddress(gate) }, null, 2) + '\n');
  log(`Wrote ${showPath(file)}: ${domain} → gate ${getAddress(gate)} on ${ctx.net.name}`);
  log(`Next: signet domain <your public/static folder>   (publishes the proof that you control ${domain})`);
}

export const WELL_KNOWN = '.well-known/signet.json';

/// The domain proof: /.well-known/signet.json names the gate. Without --check, write it into `publicDir` (a folder
/// whose files your build copies to the site root, e.g. public/). With --check, fetch it from the live domain.
export async function domainProof(ctx: Ctx, publicDir: string | undefined, o: { check?: boolean }, log: Log): Promise<void> {
  const cfg = needProject(ctx);
  const want = { signet: 1, chainId: ctx.net.chainId, gate: getAddress(cfg.gate) };
  if (!o.check) {
    if (!publicDir) throw new SignetError('dir', 'Give the folder your build copies to the site root (e.g. public), or use --check');
    const file = join(publicDir, WELL_KNOWN);
    mkdirSync(join(publicDir, '.well-known'), { recursive: true });
    writeFileSync(file, JSON.stringify(want, null, 2) + '\n');
    log(`Wrote ${showPath(file)}. Deploy it so https://${cfg.domain}/${WELL_KNOWN} names gate ${want.gate}.`);
    log('Serve it with the header "Access-Control-Allow-Origin: *" so the Signet dashboard and badge can read it:');
    log('  Cloudflare Pages / Netlify, in public/_headers:   /.well-known/signet.json');
    log('                                                       Access-Control-Allow-Origin: *');
    log('  Vercel, in vercel.json: {"headers":[{"source":"/.well-known/signet.json","headers":[{"key":"Access-Control-Allow-Origin","value":"*"}]}]}');
    log(`Then check: signet domain --check`);
    return;
  }
  const { registry } = needDeployed(ctx);
  // SIGNET_DOMAIN_ORIGIN: tests and staging only (a local server standing in for https://<domain>)
  const url = `${process.env.SIGNET_DOMAIN_ORIGIN || `https://${cfg.domain}`}/${WELL_KNOWN}`;
  let got: { signet?: number; chainId?: number; gate?: string };
  let cors = '';
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    cors = r.headers.get('access-control-allow-origin') ?? '';
    got = (await r.json()) as typeof got;
  } catch (e) {
    throw new SignetError('NoProof', `${url} could not be read (${(e as Error).message}). Deploy the file: signet domain <public folder>`);
  }
  const [bound] = await read<[Address, Address, string]>(ctx, { address: registry, abi: registryAbi, functionName: 'bindingOf', args: [cfg.domain] });
  const ok = got.chainId === ctx.net.chainId && typeof got.gate === 'string' && isAddress(got.gate) && getAddress(got.gate) === want.gate && getAddress(bound) === want.gate;
  log(`${url}: names gate ${got.gate ?? '(none)'} on chain ${got.chainId ?? '?'}`);
  log(`registry: ${cfg.domain} → ${bound}`);
  if (!ok) throw new SignetError('ProofMismatch', `The domain's file, the registry and ${CONFIG_NAME} must all name gate ${want.gate}.`);
  log(`OK: ${cfg.domain} confirms gate ${want.gate}. Guard and the watchtower accept it.`);
  if (cors !== '*') log(`warning: no "Access-Control-Allow-Origin: *" on the file, so the Signet dashboard and badge can't read it from the browser and will show "Not verified". Add the header (signet domain <dir> prints how).`);
}
