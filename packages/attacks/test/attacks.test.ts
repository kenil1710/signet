// The attack suite as a test (pnpm --filter @signet/attacks test:staging). It also rewrites docs/attack-report.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/suite.ts';

test('every attack against a Guard user is blocked, the user without Guard is not, and no clean session is blocked', { timeout: 30 * 60_000 }, async () => {
  const r = await run();
  assert.equal(r.falseBlocks, 0, `false blocks: ${r.falseBlocks}/${r.clean}`);
  assert.equal(r.blocked, r.total - 1, `blocked ${r.blocked}/${r.total}: only the user without Guard may get through`);
});
