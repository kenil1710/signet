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
