// Keeps SignetRegistry's operator grant on the shared file container alive (docs/mainnet.md, 2026-11-19).
// SiteRegistry grants an operator for at most 30 days. Since circuit #5 is held by Signet's site gate, anyone may call
// siteGate.renewOperator(processor, 5) to renew it: the watchtower does, when fewer than `minDays` are left, from a
// small dedicated wallet (WATCHTOWER_RENEW_KEY). Never signet-dev, an approver or the CI proposer.
import { createPublicClient, createWalletClient, defineChain, formatEther, http, parseAbi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export interface RenewConfig {
  rpcUrl: string;
  chainId: number;
  processor: Hex; // TapeOut processor holding the circuit NFT
  circuitId: bigint; // the shared container's circuit (#5)
  container: Hex;
  siteRegistry: Hex;
  key: Hex; // the renewer wallet's private key (never logged)
  minDays?: number; // renew when fewer days than this are left (default 7)
  lowBalanceWei?: bigint; // warn below this (default 0.00005 OKB, ≈ 20 renewals)
}
export interface RenewResult { until: number; daysLeft: number; renewed: boolean; tx?: Hex; renewer: Hex; balance: string; low: boolean; holder: Hex }

const siteAbi = parseAbi(['function operatorOf(address) view returns (address)', 'function operatorUntil(address) view returns (uint256)']);
const nftAbi = parseAbi(['function ownerOf(uint256) view returns (address)']);
const gateAbi = parseAbi(['function renewOperator(address processor, uint256 tokenId)']);

/// `now` defaults to the latest block's timestamp: the grant expires by chain time, not this machine's clock.
export async function renewIfDue(rc: RenewConfig, nowArg?: number): Promise<RenewResult> {
  const chain = defineChain({ id: rc.chainId, name: `chain ${rc.chainId}`, nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 }, rpcUrls: { default: { http: [rc.rpcUrl] } } });
  const pub = createPublicClient({ chain, transport: http(rc.rpcUrl) });
  const account = privateKeyToAccount(rc.key);
  const [untilBig, holder, balance] = await Promise.all([
    pub.readContract({ address: rc.siteRegistry, abi: siteAbi, functionName: 'operatorUntil', args: [rc.container] }),
    pub.readContract({ address: rc.processor, abi: nftAbi, functionName: 'ownerOf', args: [rc.circuitId] }),
    pub.getBalance({ address: account.address }),
  ]);
  const now = nowArg ?? Number((await pub.getBlock({ blockTag: 'latest' })).timestamp);
  let until = Number(untilBig);
  const low = balance < (rc.lowBalanceWei ?? 50_000_000_000_000n);
  const base = { renewer: account.address, balance: formatEther(balance), low, holder };
  const daysLeft = (until - now) / 86400;
  if (daysLeft >= (rc.minDays ?? 7)) return { ...base, until, daysLeft, renewed: false };
  // the holder must be a gate (only a gate has renewOperator); simulate first so a revert costs nothing
  const wallet = createWalletClient({ chain, transport: http(rc.rpcUrl), account });
  const { request } = await pub.simulateContract({ address: holder, abi: gateAbi, functionName: 'renewOperator', args: [rc.processor, rc.circuitId], account });
  const tx = await wallet.writeContract(request);
  const rcpt = await pub.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
  if (rcpt.status !== 'success') throw new Error(`renewOperator reverted (tx ${tx})`);
  until = Number(await pub.readContract({ address: rc.siteRegistry, abi: siteAbi, functionName: 'operatorUntil', args: [rc.container] }));
  return { ...base, until, daysLeft: (until - now) / 86400, renewed: true, tx };
}
