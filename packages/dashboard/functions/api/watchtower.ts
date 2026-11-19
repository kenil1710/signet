// GET /api/watchtower: the watchtower's public status.json (from the `watchtower-status` branch), served from this
// site so the dashboard talks to no extra origin. Cached for 60 s; 404 until the repository is public.
const SOURCE = 'https://raw.githubusercontent.com/kenil1710/signet/watchtower-status/status.json';

export const onRequestGet = async (): Promise<Response> => {
  try {
    const r = await fetch(SOURCE, { cf: { cacheTtl: 60, cacheEverything: true } } as RequestInit);
    if (!r.ok) return new Response(JSON.stringify({ error: 'no public status yet' }), { status: 404, headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' } });
    return new Response(await r.text(), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60', 'x-content-type-options': 'nosniff' } });
  } catch {
    return new Response(JSON.stringify({ error: 'status unavailable' }), { status: 502, headers: { 'content-type': 'application/json' } });
  }
};
