// Runs in the page's own JavaScript world at document_start, before any page script. It wraps every wallet
// provider a page can reach (window.ethereum, wallet globals such as window.okxwallet, any other EIP-1193 object on
// a global, and every EIP-6963 announcement) so that a signing request first asks Guard.
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

  type Args = { method: string; params?: unknown };
  type Request = (args: Args) => Promise<unknown>;
  /// Asks Guard about a signing request, then calls `go` with the params the wallet must get. On a sealed domain
  /// that is the JSON copy Guard checked, never the page's own object: a page object can answer differently each
  /// time it is read (getters), so the wallet would otherwise sign something other than what Guard checked.
  async function guard(method: unknown, params: unknown, request: Request, go: (params: unknown) => unknown): Promise<unknown> {
    if (typeof method !== 'string' || !SIGN.includes(method) || !(await isSealed())) return go(params);
    let copy: unknown;
    let readable = true;
    try {
      copy = fromJson(toJson(params ?? []));
    } catch {
      // not JSON (a BigInt, a getter that throws, ...): Guard is asked about the method with no params, which it
      // can't read (refused in enforce mode, a warning in observe mode); only an allowed request reaches the wallet
      readable = false;
    }
    const chainId = await request({ method: 'eth_chainId' }).catch(() => null);
    const accounts = await request({ method: 'eth_accounts' }).catch(() => []);
    const id = nextId++;
    const decision = await new Promise<{ refused: boolean; message: string }>((res) => {
      asks.set(id, res);
      later(() => res({ refused: false, message: '' }), 20000); // Guard not answering: fail-open
      try {
        up({ type: 'sign', id, req: { method, params: readable ? copy : [], chainId, accounts } });
      } catch {
        res({ refused: false, message: '' });
      }
    });
    if (decision.refused) {
      const err = new Error(`Signet Guard refused this signature: ${decision.message}`) as Error & { code: number };
      err.code = 4001; // EIP-1193: the request was rejected
      throw err;
    }
    return go(readable ? copy : params);
  }

  // ---- wrapping providers
  type Provider = Record<string, unknown> & { request?: Request };
  const isObj = (v: unknown): v is Provider => !!v && (typeof v === 'object' || typeof v === 'function');
  const wrapped = new WeakMap<object, Provider>(); // provider -> what the page gets (itself, or a proxy if frozen)
  function wrap(p: Provider): Provider {
    if (!isObj(p)) return p;
    const known = wrapped.get(p);
    if (known) return known;
    const request = typeof p.request === 'function' ? p.request.bind(p) : null;
    const ask: Request = request ?? (() => Promise.reject(new Error('no request method')));
    const patched: Record<string, unknown> = {};
    // the method is read once; the wallet gets { method, params } built here, never the page's args object
    if (request) {
      patched.request = (args: Args) => {
        const method = args?.method;
        return guard(method, args?.params, ask, (params) => request({ method, params }));
      };
    }
    for (const name of ['send', 'sendAsync']) {
      const legacy = p[name];
      if (typeof legacy !== 'function') continue;
      // send(method, params) | send(payload, callback) | sendAsync(payload, callback)
      patched[name] = (a: unknown, b: unknown) => {
        if (typeof a === 'string') return guard(a, b, ask, (params) => legacy.call(p, a, params));
        const payload = isObj(a) ? { ...(a as Record<string, unknown>) } : a; // read once
        const method = (payload as Args | undefined)?.method;
        const run = (params: unknown) => legacy.call(p, isObj(payload) ? { ...payload, method, params } : payload, b);
        const asked = guard(method, (payload as Args | undefined)?.params, ask, run);
        if (typeof b !== 'function') return asked;
        asked.catch((e: unknown) => (b as (e: unknown, r: unknown) => void)(e, null));
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
    // a frozen provider: hand out a proxy instead. Its target is a blank object inheriting from the provider: a proxy
    // on the frozen provider itself may not answer anything but the original for a read-only property (a TypeError)
    const out = inPlace ? p : new Proxy(Object.create(p) as Provider, { get: (_t, k) => (typeof k === 'string' && k in patched ? patched[k] : Reflect.get(p, k, p)) });
    wrapped.set(p, out);
    wrapped.set(out, out);
    return out;
  }
  /// Wraps a provider and the providers it carries: <wallet>.ethereum (OKX, Bitget, Phantom) and the
  /// ethereum.providers list some wallets keep when several are installed.
  function wrapAll(p: Provider): Provider {
    const out = wrap(p);
    try {
      const inner = p.ethereum;
      if (isObj(inner) && inner !== p) {
        const w = wrapAll(inner);
        if (w !== inner) try { p.ethereum = w; } catch { /* read-only: the page can still reach the frozen original */ }
      }
      const list = p.providers;
      if (Array.isArray(list)) {
        list.forEach((q, i) => {
          if (!isObj(q) || q === p) return;
          const w = wrap(q);
          if (w !== q) try { list[i] = w; } catch { /* read-only */ }
        });
      }
    } catch { /* a getter that throws: ignore */ }
    return out;
  }

  // Every global a wallet puts its provider on. Each gets the same treatment as window.ethereum: whatever is there
  // now is wrapped, and anything assigned later is wrapped as it is assigned. A wallet's own accessor is kept.
  const GLOBALS = ['ethereum', 'okxwallet', 'bitkeep', 'coinbaseWalletExtension', 'phantom', 'trustwallet', 'trustWallet', 'rabby'];
  const win = window as unknown as Record<string, unknown>;
  for (const name of GLOBALS) {
    let own: PropertyDescriptor | undefined;
    try {
      own = Object.getOwnPropertyDescriptor(window, name);
    } catch { /* ignore */ }
    if (own && !own.configurable) continue; // a wallet made it non-configurable before us: the re-checks below patch it in place
    const theirs = own && (own.get || own.set) ? own : null;
    let current: unknown;
    try {
      current = theirs ? undefined : own ? (isObj(own.value) ? wrapAll(own.value) : own.value) : undefined;
    } catch { /* ignore */ }
    try {
      Object.defineProperty(window, name, {
        configurable: true, enumerable: own ? !!own.enumerable : true,
        get: () => {
          const v = theirs ? theirs.get?.call(window) : current;
          return isObj(v) ? wrapAll(v) : v;
        },
        set: (v: unknown) => {
          if (theirs) theirs.set?.call(window, v);
          else current = isObj(v) ? wrapAll(v) : v;
        },
      });
    } catch { /* ignore: the re-checks below still patch it in place */ }
  }

  const KNOWN = new Set(GLOBALS);
  const looksLikeProvider = (v: Provider) => typeof v.request === 'function' && (typeof v.on === 'function' || typeof v.send === 'function' || typeof v.sendAsync === 'function');
  const recheck = () => {
    for (const name of GLOBALS) {
      try {
        const v = win[name];
        if (isObj(v)) wrapAll(v);
      } catch { /* ignore */ }
    }
    // any other provider a page can reach directly: an EIP-1193-shaped object on a global, or under its .ethereum
    let names: string[] = [];
    try {
      names = Object.keys(window);
    } catch { /* ignore */ }
    for (const name of names) {
      if (KNOWN.has(name)) continue;
      try {
        const v = win[name];
        if (!isObj(v) || (v as unknown) === window || (v as unknown) === doc || typeof v === 'function') continue;
        if (looksLikeProvider(v) || (isObj(v.ethereum) && looksLikeProvider(v.ethereum as Provider))) {
          const w = wrapAll(v);
          if (w !== v) win[name] = w;
        }
      } catch { /* a cross-origin frame or a getter that throws */ }
    }
  };
  for (const ev of ['ethereum#initialized', 'DOMContentLoaded', 'load']) window.addEventListener(ev, recheck, true);
  for (const ms of [0, 50, 250, 1000, 3000, 10000]) later(recheck, ms);

  // EIP-6963: every wallet announces its own provider object
  window.addEventListener('eip6963:announceProvider', (e) => {
    const d = (e as CustomEvent<{ info: unknown; provider: Provider }>).detail;
    if (!d?.provider || wrapped.get(d.provider) === d.provider) return;
    const w = wrap(d.provider);
    if (w !== d.provider) {
      e.stopImmediatePropagation();
      window.dispatchEvent(new CE('eip6963:announceProvider', { detail: Object.freeze({ info: d.info, provider: w }) }));
    }
  }, true);
})();
