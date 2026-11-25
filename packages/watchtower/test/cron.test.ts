// The watchtower's clock (cron/worker.ts): dispatches a round unless one is queued or running; fails loudly otherwise.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tick } from '../cron/worker.ts';

const env = { GH_TOKEN: 't', REPO: 'kenil1710/signet', WORKFLOW: 'watchtower.yml', REF: 'main' };
const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });
function fake(counts: Record<string, number>, dispatchStatus = 204) {
  const calls: { url: string; method: string; body?: string; auth?: string }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined, auth: (init.headers as Record<string, string>).authorization });
    if (url.endsWith('/dispatches')) return new Response(null, { status: dispatchStatus });
    const s = new URL(url).searchParams.get('status')!;
    return Response.json({ total_count: counts[s] ?? 0 });
  }) as typeof fetch;
  return calls;
}

test('nothing queued or running: dispatches the workflow on main', async () => {
  const calls = fake({});
  assert.equal(await tick(env), 'round dispatched');
  const d = calls.at(-1)!;
  assert.equal(d.url, 'https://api.github.com/repos/kenil1710/signet/actions/workflows/watchtower.yml/dispatches');
  assert.equal(d.method, 'POST');
  assert.deepEqual(JSON.parse(d.body!), { ref: 'main' });
  assert.equal(d.auth, 'Bearer t');
});
test('a round still running or queued: skips, no dispatch', async () => {
  for (const s of ['in_progress', 'queued']) {
    const calls = fake({ [s]: 1 });
    assert.match(await tick(env), /skipped/);
    assert.ok(!calls.some((c) => c.method === 'POST'));
  }
});
test('GitHub refuses the dispatch: throws (shows as an error in the Worker logs)', async () => {
  fake({}, 403);
  await assert.rejects(tick(env), /dispatch: HTTP 403/);
});
test('no token: dispatches nothing', async () => {
  const calls = fake({});
  assert.match(await tick({ ...env, GH_TOKEN: '' }), /no GH_TOKEN/);
  assert.equal(calls.length, 0);
});
