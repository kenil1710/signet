// The extension recomputes filesRoot, allowlistHash and originsHash itself; this checks it gets the same values
// as the CLI that sealed the build (and so as the contracts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seal } from '../../cli/src/seal.ts';
import { writeBuild } from '../../cli/test/fixtures.ts';
import { parseSealed, pathOfUrl } from '../src/lib/sealed.ts';

test('parseSealed gives the hashes the CLI sealed, and different ones for different bytes', () => {
  const dir = writeBuild(join(mkdtempSync(join(tmpdir(), 'guard-')), 'dist'), 'poisoned');
  const m = seal(dir, { domain: 'app.example.org', chainId: 196 }).manifest;
  const bytes = (p: string) => new Uint8Array(readFileSync(join(dir, p)));
  const s = parseSealed('app.example.org', bytes('signet/allowlist.json'), bytes('signet/origins.json'), bytes('signet/files.json'));
  assert.deepEqual([s.filesRoot, s.allowlistHash, s.originsHash, s.manifestHash], [m.filesRoot, m.allowlistHash, m.originsHash, m.manifestHash]);
  assert.equal(s.files.length, m.fileCount - 1);
  assert.equal(s.scripts.length, 1);
  assert.throws(() => parseSealed('other.example.org', bytes('signet/allowlist.json'), bytes('signet/origins.json'), bytes('signet/files.json')), /another domain/);
  const forged = new TextEncoder().encode(readFileSync(join(dir, 'signet/allowlist.json'), 'utf8').replace('"spenders":[', '"spenders":["0xBAD0C0fFeE5BAD0c0ffEe5baD0c0ffeE5baD0C0F",'));
  const f = parseSealed('app.example.org', forged, bytes('signet/origins.json'), bytes('signet/files.json'));
  assert.notEqual(f.allowlistHash, m.allowlistHash);
  assert.notEqual(f.manifestHash, m.manifestHash);
});

test('URL to sealed path', () => {
  assert.equal(pathOfUrl('/'), 'index.html');
  assert.equal(pathOfUrl('/docs/'), 'docs/index.html');
  assert.equal(pathOfUrl('/assets/app-1.js'), 'assets/app-1.js');
  assert.equal(pathOfUrl('/a%20b.js'), 'a b.js');
});

// ---- clean URLs (Cloudflare Pages / Netlify / Vercel serve about.html at /about) — sealedPathFor
import { sealedPathFor } from '../src/lib/sealed.ts';
const has = (...paths: string[]) => (p: string) => paths.includes(p);

test('clean URLs: a document at /app must be the sealed app.html (Cloudflare Pages)', () => {
  const h = has('index.html', 'app.html', 'assets/app.js');
  assert.equal(sealedPathFor(pathOfUrl('/app'), true, h), 'app.html');
  assert.equal(sealedPathFor(pathOfUrl('/app.html'), true, h), 'app.html'); // the exact path still works
  assert.equal(sealedPathFor(pathOfUrl('/'), true, h), 'index.html');
});

test('clean URLs: Netlify / Vercel style, nested, and directories', () => {
  const h = has('index.html', 'about.html', 'docs/intro.html', 'docs/index.html', 'blog/index.html');
  assert.equal(sealedPathFor(pathOfUrl('/about'), true, h), 'about.html');
  assert.equal(sealedPathFor(pathOfUrl('/docs/intro'), true, h), 'docs/intro.html');
  assert.equal(sealedPathFor(pathOfUrl('/docs/'), true, h), 'docs/index.html');
  assert.equal(sealedPathFor(pathOfUrl('/blog/'), true, h), 'blog/index.html');
  assert.equal(sealedPathFor(pathOfUrl('/about?ref=x'.split('?')[0]!), true, h), 'about.html');
});

test('a different sealed file can never stand in: /app is app.html only, not index.html', () => {
  // the check compares the page's bytes with the hash of the ONE path returned. With app.html sealed, a document
  // at /app whose bytes are index.html's is compared with app.html's hash, so it is a mismatch (red), not a pass.
  const sealed: Record<string, string> = { 'index.html': 'h-index', 'app.html': 'h-app' };
  const want = sealedPathFor(pathOfUrl('/app'), true, (p) => p in sealed);
  assert.equal(want, 'app.html');
  assert.notEqual(sealed[want!], 'h-index');
  // and no fallback to index.html once a clean-URL file exists
  assert.notEqual(sealedPathFor('app', true, has('index.html', 'app.html')), 'index.html');
});

test('single-page-app routes still map to index.html only when no clean-URL file is sealed', () => {
  const h = has('index.html', 'assets/app.js');
  assert.equal(sealedPathFor(pathOfUrl('/swap/eth'), true, h), 'index.html');
  assert.equal(sealedPathFor(pathOfUrl('/app'), true, h), 'index.html');
  assert.equal(sealedPathFor(pathOfUrl('/app'), true, has('assets/app.js')), null); // nothing to stand for
});

test('the clean-URL rule applies only to documents without an extension', () => {
  const h = has('index.html', 'app.html', 'x.js.html');
  assert.equal(sealedPathFor('app', false, h), null); // a script or fetch at /app is not app.html
  assert.equal(sealedPathFor('x.js', true, h), null); // has an extension: no .html guessing
  assert.equal(sealedPathFor('missing.html', true, h), null);
});

test('the exact sealed path wins over the clean-URL guess', () => {
  assert.equal(sealedPathFor('download', true, has('download', 'download.html')), 'download');
});

// ---- the domain proof (/.well-known/signet.json) — proofNames
import { proofNames } from '../src/lib/proof.ts';
test('domain proof: only a file naming exactly this gate on this chain confirms it', () => {
  const gate = '0xa3d4dfb5fB47D2CcF9b4a0a0fcC64Ac3fFef4503';
  const ok = JSON.stringify({ signet: 1, chainId: 196, gate });
  assert.equal(proofNames(ok, gate, 196), true);
  assert.equal(proofNames(ok, gate.toLowerCase(), 196), true); // case doesn't matter
  assert.equal(proofNames(JSON.stringify({ signet: 1, chainId: 196, gate: '0x000000000000000000000000000000000000dEaD' }), gate, 196), false); // another gate (a squatter's)
  assert.equal(proofNames(JSON.stringify({ signet: 1, chainId: 1, gate }), gate, 196), false); // another chain
  assert.equal(proofNames(JSON.stringify({ chainId: 196, gate }), gate, 196), false); // not a Signet proof
  assert.equal(proofNames(JSON.stringify({ signet: 1, chainId: 196, gate: 'a3d4dfb5' }), gate, 196), false);
  assert.equal(proofNames(null, gate, 196), false); // missing (404)
  assert.equal(proofNames('<!doctype html>', gate, 196), false); // a site that answers every path with its index.html
  assert.equal(proofNames(ok + ' '.repeat(5000), gate, 196), false); // oversized
});

import { mkdirSync, writeFileSync } from 'node:fs';
import { loadSealed } from '../../cli/src/seal.ts';
test('a big site: signet/files.json over 48,000 bytes is chunked, and the CLI and Guard agree on filesRoot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'big-'));
  mkdirSync(join(dir, '_next/static/chunks'), { recursive: true });
  for (let i = 0; i < 600; i++) writeFileSync(join(dir, `_next/static/chunks/c${String(i).padStart(4, '0')}-${'x'.repeat(40)}.js`), `console.log(${i})`);
  const r = seal(dir, { domain: 'big.example', chainId: 196 });
  const list = r.files.find((f) => f.path === 'signet/files.json')!;
  assert.ok(list.size > 48_000, `files.json is ${list.size} bytes`);
  assert.equal(list.chunks?.length, Math.ceil(list.size / 24_000), 'its chunk hashes are leaves');
  assert.ok(!r.warnings.some((w) => /files\.json.*too large/.test(w)), 'no longer "too large to store on-chain"');
  const g = parseSealed('big.example', readFileSync(join(dir, 'signet/allowlist.json')), readFileSync(join(dir, 'signet/origins.json')), readFileSync(join(dir, 'signet/files.json')));
  assert.equal(g.filesRoot, r.manifest.filesRoot);
  assert.equal(g.manifestHash, r.manifest.manifestHash);
  const b = loadSealed(dir);
  assert.doesNotThrow(() => b.chunkProof('signet/files.json', 0), 'the upload can prove each chunk');
});

// ---- a 404 page (Cloudflare Pages / Netlify / Vercel serve a sealed 404.html with HTTP 404) — notFoundPath
import { notFoundPath } from '../src/lib/sealed.ts';
test('an unknown path answered with 404 must be the sealed 404.html; a sealed path or a non-document never is', () => {
  const h = (p: string) => ['index.html', 'app.html', '404.html', 'assets/a.js'].includes(p);
  assert.equal(notFoundPath(pathOfUrl('/nonexistent-page-xyz'), true, h), '404.html');
  assert.equal(notFoundPath(pathOfUrl('/a/b/c'), true, h), '404.html');
  assert.equal(notFoundPath(pathOfUrl('/app.html'), true, h), null, 'a sealed path is never the 404 page');
  assert.equal(notFoundPath(pathOfUrl('/'), true, h), null);
  assert.equal(notFoundPath(pathOfUrl('/x.js'), false, h), null, 'only documents');
  assert.equal(notFoundPath(pathOfUrl('/nope'), true, (p) => p === 'index.html'), null, 'no 404.html sealed: none');
});
