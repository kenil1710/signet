// Guard 0.3.2: a cached copy that doesn't match is re-checked against the copy the site serves now, without ever
// letting a page that ran other bytes pass (lib/recheck.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideRecheck } from '../src/lib/recheck.ts';

const SEAL = 'aa'.repeat(32), OLD = 'bb'.repeat(32), EVIL = 'cc'.repeat(32);
const now = Date.parse('2026-11-24T13:00:00Z');
// this computer's clock: release #8 published at 12:36:57, pages loaded at 12:59:30 unless a test says otherwise
const base = { cachedHash: OLD, valid: [SEAL], release: 8, publishedLocal: Date.parse('2026-11-24T12:36:57Z'), loadedLocal: Date.parse('2026-11-24T12:59:30Z') };

test('stale cache: the cached copy predates this page load and the site serves the sealed copy now: ok (the real-Chrome case)', () => {
  const r = decideRecheck({ ...base, cachedDate: Date.parse('2026-11-24T10:00:00Z'), fresh: { hash: SEAL, date: now }, sinceLoad: 30_000 });
  assert.equal(r.status, 'ok');
  assert.equal(r.sha256, SEAL);
  assert.match(r.note!, /older copy/);
});

test('a one-off hijack: the cached copy is from this page load and differs, the site now serves the seal: still a mismatch', () => {
  const r = decideRecheck({ ...base, cachedHash: EVIL, cachedDate: now - 30_000, fresh: { hash: SEAL, date: now }, sinceLoad: 30_000 });
  assert.equal(r.status, 'mismatch');
  assert.equal(r.sha256, EVIL);
  assert.match(r.note!, /served other bytes/);
});

test('a server clock far from this computer\'s (or a chain weeks ahead, as on staging) changes nothing: each comparison uses one clock', () => {
  for (const skew of [-3_600_000, 0, 3_600_000, 204 * 86_400_000]) {
    // the hijack case, with the server's Date values shifted: still a mismatch
    assert.equal(decideRecheck({ ...base, cachedHash: EVIL, cachedDate: now + skew - 30_000, fresh: { hash: SEAL, date: now + skew }, sinceLoad: 30_000 }).status, 'mismatch');
    // the stale-cache case, shifted the same way: still ok
    assert.equal(decideRecheck({ ...base, cachedDate: now + skew - 7_200_000, fresh: { hash: SEAL, date: now + skew }, sinceLoad: 30_000 }).status, 'ok');
  }
});

test('loaded after the release was published (this computer\'s clock): never "loaded before"', () => {
  const r = decideRecheck({ ...base, cachedHash: EVIL, cachedDate: now - 5_000, fresh: { hash: EVIL, date: now }, sinceLoad: 5_000, loadedLocal: base.publishedLocal + 60_000 });
  assert.equal(r.status, 'mismatch');
});

test('the cached copy is within the Date resolution of this load (1 s): not treated as older', () => {
  const r = decideRecheck({ ...base, cachedHash: EVIL, cachedDate: now - 30_000 - 1_500, fresh: { hash: SEAL, date: now }, sinceLoad: 30_000 });
  assert.equal(r.status, 'mismatch');
});

test('loaded before the current release was published: "loaded before release #8, reload", not a mismatch', () => {
  const loaded = Date.parse('2026-11-24T12:30:00Z');
  const r = decideRecheck({ ...base, loadedLocal: loaded, cachedDate: loaded, fresh: { hash: SEAL, date: loaded + 600_000 }, sinceLoad: 600_000 });
  assert.equal(r.status, 'stale-release');
  assert.match(r.note!, /before release #8 was published/);
});

test('loaded after the release and the site itself serves other bytes now: mismatch', () => {
  const r = decideRecheck({ ...base, cachedHash: EVIL, cachedDate: now - 5_000, fresh: { hash: EVIL, date: now }, sinceLoad: 5_000 });
  assert.equal(r.status, 'mismatch');
  assert.equal(r.note, undefined);
});

test('no Date headers, or the network copy unreadable: never ok, never stale (decided on the cached copy)', () => {
  assert.equal(decideRecheck({ ...base, cachedDate: NaN, fresh: { hash: SEAL, date: now }, sinceLoad: 30_000 }).status, 'mismatch');
  assert.equal(decideRecheck({ ...base, cachedDate: Date.parse('2026-11-24T10:00:00Z'), fresh: { hash: SEAL, date: NaN }, sinceLoad: 30_000 }).status, 'mismatch');
  assert.equal(decideRecheck({ ...base, cachedDate: Date.parse('2026-11-24T10:00:00Z'), fresh: null, sinceLoad: 30_000 }).status, 'mismatch');
});

test('a stale cache whose network copy is not sealed either: mismatch (the site serves unsealed bytes now)', () => {
  assert.equal(decideRecheck({ ...base, cachedDate: Date.parse('2026-11-24T10:00:00Z'), fresh: { hash: EVIL, date: now }, sinceLoad: 30_000 }).status, 'mismatch');
});
