// The sealed factory rule (lib/factory.ts) against a fake chain: a factory that predicts CREATE2 addresses from
// (deployer, programId), vaults with programId/owner/guardian, and contracts that are not vaults.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionResult, keccak256, encodeAbiParameters, parseAbi, getAddress, type Hex } from 'viem';
import { checkFactory, type CallFn } from '../src/lib/factory.ts';
import { RpcError, type Call } from '../src/lib/rpc.ts';
import { trustedBy, withVerified, decide } from '../src/lib/policy.ts';
import type { FactoryRule, Net } from '../src/lib/types.ts';

const FACTORY = '0x9075CbB50639216C2e4E32013514baa01f2b0C1b';
const RULE: FactoryRule = { factory: FACTORY, predict: 'predictVaultAddress(address,bytes32)', id: 'programId()', roles: ['owner()', 'guardian()'] };
const ME = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const GUARD = '0x3333333333333333333333333333333333333333';
const ZERO = '0x0000000000000000000000000000000000000000';
const net = { name: 't', chainId: 196, rpcUrl: 'x', rpcUrl2: 'y', registry: null, siteRegistry: ZERO, chains: { '5042': { rpcUrl: 'a', rpcUrl2: 'b' } } } as unknown as Net;
const abi = parseAbi(['function predictVaultAddress(address, bytes32) view returns (address)', 'function programId() view returns (bytes32)', 'function owner() view returns (address)', 'function guardian() view returns (address)']);
const predicted = (deployer: string, id: Hex) => getAddress(`0x${keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [getAddress(deployer), id])).slice(-40)}`);
const ID = `0x${'ab'.repeat(32)}` as Hex;

/// contracts: address -> { programId, owner, guardian }. Factory vaults sit at predicted(deployer, id).
function chain(contracts: Record<string, { programId: Hex; owner: string; guardian: string }>, opts: { fail?: boolean } = {}) {
  let calls = 0;
  const fn: CallFn = async (_n: Net, cs: Call[]) => {
    calls += cs.length;
    if (opts.fail) throw new RpcError('the two RPCs disagree about the chain');
    return cs.map((c) => {
      if (c.to.toLowerCase() === FACTORY.toLowerCase()) {
        const { args } = decodeFunctionData({ abi, data: c.data });
        return encodeFunctionResult({ abi, functionName: 'predictVaultAddress', result: predicted(args![0] as string, args![1] as Hex) });
      }
      const k = contracts[c.to.toLowerCase()];
      if (!k) return '0x'; // no code: an empty answer
      const { functionName } = decodeFunctionData({ abi, data: c.data });
      if (functionName === 'programId') return encodeFunctionResult({ abi, functionName, result: k.programId });
      return encodeFunctionResult({ abi, functionName: functionName as 'owner', result: getAddress(functionName === 'owner' ? k.owner : k.guardian) });
    });
  };
  return { fn, count: () => calls };
}
const memo = () => { const m = new Map<string, unknown>(); return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => void m.set(k, v), m }; };

test('your own vault, created by you through the factory: allowed', async () => {
  const v = predicted(ME, ID);
  const c = chain({ [v.toLowerCase()]: { programId: ID, owner: ME, guardian: ZERO } });
  const r = await checkFactory(net, '5042', RULE, v, ME, memo(), c.fn);
  assert.equal(r.ok, true, r.why);
});

test("the vault's guardian may act on a vault its owner created", async () => {
  const v = predicted(OTHER, ID);
  const c = chain({ [v.toLowerCase()]: { programId: ID, owner: OTHER, guardian: GUARD } });
  assert.equal((await checkFactory(net, '5042', RULE, v, GUARD, memo(), c.fn)).ok, true);
});

test('a fake vault (same interface, names you as owner, not at a factory address): refused', async () => {
  const fake = '0x4444444444444444444444444444444444444444';
  const c = chain({ [fake]: { programId: ID, owner: ME, guardian: ZERO } });
  const r = await checkFactory(net, '5042', RULE, fake, ME, memo(), c.fn);
  assert.equal(r.ok, false);
  assert.match(r.why, /not created by the sealed factory/);
});

test('a real factory vault that someone else created and owns: refused (you are not its owner or guardian)', async () => {
  const v = predicted(OTHER, ID);
  const c = chain({ [v.toLowerCase()]: { programId: ID, owner: OTHER, guardian: ZERO } });
  const r = await checkFactory(net, '5042', RULE, v, ME, memo(), c.fn);
  assert.equal(r.ok, false);
  assert.match(r.why, /not made for you/);
});

test('a factory vault an attacker created naming you as owner: refused (its creator is not you)', async () => {
  const v = predicted(OTHER, ID); // deployed by OTHER, owner set to ME
  const c = chain({ [v.toLowerCase()]: { programId: ID, owner: ME, guardian: ZERO } });
  assert.equal((await checkFactory(net, '5042', RULE, v, ME, memo(), c.fn)).ok, false);
});

test('strict: no code, RPCs disagreeing, or a chain Guard has no RPCs for: refused', async () => {
  assert.equal((await checkFactory(net, '5042', RULE, predicted(ME, ID), ME, memo(), chain({}).fn)).ok, false, 'no code');
  const v = predicted(ME, ID);
  const r = await checkFactory(net, '5042', RULE, v, ME, memo(), chain({ [v.toLowerCase()]: { programId: ID, owner: ME, guardian: ZERO } }, { fail: true }).fn);
  assert.equal(r.ok, false);
  assert.match(r.why, /could not check the factory: the two RPCs disagree/);
  assert.match((await checkFactory(net, '1', RULE, v, ME, memo(), chain({}).fn)).why, /no RPCs for chain 1/);
});

test('cache: the creation fact is kept for good, the roles 10 minutes', async () => {
  const v = predicted(ME, ID);
  const c = chain({ [v.toLowerCase()]: { programId: ID, owner: ME, guardian: ZERO } });
  const cache = memo();
  assert.equal((await checkFactory(net, '5042', RULE, v, ME, cache, c.fn)).ok, true);
  const first = c.count();
  assert.equal((await checkFactory(net, '5042', RULE, v, ME, cache, c.fn)).ok, true);
  assert.equal(c.count(), first, 'second check: no RPC calls');
  const rk = [...cache.m.keys()].find((k) => k.endsWith(':roles'))!;
  (cache.m.get(rk) as { at: number }).at -= 11 * 60_000;
  assert.equal((await checkFactory(net, '5042', RULE, v, ME, cache, c.fn)).ok, true);
  assert.equal(c.count(), first + 3, 'roles re-read (id + 2 roles), creation not re-checked');
});

test('policy: the addresses a request asks you to trust, and the per-request allowlist', () => {
  const vault = predicted(ME, ID).toLowerCase();
  const USDC = '0x3600000000000000000000000000000000000000';
  const approve = `0x095ea7b3${vault.slice(2).padStart(64, '0')}${'f'.repeat(64)}`;
  const req = { method: 'eth_sendTransaction', params: [{ from: ME, to: USDC, data: approve, chainId: '0x13b2' }], chainId: '0x13b2', accounts: [ME] };
  assert.deepEqual(trustedBy(req), { chain: '5042', addresses: [USDC.toLowerCase(), vault] });
  const allowlist = { '5042': { targets: [USDC], spenders: [], eip712: [], transfers: 'user' as const, factories: [RULE] } };
  const ctx = (a: typeof allowlist) => ({ site: 'sealed' as const, page: 'ok' as const, allowlist: a });
  assert.equal(decide(req, ctx(allowlist)).action, 'block', 'without the factory check the vault is an unsealed spender');
  assert.equal(decide(req, ctx(withVerified(allowlist, '5042', [vault]) as typeof allowlist)).action, 'allow');
  assert.equal(allowlist['5042'].spenders.length, 0, 'the sealed allowlist itself is unchanged');
});
