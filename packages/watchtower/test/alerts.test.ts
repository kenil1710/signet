import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alerterFromEnv, textOf } from '../src/alerts.ts';

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
