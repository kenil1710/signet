// Demo dApp: a small X Layer swap/stake app, used to show what Signet Guard does. It asks the wallet for the same
// kinds of signatures a real DEX does: an ERC-20 approve, a router swap after a review step, a Permit2 typed-data
// signature, and a staking call. The contract addresses are demo placeholders; balances are demo balances.
import './style.css';

const ROUTER = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const STAKING = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const TOKENS = {
  USDT: { address: '0x1E4a5963aBFD975d8c9021ce480b42188849D41d', decimals: 6, usd: 1 },
  USDC: { address: '0x74b7F16337b8972027F6196A17a631aC6dE26d22', decimals: 6, usd: 1 },
  WOKB: { address: '0xe538905cf8410324e03A5A23C1c177a474D59b2b', decimals: 18, usd: 48.2 },
} as const;
type Sym = keyof typeof TOKENS;
const CHAIN_ID = __SIGNET_NETWORK__.chainId;

interface Provider { request(args: { method: string; params?: unknown[] }): Promise<unknown> }
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const word = (v: string | bigint | number) => (typeof v === 'string' ? v.toLowerCase().replace(/^0x/, '') : v.toString(16)).padStart(64, '0');
const units = (amount: number, sym: Sym) => BigInt(Math.round(amount * 1e6)) * 10n ** BigInt(TOKENS[sym].decimals - 6);
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : 2 });

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

// demo balances, kept in this browser
const balances: Record<Sym, number> = (() => {
  try {
    return { USDT: 1250, USDC: 400, WOKB: 3.5, ...JSON.parse(localStorage.getItem('demo-balances') ?? '{}') };
  } catch {
    return { USDT: 1250, USDC: 400, WOKB: 3.5 };
  }
})();
const saveBalances = () => {
  try {
    localStorage.setItem('demo-balances', JSON.stringify(balances));
  } catch { /* private window */ }
};

let account = '';
function say(text: string, state: 'idle' | 'ok' | 'error' | 'busy' = 'idle'): void {
  $('status').textContent = text;
  $('status').dataset.state = state;
}
function log(text: string): void {
  const li = document.createElement('li');
  li.textContent = `${new Date().toLocaleTimeString()} · ${text}`;
  const ul = $('activity');
  if (ul.querySelector('.dim')) ul.innerHTML = '';
  ul.prepend(li);
}
async function run(label: string, f: () => Promise<unknown>, done?: () => void): Promise<void> {
  try {
    say(`${label}: waiting for the wallet...`, 'busy');
    const r = await f();
    say(`${label}: done (${String(r).slice(0, 22)}...)`, 'ok');
    log(`${label} sent`);
    done?.();
  } catch (e) {
    const err = e as { code?: number; message?: string };
    say(`${label}: refused${err.code ? ` [${err.code}]` : ''}: ${err.message ?? e}`, 'error');
    log(`${label} refused`);
  }
}
async function connect(): Promise<string> {
  if (!account) {
    account = ((await wallet().request({ method: 'eth_requestAccounts' })) as string[])[0]!;
    $('account').textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
    $('connect').textContent = 'Connected';
  }
  return account;
}
const send = async (to: string, data: string) => wallet().request({ method: 'eth_sendTransaction', params: [{ from: await connect(), to, data, value: '0x0' }] });

// "?spender=0x…" and "?recipient=0x…" stand in for a compromised quote API: the page code is genuine, the data is hostile.
const params = new URLSearchParams(location.search);
const spender = params.get('spender') ?? ROUTER;
const recipient = (me: string) => params.get('recipient') ?? me;

// ---------------------------------------------------------------- the swap form
const from = $<HTMLSelectElement>('from');
const to = $<HTMLSelectElement>('to');
for (const s of Object.keys(TOKENS)) {
  from.add(new Option(s, s));
  to.add(new Option(s, s));
}
from.value = 'USDT';
to.value = 'WOKB';
const amount = () => Math.max(0, Number($<HTMLInputElement>('amount').value.replace(',', '.')) || 0);
const quote = () => (amount() * TOKENS[from.value as Sym].usd) / TOKENS[to.value as Sym].usd * 0.997; // 0.3% pool fee
function render(): void {
  if (from.value === to.value) to.value = from.value === 'WOKB' ? 'USDT' : 'WOKB';
  const f = from.value as Sym;
  const t = to.value as Sym;
  $<HTMLInputElement>('out').value = fmt(quote());
  $('bal-from').textContent = `${fmt(balances[f])} ${f}`;
  $('bal-to').textContent = `${fmt(balances[t])} ${t}`;
  $('rate').textContent = `1 ${f} ≈ ${fmt(TOKENS[f].usd / TOKENS[t].usd * 0.997)} ${t} · pool fee 0.3%`;
  $('approve').textContent = `Approve ${f}`;
  const short = amount() > balances[f];
  $<HTMLButtonElement>('swap').textContent = short ? `Not enough ${f}` : amount() ? 'Review swap' : 'Enter an amount';
}
for (const el of ['amount', 'from', 'to']) $(el).addEventListener('input', render);
$('flip').onclick = () => {
  [from.value, to.value] = [to.value, from.value];
  render();
};
$('max').onclick = () => {
  $<HTMLInputElement>('amount').value = String(balances[from.value as Sym]);
  render();
};

$('connect').onclick = () => run('Connect', connect);
$('approve').onclick = () => {
  const f = from.value as Sym;
  void run('Approve', () => send(TOKENS[f].address, `0x095ea7b3${word(spender)}${word(units(amount() || 10, f))}`));
};

// review, then confirm: the wallet is asked only after the user saw what will happen
const review = $<HTMLDialogElement>('review');
$('swap').onclick = async () => {
  const me = await connect().catch(() => '');
  const f = from.value as Sym;
  const t = to.value as Sym;
  $('r-pay').textContent = `${fmt(amount() || 10)} ${f}`;
  $('r-min').textContent = `${fmt(quote() * 0.995)} ${t}`;
  $('r-rate').textContent = $('rate').textContent;
  $('r-route').textContent = `Demo Router ${ROUTER.slice(0, 8)}…${ROUTER.slice(-4)}`;
  $('r-to').textContent = me ? (recipient(me).toLowerCase() === me.toLowerCase() ? 'you' : recipient(me)) : 'you';
  review.showModal();
};
$('cancel-swap').onclick = () => review.close();
$('confirm-swap').onclick = () => {
  review.close();
  const f = from.value as Sym;
  const t = to.value as Sym;
  const a = amount() || 10;
  const out = quote() || 0;
  void run('Swap', async () => {
    const me = await connect();
    const deadline = Math.floor(Date.now() / 1000) + 600;
    // swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline)
    const data = `0x38ed1739${word(units(a, f))}${word(units(out * 0.995, t))}${word(160)}${word(recipient(me))}${word(deadline)}${word(2)}${word(TOKENS[f].address)}${word(TOKENS[t].address)}`;
    return send(ROUTER, data);
  }, () => {
    balances[f] -= a;
    balances[t] += out;
    saveBalances();
    render();
  });
};
$('stake').onclick = () => {
  const a = Math.max(0, Number($<HTMLInputElement>('stake-amount').value) || 5);
  void run('Stake', () => send(STAKING, `0xa694fc3a${word(units(a, 'USDT'))}`)); // stake(uint256)
};
$('permit').onclick = () =>
  run('Permit2', async () => {
    const me = await connect();
    const f = from.value as Sym;
    const typed = {
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
        PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }],
        PermitDetails: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }],
      },
      primaryType: 'PermitSingle',
      domain: { name: 'Permit2', chainId: CHAIN_ID, verifyingContract: PERMIT2 },
      message: { details: { token: TOKENS[f].address, amount: units(amount() || 10, f).toString(), expiration: 1893456000, nonce: 0 }, spender, sigDeadline: 1893456000 },
    };
    return wallet().request({ method: 'eth_signTypedData_v4', params: [me, JSON.stringify(typed)] });
  });

$('net').textContent = `${__SIGNET_NETWORK__.name} · chain ${CHAIN_ID}`;
render();
// A lazily loaded chunk: it never appears as a <script> element, only in resource timing.
void import('./lazy').then((m) => m.mark($('app')));
