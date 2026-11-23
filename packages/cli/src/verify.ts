// `signet verify <buildDir|url>`: will Guard be able to check this site?
//   error   Guard can't protect the page as it is (the command exits 1)
//   warn    it works, with a gap the team should close
// Build dir: static build, SRI on cross-origin scripts, SSR markers, CDN-rewrite markers, on-chain limits.
// URL: the same on the served HTML, plus Cache-Control: no-store on HTML and scripts, HTML that changes between
// requests (SSR), and with --build a byte comparison of what is served against the sealed build.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex } from './merkle.ts';
import { walk, tagsOf, externalScriptsOf, isOnchainPath, MAX_ONCHAIN_BYTES, MANIFEST_NAME } from './seal.ts';

export type Level = 'ok' | 'info' | 'warn' | 'error';
export interface Finding { level: Level; code: string; message: string; fix?: string }
export interface Report { target: string; findings: Finding[]; errors: number; warnings: number }

function report(target: string, findings: Finding[]): Report {
  return { target, findings, errors: findings.filter((f) => f.level === 'error').length, warnings: findings.filter((f) => f.level === 'warn').length };
}

const SRI_FIX = 'Self-host the script, or add integrity="sha384-..." crossorigin="anonymous" (openssl dgst -sha384 -binary file.js | openssl base64 -A).';
const NO_STORE_FIX = 'Serve HTML with "Cache-Control: no-cache" (revalidate every time) and hashed assets with "Cache-Control: public, max-age=31536000, immutable".';

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 signet-verify';

/// CDN features that rewrite HTML or scripts after the build, so the served bytes stop matching the sealed hash.
const REWRITES: { re: RegExp; what: string; fix: string }[] = [
  { re: /rocket-loader(\.min)?\.js|type=["'][0-9a-f]+-text\/javascript["']|data-cf-settings=/i, what: 'Cloudflare Rocket Loader rewrites every <script> tag', fix: 'Cloudflare dashboard: Speed > Optimization > turn Rocket Loader off.' },
  { re: /\/cdn-cgi\/l\/email-protection|__cf_email__|email-decode(\.min)?\.js/i, what: 'Cloudflare Email Obfuscation rewrites the HTML', fix: 'Cloudflare dashboard: Scrape Shield > turn Email Address Obfuscation off.' },
  { re: /static\.cloudflareinsights\.com\/beacon(\.min)?\.js/i, what: 'Cloudflare Web Analytics injects a script into the HTML', fix: 'Turn off automatic injection (Web Analytics > Manage site), or add the snippet to your build so it is sealed.' },
  { re: /\/_vercel\/insights\/script\.js|va\.vercel-scripts\.com/i, what: 'Vercel Web Analytics adds a script to the page', fix: 'Vercel dashboard: Project > Analytics > disable (and remove @vercel/analytics from the app), or seal it as part of your build.' },
  { re: /\/_vercel\/speed-insights\/script\.js/i, what: 'Vercel Speed Insights adds a script to the page', fix: 'Vercel dashboard: Project > Speed Insights > disable (and remove @vercel/speed-insights from the app).' },
  { re: /vercel\.live\/_next-live|data-vercel-toolbar|\/_vercel\/toolbar/i, what: 'The Vercel Toolbar is injected into the page', fix: 'Vercel dashboard: Project > Settings > General > Vercel Toolbar: off for Production (and for Preview if you seal from a preview).' },
  { re: /\/cdn-cgi\/(scripts|challenge-platform)\//i, what: 'Cloudflare injects a /cdn-cgi/ script (bot or challenge feature)', fix: 'Turn off Bot Fight Mode / JavaScript detections for this hostname.' },
  { re: /cdn-cgi\/mirage|data-cfsrc=/i, what: 'Cloudflare Mirage rewrites <img> tags', fix: 'Cloudflare dashboard: Speed > Optimization > turn Mirage off.' },
  { re: /<!--\s*(Optimized|Minified) (by|with) /i, what: 'An optimizer rewrote this HTML', fix: 'Turn off HTML minification / optimization at the CDN; minify in your build instead.' },
];

function checkHtml(html: string, page: string, siteOrigin: string, out: Finding[]): void {
  const external = externalScriptsOf(html, page, siteOrigin);
  for (const s of external) {
    if (s.integrity) out.push({ level: 'ok', code: 'sri', message: `${page}: cross-origin script ${s.url} has an integrity attribute` });
    else out.push({ level: 'error', code: 'sri-missing', message: `${page}: cross-origin script without SRI: ${s.url}`, fix: SRI_FIX });
  }
  for (const l of tagsOf(html, 'link')) {
    const href = l.attrs.href;
    const rel = typeof l.attrs.rel === 'string' ? l.attrs.rel.toLowerCase() : '';
    if (typeof href !== 'string' || !/^(https?:)?\/\//i.test(href) || !/stylesheet|modulepreload/.test(rel)) continue;
    try {
      if (new URL(href.startsWith('//') ? `https:${href}` : href).origin === siteOrigin) continue;
    } catch { continue; }
    if (typeof l.attrs.integrity !== 'string') {
      const script = rel.includes('modulepreload');
      out.push({ level: script ? 'error' : 'warn', code: 'sri-missing', message: `${page}: cross-origin ${script ? 'module' : 'stylesheet'} without SRI: ${href}`, fix: SRI_FIX });
    }
  }
  for (const r of REWRITES) if (r.re.test(html)) out.push({ level: 'warn', code: 'cdn-rewrite', message: `${page}: ${r.what}`, fix: r.fix });
  if (tagsOf(html, 'script').some((t) => typeof t.attrs.nonce === 'string' && t.attrs.nonce.length > 0)) {
    out.push({ level: 'warn', code: 'ssr', message: `${page}: scripts carry a per-request nonce, so the HTML changes on every request`, fix: 'Signet v1 seals static builds. Use hash-based CSP instead of nonces, or export the page statically.' });
  }
  if (/"(gssp|gip|appGip)"\s*:\s*true/.test(html)) {
    out.push({ level: 'warn', code: 'ssr', message: `${page}: Next.js server-side rendering (getServerSideProps / getInitialProps)`, fix: 'Use static export (output: "export") for the pages users sign from.' });
  }
}

export function verifyDir(dir: string, domain = 'localhost'): Report {
  const out: Finding[] = [];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`${dir} is not a directory`);
  const files = walk(dir);
  const htmls = files.filter((f) => /\.html?$/i.test(f));
  if (files.includes('index.html')) out.push({ level: 'ok', code: 'static', message: `static build: index.html and ${files.length} files` });
  else out.push({ level: 'error', code: 'static', message: 'no index.html at the top of the build directory', fix: 'Point signet at the static output (Vite: dist, Next export: out, CRA: build).' });
  const server = files.filter((f) => /^(\.next\/|server\/|functions\/|\.vercel\/output\/functions\/)|(^|\/)_worker\.js$/.test(f));
  if (server.length > 0) out.push({ level: 'warn', code: 'ssr', message: `server code in the build (${server[0]}${server.length > 1 ? ` and ${server.length - 1} more` : ''}): this looks like an SSR build`, fix: 'Signet v1 seals static builds (SPA/SSG). Export the pages users sign from statically.' });
  for (const h of htmls) checkHtml(readFileSync(join(dir, h), 'utf8'), h, `https://${domain}`, out);
  const big = files.filter((f) => statSync(join(dir, f)).size > MAX_ONCHAIN_BYTES);
  if (big.length > 0) out.push({ level: 'info', code: 'size', message: `${big.length} file(s) over ${MAX_ONCHAIN_BYTES} bytes are sealed by hash but can't be stored on-chain for the verified copy (largest: ${big.sort((a, b) => statSync(join(dir, b)).size - statSync(join(dir, a)).size)[0]})` });
  const bad = files.filter((f) => !isOnchainPath(f));
  if (bad.length > 0) out.push({ level: 'warn', code: 'path', message: `${bad.length} file path(s) with spaces or non-ASCII characters can't be stored on-chain (first: "${bad[0]}")`, fix: 'Rename them to plain ASCII without spaces.' });
  out.push({ level: 'info', code: 'headers', message: 'Cache-Control and CDN rewrites can only be checked on the live site: signet verify https://your-domain --build ' + dir });
  return report(dir, out);
}

async function get(url: string): Promise<{ status: number; headers: Headers; body: Buffer; finalUrl: string }> {
  // The decoded body is what Guard hashes, so gzip/brotli don't matter. No cookies, no referrer, generic client name.
  // A browser's user agent and Accept header: some CDN features (Cloudflare Web Analytics' automatic setup) inject
  // scripts into the HTML only for browsers, so a bot user agent would get clean bytes and miss them.
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': BROWSER_UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'cache-control': 'no-cache' } });
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()), finalUrl: res.url };
}

export async function verifyUrl(url: string, opts: { build?: string } = {}): Promise<Report> {
  const out: Finding[] = [];
  const page = await get(url);
  const base = new URL(page.finalUrl);
  if (page.status !== 200) out.push({ level: 'error', code: 'http', message: `${url} answered HTTP ${page.status}` });
  if (new URL(url).origin !== base.origin) out.push({ level: 'info', code: 'redirect', message: `redirected to ${base.origin}: seal and bind that domain` });
  const html = page.body.toString('utf8');
  const cc = (h: Headers) => (h.get('cache-control') ?? '').toLowerCase();

  if (cc(page.headers).includes('no-store')) out.push({ level: 'warn', code: 'no-store', message: `HTML is served with Cache-Control: ${cc(page.headers)}. Guard can't read it from the browser cache and can only mark it "unverified"`, fix: NO_STORE_FIX });
  else out.push({ level: 'ok', code: 'no-store', message: `HTML Cache-Control: ${cc(page.headers) || '(none)'}` });
  checkHtml(html, base.pathname, base.origin, out);

  // SSR: static HTML is byte-identical on every request
  const again = await get(page.finalUrl);
  const dynamic = sha256Hex(again.body) !== sha256Hex(page.body);
  if (dynamic) out.push({ level: 'warn', code: 'ssr', message: 'the HTML differs between two requests (server-side rendering, per-request tokens or a CDN that injects content)', fix: 'Signet v1 seals static builds. Serve the same bytes to everyone, or seal a static export.' });
  else out.push({ level: 'ok', code: 'ssr', message: 'the HTML is byte-identical across two requests' });
  if (page.headers.get('set-cookie')) out.push({ level: 'warn', code: 'ssr', message: 'the HTML response sets a cookie: this usually means per-user HTML', fix: 'Set cookies from an API route, not on the page itself.' });

  // same-origin scripts and styles: no-store, and (with --build) the bytes
  const assets = new Map<string, string>(); // url -> build path
  const add = (ref: unknown) => {
    if (typeof ref !== 'string' || ref.startsWith('data:')) return;
    try {
      const u = new URL(ref, base);
      if (u.origin === base.origin) assets.set(u.origin + u.pathname + u.search, decodeURIComponent(u.pathname.replace(/^\//, '')));
    } catch { /* ignore */ }
  };
  for (const t of tagsOf(html, 'script')) add(t.attrs.src);
  for (const t of tagsOf(html, 'link')) if (typeof t.attrs.rel === 'string' && /stylesheet|modulepreload/i.test(t.attrs.rel)) add(t.attrs.href);

  const sealedFile = (path: string): Buffer | null => (opts.build && existsSync(join(opts.build, path)) ? readFileSync(join(opts.build, path)) : null);
  const compare = (label: string, served: Buffer, path: string) => {
    if (!opts.build) return;
    const local = sealedFile(path);
    if (!local) out.push({ level: 'error', code: 'not-sealed', message: `${label} is loaded by the page but is not in the build`, fix: 'Guard blocks scripts that are not in the sealed release. Deploy exactly the sealed build.' });
    else if (sha256Hex(local) === sha256Hex(served)) out.push({ level: 'ok', code: 'bytes', message: `${label} matches the build byte for byte` });
    else out.push({ level: 'error', code: 'cdn-rewrite', message: `${label} is not the file from the build (${served.length} bytes served, ${local.length} in the build): something rewrites it on the way (minify, injection, an old deploy)`, fix: 'Turn off HTML/JS rewriting at the CDN and redeploy the sealed build.' });
  };
  let htmlPath = decodeURIComponent(base.pathname.replace(/^\//, ''));
  if (htmlPath === '' || htmlPath.endsWith('/')) htmlPath += 'index.html';
  if (!dynamic) compare('the HTML', page.body, htmlPath);

  const noStore: string[] = [];
  for (const [assetUrl, path] of assets) {
    try {
      const a = await get(assetUrl);
      if (a.status !== 200) {
        if (opts.build && !sealedFile(path)) compare(path, a.body, path); // referenced by the page, not in the build
        else out.push({ level: 'error', code: 'http', message: `${path} answered HTTP ${a.status}` });
        continue;
      }
      if (cc(a.headers).includes('no-store')) noStore.push(path);
      compare(path, a.body, path);
    } catch (e) {
      out.push({ level: 'warn', code: 'http', message: `${path} could not be fetched (${(e as Error).message})` });
    }
  }
  if (noStore.length > 0) out.push({ level: 'warn', code: 'no-store', message: `${noStore.length} script/style file(s) are served with Cache-Control: no-store (${noStore.slice(0, 3).join(', ')}${noStore.length > 3 ? ', ...' : ''}). Guard can only mark them "unverified"`, fix: NO_STORE_FIX });
  else if (assets.size > 0) out.push({ level: 'ok', code: 'no-store', message: `${assets.size} same-origin script/style file(s), none served with no-store` });
  if (opts.build && !existsSync(join(opts.build, MANIFEST_NAME))) out.push({ level: 'info', code: 'seal', message: `${opts.build} is not sealed yet: signet seal ${opts.build}` });
  if (/cloudflare/i.test(page.headers.get('server') ?? '')) out.push({ level: 'info', code: 'cdn', message: 'served through Cloudflare: keep Rocket Loader, Email Obfuscation, Mirage and Auto Minify off for this hostname' });
  return report(url, out);
}

export function formatReport(r: Report): string {
  const mark: Record<Level, string> = { ok: '  ok   ', info: '  info ', warn: '  WARN ', error: '  FAIL ' };
  const lines = [`signet verify ${r.target}`];
  for (const f of r.findings) {
    lines.push(`${mark[f.level]} ${f.message}`);
    if (f.fix) lines.push(`         fix: ${f.fix}`);
  }
  lines.push(r.errors > 0 ? `Result: ${r.errors} problem(s) to fix, ${r.warnings} warning(s).` : r.warnings > 0 ? `Result: usable, with ${r.warnings} warning(s).` : 'Result: ready to seal.');
  return lines.join('\n');
}
