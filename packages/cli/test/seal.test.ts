import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { encodeAbiParameters, type Hex } from 'viem';
import { leafOf, hashPair, merkleRoot, merkleProof, verifyProof, sha256Hex } from '../src/merkle.ts';
import { seal, loadSealed, extractAddresses, extractOrigins, isValidDomain, isOnchainPath, manifestHashOf, tagsOf } from '../src/seal.ts';
import { writeBuild, ROUTER, STAKING, NEW_VAULT, PERMIT2, CDN_SCRIPT, CDN_SRI } from './fixtures.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'signet-cli-'));
const DOMAIN = 'app.example.org';
const cfg = { domain: DOMAIN, chainId: 196 };
const sha = (b: Buffer | string) => `0x${createHash('sha256').update(b).digest('hex')}` as Hex;

test('leaf = sha256(abi.encode(domain, path, contentType, sha256(bytes))), as SignetRegistry.writeFile computes it', () => {
  const body = Buffer.from('<!doctype html><title>x</title>');
  const enc = encodeAbiParameters([{ type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'bytes32' }], [DOMAIN, 'index.html', 'text/html', sha(body)]);
  assert.equal(leafOf(DOMAIN, 'index.html', 'text/html', sha(body)), sha(Buffer.from(enc.slice(2), 'hex')));
  // the domain is part of the leaf: the same file sealed for another domain is another leaf
  assert.notEqual(leafOf(DOMAIN, 'index.html', 'text/html', sha(body)), leafOf('other.example.org', 'index.html', 'text/html', sha(body)));
});

test('pairs are hashed sorted: sha256(min ++ max)', () => {
  const a = sha('a');
  const b = sha('b');
  const [lo, hi] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  assert.equal(hashPair(a, b), sha(Buffer.concat([Buffer.from(lo.slice(2), 'hex'), Buffer.from(hi.slice(2), 'hex')])));
  assert.equal(hashPair(a, b), hashPair(b, a));
});

test('every leaf has a proof that the contract loop accepts, for 1 to 33 leaves', () => {
  for (let n = 1; n <= 33; n++) {
    const leaves = Array.from({ length: n }, (_, i) => sha(`leaf-${n}-${i}`));
    const root = merkleRoot(leaves);
    assert.equal(merkleRoot([...leaves].reverse()), root, 'the root does not depend on the order of the files');
    for (const leaf of leaves) assert.ok(verifyProof(leaf, merkleProof(leaves, leaf), root), `n=${n}`);
    assert.ok(!verifyProof(sha('not a leaf'), merkleProof(leaves, leaves[0]!), root) || n === 0);
  }
  assert.equal(merkleRoot([sha('only')]), sha('only'), 'one leaf: the root is the leaf');
  assert.throws(() => merkleRoot([]));
});

test('seal: hashes, allowlist, origins, SRI and the four files', () => {
  const dir = writeBuild(join(tmp(), 'dist'), 'v1');
  const r = seal(dir, cfg);
  const m = r.manifest;

  // every build file is sealed, plus the file list itself; the reserved files are not leaves
  const paths = r.files.map((f) => f.path);
  assert.ok(paths.includes('index.html') && paths.includes('robots.txt') && paths.includes('assets/chunk-vendor.js') && paths.includes('signet/files.json'));
  assert.ok(!paths.includes('signet/allowlist.json') && !paths.includes('signet-manifest.json'));
  for (const f of r.files) assert.equal(f.sha256, sha(readFileSync(join(dir, f.path))), f.path);

  // the three hashes are exactly what the contracts compute
  assert.equal(m.allowlistHash, sha(readFileSync(join(dir, 'signet/allowlist.json'))));
  assert.equal(m.originsHash, sha(readFileSync(join(dir, 'signet/origins.json'))));
  assert.equal(m.filesRoot, merkleRoot(r.files.map((f) => leafOf(DOMAIN, f.path, f.contentType, f.sha256))));
  assert.equal(m.manifestHash, manifestHashOf(m.filesRoot, m.allowlistHash, m.originsHash));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'signet-manifest.json'), 'utf8')), m);

  // allowlist: addresses from the build; Permit2 is a spender and an EIP-712 verifier; placeholders are dropped
  assert.deepEqual(r.allowlist['196'], { targets: [PERMIT2, ROUTER, STAKING], spenders: [PERMIT2], eip712: [PERMIT2] });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'signet/allowlist.json'), 'utf8')), r.allowlist);

  // origins: RPC, API and the CDN; documentation links and XML namespaces are left out
  assert.deepEqual(r.origins, ['https://api.demo-swap.example.org', 'https://cdn.jsdelivr.net', 'https://xlayerrpc.okx.com']);
  assert.deepEqual(r.ignoredOrigins, ['http://www.w3.org', 'https://reactjs.org']);

  // SRI hashes of cross-origin scripts are sealed in the file list
  const list = JSON.parse(readFileSync(join(dir, 'signet/files.json'), 'utf8'));
  assert.deepEqual(list.externalScripts, [{ url: CDN_SCRIPT, integrity: CDN_SRI }]);
  assert.ok(r.warnings.some((w) => w.includes('chunk-vendor.js') && w.includes('too large')));
});

test('seal is deterministic and re-sealing a sealed directory changes nothing', () => {
  const a = seal(writeBuild(join(tmp(), 'dist'), 'v1'), cfg).manifest;
  const dir = writeBuild(join(tmp(), 'dist'), 'v1');
  seal(dir, cfg);
  assert.deepEqual(seal(dir, cfg).manifest, a);
});

test('what changes which hash: code -> filesRoot only; address -> allowlistHash; origin -> originsHash', () => {
  const s = (v: 'v1' | 'v2' | 'v3' | 'v4') => seal(writeBuild(join(tmp(), 'dist'), v), cfg);
  const [v1, v2, v3, v4] = [s('v1'), s('v2'), s('v3'), s('v4')];
  assert.notEqual(v2.manifest.filesRoot, v1.manifest.filesRoot);
  assert.equal(v2.manifest.allowlistHash, v1.manifest.allowlistHash);
  assert.equal(v2.manifest.originsHash, v1.manifest.originsHash);
  assert.notEqual(v3.manifest.allowlistHash, v2.manifest.allowlistHash);
  assert.equal(v3.manifest.originsHash, v2.manifest.originsHash);
  assert.ok(v3.allowlist['196']!.targets.includes(NEW_VAULT));
  assert.equal(v4.manifest.allowlistHash, v2.manifest.allowlistHash);
  assert.notEqual(v4.manifest.originsHash, v2.manifest.originsHash);
  assert.ok(v4.origins.includes('wss://prices.new-feed.example.net'));
});

test('config: spenders, extra chains, excluded addresses and origins', () => {
  const dir = writeBuild(join(tmp(), 'dist'), 'v1');
  const r = seal(dir, {
    ...cfg,
    allowlist: { '196': { spenders: [ROUTER.toLowerCase()], exclude: [STAKING] }, '1': { targets: [NEW_VAULT] } },
    origins: { include: ['https://reactjs.org/docs'], exclude: ['https://api.demo-swap.example.org'] },
  });
  assert.deepEqual(Object.keys(r.allowlist), ['1', '196']);
  assert.deepEqual(r.allowlist['1'], { targets: [NEW_VAULT], spenders: [], eip712: [] });
  assert.deepEqual(r.allowlist['196'], { targets: [PERMIT2, ROUTER], spenders: [PERMIT2, ROUTER], eip712: [PERMIT2] });
  assert.deepEqual(r.origins, ['https://cdn.jsdelivr.net', 'https://reactjs.org', 'https://xlayerrpc.okx.com']);
});

test('an empty allowlist and empty origins still hash to non-zero values (explicit empty lists)', () => {
  const dir = join(tmp(), 'dist');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>plain</title>');
  const r = seal(dir, cfg);
  assert.equal(readFileSync(join(dir, 'signet/allowlist.json'), 'utf8'), '{"196":{"targets":[],"spenders":[],"eip712":[]}}');
  assert.equal(readFileSync(join(dir, 'signet/origins.json'), 'utf8'), '[]');
  assert.equal(r.manifest.allowlistHash, sha256Hex('{"196":{"targets":[],"spenders":[],"eip712":[]}}'));
});

test('loadSealed refuses a build that changed after sealing', () => {
  const dir = writeBuild(join(tmp(), 'dist'), 'v1');
  seal(dir, cfg);
  const b = loadSealed(dir);
  for (const f of b.files) assert.ok(verifyProof(leafOf(DOMAIN, f.path, f.contentType, f.sha256), b.proof(f.path), b.manifest.filesRoot));
  writeFileSync(join(dir, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  assert.throws(() => loadSealed(dir), /robots\.txt changed since the build was sealed/);
  seal(dir, cfg);
  writeFileSync(join(dir, 'assets/drainer.js'), 'alert(1)');
  assert.throws(() => loadSealed(dir), /set of files changed/);
  seal(dir, cfg);
  writeFileSync(join(dir, 'signet/allowlist.json'), '{"196":{"targets":["0x000000000000000000000000000000000000bEEF"],"spenders":[],"eip712":[]}}');
  assert.throws(() => loadSealed(dir), /allowlist\.json changed/);
});

test('extraction details', () => {
  assert.deepEqual(extractAddresses(`a="${ROUTER.toLowerCase()}";h="0x${'ab'.repeat(32)}";z="0x${'0'.repeat(40)}";p="0x${'0'.repeat(39)}1"`), [ROUTER]);
  assert.deepEqual(extractOrigins('fetch("https://API.example.org:8443/x?y");new WebSocket("wss://ws.example.org");"http://a";"http://127.0.0.1:8545"').sort(), ['http://127.0.0.1:8545', 'https://api.example.org:8443', 'wss://ws.example.org']);
  assert.deepEqual(tagsOf('<!-- <script src=x></script> --><script defer src="/a.js" integrity=\'sha384-x\'></script>', 'script').map((t) => t.attrs), [{ defer: true, src: '/a.js', integrity: 'sha384-x' }]);
});

test('domain and path rules match the contracts', () => {
  for (const d of ['app.example.org', 'a.io', 'xn--bcher-kva.example', 'a-b.c-d.e']) assert.ok(isValidDomain(d), d);
  for (const d of ['App.example.org', 'localhost', '-a.io', 'a-.io', 'a..io', 'a.io.', 'a/b.io', 'a b.io', '']) assert.ok(!isValidDomain(d), d);
  for (const p of ['index.html', 'assets/app-1.js', '.well-known/x', 'a/b/c.d']) assert.ok(isOnchainPath(p), p);
  for (const p of ['', '/a', 'a/', 'a//b', '../a', 'a/./b', 'a b.js', 'café.js', 'a\\b', 'x'.repeat(201)]) assert.ok(!isOnchainPath(p), p);
});
