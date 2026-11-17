// Runs in the page's own JavaScript world at document_start, before any page script. It wraps every wallet
// provider (window.ethereum and every EIP-6963 announcement) so that a signing request first asks Guard.
// On a domain that is not sealed it does nothing but pass requests through.
//
// The page shares this world, so: native functions are saved before page code can replace them, providers are
// patched in place (the page never holds an unwrapped reference), and the link to the content script uses
// event names that contain a random secret handed over synchronously, before page scripts run.
(() => {
  if (window.top !== window) return;
  const doc = document;
  const listen = doc.addEventListener.bind(doc);
  const dispatch = doc.dispatchEvent.bind(doc);
  const CE = CustomEvent;
  const toJson = JSON.stringify;
  const fromJson = JSON.parse;
  const later = setTimeout;
  const SIGN = ['eth_sendTransaction', 'eth_signTransaction', 'wallet_sendCalls', 'eth_signTypedData', 'eth_signTypedData_v1', 'eth_signTypedData_v3', 'eth_signTypedData_v4', 'personal_sign', 'eth_sign'];

  // ---- link to the content script
  let secret = '';
  let sealed: boolean | null = null; // null: not known yet
  const waiting: ((v: boolean) => void)[] = [];
  const asks = new Map<number, (d: { refused: boolean; message: string }) => void>();
  let nextId = 1;
  const up = (m: unknown) => secret && dispatch(new CE(`sg:${secret}:up`, { detail: toJson(m) }));
  listen('signet-guard:init', (e) => {
    const s = (e as CustomEvent).detail;
    if (secret || typeof s !== 'string' || s.length < 20) return;
    secret = s;
    listen(`sg:${secret}:down`, (ev) => {
      const m = fromJson((ev as CustomEvent).detail as string) as { type: string; sealed?: boolean; id?: number; refused?: boolean; message?: string };
      if (m.type === 'state') {
        sealed = !!m.sealed;
        for (const w of waiting.splice(0)) w(sealed);
      } else if (m.type === 'decision' && m.id !== undefined) {
        asks.get(m.id)?.({ refused: !!m.refused, message: m.message ?? '' });
        asks.delete(m.id);
      }
    });
    up({ type: 'ack' });
  });
  dispatch(new CE('signet-guard:hello'));

  /// Is this a sealed domain? Unknown for longer than 3 s (no content script) counts as no: fail-open.
  const isSealed = (): Promise<boolean> =>
    sealed !== null ? Promise.resolve(sealed) : new Promise((res) => {
      waiting.push(res);
      later(() => res(false), 3000);
    });

  type Request = (args: { method: string; params?: unknown }) => Promise<unknown>;
  async function guard(method: string, params: unknown, request: Request, go: () => unknown): Promise<unknown> {
    if (!SIGN.includes(method) || !(await isSealed())) return go();
    const chainId = await request({ method: 'eth_chainId' }).catch(() => null);
    const accounts = await request({ method: 'eth_accounts' }).catch(() => []);
    const id = nextId++;
    const decision = await new Promise<{ refused: boolean; message: string }>((res) => {
      asks.set(id, res);
      later(() => res({ refused: false, message: '' }), 20000); // Guard not answering: fail-open
      try {
        up({ type: 'sign', id, req: { method, params: fromJson(toJson(params ?? [])), chainId, accounts } });
      } catch {
        res({ refused: false, message: '' });
      }
    });
    if (decision.refused) {
      const err = new Error(`Signet Guard refused this signature: ${decision.message}`) as Error & { code: number };
      err.code = 4001; // EIP-1193: the request was rejected
      throw err;
    }
    return go();
  }

  // ---- wrapping providers
  type Provider = Record<string, unknown> & { request?: Request };
  const done = new WeakSet<object>();
  function wrap(p: Provider): Provider {
    if (!p || (typeof p !== 'object' && typeof p !== 'function') || done.has(p)) return p;
    const request = typeof p.request === 'function' ? p.request.bind(p) : null;
    const ask: Request = request ?? (() => Promise.reject(new Error('no request method')));
    const patched: Record<string, unknown> = {};
    if (request) patched.request = (args: { method: string; params?: unknown }) => guard(args?.method, args?.params, ask, () => request(args));
    for (const name of ['send', 'sendAsync']) {
      const legacy = p[name];
      if (typeof legacy !== 'function') continue;
      // send(method, params) | send(payload, callback) | sendAsync(payload, callback)
      patched[name] = (a: unknown, b: unknown) => {
        const payload = typeof a === 'string' ? { method: a, params: b } : (a as { method: string; params?: unknown });
        const run = () => legacy.call(p, a, b);
        if (typeof b !== 'function') return guard(payload?.method, payload?.params, ask, run);
        guard(payload?.method, payload?.params, ask, run).catch((e: unknown) => (b as (e: unknown, r: unknown) => void)(e, null));
        return undefined;
      };
    }
    let inPlace = true;
    for (const [k, f] of Object.entries(patched)) {
      try {
        p[k] = f;
      } catch { /* read-only */ }
      if (p[k] !== f) inPlace = false;
    }
    done.add(p);
    if (inPlace) return p;
    // a frozen provider: hand out a proxy instead
    const proxy = new Proxy(p, { get: (t, k, r) => (typeof k === 'string' && k in patched ? patched[k] : Reflect.get(t, k, r)) });
    done.add(proxy);
    return proxy;
  }

  const w = window as unknown as { ethereum?: Provider };
  let current = w.ethereum ? wrap(w.ethereum) : undefined;
  try {
    Object.defineProperty(window, 'ethereum', {
      configurable: true, enumerable: true,
      get: () => current,
      set: (v: Provider) => {
        current = v && typeof v === 'object' ? wrap(v) : v;
      },
    });
  } catch { /* a wallet made it non-configurable before us: the re-checks below patch it in place */ }
  const recheck = () => {
    try {
      const e = w.ethereum;
      if (e && !done.has(e)) wrap(e);
    } catch { /* ignore */ }
  };
  for (const ev of ['ethereum#initialized', 'DOMContentLoaded', 'load']) window.addEventListener(ev, recheck, true);
  for (const ms of [0, 50, 250, 1000, 3000]) later(recheck, ms);

  // EIP-6963: every wallet announces its own provider object
  window.addEventListener('eip6963:announceProvider', (e) => {
    const d = (e as CustomEvent<{ info: unknown; provider: Provider }>).detail;
    if (!d?.provider || done.has(d.provider)) return;
    const wrapped = wrap(d.provider);
    if (wrapped !== d.provider) {
      e.stopImmediatePropagation();
      window.dispatchEvent(new CE('eip6963:announceProvider', { detail: Object.freeze({ info: d.info, provider: wrapped }) }));
    }
  }, true);
})();
