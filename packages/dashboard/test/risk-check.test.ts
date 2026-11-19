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
