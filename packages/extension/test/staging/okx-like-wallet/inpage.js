// Test only. A wallet page script built the way OKX Wallet 4.26.0's is (docs/decisions.md, 2026-11-28): window.okxwallet
// is a non-configurable, read-only proxy whose set trap ignores assignments to functions; window.ethereum is a
// non-configurable getter. Requests go to the content script (cs.js) with window.postMessage in the multiplex format.
(() => {
  if (window.top !== window) return;
  let next = 0;
  const waiting = new Map();
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.target !== 'mockokx-inpage') return;
    const r = d.data && d.data.data;
    const w = r && waiting.get(r.id);
    if (!w) return;
    waiting.delete(r.id);
    if (r.error) w.reject(Object.assign(new Error(r.error.message), { code: r.error.code }));
    else w.resolve(r.result);
  });
  const provider = {
    isMockOkx: true,
    on() {},
    request(a) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        waiting.set(id, { resolve, reject });
        window.postMessage({ target: 'mockokx-contentscript', data: { name: 'mockokx-provider', data: { jsonrpc: '2.0', id, method: a.method, params: a.params } } }, location.origin);
      });
    },
  };
  const proxy = new Proxy(provider, { set: (t, k, v) => (typeof t[k] === 'function' || typeof v === 'function' ? true : Reflect.set(t, k, v)) });
  Object.defineProperty(window, 'okxwallet', { value: proxy, writable: false, configurable: false });
  try {
    Object.defineProperty(window, 'ethereum', { configurable: false, get: () => proxy, set() {} });
  } catch { /* another wallet made it non-configurable first */ }
})();
