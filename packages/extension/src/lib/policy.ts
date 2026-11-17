// The signing-time check: may this page ask the wallet for this signature? Pure function, no I/O.
// The sealed allowlist has, per chain: targets (contracts the site may call), spenders (who may be given an
// allowance) and eip712 (verifying contracts of typed data). Tokens are not listed: approving any token is fine
// when the spender is sealed (spec, "Allowlist reality").
//   block  the target, spender, recipient or verifying contract is not sealed, or the page is tampered
//   warn   Guard can't tell what this is (unknown format): it goes through, marked "unverified call"
//   allow  everything it names is sealed
import { decodeAbiParameters, getAddress, isAddress, parseAbiParameters, type Hex } from 'viem';
import type { Action, Allowlist, PageStatus, SignRequest, SiteStatus } from './types.ts';

export const SIGN_METHODS = new Set([
  'eth_sendTransaction', 'eth_signTransaction', 'wallet_sendCalls', 'eth_signTypedData', 'eth_signTypedData_v1', 'eth_signTypedData_v3',
  'eth_signTypedData_v4', 'personal_sign', 'eth_sign',
]);

export interface Verdict { action: Action; title: string; reason: string; details: string[] }
export interface Context { site: SiteStatus; page: PageStatus | 'unknown'; allowlist: Allowlist | null }

const lc = (a: unknown) => String(a).toLowerCase();
const short = (a: string) => (isAddress(a) ? getAddress(a) : a);
const MAX = (1n << 256n) - 1n;
const amountText = (n: bigint) => (n >= MAX / 2n ? 'unlimited' : n.toString());

interface Lists { targets: Set<string>; spenders: Set<string>; eip712: Set<string> }
function listsFor(allowlist: Allowlist, chain: string): Lists | null {
  const a = allowlist[chain];
  return a ? { targets: new Set(a.targets.map(lc)), spenders: new Set(a.spenders.map(lc)), eip712: new Set(a.eip712.map(lc)) } : null;
}

const worst = (a: Action, b: Action): Action => (a === 'block' || b === 'block' ? 'block' : a === 'warn' || b === 'warn' ? 'warn' : 'allow');
const v = (action: Action, title: string, reason: string, details: string[] = []): Verdict => ({ action, title, reason, details });

// Calls that hand over tokens. `spender` / `recipient` = index of that argument.
const TOKEN_CALLS: Record<string, { name: string; types: string; spender?: number; recipient?: number; amount?: number; flag?: number }> = {
  '0x095ea7b3': { name: 'approve', types: 'address, uint256', spender: 0, amount: 1 },
  '0x39509351': { name: 'increaseAllowance', types: 'address, uint256', spender: 0, amount: 1 },
  '0xa22cb465': { name: 'setApprovalForAll', types: 'address, bool', spender: 0, flag: 1 },
  '0xd505accf': { name: 'permit', types: 'address, address, uint256, uint256, uint8, bytes32, bytes32', spender: 1, amount: 2 },
  '0x8fcbaf0c': { name: 'permit (DAI)', types: 'address, address, uint256, uint256, bool, uint8, bytes32, bytes32', spender: 1, flag: 4 },
  '0xa9059cbb': { name: 'transfer', types: 'address, uint256', recipient: 0, amount: 1 },
  '0x23b872dd': { name: 'transferFrom', types: 'address, address, uint256', recipient: 1, amount: 2 },
  '0x42842e0e': { name: 'safeTransferFrom', types: 'address, address, uint256', recipient: 1 },
  '0xb88d4fde': { name: 'safeTransferFrom', types: 'address, address, uint256, bytes', recipient: 1 },
};
// Calls on a sealed contract whose arguments name who receives or who may spend.
const TARGET_CALLS: Record<string, { name: string; types: string; spender?: number; recipient?: number }> = {
  '0x87517c45': { name: 'Permit2 approve', types: 'address, address, uint160, uint48', spender: 1 },
  '0x38ed1739': { name: 'swapExactTokensForTokens', types: 'uint256, uint256, address[], address, uint256', recipient: 3 },
  '0x8803dbee': { name: 'swapTokensForExactTokens', types: 'uint256, uint256, address[], address, uint256', recipient: 3 },
  '0x18cbafe5': { name: 'swapExactTokensForETH', types: 'uint256, uint256, address[], address, uint256', recipient: 3 },
  '0x4a25d94a': { name: 'swapTokensForExactETH', types: 'uint256, uint256, address[], address, uint256', recipient: 3 },
  '0x5c11d795': { name: 'swapExactTokensForTokensSupportingFeeOnTransferTokens', types: 'uint256, uint256, address[], address, uint256', recipient: 3 },
  '0x791ac947': { name: 'swapExactTokensForETHSupportingFeeOnTransferTokens', types: 'uint256, uint256, address[], address, uint256', recipient: 3 },
  '0x7ff36ab5': { name: 'swapExactETHForTokens', types: 'uint256, address[], address, uint256', recipient: 2 },
  '0xfb3bdb41': { name: 'swapETHForExactTokens', types: 'uint256, address[], address, uint256', recipient: 2 },
  '0xb6f9de95': { name: 'swapExactETHForTokensSupportingFeeOnTransferTokens', types: 'uint256, address[], address, uint256', recipient: 2 },
};

function decode(types: string, data: string): unknown[] | null {
  try {
    return [...decodeAbiParameters(parseAbiParameters(types), `0x${data.slice(10)}` as Hex)];
  } catch {
    return null;
  }
}

interface Tx { from?: string; to?: string | null; data?: string; input?: string; value?: string | number | bigint }

export function checkCall(tx: Tx, lists: Lists, user: string): Verdict {
  const to = tx.to ? lc(tx.to) : '';
  const data = lc(tx.data ?? tx.input ?? '0x');
  let value = 0n;
  try {
    value = BigInt(tx.value ?? 0);
  } catch { /* not a number: treated as 0 */ }
  const me = lc(user);
  if (!to) return v('warn', 'Unverified call', 'This transaction creates a contract. Guard cannot tell what it does.');
  const sel = data.slice(0, 10);
  const token = TOKEN_CALLS[sel];
  if (token && data.length >= 10) {
    const args = decode(token.types, data);
    if (!args) return lists.targets.has(to) ? v('warn', 'Unverified call', `A ${token.name} call that Guard could not decode.`) : v('block', 'Contract not in the sealed allowlist', `${short(to)} is not a contract this site sealed.`);
    const details = [`${token.name} on token ${short(to)}`];
    if (value > 0n && !lists.targets.has(to)) return v('block', 'Payment to an unknown contract', `This ${token.name} call also sends ${value} wei to ${short(to)}, which is not in the sealed allowlist.`, details);
    if (token.spender !== undefined) {
      const spender = lc(args[token.spender]);
      const revoke = (token.amount !== undefined && args[token.amount] === 0n) || (token.flag !== undefined && args[token.flag] === false);
      details.push(`spender ${short(spender)}`, token.amount !== undefined ? `amount ${amountText(args[token.amount] as bigint)}` : `approved ${String(args[token.flag!])}`);
      if (revoke) return v('allow', 'Revoke', 'Removing an allowance is always allowed.', details);
      if (!lists.spenders.has(spender)) return v('block', 'Spender not in the sealed allowlist', `This would let ${short(spender)} spend your tokens. The team never sealed that address as a spender.`, details);
      return v('allow', token.name, 'The spender is in the sealed allowlist.', details);
    }
    const recipient = lc(args[token.recipient!]);
    details.push(`recipient ${short(recipient)}`);
    if (recipient !== me && !lists.targets.has(recipient) && !lists.spenders.has(recipient)) {
      return v('block', 'Recipient is not you', `This sends your tokens to ${short(recipient)}. That is not your address and not a contract this site sealed.`, details);
    }
    return v('allow', token.name, recipient === me ? 'The recipient is you.' : 'The recipient is a sealed contract.', details);
  }
  if (!lists.targets.has(to)) {
    return v('block', 'Contract not in the sealed allowlist', `${short(to)} is not a contract this site sealed${value > 0n ? `, and the transaction sends ${value} wei to it` : ''}.`, [`to ${short(to)}`, `call ${sel.length === 10 ? sel : '(no data)'}`]);
  }
  const known = TARGET_CALLS[sel];
  if (known) {
    const args = decode(known.types, data);
    if (args) {
      const who = lc(args[(known.spender ?? known.recipient)!]);
      const details = [`${known.name} on ${short(to)}`, `${known.spender !== undefined ? 'spender' : 'recipient'} ${short(who)}`];
      if (known.spender !== undefined && !lists.spenders.has(who)) return v('block', 'Spender not in the sealed allowlist', `This would let ${short(who)} spend your tokens through Permit2. The team never sealed that address as a spender.`, details);
      if (known.recipient !== undefined && who !== me && !lists.targets.has(who)) return v('block', 'Recipient is not you', `The output of this swap goes to ${short(who)}, not to you.`, details);
      return v('allow', known.name, 'The contract is sealed and the recipient is you or a sealed contract.', details);
    }
  }
  if (data.length < 10) return v('allow', 'Payment to a sealed contract', 'The contract is in the sealed allowlist.', [`to ${short(to)}`]);
  return v('allow', 'Call to a sealed contract', 'The contract is in the sealed allowlist. Guard does not decode this call.', [`to ${short(to)}`, `call ${sel}`]);
}

const PERMIT2_TYPES = new Set(['PermitSingle', 'PermitBatch', 'PermitTransferFrom', 'PermitBatchTransferFrom', 'PermitWitnessTransferFrom', 'PermitBatchWitnessTransferFrom']);

export function checkTypedData(raw: unknown, allowlist: Allowlist, chain: string | null): Verdict {
  let td: { primaryType?: string; domain?: { chainId?: unknown; verifyingContract?: string; name?: string }; message?: Record<string, unknown> };
  try {
    td = typeof raw === 'string' ? JSON.parse(raw) : (raw as typeof td);
  } catch {
    return v('warn', 'Unverified signature', 'Typed data that Guard could not read.');
  }
  if (!td || typeof td !== 'object' || Array.isArray(td)) return v('warn', 'Unverified signature', 'Old-style typed data without a verifying contract.');
  let c = chain;
  try {
    if (td.domain?.chainId !== undefined) c = BigInt(td.domain.chainId as string).toString();
  } catch { /* keep the wallet's chain */ }
  const lists = c ? listsFor(allowlist, c) : null;
  const pt = td.primaryType ?? '';
  const vc = td.domain?.verifyingContract ? lc(td.domain.verifyingContract) : '';
  const spender = td.message && typeof td.message.spender === 'string' ? lc(td.message.spender) : '';
  const details = [`typed data "${pt}"${td.domain?.name ? ` of ${td.domain.name}` : ''}`, ...(vc ? [`verifying contract ${short(vc)}`] : []), ...(spender ? [`spender ${short(spender)}`] : [])];
  if (!lists) return v('block', 'Chain not in the sealed allowlist', `This site sealed nothing for chain ${c ?? '(unknown)'}.`, details);
  if (pt === 'Permit' && spender) {
    // EIP-2612 / DAI: the verifying contract is the token itself, so the spender is what matters
    if (!lists.spenders.has(spender)) return v('block', 'Spender not in the sealed allowlist', `Signing this lets ${short(spender)} spend your tokens. The team never sealed that address as a spender.`, details);
    return v('allow', 'Permit', 'The spender is in the sealed allowlist.', details);
  }
  if (PERMIT2_TYPES.has(pt)) {
    if (!vc || !lists.eip712.has(vc)) return v('block', 'Verifying contract not in the sealed allowlist', `This Permit2-style signature is for ${vc ? short(vc) : 'no contract'}, which the team never sealed.`, details);
    if (!spender || !lists.spenders.has(spender)) return v('block', 'Spender not in the sealed allowlist', `Signing this lets ${spender ? short(spender) : 'an unnamed address'} spend your tokens. The team never sealed that address as a spender.`, details);
    return v('allow', 'Permit2', 'The verifying contract and the spender are in the sealed allowlist.', details);
  }
  if (!vc) return v('warn', 'Unverified signature', 'Typed data without a verifying contract. Guard cannot tell who will use it.', details);
  if (!lists.eip712.has(vc)) return v('block', 'Verifying contract not in the sealed allowlist', `This signature is for ${short(vc)}, which the team never sealed.`, details);
  return v('allow', 'Typed-data signature', 'The verifying contract is in the sealed allowlist.', details);
}

export function decide(req: SignRequest, ctx: Context): Verdict {
  if (ctx.site === 'revoked') return v('block', 'This release was revoked', "The team revoked this site's current release. Don't sign anything here until they publish a new one.");
  if (ctx.page === 'tampered') return v('block', "This page doesn't match its sealed release", "The code running on this page is not what the team sealed. Don't sign.");
  if (ctx.site !== 'sealed' || !ctx.allowlist) return v('allow', 'Not checked', 'Guard could not check this site, so it does not block (fail-open).');
  const chain = req.chainId ? BigInt(req.chainId).toString() : null;
  const params = Array.isArray(req.params) ? req.params : [];
  const user = req.accounts[0] ?? '';
  switch (req.method) {
    case 'personal_sign':
      return v('allow', 'Login signature', 'A plain message signature (login only).');
    case 'eth_sign':
      return v('warn', 'Unverified signature', 'eth_sign signs raw data that Guard cannot read.');
    case 'eth_signTypedData':
    case 'eth_signTypedData_v1':
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData_v4':
      return checkTypedData(typeof params[0] === 'string' && isAddress(params[0]) ? params[1] : params[0], ctx.allowlist, chain);
    case 'eth_sendTransaction':
    case 'eth_signTransaction':
    case 'wallet_sendCalls': {
      const first = (params[0] ?? {}) as Tx & { calls?: Tx[]; chainId?: string };
      let c = chain;
      try {
        if (first.chainId !== undefined) c = BigInt(first.chainId).toString();
      } catch { /* keep the wallet's chain */ }
      const lists = c ? listsFor(ctx.allowlist, c) : null;
      if (!lists) return v('block', 'Chain not in the sealed allowlist', `This site sealed nothing for chain ${c ?? '(unknown)'}.`);
      const calls = req.method === 'wallet_sendCalls' ? (first.calls ?? []) : [first];
      let out: Verdict | null = null;
      for (const call of calls) {
        const r = checkCall(call, lists, first.from ?? user);
        if (!out || worst(out.action, r.action) !== out.action) out = r;
      }
      return out ?? v('warn', 'Unverified call', 'An empty batch of calls.');
    }
    default:
      return v('allow', req.method, 'Not a signing request.');
  }
}
