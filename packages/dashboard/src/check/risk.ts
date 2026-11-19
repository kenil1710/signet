// The free risk check behind /check: what a front-end attacker could use on a site, from public information only.
// Runs server-side (functions/api/check.ts, a Cloudflare Pages Function) and in Node (tests). Read-only: one page
// load, its HTTP headers, /.well-known/signet.json, public DNS (DNS-over-HTTPS) and the registry's RDAP record.
// It never runs the site's JavaScript, so scripts added at runtime, chunks loaded later and what the page asks a
// wallet to sign are NOT seen; the report says so.

export type Level = 'ok' | 'warn' | 'risk' | 'info';
export interface Finding { level: Level; area: string; text: string }
export interface Report {
  domain: string;
  url: string;
  status: number;
  checkedAt: string;
  scripts: { src: string; origin: string; sri: boolean; sameOrigin: boolean }[];
  origins: string[];
  inlineScripts: number;
  headers: Record<string, string | null>;
  sealed: { gate: string } | null;
  dns: { ns: string[]; caa: string[]; dnssec: boolean | null } | null;
  registrar: { name: string | null; locked: boolean | null; expires: string | null } | null;
  findings: Finding[];
  cannotSee: string[];
}

export const CANNOT_SEE = [
  'Scripts added at runtime by JavaScript, and chunks loaded later (the page is not run)',
  'What the site asks a wallet to sign',
  'Whether the files served today are the files your team reviewed (that is what sealing a release proves)',
  'Your hosting, CDN and registrar account security (2FA, API keys)',
];
const SEC_HEADERS = ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'referrer-policy', 'x-frame-options', 'permissions-policy'];
const MAX_HTML = 2_000_000;

/// A public hostname only: no IP literals, ports, localhost or single labels (the check never fetches internal hosts).
export function cleanDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) return null;
  if (/^(localhost|.*\.local|.*\.internal|.*\.lan)$/.test(d)) return null;
  return d;
}

type Fetch = typeof fetch;

async function readCapped(r: Response, max: number): Promise<string> {
  if (!r.body) return '';
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    chunks.push(value);
    if (n >= max) {
      await reader.cancel();
      break;
    }
  }
  const all = new Uint8Array(Math.min(n, max));
  let o = 0;
  for (const c of chunks) {
    all.set(c.subarray(0, Math.min(c.length, all.length - o)), o);
    o += c.length;
    if (o >= all.length) break;
  }
  return new TextDecoder().decode(all);
}

const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : tag.match(new RegExp(`\\s${name}(\\s|>|/)`, 'i')) ? '' : null;
};

/// Script and stylesheet references in the HTML as served (no JavaScript run).
export function parseHtml(html: string, base: string) {
  const scripts: Report['scripts'] = [];
  const styles: { href: string; sri: boolean }[] = [];
  let inline = 0;
  const mixed: string[] = [];
  const baseOrigin = new URL(base).origin;
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attr(tag, 'src');
    if (src === null) {
      const type = (attr(tag, 'type') ?? '').toLowerCase();
      if (!type || /javascript|module/.test(type)) inline++;
      continue;
    }
    let u: URL;
    try { u = new URL(src, base); } catch { continue; }
    if (u.protocol === 'http:') mixed.push(u.href);
    scripts.push({ src: u.href, origin: u.origin, sri: !!attr(tag, 'integrity'), sameOrigin: u.origin === baseOrigin });
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    if (!/stylesheet|modulepreload|preload/.test(rel)) continue;
    const href = attr(tag, 'href');
    if (!href) continue;
    let u: URL;
    try { u = new URL(href, base); } catch { continue; }
    if (u.protocol === 'http:') mixed.push(u.href);
    if (u.origin !== baseOrigin) styles.push({ href: u.href, sri: !!attr(tag, 'integrity') });
  }
  for (const m of html.matchAll(/\s(?:src|href)\s*=\s*["']?(http:\/\/[^"'\s>]+)/gi)) if (!mixed.includes(m[1]!) && /\.(js|css|png|jpe?g|gif|svg|webp|woff2?)(\?|$)/i.test(m[1]!)) mixed.push(m[1]!);
  return { scripts, styles, inline, mixed };
}

async function dohJson(f: Fetch, name: string, type: string): Promise<{ Status: number; AD?: boolean; Answer?: { type: number; data: string }[] } | null> {
  try {
    const r = await f(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}&do=1`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(6000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/// The registrable domain, roughly: the last two labels (three for a few common two-level suffixes).
export function registrable(d: string): string {
  const p = d.split('.');
  const two = ['co.uk', 'com.au', 'co.jp', 'com.br', 'co.in', 'com.cn', 'com.sg', 'co.kr'];
  return p.length > 2 && two.includes(p.slice(-2).join('.')) ? p.slice(-3).join('.') : p.slice(-2).join('.');
}

// IANA's RDAP bootstrap (which registry answers for which TLD), fetched once per instance
let bootstrap: Promise<{ services: [string[], string[]][] } | null> | null = null;
const UA = { 'user-agent': 'SignetRiskCheck/1 (+https://signetguard.xyz/check)' };

async function rdap(f: Fetch, d: string): Promise<Report['registrar']> {
  try {
    bootstrap ??= f('https://data.iana.org/rdap/dns.json', { headers: UA, signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const b = await bootstrap;
    const name = registrable(d);
    const tld = name.split('.').pop()!;
    const base = b?.services.find(([tlds]) => tlds.includes(tld))?.[1][0];
    if (!base) return null;
    const r = await f(`${base.replace(/\/?$/, '/')}domain/${name}`, { headers: { accept: 'application/rdap+json', ...UA }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { status?: string[]; events?: { eventAction: string; eventDate: string }[]; entities?: { roles?: string[]; vcardArray?: [string, [string, unknown, string, string][]] }[] };
    const reg = j.entities?.find((e) => e.roles?.includes('registrar'));
    const fn = reg?.vcardArray?.[1]?.find((v) => v[0] === 'fn')?.[3] ?? null;
    const st = (j.status ?? []).map((s) => s.toLowerCase());
    return { name: fn, locked: st.length ? st.some((s) => s.includes('client transfer prohibited')) : null, expires: j.events?.find((e) => e.eventAction === 'expiration')?.eventDate ?? null };
  } catch {
    return null;
  }
}

export async function analyze(domainInput: string, f: Fetch = fetch, opts: { origin?: string } = {}): Promise<Report> {
  const domain = cleanDomain(domainInput);
  if (!domain) throw new Error('Enter a public domain, like app.example.org');
  const start = opts.origin ?? `https://${domain}`;
  const findings: Finding[] = [];
  // 1. the page as served (follow up to 5 redirects, stay on https)
  let url = `${start}/`;
  let res: Response | null = null;
  for (let i = 0; i < 6; i++) {
    res = await f(url, { redirect: 'manual', headers: { 'user-agent': 'SignetRiskCheck/1 (+https://signetguard.xyz/check)', accept: 'text/html' }, signal: AbortSignal.timeout(10000) });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      const next = new URL(loc, url);
      if (next.protocol !== 'https:' && !opts.origin) {
        findings.push({ level: 'risk', area: 'Transport', text: `Redirects to ${next.protocol}// (not encrypted): ${next.href}` });
        break;
      }
      url = next.href;
      continue;
    }
    break;
  }
  if (!res) throw new Error('No response');
  const html = (res.headers.get('content-type') ?? '').includes('html') ? await readCapped(res, MAX_HTML) : '';
  const headers: Report['headers'] = Object.fromEntries(SEC_HEADERS.map((h) => [h, res!.headers.get(h)]));
  const p = parseHtml(html, url);
  const baseOrigin = new URL(url).origin;
  const origins = [...new Set([...p.scripts.filter((s) => !s.sameOrigin).map((s) => s.origin), ...p.styles.map((s) => new URL(s.href).origin)])].sort();

  // 2. findings
  if (res.status >= 400) findings.push({ level: 'warn', area: 'Page', text: `The page answered HTTP ${res.status}` });
  const ext = p.scripts.filter((s) => !s.sameOrigin);
  const noSri = ext.filter((s) => !s.sri);
  if (ext.length === 0) findings.push({ level: 'ok', area: 'Scripts', text: 'No scripts from other origins in the HTML' });
  else findings.push({ level: noSri.length ? 'risk' : 'ok', area: 'Scripts', text: `${ext.length} script(s) from ${new Set(ext.map((s) => s.origin)).size} other origin(s); ${noSri.length ? `${noSri.length} without SRI (integrity), so whoever controls ${[...new Set(noSri.map((s) => new URL(s.src).host))].join(', ')} can change the site's code` : 'all with SRI'}` });
  const cssNoSri = p.styles.filter((s) => !s.sri);
  if (cssNoSri.length) findings.push({ level: 'warn', area: 'Styles', text: `${cssNoSri.length} stylesheet(s) or preloaded file(s) from ${[...new Set(cssNoSri.map((x) => new URL(x.href).host))].join(', ')} without SRI` });
  if (p.inline) findings.push({ level: 'info', area: 'Scripts', text: `${p.inline} inline script(s) in the HTML` });
  if (p.mixed.length) findings.push({ level: 'risk', area: 'Mixed content', text: `${p.mixed.length} resource(s) over plain http://, e.g. ${p.mixed[0]}` });
  const csp = headers['content-security-policy'];
  if (!csp) findings.push({ level: 'warn', area: 'Headers', text: 'No Content-Security-Policy: an injected script can load from anywhere and send data anywhere' });
  else {
    const weak = [/script-src[^;]*'unsafe-eval'/.test(csp) && "'unsafe-eval' in script-src", /script-src[^;]*(\s|^)\*(\s|;|$)/.test(csp) && 'a wildcard * in script-src', !/script-src|default-src/.test(csp) && 'no script-src or default-src'].filter(Boolean);
    findings.push({ level: weak.length ? 'warn' : 'ok', area: 'Headers', text: weak.length ? `Content-Security-Policy present, but with ${weak.join(', ')}` : 'Content-Security-Policy present' });
  }
  if (!headers['strict-transport-security']) findings.push({ level: 'warn', area: 'Headers', text: 'No Strict-Transport-Security (HSTS): a first visit can be downgraded to http' });
  if (!headers['x-content-type-options']) findings.push({ level: 'info', area: 'Headers', text: 'No X-Content-Type-Options: nosniff' });
  if (!headers['x-frame-options'] && !(csp ?? '').includes('frame-ancestors')) findings.push({ level: 'info', area: 'Headers', text: 'The page can be framed by any site (no X-Frame-Options or frame-ancestors)' });

  // 3. sealed by Signet?
  let sealed: Report['sealed'] = null;
  try {
    const r = await f(`${baseOrigin}/.well-known/signet.json`, { redirect: 'error', signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const j = JSON.parse((await readCapped(r, 4096)) || '{}') as { signet?: number; gate?: string };
      if (j.signet === 1 && typeof j.gate === 'string' && /^0x[0-9a-fA-F]{40}$/.test(j.gate)) sealed = { gate: j.gate };
    }
  } catch { /* not sealed */ }
  findings.push(sealed
    ? { level: 'ok', area: 'Releases', text: `Sealed with Signet: the domain names gate ${sealed.gate} (check its releases on the dashboard)` }
    : { level: 'warn', area: 'Releases', text: 'Releases are not sealed: neither the team nor its users can tell if the files served today are the ones the team shipped' });

  // 4. DNS and registrar hints (public data; best effort)
  let dns: Report['dns'] = null;
  let registrar: Report['registrar'] = null;
  if (!opts.origin) {
    const zone = registrable(domain);
    const [ns, caa, a] = await Promise.all([dohJson(f, zone, 'NS'), dohJson(f, zone, 'CAA'), dohJson(f, domain, 'A')]);
    dns = { ns: (ns?.Answer ?? []).filter((x) => x.type === 2).map((x) => x.data.replace(/\.$/, '')), caa: (caa?.Answer ?? []).filter((x) => x.type === 257).map((x) => x.data), dnssec: a ? !!a.AD : null };
    if (dns.dnssec === false) findings.push({ level: 'info', area: 'DNS', text: 'DNSSEC is not validated for this name' });
    if (caa && !dns.caa.length) findings.push({ level: 'info', area: 'DNS', text: 'No CAA record: any certificate authority may issue certificates for the domain' });
    registrar = await rdap(f, domain);
    if (registrar?.locked === false) findings.push({ level: 'warn', area: 'Registrar', text: 'No registrar transfer lock (clientTransferProhibited): a hijacked registrar account can move the domain' });
    if (registrar?.locked) findings.push({ level: 'ok', area: 'Registrar', text: `Transfer lock on${registrar.name ? ` (registrar: ${registrar.name})` : ''}` });
  }
  return { domain, url, status: res.status, checkedAt: new Date().toISOString(), scripts: p.scripts, origins, inlineScripts: p.inline, headers, sealed, dns, registrar, findings, cannotSee: CANNOT_SEE };
}
