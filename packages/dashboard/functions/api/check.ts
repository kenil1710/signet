// GET /api/check?domain=app.example.org: the free risk check (Cloudflare Pages Function, deployed with the site).
// Read-only and server-side, so the visitor's browser never contacts the checked site. Nothing is stored or logged:
// no cookies, no analytics. Results are cached per domain for 10 minutes; each client IP gets 10 checks per minute
// (best effort: the limit lives in one worker instance, not globally).
import { analyze, cleanDomain } from '../../src/check/risk.ts';

const hits = new Map<string, number[]>();
const LIMIT = 10;
const WINDOW_MS = 60_000;

function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // keep memory bounded
  return recent.length > LIMIT;
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra } });

export const onRequestGet = async (ctx: { request: Request; waitUntil(p: Promise<unknown>): void }): Promise<Response> => {
  const url = new URL(ctx.request.url);
  const domain = cleanDomain(url.searchParams.get('domain') ?? '');
  if (!domain) return json({ error: 'Enter a public domain, like app.example.org' }, 400);
  const ip = ctx.request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (limited(ip)) return json({ error: 'Too many checks from your address: try again in a minute' }, 429, { 'retry-after': '60' });
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(`https://signet-check.cache/${domain}`);
  const hit = await cache.match(key);
  if (hit) return json(await hit.json(), 200, { 'x-signet-cache': 'hit' });
  try {
    const report = await analyze(domain);
    ctx.waitUntil(cache.put(key, new Response(JSON.stringify(report), { headers: { 'cache-control': 'max-age=600' } })));
    return json(report);
  } catch (e) {
    return json({ error: `Couldn't load https://${domain}/: ${(e as Error).message}` }, 502);
  }
};
