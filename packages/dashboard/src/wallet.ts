// The connected wallet (EIP-6963 or window.ethereum). Every action simulates first, so a refusal names its reason
// before anything is signed, and publish/unfreeze get gas headroom for the policy circuit (as in the CLI).
// Plain JSON-RPC (no viem clients): viem is used only to encode the call and decode a revert, which keeps the
// bundle small enough for DeWEB.
import { decodeErrorResult, encodeFunctionData, type Abi, type Address, type Hex } from 'viem';
import { NET, GATE_ABI } from './chain.ts';

interface Eip1193 { request(a: { method: string; params?: unknown[] }): Promise<unknown>; on?(event: string, cb: (...a: unknown[]) => void): void }
let provider: Eip1193 | null = null;
const listeners: (() => void)[] = [];
window.addEventListener('eip6963:announceProvider', (e) => {
  if (provider) return;
  provider = (e as CustomEvent<{ provider: Eip1193 }>).detail.provider;
  watch(provider);
});
window.dispatchEvent(new Event('eip6963:requestProvider'));

const found = (): Eip1193 | null => provider ?? (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null;
let watched: Eip1193 | null = null;
function watch(p: Eip1193): void {
  if (watched === p) return;
  watched = p;
  p.on?.('chainChanged', () => listeners.forEach((f) => f()));
  listeners.forEach((f) => f());
}
/// Called whenever the wallet's chain may have changed (a wallet appearing, or its chainChanged event).
export function onChainChange(f: () => void): void {
  listeners.push(f);
  const p = found();
  if (p) watch(p);
}

/// X Layer as wallet_addEthereumChain expects it (EIP-3085). The mainnet build adds X Layer's public RPC.
export const XLAYER = {
  chainId: `0x${NET.chainId.toString(16)}`,
  chainName: 'X Layer',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: [NET.name === 'mainnet' ? 'https://xlayerrpc.okx.com' : NET.rpcUrl],
  blockExplorerUrls: ['https://web3.okx.com/explorer/x-layer'],
};

/// The wallet's current chain, without asking for accounts; null when there is no wallet.
export async function walletChain(): Promise<number | null> {
  const p = found();
  if (!p) return null;
  try {
    return parseInt((await p.request({ method: 'eth_chainId' })) as string, 16);
  } catch {
    return null;
  }
}

/// MetaMask (extension), Rabby and most wallets answer 4902 for a chain they don't know; MetaMask Mobile wraps it
/// in -32603 with data.originalError.code 4902; some only say so in the message.
function unknownChain(e: unknown): boolean {
  const x = e as { code?: number; message?: string; data?: { originalError?: { code?: number } } };
  return x?.code === 4902 || x?.data?.originalError?.code === 4902 || /unrecognized chain|unknown chain|not (been )?added|4902/i.test(x?.message ?? '');
}

/// Switch the wallet to X Layer, adding X Layer to the wallet first if it doesn't know it.
export async function switchToXLayer(): Promise<string> {
  const p = found();
  if (!p) throw new Error('No wallet found in this browser.');
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: XLAYER.chainId }] });
  } catch (e) {
    if (!unknownChain(e)) throw e; // e.g. 4001: the user said no
    await p.request({ method: 'wallet_addEthereumChain', params: [XLAYER] });
    // most wallets switch when the user approves the add; switch explicitly for those that don't
    if ((await walletChain()) !== NET.chainId) await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: XLAYER.chainId }] });
  }
  const id = await walletChain();
  if (id !== NET.chainId) throw new Error(`The wallet is still on chain ${id}.`);
  listeners.forEach((f) => f());
  return `switched to X Layer (chain ${NET.chainId})`;
}
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
function reason(e: unknown, abi: Abi = GATE_ABI as Abi): Error {
  const raw = e instanceof RpcError ? e.data : (e as { data?: unknown })?.data;
  const data = typeof raw === 'string' ? raw : typeof (raw as { data?: unknown })?.data === 'string' ? (raw as { data: string }).data : undefined;
  if (data && /^0x[0-9a-f]{8}/i.test(data)) {
    try { return new Error(`refused by the contract: ${decodeErrorResult({ abi, data: data as Hex }).errorName}`); } catch { /* not one of ours */ }
  }
  return e instanceof Error ? e : new Error(String(e));
}

export async function connect(): Promise<Address> {
  const p = found();
  if (!p) throw new Error('No wallet found in this browser.');
  provider = p;
  watch(p);
  account = ((await p.request({ method: 'eth_requestAccounts' })) as Address[])[0]!;
  const id = parseInt((await p.request({ method: 'eth_chainId' })) as string, 16);
  if (id !== NET.chainId) {
    listeners.forEach((f) => f()); // shows the "Switch to X Layer" bar
    throw new Error(`Your wallet is on chain ${id}. Use "Switch to X Layer" above, then try again.`);
  }
  return account;
}

export async function send(to: Address, functionName: string, args: unknown[] = [], pad = false, abi: Abi = GATE_ABI as Abi): Promise<string> {
  await connect(); // the wallet's current account every time: the user may have switched accounts since
  const tx = { from: account!, to, data: encodeFunctionData({ abi, functionName, args }) };
  let gas: bigint;
  try {
    await rpc('eth_call', [tx, 'latest']);
    gas = BigInt(await rpc<string>('eth_estimateGas', [tx]));
  } catch (e) {
    throw reason(e, abi);
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
