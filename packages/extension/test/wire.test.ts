// Guard 0.3.6: reading signing requests on a wallet's own channel (lib/wire.ts). The frames are the ones captured
// from the real OKX Wallet 4.26.0 and Rabby 0.94.17 page scripts on 2026-11-28 (docs/decisions.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestKey, signRequestIn } from '../src/lib/wire.ts';

const TX = [{ to: '0xBAD0C0fFeE5BAD0c0ffEe5baD0c0ffeE5baD0C0F', value: '0x0', data: '0x' }];
const okx = (method: string, params: unknown = TX) => ({ target: 'okexwallet-contentscript', data: { name: 'okexwallet-provider', data: { method, params, jsonrpc: '2.0', url: 'https://example.com/', id: 1355287362 } } });
const rabby = (method: string) => ({ target: 'rabby-content-script', data: { data: { type: 'request', data: { ident: '9yLVs7Xha3B8Yn0Y66x2z', data: { method, params: TX, $ctx: { providers: [] } } } } } });

test('OKX (multiplex frame): a signing request is found, with the wallet name and a 4001 reply in its own format', () => {
  const r = signRequestIn(okx('eth_sendTransaction'))!;
  assert.equal(r.method, 'eth_sendTransaction');
  assert.deepEqual(r.params, TX);
  assert.equal(r.wallet, 'okexwallet');
  assert.deepEqual(r.reply!(4001, 'Signet Guard refused this signature: x'), {
    target: 'okexwallet-inpage',
    data: { name: 'okexwallet-provider', data: { jsonrpc: '2.0', id: 1355287362, error: { code: 4001, message: 'Signet Guard refused this signature: x' } } },
  });
});

test('Rabby (its own frame): found by the nested search; no reply format known', () => {
  const r = signRequestIn(rabby('eth_sendTransaction'))!;
  assert.deepEqual([r.method, r.wallet, r.reply], ['eth_sendTransaction', 'rabby', null]);
  assert.deepEqual(r.params, TX);
});

test('every signing method is caught; reads, handshakes and other traffic are not', () => {
  for (const m of ['eth_sendTransaction', 'eth_signTransaction', 'wallet_sendCalls', 'eth_signTypedData', 'eth_signTypedData_v1', 'eth_signTypedData_v3', 'eth_signTypedData_v4', 'personal_sign', 'eth_sign']) {
    assert.equal(signRequestIn(okx(m))?.method, m, m);
    assert.equal(signRequestIn(rabby(m))?.method, m, m);
  }
  for (const m of ['eth_chainId', 'eth_accounts', 'eth_requestAccounts', 'wallet_switchEthereumChain', 'eth_call']) {
    assert.equal(signRequestIn(okx(m)), null, m);
    assert.equal(signRequestIn(rabby(m)), null, m);
  }
  for (const f of [null, 'x', 42, { target: 'okexwallet-contentscript', data: 'SYN' }, { target: 'okexwallet-inpage', data: { name: 'okexwallet-provider', data: { id: 1, result: '0xc4' } } }]) assert.equal(signRequestIn(f), null);
});

test('a signing method named inside params is data, not a request', () => {
  assert.equal(signRequestIn(okx('eth_call', [{ note: { method: 'eth_sendTransaction' } }])), null);
});

test('deeper than 6 levels is not searched (bounded work per message)', () => {
  let f: Record<string, unknown> = { method: 'eth_sign', params: [] };
  for (let i = 0; i < 8; i++) f = { data: f };
  assert.equal(signRequestIn(f), null);
});

test('requestKey: same method and params give the same key; not JSON gives none', () => {
  assert.equal(requestKey('eth_sendTransaction', TX), requestKey('eth_sendTransaction', JSON.parse(JSON.stringify(TX))));
  assert.notEqual(requestKey('eth_sendTransaction', TX), requestKey('eth_signTransaction', TX));
  assert.equal(requestKey('eth_sendTransaction', [{ value: 5n }]), null);
});
