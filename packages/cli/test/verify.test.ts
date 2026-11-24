import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyDir, verifyUrl, type Report } from '../src/verify.ts';
import { serve } from './serve.ts';
import { writeBuild } from './fixtures.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'signet-cli-'));
const codes = (r: Report, level: string) => r.findings.filter((f) => f.level === level).map((f) => f.code);

test('build dir: a clean static build is ready', () => {
  const r = verifyDir(writeBuild(join(tmp(), 'dist'), 'v1'));
  assert.equal(r.errors, 0);
  assert.equal(r.warnings, 0);
  assert.ok(codes(r, 'ok').includes('static') && codes(r, 'ok').includes('sri'));
  assert.ok(codes(r, 'info').includes('size'), 'reports files too large for on-chain storage');
});

test('build dir: a cross-origin script without SRI fails', () => {
  const r = verifyDir(writeBuild(join(tmp(), 'dist'), 'v1', { sri: false }));
  assert.equal(r.errors, 1);
  assert.deepEqual(codes(r, 'error'), ['sri-missing']);
  assert.match(r.findings.find((f) => f.code === 'sri-missing')!.fix!, /integrity=/);
});

test('build dir: SSR output and missing index.html', () => {
  const dir = join(tmp(), 'out');
  mkdirSync(join(dir, 'server'), { recursive: true });
  writeFileSync(join(dir, 'server/entry.js'), 'export default {}');
  writeFileSync(join(dir, 'page.html'), '<html><script id="__NEXT_DATA__" type="application/json">{"props":{},"gssp":true}</script><script nonce="abc" src="/a.js"></script></html>');
  const r = verifyDir(dir);
  assert.deepEqual(codes(r, 'error'), ['static']);
  assert.deepEqual(codes(r, 'warn'), ['ssr', 'ssr', 'ssr']); // server code, nonce, getServerSideProps
});

test('build dir: CDN rewrite markers saved into the HTML are reported', () => {
  const r = verifyDir(writeBuild(join(tmp(), 'dist'), 'v1', { rocket: true }));
  assert.ok(r.findings.some((f) => f.code === 'cdn-rewrite' && /Rocket Loader/.test(f.message)));
});

test('url: a correctly served build matches byte for byte', async () => {
  const dir = writeBuild(join(tmp(), 'dist'), 'v1');
  const s = await serve(dir);
  try {
    const r = await verifyUrl(s.url, { build: dir });
    assert.equal(r.errors, 0, JSON.stringify(r.findings, null, 1));
    assert.equal(r.warnings, 0);
    assert.equal(codes(r, 'ok').filter((c) => c === 'bytes').length, 3); // HTML, app script, stylesheet
  } finally {
    await s.close();
  }
});

test('url: page mode ssr: the served HTML is not compared with the build (it is not sealed); the scripts are', async () => {
  // the server's HTML (stable across requests) and a sealed ssr build without index.html: the Misthos staged
  // deployment, where 0.2.1 reported "the HTML is loaded by the page but is not in the build"
  const site = writeBuild(join(tmp(), 'site'), 'v1');
  const sealed = join(tmp(), 'sealed');
  cpSync(site, sealed, { recursive: true });
  rmSync(join(sealed, 'index.html'));
  mkdirSync(join(sealed, 'signet'), { recursive: true });
  writeFileSync(join(sealed, 'signet', 'origins.json'), JSON.stringify({ origins: [], scripts: [], pages: { mode: 'ssr', inline: [], serviceWorkers: [] } }));
  const s = await serve(site);
  try {
    const r = await verifyUrl(s.url, { build: sealed });
    assert.equal(r.errors, 0, JSON.stringify(r.findings, null, 1));
    assert.ok(!r.findings.some((f) => f.code === 'not-sealed'), 'the HTML is not reported as missing from the build');
    assert.equal(codes(r, 'ok').filter((c) => c === 'bytes').length, 2); // the app script and the stylesheet
    assert.ok(r.findings.some((f) => f.level === 'info' && f.code === 'ssr' && /page mode "ssr"/.test(f.message)));
    // without the ssr build (a static build without index.html) it still is an error
    rmSync(join(sealed, 'signet'), { recursive: true });
    assert.ok((await verifyUrl(s.url, { build: sealed })).findings.some((f) => f.code === 'not-sealed'));
  } finally {
    await s.close();
  }
});

test('url: warns about Cache-Control: no-store on HTML and on scripts', async () => {
  const dir = writeBuild(join(tmp(), 'dist'), 'v1');
  const s = await serve(dir, { cacheControl: (p) => (p.endsWith('.css') ? 'public, max-age=60' : 'no-store, max-age=0') });
  try {
    const r = await verifyUrl(s.url);
    const noStore = r.findings.filter((f) => f.code === 'no-store' && f.level === 'warn');
    assert.equal(noStore.length, 2);
    assert.match(noStore[0]!.message, /HTML is served with Cache-Control: no-store/);
    assert.match(noStore[1]!.message, /1 script\/style file\(s\).*assets\/app-/);
    assert.match(noStore[0]!.fix!, /no-cache/);
    assert.equal(r.errors, 0, 'no-store is a warning, not a failure');
  } finally {
    await s.close();
  }
});

test('url: detects CDN rewrites (Rocket Loader injected, script bytes changed)', async () => {
  const dir = writeBuild(join(tmp(), 'dist'), 'v1');
  const s = await serve(dir, {
    rewrite: (p, b) =>
      p.endsWith('.html') ? Buffer.from(b.toString().replace('</body>', '<script src="/cdn-cgi/scripts/7d0fa10a/cloudflare-static/rocket-loader.min.js" data-cf-settings="x-|49" defer></script><a href="/cdn-cgi/l/email-protection" class="__cf_email__">[email protected]</a></body>'))
      : p.endsWith('.js') ? Buffer.from(b.toString().replace(/\n/g, ';')) // "auto-minify"
      : b,
  });
  try {
    const r = await verifyUrl(s.url, { build: dir });
    const rewrites = r.findings.filter((f) => f.code === 'cdn-rewrite');
    assert.ok(rewrites.some((f) => /Rocket Loader/.test(f.message)));
    assert.ok(rewrites.some((f) => /Email Obfuscation/.test(f.message)));
    assert.ok(rewrites.some((f) => f.level === 'error' && /the HTML is not the file from the build/.test(f.message)));
    assert.ok(rewrites.some((f) => f.level === 'error' && /assets\/app-.*is not the file from the build/.test(f.message)));
    assert.ok(r.findings.some((f) => f.code === 'not-sealed' && /rocket-loader/.test(f.message)), 'an injected script is not in the build');
    assert.ok(r.errors >= 3);
  } finally {
    await s.close();
  }
});

test('url: detects server-side rendering (HTML differs per request, nonces, cookies)', async () => {
  const dir = writeBuild(join(tmp(), 'dist'), 'v1');
  const s = await serve(dir, { ssr: true, cookie: true });
  try {
    const r = await verifyUrl(s.url);
    const ssr = r.findings.filter((f) => f.code === 'ssr' && f.level === 'warn').map((f) => f.message);
    assert.equal(ssr.length, 3);
    assert.ok(ssr.some((m) => /per-request nonce/.test(m)) && ssr.some((m) => /differs between two requests/.test(m)) && ssr.some((m) => /sets a cookie/.test(m)));
  } finally {
    await s.close();
  }
});

test('url: a cross-origin script without SRI fails on the live page too', async () => {
  const dir = writeBuild(join(tmp(), 'dist'), 'v1', { sri: false });
  const s = await serve(dir);
  try {
    const r = await verifyUrl(s.url);
    assert.deepEqual(codes(r, 'error'), ['sri-missing']);
  } finally {
    await s.close();
  }
});
