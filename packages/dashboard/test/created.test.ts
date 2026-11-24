// "Create the gate" must show the gate the transaction created, never 0x000…0. Regression for mainnet 2026-11-24
// (misthos.world, tx 0xf2ac22f0…d8bc): the receipt came from RPC 1 while RPC 2 was a block behind, and the binding
// was read at the lower head, before createGate.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { decodeFunctionData, decodeFunctionResult, encodeFunctionData, encodeFunctionResult, getAddress, zeroAddress, type Address, type Hex } from 'viem';
import { registryAbi } from '@signet/extension/src/lib/abi.ts';
import { agree } from '@signet/extension/src/lib/rpc.ts';
import type { Net } from '@signet/extension/src/lib/types.ts';
import { gateFromLogs, bindingAfter, createdGate } from '../src/created.ts';

const FACTORY = '0xc5e12ffe9D5bE7085441bD955724A6FAff9f7986' as Address;
const REGISTRY = '0x98dB5B6B1545D0fb374da40a02045B93398E0589' as Address;
const A = '0xB9ef367A86DE5150a5390c4148073901587d2416' as Address;
const GATE = '0xDfFf2307d45df1995502d8b300aE9AfbB01c4a59' as Address;
const CONTAINER = '0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed' as Address;
const TX = '0xf2ac22f0566995dd00c2054262f6d3287ef85395c05ba15011b9184c187bd8bc';

// the real receipt of the mainnet createGate (xlayerrpc.okx.com): the registry's event, then the factory's GateCreated
const RECEIPT = {
  blockNumber: '0x492f1e8',
  logs: [
    { address: '0x98db5b6b1545d0fb374da40a02045b93398e0589', topics: ['0xad0c006487cb4960db6b4c33e9c3af90353d172ab27ed6d48158abf220956508', '0x000000000000000000000000dfff2307d45df1995502d8b300ae9afbb01c4a59'], data: '0x000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d6d697374686f732e776f726c6400000000000000000000000000000000000000' },
    { address: '0xc5e12ffe9d5be7085441bd955724a6faff9f7986', topics: ['0x9ad11d2543e435679c4a3ba5d29e609561065d9198a43403ef6d0e5d1f7578ea', '0x000000000000000000000000dfff2307d45df1995502d8b300ae9afbb01c4a59', '0x000000000000000000000000b9ef367a86de5150a5390c4148073901587d2416'], data: '0x' },
  ],
};
const TX_BLOCK = parseInt(RECEIPT.blockNumber, 16);

test('gateFromLogs: the gate of the real mainnet receipt, only from the factory and for this creator', () => {
  assert.equal(gateFromLogs(RECEIPT.logs, FACTORY, A), GATE);
  assert.equal(gateFromLogs([RECEIPT.logs[0]!], FACTORY, A), null, 'the registry event alone is not GateCreated');
  assert.equal(gateFromLogs(RECEIPT.logs, FACTORY, '0x3280887C6ed2c0C43679918654f72222b767e6dc'), null, 'another creator');
  const forged = { ...RECEIPT.logs[1]!, address: '0x0000000000000000000000000000000000000bad' };
  assert.equal(gateFromLogs([forged], FACTORY, A), null, 'a GateCreated from another contract');
  assert.equal(gateFromLogs([], FACTORY, A), null);
});

/// A fake X Layer RPC: the binding exists from TX_BLOCK on; `head()` is what eth_blockNumber answers now.
async function fakeRpc(head: () => number): Promise<{ url: string; calls: number[]; close: () => Promise<unknown> }> {
  const calls: number[] = [];
  const answer = (m: { id: number; method: string; params: any[] }) => {
    if (m.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: m.id, result: `0x${head().toString(16)}` };
    if (m.method === 'eth_call') {
      const [call, tag] = m.params as [{ to: string; data: Hex }, string];
      const at = tag === 'latest' ? head() : parseInt(tag, 16);
      calls.push(at);
      assert.equal(getAddress(call.to), REGISTRY);
      const { functionName, args } = decodeFunctionData({ abi: registryAbi, data: call.data });
      assert.equal(functionName, 'bindingOf');
      assert.equal(args![0], 'misthos.world');
      const bound = at >= TX_BLOCK;
      return { jsonrpc: '2.0', id: m.id, result: encodeFunctionResult({ abi: registryAbi, functionName: 'bindingOf', result: bound ? [GATE, CONTAINER, 'projects/misthos.world/'] : [zeroAddress, zeroAddress, ''] }) };
    }
    return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not here' } };
  };
  const s: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const j = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(Array.isArray(j) ? j.map(answer) : answer(j)));
    });
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, calls, close: () => new Promise((r) => s.close(r)) };
}

const servers: { close: () => Promise<unknown> }[] = [];
after(async () => { for (const s of servers) await s.close(); });
const netOf = (u1: string, u2: string | null): Net => ({ name: 'mainnet', chainId: 196, rpcUrl: u1, rpcUrl2: u2, registry: REGISTRY } as unknown as Net);

test('the bug: reading at the lower head while RPC 2 is a block behind gives 0x0 (what the page showed)', async () => {
  const r1 = await fakeRpc(() => TX_BLOCK), r2 = await fakeRpc(() => TX_BLOCK - 1);
  servers.push(r1, r2);
  const raw = (await agree(netOf(r1.url, r2.url), [{ to: REGISTRY, data: encodeFunctionData({ abi: registryAbi, functionName: 'bindingOf', args: ['misthos.world'] }) }]))[0]!;
  const [gate] = decodeFunctionResult({ abi: registryAbi, functionName: 'bindingOf', data: raw as Hex }) as readonly [Address, Address, string];
  assert.equal(gate, zeroAddress, 'agree() without minBlock reads before createGate');
});

test('fixed: createdGate waits until both RPCs reach the transaction block, then confirms the binding', async () => {
  let lag = 3; // RPC 2 catches up after a few polls
  const r1 = await fakeRpc(() => TX_BLOCK + 1), r2 = await fakeRpc(() => (lag-- > 0 ? TX_BLOCK - 1 : TX_BLOCK));
  servers.push(r1, r2);
  const gate = await createdGate(netOf(r1.url, r2.url), RECEIPT, FACTORY, A, 'misthos.world', TX, { timeoutMs: 5000, intervalMs: 20 });
  assert.equal(gate, GATE);
  assert.ok([...r1.calls, ...r2.calls].every((b) => b >= TX_BLOCK), `read before the tx block: ${[...r1.calls, ...r2.calls]}`);
});

test('fixed: an RPC that never catches up is an error naming the blocks, never a zero gate', async () => {
  const r1 = await fakeRpc(() => TX_BLOCK), r2 = await fakeRpc(() => TX_BLOCK - 1);
  servers.push(r1, r2);
  await assert.rejects(createdGate(netOf(r1.url, r2.url), RECEIPT, FACTORY, A, 'misthos.world', TX, { timeoutMs: 150, intervalMs: 20 }), /not yet at 76739048/);
});

test('fixed: a receipt without GateCreated is an error with the tx, not a zero gate', async () => {
  const r1 = await fakeRpc(() => TX_BLOCK), r2 = await fakeRpc(() => TX_BLOCK);
  servers.push(r1, r2);
  await assert.rejects(createdGate(netOf(r1.url, r2.url), { ...RECEIPT, logs: [RECEIPT.logs[0]!] }, FACTORY, A, 'misthos.world', TX), new RegExp(`no GateCreated.*${TX}`));
});

test('one RPC (local staging): also waits for the transaction block', async () => {
  let lag = 2;
  const r1 = await fakeRpc(() => (lag-- > 0 ? TX_BLOCK - 1 : TX_BLOCK));
  servers.push(r1);
  assert.equal(await bindingAfter(netOf(r1.url, null), 'misthos.world', TX_BLOCK, { timeoutMs: 5000, intervalMs: 20 }), GATE);
  assert.ok(r1.calls.every((b) => b >= TX_BLOCK));
});
