// The shared JSON-RPC helper never sends more than MAX_BATCH calls in one request (xlayer.drpc.org rejects 4+),
// and still answers every call in order, at one pinned block, compared across both RPCs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { agree, MAX_BATCH } from '../src/lib/rpc.ts';

function fakeRpc(limit: number) {
  const sizes: number[] = [];
  const blocks = new Set<string>();
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const j = JSON.parse(body);
      if (!Array.isArray(j)) return void res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result: '0x10' }));
      sizes.push(j.length);
      if (j.length > limit) { res.statusCode = 400; return void res.end('batch too large'); }
      for (const x of j) blocks.add(x.params[1]);
      res.end(JSON.stringify(j.map((x: { id: number; params: [{ data: string }] }) => ({ jsonrpc: '2.0', id: x.id, result: x.params[0].data }))));
    });
  });
  return new Promise<{ url: string; sizes: number[]; blocks: Set<string>; close: () => void }>((r) => srv.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, sizes, blocks, close: () => srv.close() })));
}

test('calls are sent in batches of at most 3, in order, at one block, on both RPCs', async () => {
  assert.equal(MAX_BATCH, 3);
  const [a, b] = await Promise.all([fakeRpc(3), fakeRpc(1000)]);
  const calls = Array.from({ length: 8 }, (_, i) => ({ to: '0x0000000000000000000000000000000000000001' as const, data: `0x${i.toString(16).padStart(2, '0')}` as `0x${string}` }));
  const out = await agree({ rpcUrl: a.url, rpcUrl2: b.url } as never, calls);
  assert.deepEqual(out, calls.map((c) => c.data));
  assert.ok(a.sizes.every((n) => n <= 3) && b.sizes.every((n) => n <= 3), `batch sizes ${a.sizes} / ${b.sizes}`);
  assert.deepEqual(a.sizes, [3, 3, 2]);
  assert.deepEqual([...a.blocks], ['0x10']);
  a.close(); b.close();
});
