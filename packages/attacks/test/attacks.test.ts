// The attack suite as a test (pnpm --filter @signet/attacks test:staging). It also rewrites docs/attack-report.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/suite.ts';

test('every attack against a Guard user is blocked, no clean session is blocked, and the user without Guard is reported as not protected', { timeout: 30 * 60_000 }, async () => {
  const r = await run();
  assert.equal(r.falseBlocks, 0, `false blocks: ${r.falseBlocks}/${r.clean}`);
  assert.equal(r.blocked, r.total, `blocked ${r.blocked}/${r.total} attacks against Guard users`);
  assert.equal(r.limitsNotProtected, 1, 'the user-without-Guard case is reported (not hidden)');
});
