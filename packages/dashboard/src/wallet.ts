// The connected wallet (EIP-6963 or window.ethereum). Every action simulates first, so a refusal names its reason
// before anything is signed, and publish/unfreeze get gas headroom for the policy circuit (as in the CLI).
import { createPublicClient, createWalletClient, custom, http, BaseError, ContractFunctionRevertedError, type Abi, type Address } from 'viem';
import { NET, GATE_ABI } from './chain.ts';

interface Eip1193 { request(a: { method: string; params?: unknown[] }): Promise<unknown> }
let provider: Eip1193 | null = null;
window.addEventListener('eip6963:announceProvider', (e) => {
  provider ??= (e as CustomEvent<{ provider: Eip1193 }>).detail.provider;
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
const chain = { id: NET.chainId, name: `X Layer (${NET.name})`, nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 }, rpcUrls: { default: { http: [NET.rpcUrl] } } } as const;
const pub = createPublicClient({ chain, transport: http(NET.rpcUrl) });
export let account: Address | null = null;

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
  const wallet = createWalletClient({ chain, transport: custom(provider!), account: account! });
  try {
    const { request } = await pub.simulateContract({ address: to, abi: GATE_ABI as Abi, functionName, args, account: account! });
    const gas = await pub.estimateContractGas({ address: to, abi: GATE_ABI as Abi, functionName, args, account: account! });
    const hash = await wallet.writeContract({ ...request, gas: pad ? (gas * 3n) / 2n + 400_000n : (gas * 6n) / 5n } as never);
    const r = await pub.waitForTransactionReceipt({ hash, pollingInterval: 300 });
    if (r.status !== 'success') throw new Error(`reverted on-chain (tx ${hash})`);
    return hash;
  } catch (e) {
    if (e instanceof BaseError) {
      const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
      throw new Error(rev?.data?.errorName ? `refused by the contract: ${rev.data.errorName}` : e.shortMessage);
    }
    throw e;
  }
}
