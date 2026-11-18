// The connected wallet (EIP-6963 or window.ethereum). Every action simulates first, so a refusal names its reason
// before anything is signed, and publish/unfreeze get gas headroom for the policy circuit (as in the CLI).
// Plain JSON-RPC (no viem clients): viem is used only to encode the call and decode a revert, which keeps the
// bundle small enough for DeWEB.
import { decodeErrorResult, encodeFunctionData, type Abi, type Address, type Hex } from 'viem';
import { NET, GATE_ABI } from './chain.ts';

interface Eip1193 { request(a: { method: string; params?: unknown[] }): Promise<unknown> }
let provider: Eip1193 | null = null;
window.addEventListener('eip6963:announceProvider', (e) => {
  provider ??= (e as CustomEvent<{ provider: Eip1193 }>).detail.provider;
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
export let account: Address | null = null;

class RpcError extends Error {
  constructor(message: string, readonly data?: unknown) { super(message); }
}
let rpcId = 0;
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(NET.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  const j = (await r.json()) as { result?: T; error?: { message: string; data?: unknown } };
  if (j.error) throw new RpcError(j.error.message, j.error.data);
  return j.result as T;
}

/// "refused by the contract: <ErrorName>" when the revert data decodes against the gate's ABI.
function reason(e: unknown): Error {
  const raw = e instanceof RpcError ? e.data : (e as { data?: unknown })?.data;
  const data = typeof raw === 'string' ? raw : typeof (raw as { data?: unknown })?.data === 'string' ? (raw as { data: string }).data : undefined;
  if (data && /^0x[0-9a-f]{8}/i.test(data)) {
    try { return new Error(`refused by the contract: ${decodeErrorResult({ abi: GATE_ABI as Abi, data: data as Hex }).errorName}`); } catch { /* not one of ours */ }
  }
  return e instanceof Error ? e : new Error(String(e));
}

export async function connect(): Promise<Address> {
  const p = provider ?? (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!p) throw new Error('No wallet found in this browser.');
  provider = p;
  account = ((await p.request({ method: 'eth_requestAccounts' })) as Address[])[0]!;
  const id = parseInt((await p.request({ method: 'eth_chainId' })) as string, 16);
  if (id !== NET.chainId) throw new Error(`Your wallet is on chain ${id}; switch it to ${NET.chainId} (${NET.name}).`);
  return account;
}

export async function send(to: Address, functionName: string, args: unknown[] = [], pad = false): Promise<string> {
  await connect(); // the wallet's current account every time: the user may have switched accounts since
  const tx = { from: account!, to, data: encodeFunctionData({ abi: GATE_ABI as Abi, functionName, args }) };
  let gas: bigint;
  try {
    await rpc('eth_call', [tx, 'latest']);
    gas = BigInt(await rpc<string>('eth_estimateGas', [tx]));
  } catch (e) {
    throw reason(e);
  }
  gas = pad ? (gas * 3n) / 2n + 400_000n : (gas * 6n) / 5n;
  const hash = (await provider!.request({ method: 'eth_sendTransaction', params: [{ ...tx, gas: `0x${gas.toString(16)}` }] }).catch((e) => { throw reason(e); })) as Hex;
  for (;;) {
    const r = await rpc<{ status: string } | null>('eth_getTransactionReceipt', [hash]);
    if (r) {
      if (r.status !== '0x1') throw new Error(`reverted on-chain (tx ${hash})`);
      return hash;
    }
    await new Promise((res) => setTimeout(res, 300));
  }
}
