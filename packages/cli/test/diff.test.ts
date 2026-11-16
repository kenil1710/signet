import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seal, loadSealed } from '../src/seal.ts';
import { diffSealed, formatDiff } from '../src/diff.ts';
import { findCalls, countCalls } from '../src/calls.ts';
import { writeBuild, DRAINER, DRAINER_ORIGIN, CDN_SCRIPT, CDN_SRI, NEW_VAULT, ROUTER, type Variant } from './fixtures.ts';

const DOMAIN = 'app.example.org';
const cfg = { domain: DOMAIN, chainId: 196 };
const tmp = () => mkdtempSync(join(tmpdir(), 'signet-diff-'));
function sealed(v: Variant, edit?: (dir: string) => void, config = cfg) {
  const dir = writeBuild(join(tmp(), 'dist'), v);
  edit?.(dir);
  seal(dir, config);
  const b = loadSealed(dir);
  return { lists: b.sealed, code: (p: string) => b.bytes(p).toString('utf8') };
}
const diff = (from: ReturnType<typeof sealed> | null, to: ReturnType<typeof sealed>) =>
  diffSealed(DOMAIN, from ? { ...from.lists, release: '2' } : null, to.lists, to.code);

test('code-only change: tier 00, nothing flagged, the hashed file name is shown as one changed file', () => {
  const r = diff(sealed('v1'), sealed('v2'));
  assert.equal(r.tier.expected, 0);
  assert.deepEqual(r.flags, []);
  assert.equal(r.files.changed.length, 2); // app-<hash>.js (renamed by its hash) and index.html (which references it)
  assert.ok(r.files.changed.some((c) => c.from !== c.path && /^assets\/app-/.test(c.from) && /^assets\/app-/.test(c.path)));
  assert.deepEqual([r.files.added, r.files.removed], [[], []]);
  assert.deepEqual([r.allowlist.added, r.origins.added, r.scripts.sriChanged, r.calls.added], [[], [], [], []]);
  assert.match(formatDiff(r), /RISK TIER 00 CODE ONLY[\s\S]*Only code changed/);
});

test('poisoned npm package: new address, new origin and new approve/transferFrom calls, each with the file it is in', () => {
  const r = diff(sealed('v2'), sealed('poisoned'));
  assert.equal(r.tier.expected, 2);
  assert.ok(r.tier.allowlistChanged && r.tier.originsChanged);
  assert.deepEqual(r.allowlist.added.map((a) => [a.chainId, a.address, a.roles]), [['196', DRAINER, ['contract']]]);
  assert.match(r.allowlist.added[0]!.where[0]!.file, /^assets\/chunk-vendor-/);
  assert.ok(r.allowlist.added[0]!.where[0]!.snippet.includes(DRAINER));
  assert.deepEqual(r.origins.added.map((o) => o.origin), [DRAINER_ORIGIN]);
  assert.match(r.origins.added[0]!.where[0]!.file, /^assets\/chunk-vendor-/);
  assert.deepEqual(r.calls.added.map((c) => [c.kind, c.count, c.before]), [['approve', 1, 0], ['transferFrom', 1, 0]]);
  assert.ok(r.calls.added[0]!.where[0]!.snippet.includes('0x095ea7b3'));
  // the app's own code did not change: only the vendor chunk did
  assert.deepEqual(r.files.changed.map((c) => c.from), ['assets/chunk-vendor-51b0e7d4.js']);
  assert.equal(r.flags.length, 4);
  const text = formatDiff(r);
  assert.match(text, /RISK TIER 10 ALLOWLIST CHANGED/);
  assert.match(text, /\+ NEW contract {2}0xBAD0/);
  assert.match(text, /\+ NEW origin {2}https:\/\/cdn\.connect-kit-assets\.example\.net/);
  assert.match(text, /\+ NEW ERC-20 approve: 1 in this build, 0 in the current release/);
  assert.match(text, /emergency fast lane is refused/);
});

test('changed SRI hash: tier 01 with the old and the new hash', () => {
  const OTHER = 'sha384-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  const r = diff(sealed('v2'), sealed('v2', (dir) => writeFileSync(join(dir, 'index.html'), readFileSync(join(dir, 'index.html'), 'utf8').replace(CDN_SRI, OTHER))));
  assert.equal(r.tier.expected, 1);
  assert.deepEqual(r.scripts.sriChanged, [{ url: CDN_SCRIPT, from: CDN_SRI, to: OTHER }]);
  assert.deepEqual([r.origins.added, r.allowlist.added], [[], []]);
  assert.match(formatDiff(r), /RISK TIER 01[\s\S]*1 cross-origin script with a changed SRI hash[\s\S]*~ CHANGED SRI/);
});

test('new address (tier 10), new origin (tier 01), removed address, a new spender role for a known address', () => {
  const v2 = sealed('v2');
  assert.equal(diff(v2, sealed('v3')).tier.expected, 2);
  assert.deepEqual(diff(v2, sealed('v3')).allowlist.added.map((a) => a.address), [NEW_VAULT]);
  const v4 = diff(v2, sealed('v4'));
  assert.equal(v4.tier.expected, 1);
  assert.deepEqual(v4.origins.added.map((o) => o.origin), ['wss://prices.new-feed.example.net']);
  const back = diff(sealed('v3'), v2);
  assert.deepEqual(back.allowlist.removed.map((a) => [a.address, a.roles]), [[NEW_VAULT, ['contract']]]);
  assert.equal(back.tier.expected, 2);
  const spender = diff(v2, sealed('v2', undefined, { ...cfg, allowlist: { '196': { spenders: [ROUTER] } } } as never));
  assert.deepEqual(spender.allowlist.added.map((a) => [a.address, a.roles]), [[ROUTER, ['spender']]]);
  assert.match(formatDiff(spender), /\+ NEW spender/);
});

test('first release: tier 10, everything is listed as new', () => {
  const r = diff(null, sealed('v1'));
  assert.equal(r.base, null);
  assert.equal(r.tier.expected, 2);
  assert.equal(r.allowlist.added.length, 3);
  assert.match(formatDiff(r), /first release/);
});

test('a base release sealed without call counts: calls are reported as present, not as new', () => {
  const base = sealed('v2');
  const r = diffSealed(DOMAIN, { ...base.lists, calls: null, release: '2' }, sealed('poisoned').lists, sealed('poisoned').code);
  assert.equal(r.calls.baseKnown, false);
  assert.match(formatDiff(r), /sealed without call counts/);
});

test('call scanner: selectors, ABI names, method calls and typed data; plain words are not calls', () => {
  const kinds = (code: string) => countCalls(findCalls('a.js', code));
  assert.deepEqual(kinds('data:"0x095ea7b3"+x'), { approve: 1 });
  assert.deepEqual(kinds('{name:"approve",type:"function"};t.approve(s,n)'), { approve: 2 });
  assert.deepEqual(kinds('label="Approve USDC to continue";// we approve of this'), {});
  assert.deepEqual(kinds('w.request({method:"eth_signTypedData_v4"});primaryType:"Permit"'), { permit: 1, signTypedData: 1 });
  assert.deepEqual(kinds('types:{PermitSingle:[]};"0xa22cb465";x.setApprovalForAll(o,true)'), { setApprovalForAll: 2, permit2: 1 });
  assert.deepEqual(kinds('"0xa9059cbb";"0x23b872dd";c.safeTransferFrom(a,b,1);method:"eth_sign"'), { transfer: 1, transferFrom: 2, ethSign: 1 });
});
