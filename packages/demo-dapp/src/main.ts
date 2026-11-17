// Demo dApp: a simple X Layer swap/stake page. It asks the wallet for the same kinds of signatures a real DEX
// does (approve, a router swap, a Permit2 typed-data signature, a staking call), so Guard has something to check.
// The contract addresses are placeholders for the demo: nothing is deployed at them.
import './style.css';

const USDT = '0x1E4a5963aBFD975d8c9021ce480b42188849D41d';
const ROUTER = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const STAKING = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const WOKB = '0xe538905cf8410324e03A5A23C1c177a474D59b2b';
const CHAIN_ID = __SIGNET_NETWORK__.chainId;

interface Provider { request(args: { method: string; params?: unknown[] }): Promise<unknown> }
const $ = (id: string) => document.getElementById(id)!;
const word = (v: string | bigint | number) => (typeof v === 'string' ? v.toLowerCase().replace(/^0x/, '') : v.toString(16)).padStart(64, '0');
const usdt = (n: number) => BigInt(n) * 1_000_000n;

// EIP-6963 wallets announce themselves; window.ethereum is the fallback.
let provider: Provider | null = null;
window.addEventListener('eip6963:announceProvider', (e) => {
  provider ??= (e as CustomEvent<{ provider: Provider }>).detail.provider;
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
const wallet = (): Provider => {
  const p = provider ?? (window as unknown as { ethereum?: Provider }).ethereum;
  if (!p) throw new Error('No wallet found. Install a wallet extension.');
  return p;
};

let account = '';
function say(text: string, state: 'idle' | 'ok' | 'error' = 'idle'): void {
  $('status').textContent = text;
  $('status').dataset.state = state;
}
async function run(label: string, f: () => Promise<unknown>): Promise<void> {
  try {
    say(`${label}: waiting for the wallet...`);
    const r = await f();
    say(`${label}: done (${String(r).slice(0, 22)}...)`, 'ok');
  } catch (e) {
    const err = e as { code?: number; message?: string };
    say(`${label}: refused${err.code ? ` [${err.code}]` : ''}: ${err.message ?? e}`, 'error');
  }
}
async function connect(): Promise<string> {
  if (!account) {
    account = ((await wallet().request({ method: 'eth_requestAccounts' })) as string[])[0]!;
    $('account').textContent = account;
  }
  return account;
}
const send = async (to: string, data: string) => wallet().request({ method: 'eth_sendTransaction', params: [{ from: await connect(), to, data, value: '0x0' }] });

// The spender normally is the router. "?spender=0x..." stands in for a compromised price API that tells the
// page to approve someone else: the code is untouched, only the data is hostile.
const spender = new URLSearchParams(location.search).get('spender') ?? ROUTER;

$('connect').onclick = () => run('Connect', connect);
$('approve').onclick = () => run('Approve', () => send(USDT, `0x095ea7b3${word(spender)}${word(usdt(10))}`));
$('swap').onclick = () =>
  run('Swap', async () => {
    const me = await connect();
    const deadline = Math.floor(Date.now() / 1000) + 600;
    // swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline)
    const data = `0x38ed1739${word(usdt(10))}${word(0)}${word(160)}${word(me)}${word(deadline)}${word(2)}${word(USDT)}${word(WOKB)}`;
    return send(ROUTER, data);
  });
$('stake').onclick = () => run('Stake', () => send(STAKING, `0xa694fc3a${word(usdt(5))}`)); // stake(uint256)
$('permit').onclick = () =>
  run('Permit2', async () => {
    const me = await connect();
    const typed = {
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
        PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }],
        PermitDetails: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }],
      },
      primaryType: 'PermitSingle',
      domain: { name: 'Permit2', chainId: CHAIN_ID, verifyingContract: PERMIT2 },
      message: { details: { token: USDT, amount: usdt(10).toString(), expiration: 1893456000, nonce: 0 }, spender, sigDeadline: 1893456000 },
    };
    return wallet().request({ method: 'eth_signTypedData_v4', params: [me, JSON.stringify(typed)] });
  });

$('net').textContent = `network: ${__SIGNET_NETWORK__.name} (chain ${CHAIN_ID})`;
// A lazily loaded chunk: it never appears as a <script> element, only in resource timing.
void import('./lazy').then((m) => m.mark($('app')));
