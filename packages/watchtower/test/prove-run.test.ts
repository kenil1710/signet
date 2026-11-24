// The watchtower keeps the last finished /prove run for the public status (shown at once on /prove, dated).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { proveRun } from '../src/watchtower.ts';

const PAGE = (delay: number) => `<!doctype html><div id="app"><ul id="rows"></ul><p id="sum">running…</p></div><script>
setTimeout(() => {
  document.getElementById('rows').innerHTML = '<li class="claim"><span class="st PASS">Verified</span><div class="what">Circuit  #6 truth table</div><div class="detail">all 512 rows</div></li><li class="claim"><span class="st FAIL">Failed</span><div class="what">x.org files</div><div class="detail">differ</div></li>';
  document.getElementById('sum').textContent = '1 check(s) FAILED.';
  document.getElementById('app').dataset.proveDone = '123';
}, ${delay});</script>`;
let srv: Server; let b: Browser; let base = '';
before(async () => {
  srv = createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end(PAGE(q.url?.includes('slow') ? 5000 : 50)); }).listen(0);
  base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  b = await chromium.launch();
});
after(async () => { await b?.close(); srv?.close(); });

test('a finished /prove run: its block, summary and every row with its status', async () => {
  const r = await proveRun(b, `${base}/fast`);
  assert.ok(!('error' in r));
  assert.equal(r.block, '123');
  assert.equal(r.summary, '1 check(s) FAILED.');
  assert.deepEqual(r.rows, [{ claim: 'Circuit #6 truth table', detail: 'all 512 rows', status: 'PASS' }, { claim: 'x.org files', detail: 'differ', status: 'FAIL' }]);
  assert.ok(Date.now() - Date.parse(r.checkedAt) < 60_000);
});

test('a run that does not finish in time is not recorded', async () => {
  const r = await proveRun(b, `${base}/slow`, 500);
  assert.ok('error' in r);
});
