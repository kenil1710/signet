// A rate-limited RPC (HTTP 429/503) is retried with backoff; one that stays limited gives RpcRateLimited, never a
// wrong answer. Found live 2026-11-24: /prove showed "FAILED" because xlayer.drpc.org answered 429 to its 512-row checks.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { agree, rpc, RETRY, RpcRateLimited, RpcError } from '../src/lib/rpc.ts';

RETRY.baseMs = 5; // keep the test fast; the backoff shape is the same

/// Answers 429 to the first `limited` requests (with Retry-After if given), then normally.
function fakeRpc(limited: number, retryAfter?: string) {
  let n = 0;
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      n++;
      if (n <= limited) { res.writeHead(429, retryAfter ? { 'retry-after': retryAfter } : {}); return void res.end('slow down'); }
      const j = JSON.parse(body);
      const one = (x: { id: number; method: string; params: [{ data: string }] }) => ({ jsonrpc: '2.0', id: x.id, result: x.method === 'eth_blockNumber' ? '0x10' : x.params[0].data });
      res.end(JSON.stringify(Array.isArray(j) ? j.map(one) : one(j)));
    });
  });
  servers.push(srv);
  return new Promise<{ url: string; count: () => number }>((r) => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, count: () => n })));
}
const servers: http.Server[] = [];
after(() => { for (const s of servers) s.close(); });
const calls = [{ to: '0x0000000000000000000000000000000000000001' as const, data: '0xab' as const }];

test('429s are retried and the answer is the real one', async () => {
  const [a, b] = await Promise.all([fakeRpc(2), fakeRpc(3)]);
  assert.deepEqual(await agree({ rpcUrl: a.url, rpcUrl2: b.url } as never, calls), ['0xab']);
  assert.ok(a.count() >= 3 && b.count() >= 4, 'it retried');
});

test('Retry-After is honoured (in seconds)', async () => {
  const a = await fakeRpc(1, '1');
  const t0 = Date.now();
  assert.equal(await rpc<string>(a.url, 'eth_blockNumber', []), '0x10');
  assert.ok(Date.now() - t0 >= 900, `waited ${Date.now() - t0} ms`);
});

test('an RPC that stays rate-limited gives RpcRateLimited after the retries (an RpcError: "could not check")', async () => {
  const a = await fakeRpc(1000);
  const e = await rpc(a.url, 'eth_blockNumber', []).catch((x) => x);
  assert.ok(e instanceof RpcRateLimited && e instanceof RpcError, String(e));
  assert.match(e.message, /rate-limiting \(HTTP 429, 4 retries\)/);
  assert.equal(a.count(), RETRY.tries + 1);
});
