// Signet v2, server-rendered pages: the inline-script classifier (shared with Guard) and what the sealer seals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyInline, inlineHash, inlineHashesOf, inlineScriptsOf, runs, templateOf } from '../src/inline.ts';
import { seal, parseSealed, ORIGINS_PATH, ALLOWLIST_PATH, FILES_PATH } from '../src/seal.ts';

const none = new Set<string>();

test('templates: Next.js flight data and React streaming calls are data; anything added to them is injected', () => {
  assert.equal(templateOf('self.__next_f.push([1,"a:I[123,[],\\"x\\"]\\n"])'), 'data');
  assert.equal(templateOf('self.__next_f.push([2,null])'), 'data');
  assert.equal(templateOf('self.__next_f.push([1,"\\u0022);alert(1)//"])'), 'data', 'an escaped quote stays inside the JSON string');
  assert.equal(templateOf('$RS("S:2","P:2")'), 'reveal');
  assert.equal(templateOf('$RC("B:0","S:0")'), 'reveal');
  assert.equal(templateOf('$RX("B:1","","digest \\"x\\"")'), 'reveal');
  for (const evil of [
    'self.__next_f.push([1,"x"]);fetch("//evil")',
    'self.__next_f.push([1,"a"]);alert(1);(0)',
    'self.__next_f.push([1,{"a":1}])', // objects are not what Next pushes
    'self.__next_f.push(1)',
    ' self.__next_f.push([1,"x"])', // exact text only
    'self.__next_f.push([1,"x"])\n',
    'self.__next_f["push"]([1,"x"])',
    '$RS("S:1","P:1");alert(1)',
    '$RS("S:1"+alert(1))',
    '$RS(`S:1`)',
    '$RS()',
    '$RZ("S:1")',
    '$RS("S:1",1)',
    '/*x*/self.__next_f.push([1])',
  ]) assert.equal(classifyInline({ text: evil, type: '' }, none), 'injected', evil);
});

test('types: only scripts the browser runs are checked; importmap and speculationrules count as code', () => {
  assert.equal(classifyInline({ text: '{"a":1}', type: 'application/json' }, none), 'inert');
  assert.equal(classifyInline({ text: '{}', type: 'application/ld+json' }, none), 'inert');
  assert.equal(classifyInline({ text: 'alert(1)', type: 'text/plain' }, none), 'inert');
  for (const t of ['', 'module', 'text/javascript', 'TEXT/JAVASCRIPT', 'application/javascript; charset=utf-8', 'importmap', 'speculationrules']) assert.ok(runs(t), t);
  assert.equal(classifyInline({ text: '{"imports":{"a":"https://evil/x.js"}}', type: 'importmap' }, none), 'injected');
});

test('sealed hashes: the exact text, nothing else', () => {
  const theme = '(function(){document.documentElement.dataset.theme="dark"})()';
  const sealed = new Set([inlineHash(theme)]);
  assert.equal(classifyInline({ text: theme, type: '' }, sealed), 'sealed');
  assert.equal(classifyInline({ text: `${theme};alert(1)`, type: '' }, sealed), 'injected');
  assert.equal(classifyInline({ text: theme.replace('dark', 'light'), type: '' }, sealed), 'injected');
});

test('collection: inline scripts of HTML pages, templates and inert ones left out', () => {
  const html = `<html><head><script>(function(){1})()</script><script src="/_next/static/chunks/a.js"></script>
    <script type="application/json" id="x">{"a":1}</script></head><body><script>self.__next_f.push([1,"x"])</script>
    <script>$RS("S:1","P:1")</script><script>$RS=function(a,b){}</script></body></html>`;
  const all = inlineScriptsOf(html);
  assert.equal(all.length, 5, 'the src script is not inline');
  assert.deepEqual(inlineHashesOf([html]), [inlineHash('(function(){1})()'), inlineHash('$RS=function(a,b){}')].sort());
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ssr-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
}

test('seal: ssr pages and a factory rule go into origins.json and allowlist.json (manifest v2); the preview must be this build', () => {
  const dir = project({ '_next/static/chunks/main-abc.js': 'console.log(1)', 'favicon.ico': 'x' });
  const page = '<html><script src="/_next/static/chunks/main-abc.js"></script><script>(function(){t()})()</script><script>self.__next_f.push([1,"a"])</script><script>$RS=function(a,b){}</script><script>$RS("S:1","P:1")</script></html>';
  const factory = { factory: '0x9075cbb50639216c2e4e32013514baa01f2b0c1b', predict: 'predictVaultAddress(address,bytes32)', id: 'programId()', roles: ['owner()', 'guardian()'] };
  const cfg = { domain: 'misthos.example', chainId: 196, pages: { mode: 'ssr' as const, crawl: ['/', '/p/x'] }, allowlist: { '5042': { targets: ['0x3600000000000000000000000000000000000000'], factories: [factory] } } };
  assert.throws(() => seal(dir, cfg), /--crawl/);
  const r = seal(dir, cfg, { crawled: [{ path: '/', html: page }, { path: '/p/x', html: page }] });
  assert.equal(r.manifest.version, 2);
  assert.deepEqual(r.pages, { mode: 'ssr', inline: [inlineHash('(function(){t()})()'), inlineHash('$RS=function(a,b){}')].sort(), serviceWorkers: [] });
  assert.equal(r.allowlist['5042']!.factories![0]!.factory, '0x9075CbB50639216C2e4E32013514baa01f2b0C1b', 'checksummed');
  const back = parseSealed('misthos.example', readFileSync(join(dir, ALLOWLIST_PATH)), readFileSync(join(dir, ORIGINS_PATH)), readFileSync(join(dir, FILES_PATH)));
  assert.deepEqual(back.pages, r.pages);
  assert.equal(back.manifestHash, r.manifest.manifestHash);
  // a preview that loads a script this build doesn't have: refused
  assert.throws(() => seal(dir, cfg, { crawled: [{ path: '/', html: '<script src="/_next/static/chunks/other.js"></script>' }] }), /not in .*seal the exact build/);
  // a malformed factory rule
  assert.throws(() => seal(dir, { ...cfg, allowlist: { '5042': { factories: [{ ...factory, predict: 'predict(address)' }] } } }, { crawled: [{ path: '/', html: page }] }), /factories/);
});

test('seal: without the v2 options the output is exactly v1 (no new keys)', () => {
  const dir = project({ 'index.html': '<script src="/a.js"></script>', 'a.js': 'x' });
  const r = seal(dir, { domain: 'static.example', chainId: 196 });
  assert.equal(r.manifest.version, 1);
  assert.equal(readFileSync(join(dir, ORIGINS_PATH), 'utf8'), '{"origins":[],"scripts":[]}');
  assert.ok(!readFileSync(join(dir, ALLOWLIST_PATH), 'utf8').includes('factories'));
  assert.equal(r.pages, null);
});
