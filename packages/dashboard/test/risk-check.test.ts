// The /check risk analysis against a local site with known problems, and the domain filter (no internal hosts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { analyze, cleanDomain, parseHtml } from '../src/check/risk.ts';

test('cleanDomain: only public hostnames', () => {
  assert.equal(cleanDomain('https://App.Example.org/path?x=1'), 'app.example.org');
  for (const bad of ['localhost', '127.0.0.1', '10.0.0.1', 'example', 'a.local', 'x.internal', 'http://[::1]/', 'foo.com:8080', '']) assert.equal(cleanDomain(bad), null, bad);
});

test('parseHtml: external scripts with and without SRI, inline scripts, mixed content', () => {
  const p = parseHtml(`<script src="/app.js"></script><script src="https://cdn.example.net/lib.js"></script>
    <script src="https://cdn2.example.net/x.js" integrity="sha384-abc" crossorigin></script><script>var a=1</script>
    <script type="application/ld+json">{}</script><link rel="stylesheet" href="https://fonts.example.com/a.css"><img src="http://old.example.com/a.png">`, 'https://site.example.org/');
  assert.deepEqual(p.scripts.map((s) => [s.origin, s.sri, s.sameOrigin]), [['https://site.example.org', false, true], ['https://cdn.example.net', false, false], ['https://cdn2.example.net', true, false]]);
  assert.equal(p.inline, 1);
  assert.equal(p.styles.length, 1);
  assert.deepEqual(p.mixed, ['http://old.example.com/a.png']);
});

test('parseHtml: modulepreloads are scripts, not stylesheets; font preloads are neither (app.uniswap.org showed "723 stylesheets")', () => {
  const html = `<script type="module" src="https://cdn.example.net/main.js"></script>
    <link rel="modulepreload" crossorigin href="https://cdn.example.net/main.js"><link rel="modulepreload" href="https://cdn.example.net/a.js">
    <link rel="modulepreload" href="/local.js"><link rel="preload" href="https://cdn.example.net/b.js" as="script" integrity="sha384-x">
    <link rel="preload" href="https://cdn.example.net/f.woff2" as="font" crossorigin><link rel="preload" href="https://cdn.example.net/s.css" as="style">
    <link rel="stylesheet" href="https://cdn.example.net/t.css"><link rel="stylesheet" href="/own.css"><link rel="preconnect" href="https://rpc.example.net">`;
  const p = parseHtml(html, 'https://site.example.org/');
  assert.deepEqual(p.scripts.map((s) => [new URL(s.src).pathname, s.sri, s.sameOrigin, !!s.preload]), [['/main.js', false, false, false], ['/a.js', false, false, true], ['/local.js', false, true, true], ['/b.js', true, false, true]]);
  assert.deepEqual(p.styles.map((s) => new URL(s.href).pathname), ['/s.css', '/t.css']);
});

test('analyze: a local site with an unpinned CDN script, no CSP, no proof', async () => {
  const srv = http.createServer((q, r) => {
    if (q.url === '/') { r.setHeader('content-type', 'text/html'); r.end('<script src="https://cdn.example.net/wallet.js"></script>'); return; }
    r.statusCode = 404; r.end();
  });
  await new Promise<void>((res) => srv.listen(0, '127.0.0.1', res));
  const origin = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  try {
    const r = await analyze('site.example.org', fetch, { origin });
    const t = r.findings.map((f) => `${f.level}:${f.area}:${f.text}`).join('\n');
    assert.match(t, /risk:Scripts:1 script\(s\) from 1 other origin\(s\); 1 without SRI/);
    assert.match(t, /warn:Headers:No Content-Security-Policy/);
    assert.match(t, /warn:Releases:Releases are not sealed/);
    assert.deepEqual(r.origins, ['https://cdn.example.net']);
    assert.ok(r.cannotSee.length >= 3);
  } finally {
    srv.close();
  }
});
