// Where the watchtower speaks. Always the console; Telegram too when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are
// set. "private" messages are for the team (a site mismatch); "public" ones are facts already on-chain (a new
// domain, a pending tier-10/11 change) and go to TELEGRAM_PUBLIC_CHAT_ID when set, else to the same chat.
export type Audience = 'private' | 'public';
export interface Message { audience: Audience; title: string; lines: string[] }
export interface Alerter { send(m: Message): Promise<void> }

export const textOf = (m: Message) => [m.title, ...m.lines].join('\n');

export function consoleAlerter(log: (line: string) => void = console.log): Alerter {
  return {
    async send(m) {
      log(`[${new Date().toISOString()}] [${m.audience}] ${m.title}`);
      for (const l of m.lines) log(`    ${l}`);
    },
  };
}

export interface TelegramConfig { token: string; chatId: string; publicChatId?: string; apiUrl?: string }

/// Telegram Bot API, sendMessage. The token is part of the URL: it is never logged, and errors name only the status.
export function telegramAlerter(c: TelegramConfig, log: (line: string) => void = console.log): Alerter {
  const api = (c.apiUrl ?? 'https://api.telegram.org').replace(/\/$/, '');
  return {
    async send(m) {
      const chat_id = m.audience === 'public' ? (c.publicChatId ?? c.chatId) : c.chatId;
      try {
        const res = await fetch(`${api}/bot${c.token}/sendMessage`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id, text: textOf(m).slice(0, 4000), disable_web_page_preview: true }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) log(`    (Telegram did not accept the message: HTTP ${res.status})`);
      } catch {
        log('    (Telegram could not be reached; the alert is only on the console)');
      }
    },
  };
}

export function allOf(...alerters: Alerter[]): Alerter {
  return { send: async (m) => void (await Promise.all(alerters.map((a) => a.send(m)))) };
}

export function alerterFromEnv(env: NodeJS.ProcessEnv = process.env, log: (line: string) => void = console.log): Alerter {
  const out = [consoleAlerter(log)];
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    out.push(telegramAlerter({ token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID, publicChatId: env.TELEGRAM_PUBLIC_CHAT_ID || undefined, apiUrl: env.TELEGRAM_API_URL || undefined }, log));
  } else if (env.TELEGRAM_BOT_TOKEN) log('TELEGRAM_BOT_TOKEN is set but TELEGRAM_CHAT_ID is not: alerts go to the console only.');
  return allOf(...out);
}

/// One labelled test message to the private Telegram chat, through the same Bot API call as real alerts, so a team
/// can confirm alerts arrive. Returns false (and says why, never printing the token or chat id) if Telegram isn't
/// configured, can't be reached or rejects the message.
export async function sendTestAlert(env: NodeJS.ProcessEnv = process.env, log: (line: string) => void = console.log, now = new Date()): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    log('Test alert: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must both be set.');
    return false;
  }
  const api = (env.TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/$/, '');
  const m: Message = { audience: 'private', title: 'TEST: Signet watchtower alert', lines: [`This is a test message, sent on request at ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC.`, 'If you can read it, real alerts (a site that stops matching its sealed release) will reach this chat. Nothing is wrong.'] };
  try {
    const res = await fetch(`${api}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: textOf(m), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (res.ok && body.ok) { log('Test alert: Telegram accepted the message.'); return true; }
    // Telegram's description names the problem ("chat not found", "Unauthorized"), never the token
    log(`Test alert: Telegram did not accept the message: HTTP ${res.status}${body.description ? ` (${body.description.replaceAll(env.TELEGRAM_BOT_TOKEN, '***')})` : ''}`);
  } catch {
    log('Test alert: Telegram could not be reached.');
  }
  return false;
}
