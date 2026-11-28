// Guard 0.3.7: the popup's "Files matched" line (lib/filecount.ts). misthos.world (a sealed server-rendered page) showed
// "26 / 35 loaded" in red: the popup didn't count the inline scripts and the page itself, which the page check does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filesMatched } from '../src/lib/filecount.ts';
import type { FileResult, FileStatus } from '../src/lib/types.ts';

const r = (status: FileStatus, n: number, note?: string): FileResult[] => Array.from({ length: n }, (_, i) => ({ url: `${status}:${i}`, status, note }));

test('a sealed server-rendered page (misthos.world): 35 / 35 in green, by kind', () => {
  const m = filesMatched([...r('ok', 26), ...r('ok-inline', 3, 'sealed'), ...r('ok-inline', 5, 'data'), ...r('ok-ssr', 1)]);
  assert.equal(m.text, '35 / 35 loaded checked · 26 files + 8 inline + 1 server-rendered page');
  assert.equal(m.good, true);
  assert.deepEqual(m.unchecked, []);
});

test('a static page: SRI and gateway files count as files', () => {
  const m = filesMatched([...r('ok', 4), ...r('ok-sri', 1), ...r('ok-gateway', 2)]);
  assert.equal(m.text, '7 / 7 loaded checked · 7 files');
  assert.equal(m.good, true);
});

test('anything not checked is counted out, listed, and the line is not green', () => {
  for (const bad of ['mismatch', 'injected', 'unknown-origin', 'not-cached', 'stale-release', 'cross-origin'] as FileStatus[]) {
    const m = filesMatched([...r('ok', 2), ...r('ok-ssr', 1), ...r(bad, 1)]);
    assert.equal(m.text, '3 / 4 loaded checked · 2 files + 1 server-rendered page', bad);
    assert.equal(m.good, false, bad);
    assert.deepEqual(m.unchecked.map((f) => f.status), [bad]);
  }
});

test('singular and empty', () => {
  assert.equal(filesMatched(r('ok', 1)).text, '1 / 1 loaded checked · 1 file');
  assert.deepEqual(filesMatched([]), { text: '0 / 0 loaded checked', good: true, unchecked: [] });
});
