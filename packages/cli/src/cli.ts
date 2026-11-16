#!/usr/bin/env node
// signet: seal a build, check it, and move a release through its gate. See docs/signet-spec.md.
import { Command } from 'commander';
import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { makeCtx, readConfig, SignetError, CONFIG_NAME } from './chain.ts';
import { seal } from './seal.ts';
import { verifyDir, verifyUrl, formatReport } from './verify.ts';
import * as cmd from './commands.ts';
import { loadNetwork } from './network.ts';

const log = (line = '') => console.log(line);
const program = new Command('signet')
  .description("Signet: decide what your dApp's website is allowed to do")
  .option('-C, --project <dir>', `project directory (where ${CONFIG_NAME} lives)`, '.')
  .option('--as <who>', 'local staging chain only: sign as a test account (approver1, proposer, user1, ... or an address)');

const ctx = () => {
  const g = program.opts<{ project: string; as?: string }>();
  return makeCtx(resolve(g.project), g.as);
};
const id = (v: string) => {
  if (!/^\d+$/.test(v)) throw new SignetError('id', `"${v}" is not a proposal id`);
  return BigInt(v);
};

program.command('init')
  .description('create the project\'s gate (3 approvers, CI proposer, recovery, guardian) and bind the domain')
  .option('--domain <domain>', 'the domain to protect, e.g. app.example.org')
  .option('--approvers <a,b,c>', 'the 3 approver addresses')
  .option('--recovery <address>', 'recovery address (a key kept offline)')
  .option('--guardian <address>', 'optional key that can only freeze (the watchtower), or "none"')
  .option('--proposer <address>', 'the CI key\'s address (default: create a new key file)')
  .option('--no-wait', 'send the commitment and exit; run init again 2 blocks later to finish')
  .option('--wait-seconds <n>', 'how long to wait for the 2 blocks', '120')
  .action(async (o) => {
    await cmd.init(ctx(), { ...o, waitSeconds: Number(o.waitSeconds) }, log);
  });

program.command('seal <buildDir>')
  .description('hash every file, extract the allowlist and the external origins, write signet-manifest.json')
  .option('--domain <domain>', `the domain (default: from ${CONFIG_NAME})`)
  .option('--chain-id <id>', 'the chain your contracts are on (default: from the config, else 196)')
  .action((buildDir: string, o: { domain?: string; chainId?: string }) => {
    const cfg = readConfig(resolve(program.opts().project));
    const domain = o.domain ?? cfg?.domain;
    if (!domain) throw new SignetError('domain', `no domain: pass --domain or run signet init (writes ${CONFIG_NAME})`);
    const r = seal(buildDir, { domain, chainId: Number(o.chainId ?? cfg?.chainId ?? 196), allowlist: cfg?.allowlist, origins: cfg?.origins });
    const m = r.manifest;
    log(`Sealed ${m.fileCount} files (${m.totalBytes} bytes) for ${m.domain}`);
    log(`  filesRoot      ${m.filesRoot}`);
    log(`  allowlistHash  ${m.allowlistHash}`);
    log(`  originsHash    ${m.originsHash}`);
    log(`  manifestHash   ${m.manifestHash}`);
    log();
    log('Allowlist: what the site may ask a wallet to sign. Check every line.');
    for (const [chain, a] of Object.entries(r.allowlist)) {
      log(`  chain ${chain}: ${a.targets.length} contract(s), ${a.spenders.length} spender(s), ${a.eip712.length} EIP-712 verifier(s)`);
      for (const t of a.targets) {
        const tags = [a.spenders.includes(t) ? 'spender' : '', a.eip712.includes(t) ? 'eip712' : ''].filter(Boolean).join(', ');
        const where = r.found.find((f) => f.address === t)?.files ?? [];
        log(`    ${t}  ${tags ? `[target, ${tags}]` : '[target]'}  ${where.length ? `found in ${where[0]}${where.length > 1 ? ` +${where.length - 1}` : ''}` : `from ${CONFIG_NAME}`}`);
      }
      for (const x of [...new Set([...a.spenders, ...a.eip712])].filter((x) => !a.targets.includes(x))) log(`    ${x}  [${a.spenders.includes(x) ? 'spender' : 'eip712'}]  from ${CONFIG_NAME}`);
    }
    log(`  To allow an address as a token spender, or to drop one, edit "allowlist" in ${CONFIG_NAME} (spenders, eip712, exclude).`);
    log();
    log(`External origins the site may load from or connect to (${r.origins.length}):`);
    for (const x of r.origins) log(`    ${x}`);
    if (r.ignoredOrigins.length) log(`  not listed (documentation links in the code): ${r.ignoredOrigins.join(', ')}`);
    for (const s of r.externalScripts) log(`  cross-origin script ${s.url}  ${s.integrity ? `SRI ${s.integrity.slice(0, 22)}...` : 'NO SRI'}`);
    for (const w of r.warnings) log(`  warning: ${w}`);
    log();
    log(`Wrote ${buildDir}/signet-manifest.json and ${buildDir}/signet/{allowlist,origins,files}.json`);
    log(`Next: signet propose ${buildDir}`);
  });

program.command('verify <target>')
  .description('check a build directory or a live URL: no-store, cross-origin scripts without SRI, CDN rewrites, SSR')
  .option('--build <dir>', 'with a URL: compare what is served with this build, byte for byte')
  .option('--strict', 'exit 1 on warnings too')
  .option('--json', 'print the findings as JSON')
  .action(async (target: string, o: { build?: string; strict?: boolean; json?: boolean }) => {
    const isUrl = /^https?:\/\//i.test(target);
    if (!isUrl && !(existsSync(target) && statSync(target).isDirectory())) throw new SignetError('target', `${target} is neither a directory nor an http(s) URL`);
    const cfg = readConfig(resolve(program.opts().project));
    const r = isUrl ? await verifyUrl(target, { build: o.build }) : verifyDir(target, cfg?.domain);
    log(o.json ? JSON.stringify(r, null, 2) : formatReport(r));
    if (r.errors > 0 || (o.strict && r.warnings > 0)) process.exitCode = 1;
  });

program.command('propose <buildDir>')
  .description('propose the sealed build as a release (the CI key can do only this)')
  .option('--emergency', 'ask for the fast lane: 3 of 3 approvals publish at once (tiers 00 and 10)')
  .action(async (buildDir: string, o) => {
    await cmd.propose(ctx(), buildDir, o, log);
  });

program.command('approve <id>').description('approve a proposal (approvers only)').action(async (v: string) => cmd.approve(ctx(), id(v), log));
program.command('cancel <id>').description('cancel a proposal (any approver)').action(async (v: string) => cmd.cancel(ctx(), id(v), log));

program.command('publish <id> [buildDir]')
  .description('publish an approved proposal (the policy circuit decides), then write its manifest files on-chain')
  .option('--full', 'also store every file that fits on-chain (the verified copy), not just the manifest')
  .option('--no-upload', 'publish only')
  .action(async (v: string, buildDir: string | undefined, o) => cmd.publish(ctx(), id(v), buildDir, o, log));

program.command('upload <buildDir>')
  .description('write the current release\'s files on-chain (after publish; safe to run again)')
  .option('--full', 'every file that fits on-chain, not just the manifest')
  .action(async (buildDir: string, o) => cmd.upload(ctx(), buildDir, o, log));

program.command('status [buildDir]').description('the gate, the current release and the open proposals').action(async (b?: string) => cmd.status(ctx(), b, log));
program.command('freeze').description('stop all publishing now (any approver, or the guardian)').action(async () => cmd.freeze(ctx(), log));
program.command('unfreeze').description('approve the unfreeze; the second approver\'s call unfreezes').action(async () => cmd.unfreeze(ctx(), log));
program.command('network').description('show the chain and contract addresses in use').action(() => {
  const n = loadNetwork(process.env.SIGNET_NETWORK || readConfig(resolve(program.opts().project))?.network || 'mainnet');
  log(JSON.stringify({ network: n.name, chainId: n.chainId, rpcUrl: n.rpcUrl, contracts: n.contracts, gates: n.gates }, null, 2));
});

program.parseAsync().catch((e: unknown) => {
  console.error(e instanceof SignetError ? `signet: ${e.message}` : e instanceof Error ? `signet: ${e.message}` : e);
  process.exitCode = 1;
});
