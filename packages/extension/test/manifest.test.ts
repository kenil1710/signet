// Guard 0.3.8: the built manifest lists 16/32/48/128 icons (the Chrome Web Store asks for a 128 px icon) and every
// listed file is in the build, a PNG of that size. Builds the mainnet extension into a temporary folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('the manifest lists 16/32/48/128 icons and each is a PNG of that size in the build', () => {
  const out = mkdtempSync(join(tmpdir(), 'guard-build-'));
  const r = spawnSync(process.execPath, [join(root, 'scripts/build.mjs')], { encoding: 'utf8', env: { ...process.env, SIGNET_NETWORK: 'mainnet', GUARD_OUT: out } });
  assert.equal(r.status, 0, r.stderr);
  const dir = existsSync(join(out, 'manifest.json')) ? out : join(root, 'dist');
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(m.icons).sort((a, b) => Number(a) - Number(b)), ['16', '32', '48', '128']);
  assert.deepEqual(Object.keys(m.action.default_icon).sort(), ['16', '32']);
  for (const [size, file] of Object.entries(m.icons) as [string, string][]) {
    const png = readFileSync(join(dir, file));
    assert.equal(png.subarray(1, 4).toString(), 'PNG', file);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [Number(size), Number(size)], file);
  }
});
