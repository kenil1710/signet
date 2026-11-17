import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, parseAbi } from 'viem';
import { decide, type Context } from '../src/lib/policy.ts';
import type { SignRequest } from '../src/lib/types.ts';

const USER = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x1E4a5963aBFD975d8c9021ce480b42188849D41d'; // any token: not in the allowlist
const ROUTER = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const STAKING = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const DRAINER = '0xBAD0C0fFeE5BAD0c0ffEe5baD0c0ffeE5baD0C0F';
const allowlist = { '196': { targets: [ROUTER, STAKING, PERMIT2], spenders: [ROUTER, PERMIT2], eip712: [PERMIT2] } };
const ok: Context = { site: 'sealed', page: 'ok', allowlist };
const abi = parseAbi([
  'function approve(address,uint256)', 'function increaseAllowance(address,uint256)', 'function setApprovalForAll(address,bool)',
  'function transfer(address,uint256)', 'function transferFrom(address,address,uint256)', 'function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)',
  'function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)', 'function stake(uint256)',
]);
const p2 = parseAbi(['function approve(address,address,uint160,uint48)']);
const data = (functionName: string, args: unknown[]) => encodeFunctionData({ abi, functionName, args } as never);
const tx = (to: string | null, d = '0x', value = '0x0'): SignRequest => ({ method: 'eth_sendTransaction', params: [{ from: USER, to, data: d, value }], chainId: '0xc4', accounts: [USER] });
const act = (r: SignRequest, ctx = ok) => decide(r, ctx).action;
const Z = `0x${'00'.repeat(32)}`;

test('approve: any token is fine when the spender is sealed; an unsealed spender is refused', () => {
  assert.equal(act(tx(TOKEN, data('approve', [ROUTER, 10n]))), 'allow');
  const bad = decide(tx(TOKEN, data('approve', [DRAINER, 2n ** 256n - 1n])), ok);
  assert.equal(bad.action, 'block');
  assert.match(bad.title, /Spender not in the sealed allowlist/);
  assert.ok(bad.details.includes(`spender ${DRAINER}`) && bad.details.includes('amount unlimited'));
  assert.equal(act(tx(TOKEN, data('approve', [DRAINER, 0n]))), 'allow', 'revoking is always allowed');
  assert.equal(act(tx(TOKEN, data('increaseAllowance', [DRAINER, 5n]))), 'block');
  assert.equal(act(tx(TOKEN, data('setApprovalForAll', [DRAINER, true]))), 'block');
  assert.equal(act(tx(TOKEN, data('setApprovalForAll', [DRAINER, false]))), 'allow');
  assert.equal(act(tx(TOKEN, data('setApprovalForAll', [ROUTER, true]))), 'allow');
  assert.equal(act(tx(TOKEN, data('permit', [USER, DRAINER, 1n, 1n, 27, Z, Z]))), 'block');
  assert.equal(act(tx(TOKEN, data('permit', [USER, ROUTER, 1n, 1n, 27, Z, Z]))), 'allow');
});

test('transfer: who may receive is the project\'s sealed setting (user | allowlist | any)', () => {
  const withRule = (transfers?: 'user' | 'allowlist' | 'any'): Context => ({ ...ok, allowlist: { '196': { ...allowlist['196'], ...(transfers ? { transfers } : {}) } } });
  const to = (who: string) => tx(TOKEN, data('transfer', [who, 1n]));
  const from = (who: string) => tx(TOKEN, data('transferFrom', [USER, who, 1n]));
  // "user" (and a release sealed before the setting existed): only the user's own address
  for (const ctx of [withRule(), withRule('user')]) {
    assert.equal(act(to(USER), ctx), 'allow');
    assert.equal(act(from(USER), ctx), 'allow');
    const sealedContract = decide(to(STAKING), ctx);
    assert.equal(sealedContract.action, 'block');
    assert.match(sealedContract.reason, /sealed that token transfers go only to you/);
    assert.equal(act(to(DRAINER), ctx), 'block');
    assert.equal(act(from(DRAINER), ctx), 'block');
  }
  // "allowlist": also contracts the site sealed
  assert.equal(act(to(USER), withRule('allowlist')), 'allow');
  assert.equal(act(to(STAKING), withRule('allowlist')), 'allow');
  assert.equal(act(to(ROUTER), withRule('allowlist')), 'allow');
  const bad = decide(to(DRAINER), withRule('allowlist'));
  assert.equal(bad.action, 'block');
  assert.match(bad.title, /Recipient is not you/);
  assert.match(bad.reason, /not your address and not a contract this site sealed/);
  assert.equal(act(from(DRAINER), withRule('allowlist')), 'block');
  // "any": a send-tokens app
  assert.equal(act(to(DRAINER), withRule('any')), 'allow');
  assert.equal(act(from(DRAINER), withRule('any')), 'allow');
  // the setting is about transfers only: approvals and swap recipients stay strict
  assert.equal(act(tx(TOKEN, data('approve', [DRAINER, 1n])), withRule('any')), 'block');
  assert.equal(act(tx(ROUTER, data('swapExactTokensForTokens', [1n, 0n, [TOKEN, TOKEN], DRAINER, 1n])), withRule('any')), 'block');
  // an unknown value is the strict rule
  assert.equal(act(to(STAKING), { ...ok, allowlist: { '196': { ...allowlist['196'], transfers: 'everyone' as never } } }), 'block');
});

test('a token-style call that also sends OKB to an unsealed contract is refused', () => {
  assert.equal(act(tx(DRAINER, data('approve', [ROUTER, 1n]), '0xde0b6b3a7640000')), 'block');
  assert.equal(act(tx(DRAINER, data('approve', [ROUTER, 1n]))), 'allow'); // harmless: nothing moves
});

test('targets: calls and payments only to sealed contracts', () => {
  assert.equal(act(tx(STAKING, data('stake', [5n]))), 'allow');
  assert.equal(act(tx(DRAINER, data('stake', [5n]))), 'block');
  assert.equal(act(tx(DRAINER, '0x', '0x1')), 'block', 'a plain payment to an unsealed address');
  assert.equal(act(tx(ROUTER, '0x', '0x1')), 'allow');
  assert.equal(act(tx(null, '0x6080')), 'warn', 'contract creation');
});

test('allowlisted router, attacker as recipient (threat 6)', () => {
  assert.equal(act(tx(ROUTER, data('swapExactTokensForTokens', [1n, 0n, [TOKEN, TOKEN], USER, 1n]))), 'allow');
  const bad = decide(tx(ROUTER, data('swapExactTokensForTokens', [1n, 0n, [TOKEN, TOKEN], DRAINER, 1n])), ok);
  assert.equal(bad.action, 'block');
  assert.match(bad.reason, /goes to 0xBAD0.*not to you/);
  assert.equal(act(tx(PERMIT2, encodeFunctionData({ abi: p2, functionName: 'approve', args: [TOKEN, DRAINER, 1n, 1] }))), 'block');
  assert.equal(act(tx(PERMIT2, encodeFunctionData({ abi: p2, functionName: 'approve', args: [TOKEN, ROUTER, 1n, 1] }))), 'allow');
});

const typed = (primaryType: string, verifyingContract: string | undefined, message: Record<string, unknown>, chainId: unknown = 196): SignRequest => ({
  method: 'eth_signTypedData_v4', chainId: '0xc4', accounts: [USER],
  params: [USER, JSON.stringify({ primaryType, domain: { name: 'x', chainId, verifyingContract }, message, types: {} })],
});

test('typed data: Permit2 needs a sealed verifying contract and a sealed spender; token permits need a sealed spender', () => {
  assert.equal(act(typed('PermitSingle', PERMIT2, { spender: ROUTER })), 'allow');
  assert.equal(act(typed('PermitSingle', PERMIT2, { spender: DRAINER })), 'block');
  assert.equal(act(typed('PermitSingle', DRAINER, { spender: ROUTER })), 'block');
  assert.equal(act(typed('PermitTransferFrom', PERMIT2, { spender: DRAINER })), 'block');
  assert.equal(act(typed('Permit', TOKEN, { owner: USER, spender: ROUTER })), 'allow', 'EIP-2612: the token is the verifying contract');
  assert.equal(act(typed('Permit', TOKEN, { owner: USER, spender: DRAINER })), 'block');
  assert.equal(act(typed('Order', DRAINER, {})), 'block');
  assert.equal(act(typed('Order', PERMIT2, {})), 'allow');
  assert.equal(act(typed('Mail', undefined, {})), 'warn');
  assert.equal(act(typed('PermitSingle', PERMIT2, { spender: ROUTER }, 1)), 'block', 'a chain the site sealed nothing for');
  assert.equal(act({ method: 'eth_signTypedData_v4', chainId: '0xc4', accounts: [USER], params: [USER, '{not json'] }), 'warn');
});

test('other methods: login signatures pass, eth_sign is unverified, batches take the worst call', () => {
  assert.equal(act({ method: 'personal_sign', params: ['0x68656c6c6f', USER], chainId: '0xc4', accounts: [USER] }), 'allow');
  assert.equal(act({ method: 'eth_sign', params: [USER, Z], chainId: '0xc4', accounts: [USER] }), 'warn');
  const batch = (calls: unknown[]): SignRequest => ({ method: 'wallet_sendCalls', params: [{ from: USER, chainId: '0xc4', calls }], chainId: '0xc4', accounts: [USER] });
  assert.equal(act(batch([{ to: TOKEN, data: data('approve', [ROUTER, 1n]) }, { to: STAKING, data: data('stake', [1n]) }])), 'allow');
  assert.equal(act(batch([{ to: TOKEN, data: data('approve', [ROUTER, 1n]) }, { to: TOKEN, data: data('transfer', [DRAINER, 1n]) }])), 'block');
  assert.equal(act({ ...tx(STAKING, data('stake', [1n])), chainId: '0x1' }), 'block', 'wrong chain');
  assert.equal(act({ method: 'eth_chainId', params: [], chainId: '0xc4', accounts: [] }), 'allow');
});

test('page and site state: tampered or revoked refuses everything; could-not-check allows everything (fail-open)', () => {
  const login: SignRequest = { method: 'personal_sign', params: ['0x00', USER], chainId: '0xc4', accounts: [USER] };
  assert.equal(act(login, { ...ok, page: 'tampered' }), 'block');
  assert.equal(act(tx(TOKEN, data('approve', [ROUTER, 1n])), { ...ok, page: 'tampered' }), 'block');
  assert.equal(act(login, { site: 'revoked', page: 'ok', allowlist: null }), 'block');
  for (const site of ['unverified', 'no-release'] as const) assert.equal(act(tx(TOKEN, data('approve', [DRAINER, 1n])), { site, page: 'unknown', allowlist: null }), 'allow');
  // files that could not be read (grey) do not switch the allowlist off
  assert.equal(act(tx(TOKEN, data('approve', [DRAINER, 1n])), { ...ok, page: 'unverified' }), 'block');
});
