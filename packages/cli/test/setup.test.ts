// signet init (setup): the workflow and the proof headers it writes for each host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { workflow, proofHeaders, HOSTS } from '../src/setup.ts';

test('every host: the workflow builds, seals, proposes, waits with --publish, and deploys the sealed folder', () => {
  for (const h of HOSTS) {
    const y = workflow(h, { build: 'npm ci && npm run build', out: 'dist' });
    assert.match(y, /signet verify dist && signet seal dist && signet propose dist --reuse/, h);
    assert.match(y, /signet wait dist --publish/, h);
    assert.ok(y.indexOf('signet wait') < y.lastIndexOf('deploy'), `${h}: deploy comes after wait`);
    assert.doesNotMatch(y, /\t/, `${h}: no tabs in YAML`);
  }
  assert.match(workflow('cloudflare', { build: 'b', out: 'dist' }), /wrangler@4 pages deploy dist/);
  assert.match(workflow('netlify', { build: 'b', out: 'dist' }), /netlify-cli@17 deploy --dir=dist --prod --no-build/);
  assert.match(workflow('vercel', { build: 'b', out: 'dist' }), /vercel@39 deploy dist --prod/);
  const gp = workflow('github-pages', { build: 'b', out: 'dist' });
  assert.match(gp, /pages: write/); assert.match(gp, /upload-pages-artifact@v3\n        with:\n          path: dist/); assert.match(gp, /deploy-pages@v4/);
  assert.match(workflow('other', { build: 'b', out: 'out', deploy: 'rsync -a out/ host:/srv' }), /run: rsync -a out\/ host:\/srv/);
});

test('the proof header, in each host\'s format, without clobbering what is there', () => {
  const log = () => {};
  const d1 = mkdtempSync(join(tmpdir(), 'sg-h-'));
  writeFileSync(join(d1, '_headers'), '/*\n  X-Frame-Options: DENY\n');
  proofHeaders('cloudflare', d1, log); proofHeaders('cloudflare', d1, log); // twice: written once
  const h = readFileSync(join(d1, '_headers'), 'utf8');
  assert.match(h, /X-Frame-Options: DENY/);
  assert.equal(h.match(/\/\.well-known\/signet\.json\n  Access-Control-Allow-Origin: \*/g)?.length, 1);
  const d2 = mkdtempSync(join(tmpdir(), 'sg-h-'));
  writeFileSync(join(d2, 'vercel.json'), JSON.stringify({ cleanUrls: true }));
  proofHeaders('vercel', d2, log);
  const v = JSON.parse(readFileSync(join(d2, 'vercel.json'), 'utf8'));
  assert.equal(v.cleanUrls, true);
  assert.deepEqual(v.headers, [{ source: '/.well-known/signet.json', headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }] }]);
  const d3 = mkdtempSync(join(tmpdir(), 'sg-h-'));
  proofHeaders('github-pages', d3, log);
  assert.ok(existsSync(join(d3, '.nojekyll')));
});
