// JSON-RPC over fetch. Chain facts Guard acts on are read from two independent RPCs at the same block and
// must be identical (spec threat 13); a difference or a failure is "could not check", never a guess.
import type { Hex, Net } from './types.ts';

export class RpcError extends Error {}
export interface Call { to: Hex; data: Hex }
type Reply = { result?: unknown; error?: { code: number; message: string; data?: unknown } };

async function post(url: string, body: unknown): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal, cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new RpcError(`${new URL(url).host} answered HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e instanceof RpcError) throw e;
    throw new RpcError(`${new URL(url).host} could not be reached`);
  } finally {
    clearTimeout(timer);
  }
}

export async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const r = (await post(url, { jsonrpc: '2.0', id: 1, method, params })) as Reply;
  if (r.error) throw new RpcError(`${method}: ${r.error.message}`);
  return r.result as T;
}

/// eth_call for each call at one block. A reverted call gives "revert" (so a revert can be compared too).
async function callAt(url: string, calls: Call[], block: string): Promise<string[]> {
  const batch = calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_call', params: [c, block] }));
  const replies = (await post(url, batch)) as (Reply & { id: number })[];
  if (!Array.isArray(replies) || replies.length !== calls.length) throw new RpcError(`${new URL(url).host} gave a malformed answer`);
  const out: string[] = [];
  for (let i = 0; i < calls.length; i++) {
    const r = replies.find((x) => x.id === i);
    if (!r) throw new RpcError(`${new URL(url).host} gave a malformed answer`);
    if (r.error) {
      if (r.error.code === 3 || /revert/i.test(r.error.message)) out.push('revert');
      else throw new RpcError(`eth_call: ${r.error.message}`);
    } else out.push(String(r.result));
  }
  return out;
}

/// The same calls on both RPCs, at the newest block both have. Throws unless every answer is identical.
export async function agree(net: Net, calls: Call[]): Promise<string[]> {
  if (!net.rpcUrl2) throw new RpcError('only one RPC is configured, and Guard needs two that agree');
  const heads = await Promise.all([net.rpcUrl, net.rpcUrl2].map((u) => rpc<string>(u, 'eth_blockNumber', [])));
  const block = `0x${Math.min(...heads.map((h) => parseInt(h, 16))).toString(16)}`;
  const [a, b] = await Promise.all([callAt(net.rpcUrl, calls, block), callAt(net.rpcUrl2, calls, block)]);
  for (let i = 0; i < calls.length; i++) if (a[i] !== b[i]) throw new RpcError('the two RPCs disagree about the chain');
  return a!;
}

/// One call on either RPC. Only for bytes that are checked against a hash afterwards.
export async function either(net: Net, call: Call): Promise<string> {
  let last: unknown;
  for (const url of [net.rpcUrl, net.rpcUrl2]) {
    if (!url) continue;
    try {
      return (await callAt(url, [call], 'latest'))[0]!;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
