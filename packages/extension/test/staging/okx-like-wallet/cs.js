// Test only. The mock wallet's content script: answers each request and records it on the page
// (<html data-mock-okx-calls>) so the test can see exactly what reached the wallet.
(() => {
  // like OKX: every frame, iframes included (Guard 0.3.7 covers same-origin iframes)
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.target !== 'mockokx-contentscript' || !d.data || !d.data.data) return;
    const { id, method, params } = d.data.data;
    const el = document.documentElement;
    const calls = JSON.parse(el.dataset.mockOkxCalls || '[]');
    calls.push({ method, params: JSON.stringify(params ?? null) });
    el.dataset.mockOkxCalls = JSON.stringify(calls);
    const result = method === 'eth_chainId' ? '0xc4'
      : method === 'eth_accounts' || method === 'eth_requestAccounts' ? ['0x1111111111111111111111111111111111111111']
      : /sign|sendTransaction|sendCalls/i.test(method) ? `0x${'ab'.repeat(32)}` : null;
    window.postMessage({ target: 'mockokx-inpage', data: { name: 'mockokx-provider', data: { jsonrpc: '2.0', id, result } } }, location.origin);
  });
})();
