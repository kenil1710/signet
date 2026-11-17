// Chain access for the commands: network + project config, who signs, sending a transaction, readable errors.
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import {
  createPublicClient, createWalletClient, http, defineChain, BaseError, ContractFunctionRevertedError, getAddress, isAddress,
  type Abi, type Address, type Hex, type PublicClient, type WalletClient, type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { loadNetwork } from './network.ts';
import { gateAbi, factoryAbi, registryAbi } from './abi.ts';
import type { AllowlistRules, Transfers } from './seal.ts';

export class SignetError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface ProjectConfig {
  network: string;
  chainId: number;
  domain: string;
  gate: Address;
  allowlist?: Record<string, AllowlistRules>;
  transfers?: Transfers;
  origins?: { include?: string[]; exclude?: string[] };
}

export type Network = ReturnType<typeof loadNetwork>;
export interface Ctx {
  dir: string; // the project directory (signet.config.json and .signet/ live here)
  net: Network;
  pub: PublicClient;
  config: ProjectConfig | null;
  as?: string;
}
export interface Signer { address: Address; wallet: WalletClient; label: string }

export const CONFIG_NAME = 'signet.config.json';
export const STATE_DIR = '.signet';

export function readConfig(dir: string): ProjectConfig | null {
  const f = join(dir, CONFIG_NAME);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as ProjectConfig) : null;
}

export function statePath(dir: string, name: string): string {
  const d = join(dir, STATE_DIR);
  if (!existsSync(d)) {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, '.gitignore'), '*\n'); // salts and the CI key never reach git
  }
  return join(d, name);
}

export function chainOf(net: Network) {
  return defineChain({ id: net.chainId, name: `X Layer (${net.name})`, nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 }, rpcUrls: { default: { http: [net.rpcUrl] } } });
}

export function makeCtx(dir: string, as?: string): Ctx {
  const config = readConfig(dir);
  const env = process.env.SIGNET_NETWORK;
  if (env && config && config.network !== env) {
    throw new SignetError('network', `${CONFIG_NAME} is for network "${config.network}" but SIGNET_NETWORK is "${env}"`);
  }
  const net = loadNetwork(env || config?.network || 'mainnet');
  const pub = createPublicClient({ chain: chainOf(net), transport: http(net.rpcUrl), pollingInterval: net.name === 'local' ? 100 : 1000 });
  return { dir, net, pub: pub as PublicClient, config, as };
}

export function needDeployed(ctx: Ctx): { factory: Address; registry: Address } {
  const { factory, registry } = ctx.net.contracts;
  if (!factory || !registry) throw new SignetError('not-deployed', `Signet's contracts are not deployed on ${ctx.net.name} yet. For staging: pnpm staging:up, then SIGNET_NETWORK=local.`);
  return { factory: factory as Address, registry: registry as Address };
}

export function needProject(ctx: Ctx): ProjectConfig {
  if (!ctx.config) throw new SignetError('no-project', `No ${CONFIG_NAME} in ${ctx.dir}. Run: signet init`);
  return ctx.config;
}

// ---------------------------------------------------------------- signers

const ROLES = ['deployer', 'approver1', 'approver2', 'approver3', 'proposer', 'recovery', 'guardian', 'user1', 'user2', 'user3'];

function localRole(net: Network, who: string): Address | null {
  const a = net.accounts;
  if (!a) return null;
  const all = [a.deployer, ...a.approvers, a.proposer, a.recovery, a.guardian, ...a.users];
  const i = ROLES.indexOf(who);
  return i >= 0 && all[i] ? getAddress(all[i]!) : null;
}

/// A staging-chain test account by role name, or the address itself.
export function resolveAddress(net: Network, who: string): Address {
  const role = localRole(net, who);
  if (role) return role;
  if (!isAddress(who)) throw new SignetError('address', `"${who}" is not an address${net.name === 'local' ? ` or a staging role (${ROLES.join(', ')})` : ''}`);
  return getAddress(who);
}

/// Who signs. A private key from the environment (never printed, never stored by the CLI), or, on the local
/// staging chain only, `--as <role|address>`: one of anvil's unlocked test accounts, signed by the node.
export async function signerFor(ctx: Ctx, envs: string[], keyFile?: string): Promise<Signer> {
  const chain = chainOf(ctx.net);
  const transport = http(ctx.net.rpcUrl);
  if (ctx.as) {
    if (ctx.net.name !== 'local') throw new SignetError('signer', '--as works only on the local staging chain. On mainnet set SIGNET_PRIVATE_KEY.');
    try {
      await ctx.pub.request({ method: 'anvil_nodeInfo' } as never);
    } catch {
      throw new SignetError('signer', `--as needs the local staging chain at ${ctx.net.rpcUrl} (pnpm staging:up)`);
    }
    const address = resolveAddress(ctx.net, ctx.as);
    return { address, wallet: createWalletClient({ account: address, chain, transport }), label: isAddress(ctx.as) ? address : `${ctx.as} ${address}` };
  }
  let key: string | undefined;
  let from = '';
  for (const name of envs) {
    if (process.env[name]) {
      key = process.env[name];
      from = name;
      break;
    }
  }
  if (!key && keyFile && existsSync(keyFile)) {
    key = readFileSync(keyFile, 'utf8').trim();
    from = keyFile;
  }
  if (!key) throw new SignetError('signer', `No signing key. Set ${envs.join(' or ')}${ctx.net.name === 'local' ? ', or use --as <role> on staging' : ''}.`);
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key)) throw new SignetError('signer', `${from} is not a 32-byte hex private key`);
  const account = privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as Hex);
  return { address: account.address, wallet: createWalletClient({ account, chain, transport }), label: `${account.address} (key from ${from.includes('/') ? showPath(from) : from})` };
}

/// A new CI key, written to a file only the user can read. The key itself is never printed.
export function newKeyFile(path: string): Address {
  const key = generatePrivateKey();
  writeFileSync(path, key + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
  return privateKeyToAccount(key).address;
}

export function addressOfKeyFile(path: string): Address {
  return privateKeyToAccount(readFileSync(path, 'utf8').trim() as Hex).address;
}

// ---------------------------------------------------------------- transactions

/// Every custom error of the three contracts: a revert that bubbles up from another Signet contract still decodes.
const ERRORS = [...gateAbi, ...factoryAbi, ...registryAbi].filter((x) => x.type === 'error').filter((e, i, all) => all.findIndex((x) => x.name === e.name) === i);

const EXPLAIN: Record<string, string> = {
  NotProposer: 'this key is not the gate\'s proposer or an approver',
  NotApprover: 'this key is not one of the gate\'s 3 approvers',
  NotFreezer: 'only an approver or the guardian can freeze',
  OwnProposal: 'an approver can\'t approve a release they proposed themselves',
  AlreadyApproved: 'this approver already approved it',
  NotLive: 'this proposal is not open (published, cancelled, unknown, or from before an approver change)',
  Expired: 'this proposal expired (7 days after it was made). Propose again.',
  StaleBase: 'another release was published or revoked since this was proposed. Propose again.',
  PolicyDenied: 'the policy circuit says no',
  RevokedManifest: 'this exact release was revoked. Un-revoking needs 2 of 3 approvers.',
  FastLaneNotAllowed: 'the emergency fast lane is refused when the allowlist and the origins both changed. Propose without --emergency.',
  BadProposal: 'bad proposal (a zero hash)',
  AlreadyFrozen: 'the gate is already frozen',
  NotFrozen: 'the gate is not frozen',
  FreezeCooldown: 'this key froze within the last 24 hours and must wait',
  BadConfig: 'bad setup: the 3 approvers, the proposer, the recovery address and the guardian must all be different, non-zero addresses',
  BadDomain: 'not a valid lowercase domain name',
  AlreadyBound: 'this domain is already bound to a gate',
  Reserved: 'this domain was unbound less than 30 days ago; only its previous gate can claim it',
  NoCommit: 'no commitment found for this domain, salt and sender',
  CommitTooNew: 'the commitment must be at least 2 blocks old',
  CommitExpired: 'the commitment is older than 7 days',
  CommitExists: 'this commitment is already recorded',
  NotApproved: 'these bytes are not part of the gate\'s current release',
  BadSize: 'a file stored on-chain must be 1 to 48,000 bytes',
  BadPath: 'this path can\'t be stored on-chain',
  NotBoundGate: 'this domain is not bound to a gate',
};

export function errorName(e: unknown): string | null {
  if (!(e instanceof BaseError)) return null;
  const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
  return r instanceof ContractFunctionRevertedError ? (r.data?.errorName ?? null) : null;
}

function wrap(e: unknown, what: string): never {
  const name = errorName(e);
  if (name) throw new SignetError(name, `${what} failed: ${EXPLAIN[name] ?? name} [${name}]`);
  if (e instanceof BaseError) {
    const broke = /exceeds the balance|insufficient funds/i.test(e.shortMessage) ? ' The signing address needs OKB for gas.' : '';
    throw new SignetError('rpc', `${what} failed: ${e.shortMessage}${broke}`);
  }
  throw e;
}

export interface Call { address: Address; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[] }

export async function read<T>(ctx: Ctx, call: Call): Promise<T> {
  try {
    return (await ctx.pub.readContract({ ...call, abi: [...(call.abi as Abi), ...ERRORS] } as never)) as T;
  } catch (e) {
    wrap(e, call.functionName);
  }
}

/// Simulate first (so a refusal costs nothing and names its reason), then send and wait for the receipt.
/// `pad` adds gas headroom for calls that read the policy circuit: an estimate that is exactly enough for the
/// Solidity mirror but not for the circuit would make the gate use the mirror.
export async function send(ctx: Ctx, signer: Signer, call: Call, opts: { pad?: boolean } = {}): Promise<TransactionReceipt> {
  const abi = [...(call.abi as Abi), ...ERRORS];
  try {
    const { request } = await ctx.pub.simulateContract({ ...call, abi, account: signer.wallet.account ?? signer.address } as never);
    const gas = await ctx.pub.estimateContractGas({ ...call, abi, account: signer.address } as never);
    const hash = await signer.wallet.writeContract({ ...(request as object), gas: opts.pad ? (gas * 3n) / 2n + 400_000n : (gas * 6n) / 5n } as never);
    const receipt = await receiptOf(ctx, hash);
    if (receipt.status !== 'success') throw new SignetError('reverted', `${call.functionName} reverted on-chain (tx ${hash})`);
    return receipt;
  } catch (e) {
    if (e instanceof SignetError) throw e;
    wrap(e, call.functionName);
  }
}

/// Polls for the receipt itself. viem's waitForTransactionReceipt re-checks only when the block number changes;
/// on a chain that mines one block per transaction (the staging chain) it can miss that block and wait forever.
export async function receiptOf(ctx: Ctx, hash: Hex, timeoutMs = 180_000): Promise<TransactionReceipt> {
  const every = ctx.net.name === 'local' ? 100 : 1000;
  for (const end = Date.now() + timeoutMs; ; ) {
    const r = (await ctx.pub.request({ method: 'eth_getTransactionReceipt', params: [hash] })) as { blockNumber: Hex | null } | null;
    if (r?.blockNumber) return ctx.pub.getTransactionReceipt({ hash });
    if (Date.now() > end) throw new SignetError('timeout', `transaction ${hash} was sent but not mined within ${Math.round(timeoutMs / 1000)}s. Check it before sending again.`);
    await new Promise((res) => setTimeout(res, every));
  }
}

export async function chainTime(ctx: Ctx): Promise<number> {
  return Number((await ctx.pub.getBlock()).timestamp);
}

/// A path as the user would type it: relative to where they are when that is shorter.
export function showPath(p: string): string {
  const r = relative(process.cwd(), p);
  return r && !r.startsWith('..') && !isAbsolute(r) ? r : p;
}

export const fmtTime = (t: number) => new Date(t * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
export function fmtSpan(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60) ? ` ${Math.floor((s % 3600) / 60)}m` : ''}`;
  return `${Math.floor(s / 86400)}d${Math.floor((s % 86400) / 3600) ? ` ${Math.floor((s % 86400) / 3600)}h` : ''}`;
}
