// Guard offers "Open the verified copy" only when every file of the current release is stored with its sealed size
// and hash (lib/copy.ts); otherwise the popup and the warning page show a plain line instead of a dead button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fullCopy } from '../src/lib/copy.ts';
import type { SealedFile } from '../src/lib/types.ts';

const f = (path: string, n: number): SealedFile => ({ path, contentType: 'text/plain', sha256: `0x${String(n).repeat(64).slice(0, 64)}`, size: n * 10 });
const files = [f('index.html', 1), f('app.js', 2), f('style.css', 3)];
const stored = (x: SealedFile) => ({ size: x.size, sha256: x.sha256 });

test('every file stored with its sealed size and hash: complete', () => {
  assert.deepEqual(fullCopy(files, files.map(stored)), { complete: true, stored: 3, total: 3 });
});
test('a missing file, a wrong hash or a wrong size: not complete', () => {
  assert.deepEqual(fullCopy(files, [stored(files[0]!), null, stored(files[2]!)]), { complete: false, stored: 2, total: 3 });
  assert.equal(fullCopy(files, [stored(files[0]!), { ...stored(files[1]!), sha256: `0x${'f'.repeat(64)}` }, stored(files[2]!)]).complete, false);
  assert.equal(fullCopy(files, [stored(files[0]!), stored(files[1]!), { ...stored(files[2]!), size: 1 }]).complete, false);
});
test('hash compared case-insensitively; an empty release is never complete', () => {
  assert.equal(fullCopy(files, files.map((x) => ({ size: x.size, sha256: x.sha256.toUpperCase().replace('0X', '0x') as `0x${string}` }))).complete, true);
  assert.equal(fullCopy([], []).complete, false);
});
