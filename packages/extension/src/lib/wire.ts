// Guard 0.3.6: signing requests on the wallet's own channel. Most wallets hand a request from their page script to
// their content script with window.postMessage (OKX: post-message-stream + obj-multiplex, the MetaMask format;
// Rabby: its own frame). Guard's content script (isolated world, a capture listener that runs before the wallet's)
// reads each frame, holds a signing request until Guard decides, and posts the frame again if it is allowed. This
// covers wallets whose provider object Guard can't wrap (OKX 4.26.0: non-configurable globals, assignments ignored).

export const SIGN_METHODS = new Set(['eth_sendTransaction', 'eth_signTransaction', 'wallet_sendCalls', 'eth_signTypedData', 'eth_signTypedData_v1', 'eth_signTypedData_v3', 'eth_signTypedData_v4', 'personal_sign', 'eth_sign']);

export interface WireRequest {
  method: string;
  params: unknown;
  /// the wallet's name for its channel, e.g. "okexwallet" (from target "okexwallet-contentscript"); null if unknown
  wallet: string | null;
  /// a frame that answers the page's request with an error, when the format is known (multiplex); else null
  reply: ((code: number, message: string) => unknown) | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

/// The signing request a window message carries, or null if it carries none. Two shapes:
/// 1. multiplex: { target: "<wallet>-contentscript", data: { name, data: { id, method, params } } } (OKX, MetaMask)
/// 2. anything else: the first object, at most 6 levels down, with a signing `method` (Rabby: data.data.data.data)
export function signRequestIn(data: unknown): WireRequest | null {
  if (!isObj(data)) return null;
  const target = typeof data.target === 'string' ? data.target : null;
  const outer = data.data;
  if (target && isObj(outer) && typeof outer.name === 'string' && isObj(outer.data)) {
    const rpc = outer.data;
    if (typeof rpc.method === 'string' && SIGN_METHODS.has(rpc.method)) {
      const m = /^(.*)-content-?script$/i.exec(target);
      const wallet = m ? m[1]! : null;
      const inpage = wallet ? `${wallet}-inpage` : null;
      const name = outer.name;
      const id = rpc.id;
      return {
        method: rpc.method, params: rpc.params, wallet,
        reply: inpage && id !== undefined ? (code, message) => ({ target: inpage, data: { name, data: { jsonrpc: '2.0', id, error: { code, message } } } }) : null,
      };
    }
  }
  const found = find(data, 0);
  if (!found) return null;
  return { method: found.method as string, params: found.params, wallet: target ? target.replace(/-content-?script$/i, '') : null, reply: null };
}

function find(v: unknown, depth: number): Record<string, unknown> | null {
  if (!isObj(v) || depth > 6) return null;
  if (typeof v.method === 'string' && SIGN_METHODS.has(v.method)) return v;
  for (const k of Object.keys(v)) {
    if (k === 'params') continue; // a signing method named inside a request's params is data, not a request
    const r = find(v[k], depth + 1);
    if (r) return r;
  }
  return null;
}

/// The key under which a request the page-world wrapper already got a decision for is remembered, so the same
/// request is not asked about twice when it then travels on the wallet's channel.
export function requestKey(method: string, params: unknown): string | null {
  try {
    return `${method}:${JSON.stringify(params ?? [])}`;
  } catch {
    return null;
  }
}
