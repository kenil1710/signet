// Guard 0.3.6: the in-page wrapper (src/inpage.ts) covers every provider a page can reach, not only
// window.ethereum: wallet globals (window.okxwallet, okxwallet.ethereum, bitkeep.ethereum, coinbaseWalletExtension,
// phantom.ethereum, trustwallet, rabby), any other EIP-1193 object on a global, and ethereum.providers. The real
// inpage.ts runs in a VM sandbox with a fake window; a fake content script stands in for Guard and refuses what
// isn't sealed, as Guard does in enforce mode. (The decision itself is tested on the staging chain: guard.test.ts.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

// inpage.ts imports lib/wire.ts (bundled by the build); here the two are joined into one classic script
const WIRE = stripTypeScriptTypes(readFileSync(new URL('../src/lib/wire.ts', import.meta.url), 'utf8')).replace(/^export /gm, '');
const SOURCE = WIRE + '\n' + stripTypeScriptTypes(readFileSync(new URL('../src/inpage.ts', import.meta.url), 'utf8')).replace(/^import .*$/m, '');
const ME = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x1e4a5963abfd975d8c9021ce480b42188849d41d';
const ROUTER = '5fbdb2315678afecb367f032d93f642f64180aa3';
const DRAINER = 'bad0c0ffee5bad0c0ffee5bad0c0ffee5bad0c0f';
const approve = (spender: string) => ({ method: 'eth_sendTransaction', params: [{ from: ME, to: TOKEN, data: `0x095ea7b3${spender.padStart(64, '0')}${'f'.repeat(64)}` }] });

interface Call { provider: string; method: string; params: string }
interface Ask { method: string; params: string }
type Mode = 'enforce' | 'observe' | 'unsealed';

/// A mock wallet provider: records every call, answers like a wallet.
function mockProvider(name: string, calls: Call[]) {
  return {
    isMock: true,
    on() {},
    async request(args: { method: string; params?: unknown }) {
      calls.push({ provider: name, method: args.method, params: JSON.stringify(args.params ?? null, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)) });
      if (args.method === 'eth_chainId') return '0xc4';
      if (args.method === 'eth_accounts' || args.method === 'eth_requestAccounts') return [ME];
      if (args.method === 'eth_sendTransaction') return `0x${'ab'.repeat(32)}`;
      return null;
    },
    sendAsync(payload: { id: number; method: string; params?: unknown }, cb: (e: unknown, r: unknown) => void) {
      this.request(payload).then((result) => cb(null, { id: payload.id, result }), (e) => cb(e, null));
    },
  };
}

/// A page with Guard's in-page script. `before` runs before it (a wallet that injects first), `after` right after
/// (a wallet that injects later). The fake Guard refuses any request whose params name the drainer or are empty
/// (Guard can't read it) in enforce mode, and allows everything else.
function page(mode: Mode, o: { before?: (w: Record<string, unknown>, calls: Call[]) => void; after?: (w: Record<string, unknown>, calls: Call[]) => void } = {}) {
  const calls: Call[] = [];
  const asks: Ask[] = [];
  const events = new EventTarget();
  const doc = new EventTarget();
  const later = (f: () => void, ms: number) => setTimeout(f, ms).unref();
  const ctx = vm.createContext({ document: doc, CustomEvent, setTimeout: later, console }) as Record<string, unknown>;
  const w = vm.runInContext('globalThis', ctx) as Record<string, unknown>;
  Object.assign(w, { window: w, addEventListener: events.addEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) });
  w.top = w;
  // the content script's side of the link (src/content.ts)
  const secret = 'x'.repeat(32);
  const down = (m: unknown) => doc.dispatchEvent(new CustomEvent(`sg:${secret}:down`, { detail: JSON.stringify(m) }));
  doc.addEventListener('signet-guard:hello', () => doc.dispatchEvent(new CustomEvent('signet-guard:init', { detail: secret })));
  doc.addEventListener(`sg:${secret}:up`, (e) => {
    const m = JSON.parse((e as CustomEvent).detail) as { type: string; id: number; req: { method: string; params: unknown } };
    if (m.type === 'ack') down({ type: 'state', sealed: mode !== 'unsealed' });
    if (m.type !== 'sign') return;
    const params = JSON.stringify(m.req.params);
    asks.push({ method: m.req.method, params });
    const refused = mode === 'enforce' && (params.includes(DRAINER) || params === '[]');
    setTimeout(() => down({ type: 'decision', id: m.id, refused, message: refused ? 'Spender not in the sealed allowlist' : '' }), 1);
  });
  o.before?.(w, calls);
  vm.runInContext(SOURCE, ctx);
  o.after?.(w, calls);
  /// runs code in the page, as a page script would
  const run = <T>(code: string): Promise<T> => vm.runInContext(code, ctx) as Promise<T>;
  return { w, calls, asks, run };
}
const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const signed = (calls: Call[]) => calls.filter((c) => c.method === 'eth_sendTransaction');
async function attempt(p: Promise<unknown>): Promise<string> {
  return p.then(() => 'SENT', (e: { code?: number; message: string }) => `${e.code}: ${e.message}`);
}

// path from window -> how a wallet installs it
const VENDORS: Record<string, (w: Record<string, unknown>, calls: Call[]) => void> = {
  'window.ethereum': (w, c) => { w.ethereum = mockProvider('window.ethereum', c); },
  'window.okxwallet': (w, c) => { w.okxwallet = mockProvider('window.okxwallet', c); },
  'window.okxwallet.ethereum': (w, c) => { w.okxwallet = Object.assign(mockProvider('window.okxwallet', c), { ethereum: mockProvider('window.okxwallet.ethereum', c) }); },
  'window.bitkeep.ethereum': (w, c) => { w.bitkeep = { ethereum: mockProvider('window.bitkeep.ethereum', c) }; },
  'window.coinbaseWalletExtension': (w, c) => { w.coinbaseWalletExtension = mockProvider('window.coinbaseWalletExtension', c); },
  'window.phantom.ethereum': (w, c) => { w.phantom = { ethereum: mockProvider('window.phantom.ethereum', c), solana: {} }; },
  'window.trustwallet': (w, c) => { w.trustwallet = mockProvider('window.trustwallet', c); },
  'window.rabby': (w, c) => { w.rabby = mockProvider('window.rabby', c); },
  'a wallet global Guard has no name for (window.someNewWallet)': (w, c) => { w.someNewWallet = mockProvider('window.someNewWallet', c); },
  'window.someNewWallet.ethereum (no name either)': (w, c) => { w.someNewWallet = { ethereum: mockProvider('window.someNewWallet.ethereum', c) }; },
  'window.ethereum.providers[1]': (w, c) => { w.ethereum = Object.assign(mockProvider('window.ethereum', c), { providers: [mockProvider('providers[0]', c), mockProvider('providers[1]', c)] }); },
};
const PATH: Record<string, string> = {
  'a wallet global Guard has no name for (window.someNewWallet)': 'window.someNewWallet',
  'window.someNewWallet.ethereum (no name either)': 'window.someNewWallet.ethereum',
};
const pathOf = (name: string) => PATH[name] ?? name;

test('window.okxwallet.request in enforce mode: an unsealed approve is refused [4001] and never reaches OKX Wallet; a sealed one passes', async () => {
  for (const when of ['before', 'after'] as const) {
    const { calls, asks, run } = page('enforce', { [when]: VENDORS['window.okxwallet'] });
    await settle();
    const bad = await attempt(run(`window.okxwallet.request(${JSON.stringify(approve(DRAINER))})`));
    assert.equal(bad, '4001: Signet Guard refused this signature: Spender not in the sealed allowlist', `wallet injected ${when} Guard`);
    const good = await attempt(run(`window.okxwallet.request(${JSON.stringify(approve(ROUTER))})`));
    assert.equal(good, 'SENT');
    assert.equal(asks.length, 2, 'Guard was asked both times');
    assert.deepEqual(signed(calls).map((c) => c.params.includes(ROUTER)), [true], 'only the sealed approve reached the wallet');
  }
});

for (const [name, install] of Object.entries(VENDORS)) {
  test(`${name}: refused in enforce mode when unsealed, passes when sealed (wallet injected before and after Guard)`, async () => {
    for (const when of ['before', 'after'] as const) {
      const { calls, run } = page('enforce', { [when]: install });
      await settle(); // the re-check at 0 ms finds globals Guard has no name for
      const path = pathOf(name);
      assert.equal(await attempt(run(`${path}.request(${JSON.stringify(approve(DRAINER))})`)), '4001: Signet Guard refused this signature: Spender not in the sealed allowlist', `${path}, injected ${when}`);
      assert.equal(await attempt(run(`new Promise((res, rej) => ${path}.sendAsync({ id: 1, ...${JSON.stringify(approve(DRAINER))} }, (e, r) => e ? rej(e) : res(r)))`)), '4001: Signet Guard refused this signature: Spender not in the sealed allowlist', `${path}.sendAsync, injected ${when}`);
      assert.equal(await attempt(run(`${path}.request(${JSON.stringify(approve(ROUTER))})`)), 'SENT', `${path}, injected ${when}`);
      assert.deepEqual(signed(calls).map((c) => c.params.includes(ROUTER)), [true], `${path}, injected ${when}: only the sealed approve reached the wallet`);
    }
  });
}

test('a wallet that injects late through a plain assignment (after the re-checks ran) is still wrapped: the setter catches it', async () => {
  const { w, calls, run } = page('enforce');
  await settle(300); // the re-checks at 0, 50 and 250 ms found nothing
  w.okxwallet = mockProvider('late okx', calls);
  assert.equal(await attempt(run(`window.okxwallet.request(${JSON.stringify(approve(DRAINER))})`)), '4001: Signet Guard refused this signature: Spender not in the sealed allowlist');
  assert.equal(await attempt(run(`window.okxwallet.request(${JSON.stringify(approve(ROUTER))})`)), 'SENT');
  assert.deepEqual(signed(calls).map((c) => c.params.includes(ROUTER)), [true]);
});

test("a wallet's own accessor on window is kept (its getter still decides what is there), and what it returns is wrapped", async () => {
  const { calls, run } = page('enforce', {
    before: (w, c) => {
      const real = mockProvider('okx via getter', c);
      Object.defineProperty(w, 'okxwallet', { configurable: true, enumerable: true, get: () => real, set: () => {} });
    },
  });
  await settle();
  assert.equal(await attempt(run(`window.okxwallet.request(${JSON.stringify(approve(DRAINER))})`)), '4001: Signet Guard refused this signature: Spender not in the sealed allowlist');
  assert.equal(await attempt(run(`window.okxwallet.request(${JSON.stringify(approve(ROUTER))})`)), 'SENT');
  assert.deepEqual(signed(calls).map((c) => c.provider), ['okx via getter']);
});

test('a frozen provider gets a proxy: the page only reaches the wrapped one', async () => {
  const { calls, run } = page('enforce', { before: (w, c) => { w.okxwallet = Object.freeze(mockProvider('frozen okx', c)); } });
  await settle();
  assert.equal(await attempt(run(`window.okxwallet.request(${JSON.stringify(approve(DRAINER))})`)), '4001: Signet Guard refused this signature: Spender not in the sealed allowlist');
  assert.equal(await attempt(run(`window.okxwallet.request(${JSON.stringify(approve(ROUTER))})`)), 'SENT');
  assert.equal(signed(calls).length, 1);
});

test('one provider reachable from two globals (window.ethereum === window.okxwallet) is wrapped once: Guard is asked once', async () => {
  const { calls, asks, run } = page('enforce', { before: (w, c) => { w.okxwallet = w.ethereum = mockProvider('okx', c); } });
  await settle();
  assert.equal(await attempt(run(`window.okxwallet.request(${JSON.stringify(approve(ROUTER))})`)), 'SENT');
  assert.equal(asks.length, 1);
  assert.equal(signed(calls).length, 1);
});

test('the wallet signs exactly what Guard checked: a page object that answers differently on a second read gets nowhere', async () => {
  const { calls, asks, run } = page('enforce', { before: VENDORS['window.okxwallet'] });
  await settle();
  // method: harmless when Guard reads it, a transaction when the wallet reads it
  const m = await attempt(run(`(() => { let n = 0; return window.okxwallet.request({ get method() { return n++ ? 'eth_sendTransaction' : 'eth_chainId' }, params: ${JSON.stringify(approve(DRAINER).params)} }) })()`));
  // params: sealed spender when Guard reads them, the drainer when the wallet reads them
  const p = await attempt(run(`(() => { let n = 0; const tx = { from: '${ME}', to: '${TOKEN}', get data() { return (n++ ? '0x095ea7b3${DRAINER.padStart(64, '0')}' : '0x095ea7b3${ROUTER.padStart(64, '0')}') + '${'f'.repeat(64)}' } }; return window.okxwallet.request({ method: 'eth_sendTransaction', params: [tx] }) })()`));
  // the same through the legacy sendAsync
  const l = await attempt(run(`(() => { let n = 0; const tx = { from: '${ME}', to: '${TOKEN}', get data() { return (n++ ? '0x095ea7b3${DRAINER.padStart(64, '0')}' : '0x095ea7b3${ROUTER.padStart(64, '0')}') + '${'f'.repeat(64)}' } }; return new Promise((res, rej) => window.okxwallet.sendAsync({ id: 1, method: 'eth_sendTransaction', params: [tx] }, (e, r) => e ? rej(e) : res(r))) })()`));
  assert.deepEqual([m, p, l], ['SENT', 'SENT', 'SENT']);
  assert.deepEqual(calls.filter((c) => c.method !== 'eth_chainId' && c.method !== 'eth_accounts').map((c) => c.method), ['eth_sendTransaction', 'eth_sendTransaction'], 'the method the wallet got is the one Guard was asked about (eth_chainId first)');
  assert.ok(signed(calls).every((c) => c.params.includes(ROUTER) && !c.params.includes(DRAINER)), JSON.stringify(signed(calls)));
  // 3 asks: the mock's sendAsync calls this.request, which is wrapped too, so the legacy call is checked twice
  // (with the same copy). A real wallet built that way gets a duplicate check, never a missed one.
  assert.equal(asks.length, 3);
});

test("params that aren't JSON (a BigInt): Guard is asked with no params; refused in enforce mode, reach the wallet unchanged in observe mode", async () => {
  const bigint = `window.okxwallet.request({ method: 'eth_sendTransaction', params: [{ from: '${ME}', to: '${TOKEN}', value: 5n }] })`;
  const e = page('enforce', { before: VENDORS['window.okxwallet'] });
  await settle();
  assert.match(await attempt(e.run(bigint)), /^4001: Signet Guard refused/);
  assert.deepEqual(e.asks.map((a) => a.params), ['[]']);
  assert.equal(signed(e.calls).length, 0);
  const o = page('observe', { before: VENDORS['window.okxwallet'] });
  await settle();
  assert.equal(await attempt(o.run(bigint)), 'SENT');
  assert.match(signed(o.calls)[0]!.params, /"5n"/, 'the wallet got the BigInt');
});

test('observe mode: the fake Guard allows, so every request through every provider reaches the wallet', async () => {
  for (const [name, install] of Object.entries(VENDORS)) {
    const { calls, run } = page('observe', { before: install });
    await settle();
    assert.equal(await attempt(run(`${pathOf(name)}.request(${JSON.stringify(approve(DRAINER))})`)), 'SENT', name);
    assert.equal(signed(calls).length, 1, name);
  }
});

test('a domain that is not sealed: requests pass straight through and Guard is never asked about them', async () => {
  for (const [name, install] of Object.entries(VENDORS)) {
    const { calls, asks, run } = page('unsealed', { before: install });
    await settle();
    assert.equal(await attempt(run(`${pathOf(name)}.request(${JSON.stringify(approve(DRAINER))})`)), 'SENT', name);
    assert.equal(asks.length, 0, name);
    assert.equal(signed(calls).length, 1, name);
  }
});

test('reads still work: a non-signing request goes straight to the wallet with the same method and params', async () => {
  const { calls, asks, run } = page('enforce', { before: VENDORS['window.okxwallet.ethereum'] });
  await settle();
  assert.deepEqual(await run(`window.okxwallet.ethereum.request({ method: 'eth_accounts' })`), [ME]);
  assert.equal(await run(`window.okxwallet.request({ method: 'eth_getBalance', params: ['${ME}', 'latest'] })`), null);
  assert.deepEqual(calls.map((c) => [c.provider, c.method, c.params]), [['window.okxwallet.ethereum', 'eth_accounts', 'null'], ['window.okxwallet', 'eth_getBalance', `["${ME}","latest"]`]]);
  assert.equal(asks.length, 0);
});

// ---- 0.3.8: a wallet's own channel, held where it is posted (window.postMessage), before any listener sees it.
// Chrome runs listeners on one target in registration order, so content.ts's listener can't be relied on to run
// before the wallet's; the frame must not be dispatched at all until Guard has decided.
const okxFrame = (id: number, req: { method: string; params: unknown }) => ({ target: 'okexwallet-contentscript', data: { name: 'okexwallet-provider', data: { jsonrpc: '2.0', id, ...req } } });
/// A page whose window.postMessage records what is actually dispatched (what a wallet's listener would receive).
function channelPage(mode: Mode) {
  const posted: unknown[] = [];
  const pg = page(mode, {
    before: (w, calls) => {
      w.postMessage = function (this: unknown, message: unknown) { posted.push(JSON.parse(JSON.stringify(message))); };
      w.location = { origin: 'https://site.example' };
      w.ethereum = mockProvider('window.ethereum', calls); // what walletInfo reads the chain and accounts from
    },
  });
  return { ...pg, posted };
}
const sent = (posted: unknown[]) => posted.filter((m) => (m as { target?: string }).target === 'okexwallet-contentscript' && /sendTransaction/.test(JSON.stringify(m)));
const replies = (posted: unknown[]) => posted.filter((m) => (m as { target?: string }).target === 'okexwallet-inpage') as { data: { data: { id: number; error?: { code: number; message: string } } } }[];

test('0.3.8 enforce: a wallet frame for an unsealed spender posted with window.postMessage is never dispatched; the page gets the wallet\'s own 4001 reply', async () => {
  const { run, posted, asks } = channelPage('enforce');
  await settle();
  run(`window.postMessage(${JSON.stringify(okxFrame(7, approve(DRAINER)))}, 'https://site.example')`);
  await settle(60);
  assert.equal(sent(posted).length, 0, 'the frame never reached a listener');
  assert.equal(asks.length, 1);
  const r = replies(posted);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.data.data.id, 7);
  assert.equal(r[0]!.data.data.error!.code, 4001);
  assert.match(r[0]!.data.data.error!.message, /^Signet Guard refused this signature: Spender not in the sealed allowlist/);
});

test('0.3.8 enforce: a sealed request is held until Guard allows it, then the copy Guard checked is dispatched', async () => {
  const { run, posted, asks } = channelPage('enforce');
  await settle();
  run(`(() => { const f = ${JSON.stringify(okxFrame(8, approve(ROUTER)))}; window.postMessage(f, 'https://site.example'); f.data.data.params[0].data = '0x095ea7b3${DRAINER.padStart(64, '0')}${'f'.repeat(64)}'; })()`);
  assert.equal(sent(posted).length, 0, 'not dispatched before the decision');
  await settle(60);
  assert.equal(asks.length, 1);
  const s = sent(posted);
  assert.equal(s.length, 1);
  assert.ok(JSON.stringify(s[0]).includes(ROUTER) && !JSON.stringify(s[0]).includes(DRAINER), 'the wallet got the checked copy, not the page object changed afterwards');
});

test('0.3.8: on a domain that is not sealed, frames are dispatched at once and Guard is never asked', async () => {
  const { run, posted, asks } = channelPage('unsealed');
  await settle();
  run(`window.postMessage(${JSON.stringify(okxFrame(9, approve(DRAINER)))}, 'https://site.example')`);
  assert.equal(sent(posted).length, 1, 'synchronous');
  await settle(30);
  assert.equal(asks.length, 0);
});

test('0.3.8: frames that are not signing requests pass at once; a request a wrapped provider already got allowed is not asked about twice', async () => {
  const { run, posted, asks } = channelPage('enforce');
  await settle();
  run(`window.postMessage(${JSON.stringify(okxFrame(10, { method: 'eth_chainId', params: [] }))}, 'https://site.example'); window.postMessage('SYN', '*')`);
  assert.equal(posted.length, 2, 'not held');
  // a wrapped provider whose page script then posts the same request as a frame (MetaMask does)
  await run(`window.ethereum.request(${JSON.stringify(approve(ROUTER))})`);
  assert.equal(asks.length, 1);
  run(`window.postMessage(${JSON.stringify(okxFrame(11, approve(ROUTER)))}, 'https://site.example')`);
  await settle(30);
  assert.equal(asks.length, 1, 'allowed a moment ago through the provider: not asked again');
  assert.equal(sent(posted).length, 1);
});

test('0.3.8: postMessage called on another window (this is not ours) is passed through untouched', async () => {
  const { run, posted, asks } = channelPage('enforce');
  await settle();
  run(`window.postMessage.call({}, ${JSON.stringify(okxFrame(12, approve(DRAINER)))}, '*')`);
  await settle(30);
  assert.equal(asks.length, 0);
  assert.equal(posted.length, 1);
});
