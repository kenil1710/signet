// Guard offers "Open the verified copy" only when every file of the current release is stored with its sealed size
// and hash (lib/copy.ts); otherwise the popup and the warning page show a plain line instead of a dead button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyOffer, fullCopy } from '../src/lib/copy.ts';
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

// One rule for the popup, the warning page and the refusal notice: no gateway is deployed yet, so the copy is "coming soon",
// so Guard shows a button only for a copy the wallet can use (a gateway, and every file stored).
test('copyOffer: a button only with a gateway and a complete copy; otherwise "Verified copy: coming soon"', () => {
  assert.deepEqual(copyOffer({ complete: true, stored: 3, total: 3, gateway: true }), { button: true, text: 'Open the verified copy', title: 'A copy of the sealed release, read from X Layer, every file hash-checked.' });
  const noGateway = copyOffer({ complete: true, stored: 3, total: 3, gateway: false });
  assert.deepEqual([noGateway.button, noGateway.text], [false, 'Verified copy: coming soon']);
  assert.match(noGateway.title, /gateway, which isn't deployed yet/);
  const partial = copyOffer({ complete: false, stored: 1, total: 3, gateway: true });
  assert.deepEqual([partial.button, partial.text, partial.title], [false, 'Verified copy: coming soon', "This release isn't stored on X Layer in full (1 of 3 files)."]);
  assert.deepEqual([copyOffer(null).button, copyOffer(null).text], [false, 'Verified copy: coming soon']);
  assert.equal(copyOffer({ complete: true, stored: 3, total: 3 }).button, false, 'an older answer without the gateway flag: no button');
});
