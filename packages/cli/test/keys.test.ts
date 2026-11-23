// The CI proposer key: `keygen` writes it with a trailing newline into a git-ignored folder; a GitHub secret set from
// that file (`gh secret set SIGNET_PROPOSER_KEY < .signet/proposer.key`) keeps the newline, and must still work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeCtx, newKeyFile, signerFor, statePath, addressOfKeyFile } from '../src/chain.ts';

test('a proposer key from the environment works with the trailing newline of its key file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'signet-keys-'));
  const file = statePath(dir, 'proposer.key');
  assert.equal(readFileSync(join(dir, '.signet/.gitignore'), 'utf8'), '*\n', 'the key folder is git-ignored');
  const address = newKeyFile(file);
  assert.equal(addressOfKeyFile(file), address);
  const content = readFileSync(file, 'utf8');
  assert.ok(content.endsWith('\n'));
  const NAME = 'SIGNET_TEST_PROPOSER_KEY';
  try {
    for (const v of [content, `${content.trim()}\r\n`, `  ${content}`]) {
      process.env[NAME] = v;
      const s = await signerFor(makeCtx(dir), [NAME]);
      assert.equal(s.address, address);
    }
    process.env[NAME] = 'not a key\n';
    await assert.rejects(signerFor(makeCtx(dir), [NAME]), /not a 32-byte hex private key/);
  } finally {
    delete process.env[NAME];
  }
});
