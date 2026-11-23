// The sealed factory rule (allowlist.json, per chain: "factories"). A contract that isn't listed passes as a target
// or spender only when the chain shows, on two RPCs that agree at one block, that:
//   1. factory.<predict>(X, target.<id>()) == target, for X = the signer or target.<roles[0]>() (the owner). The
//      factory deploys with CREATE2 from (deployer, id), so only a contract it created can sit at that address, and
//      reading target.<id>() fails if there is no code there;
//   2. the signer is one of target.<roles>() (owner, guardian…): you only ever act on your own vault.
// Without (2), anyone could create a vault through the public factory and a hijacked page could steer you into it.
// Strict: an RPC error, a disagreement, a revert or an unknown chain means "not created by the factory".
// Cache: the creation fact (1) never changes, so it is kept; the roles (2) can change and are kept 10 minutes.
import { decodeFunctionResult, encodeFunctionData, getAddress, isAddress, parseAbi, type Abi, type Hex } from 'viem';
import { agree } from './rpc.ts';
import type { FactoryRule, Net } from './types.ts';

const ROLE_TTL = 10 * 60_000;
export interface FactoryCache { get(k: string): Promise<unknown>; set(k: string, v: unknown): Promise<void> }
export type CallFn = typeof agree;
export interface FactoryVerdict { ok: boolean; why: string }

const lc = (a: string) => a.toLowerCase();
const fnName = (sig: string) => sig.slice(0, sig.indexOf('('));

/// "predictVaultAddress(address,bytes32)" + returns address → an ABI item. Only the shapes the rule needs.
function abiOf(rule: FactoryRule): { predict: Abi; id: Abi; role: Abi; idType: string } {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\(address,(bytes32|uint256)\)$/.exec(rule.predict);
  const i = /^([A-Za-z_][A-Za-z0-9_]*)\(\)$/.exec(rule.id);
  if (!m || !i || m[2] === undefined) throw new Error('unsupported factory rule');
  for (const r of rule.roles) if (!/^[A-Za-z_][A-Za-z0-9_]*\(\)$/.test(r)) throw new Error('unsupported role getter');
  return {
    predict: parseAbi([`function ${m[1]}(address, ${m[2]}) view returns (address)`]),
    id: parseAbi([`function ${i[1]}() view returns (${m[2]})`]),
    role: parseAbi(rule.roles.map((r) => `function ${fnName(r)}() view returns (address)`)),
    idType: m[2],
  };
}

/// Is `target` a contract the sealed factory created, that `signer` may act on? Never throws.
export async function checkFactory(net: Net, chain: string, rule: FactoryRule, target: string, signer: string, cache: FactoryCache, call: CallFn = agree): Promise<FactoryVerdict> {
  try {
    const c = net.chains?.[chain];
    if (!c) return { ok: false, why: `Guard has no RPCs for chain ${chain}` };
    if (!isAddress(target) || !isAddress(signer) || !isAddress(rule.factory)) return { ok: false, why: 'not an address' };
    const chainNet: Net = { ...net, rpcUrl: c.rpcUrl, rpcUrl2: c.rpcUrl2 };
    const abi = abiOf(rule);
    const t = getAddress(target) as Hex;
    const f = getAddress(rule.factory) as Hex;
    const key = `factory:${chain}:${lc(f)}:${lc(t)}`;

    // 2. roles (10 min), read every time the cache is older; also gives the id and the owner for step 1
    const rk = `${key}:roles`;
    let roles = (await cache.get(rk)) as { at: number; id: string; addrs: string[] } | undefined;
    if (!roles || Date.now() - roles.at > ROLE_TTL) {
      const calls = [
        { to: t, data: encodeFunctionData({ abi: abi.id, functionName: fnName(rule.id) }) },
        ...rule.roles.map((r) => ({ to: t, data: encodeFunctionData({ abi: abi.role, functionName: fnName(r) }) })),
      ];
      const out = await call(chainNet, calls);
      if (out.some((x) => x === 'revert' || x === '0x')) return { ok: false, why: `${t} is not a contract made by the sealed factory (it does not answer ${rule.id})` };
      const id = String(decodeFunctionResult({ abi: abi.id, functionName: fnName(rule.id), data: out[0] as Hex }));
      const addrs = rule.roles.map((r, k) => lc(decodeFunctionResult({ abi: abi.role, functionName: fnName(r), data: out[k + 1] as Hex }) as string));
      roles = { at: Date.now(), id, addrs };
      await cache.set(rk, roles);
    }
    const zero = '0x0000000000000000000000000000000000000000';
    if (!roles.addrs.filter((a) => a !== zero).includes(lc(signer))) {
      return { ok: false, why: `${t} was not made for you: you are not its ${rule.roles.map(fnName).join(' or ')}` };
    }

    // 1. created by the factory (kept for good once true)
    const ck = `${key}:created`;
    if ((await cache.get(ck)) !== true) {
      const deployers = [...new Set([lc(signer), roles.addrs[0]!].filter((a) => a !== zero))];
      const idArg = abi.idType === 'bytes32' ? (roles.id as Hex) : BigInt(roles.id);
      const out = await call(chainNet, deployers.map((d) => ({ to: f, data: encodeFunctionData({ abi: abi.predict, functionName: fnName(rule.predict), args: [getAddress(d), idArg] }) })));
      const created = out.some((x) => x !== 'revert' && lc(decodeFunctionResult({ abi: abi.predict, functionName: fnName(rule.predict), data: x as Hex }) as string) === lc(t));
      if (!created) return { ok: false, why: `${t} was not created by the sealed factory ${f} for you` };
      await cache.set(ck, true);
    }
    return { ok: true, why: `${t} was created by the sealed factory ${f}, and you are its ${rule.roles.map(fnName).join(' or ')}` };
  } catch (e) {
    return { ok: false, why: `could not check the factory: ${e instanceof Error ? e.message : String(e)}` };
  }
}
