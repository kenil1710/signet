import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alerterFromEnv, textOf, sendTestAlert } from '../src/alerts.ts';
import http from 'node:http';

test('without Telegram settings alerts go to the console only; a token without a chat id is said once', async () => {
  const lines: string[] = [];
  const a = alerterFromEnv({}, (l) => void lines.push(l));
  await a.send({ audience: 'private', title: 'ALERT: x', lines: ['one', 'two'] });
  assert.match(lines[0]!, /\[private\] ALERT: x$/);
  assert.deepEqual(lines.slice(1), ['    one', '    two']);
  const warn: string[] = [];
  alerterFromEnv({ TELEGRAM_BOT_TOKEN: '1:secret' }, (l) => void warn.push(l));
  assert.match(warn[0]!, /TELEGRAM_CHAT_ID is not/);
  assert.ok(!warn.join('').includes('secret'));
  assert.equal(textOf({ audience: 'public', title: 't', lines: ['a'] }), 't\na');
});

test('a Telegram failure does not break the round and does not print the token', async () => {
  const lines: string[] = [];
  const a = alerterFromEnv({ TELEGRAM_BOT_TOKEN: '1:secret', TELEGRAM_CHAT_ID: '5', TELEGRAM_API_URL: 'http://127.0.0.1:9' }, (l) => void lines.push(l));
  await a.send({ audience: 'private', title: 'ALERT', lines: [] });
  assert.ok(lines.some((l) => /Telegram could not be reached/.test(l)));
  assert.ok(!lines.join('').includes('secret'));
});

test('test alert: one labelled message to the private chat; false when Telegram rejects it or is missing; never prints the token', async () => {
  const got: { path: string; body: { chat_id: string; text: string } }[] = [];
  let reply = { status: 200, body: { ok: true } as Record<string, unknown> };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)).on('end', () => { got.push({ path: req.url!, body: JSON.parse(b) }); res.writeHead(reply.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply.body)); });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const env = { TELEGRAM_BOT_TOKEN: '1:secret', TELEGRAM_CHAT_ID: '5', TELEGRAM_API_URL: `http://127.0.0.1:${(srv.address() as { port: number }).port}` };
  try {
    const lines: string[] = [];
    assert.equal(await sendTestAlert(env, (l) => void lines.push(l), new Date('2026-11-20T13:45:00Z')), true);
    assert.equal(got[0]!.path, '/bot1:secret/sendMessage');
    assert.equal(got[0]!.body.chat_id, '5');
    assert.match(got[0]!.body.text, /^TEST: Signet watchtower alert\n.*2026-11-20 13:45 UTC.*Nothing is wrong\.$/s);
    reply = { status: 400, body: { ok: false, description: 'Bad Request: chat not found' } };
    assert.equal(await sendTestAlert(env, (l) => void lines.push(l)), false);
    assert.match(lines.at(-1)!, /HTTP 400 \(Bad Request: chat not found\)/);
    assert.equal(await sendTestAlert({ TELEGRAM_BOT_TOKEN: '1:secret' }, (l) => void lines.push(l)), false);
    assert.ok(!lines.join('\n').includes('secret'));
  } finally {
    srv.close();
  }
});
