// The Vercel protection-bypass secret goes ONLY to the staged deployment's own origin: never to a third-party origin
// the page loads, never across a redirect to another origin (CLI 0.2.0 sent it on every request in --crawl-browser).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { crawl, crawlBrowser, bypassFor, BYPASS_HEADER } from '../src/crawl.ts';

const SECRET = 'test-bypass-secret-0123456789';
type Seen = { url: string; bypass: string | undefined }[];

async function server(handler: (req: IncomingMessage, res: any) => void): Promise<{ url: string; seen: Seen; close: () => Promise<unknown> }> {
  const seen: Seen = [];
  const s: Server = createServer((req, res) => {
    seen.push({ url: req.url!, bypass: req.headers[BYPASS_HEADER] as string | undefined });
    handler(req, res);
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, seen, close: () => new Promise((r) => s.close(r)) };
}

let deploy: Awaited<ReturnType<typeof server>>;
let third: Awaited<ReturnType<typeof server>>;

before(async () => {
  // the third-party origin (another port = another origin): a script, an image, an API and a landing page
  third = await server((req, res) => {
    const p = req.url!;
    if (p.startsWith('/x.js')) return void res.writeHead(200, { 'content-type': 'text/javascript' }).end('window.__x = 1;');
    if (p.startsWith('/api')) return void res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }).end('{}');
    if (p.startsWith('/i.png')) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>elsewhere</title>');
  });
  deploy = await server((req, res) => {
    const p = req.url!;
    if (req.headers[BYPASS_HEADER] !== SECRET) return void res.writeHead(401, { 'content-type': 'text/html' }).end('protected');
    if (p === '/to-other') return void res.writeHead(302, { location: `${third.url}/landing` }).end();
    if (p === '/to-same') return void res.writeHead(307, { location: '/' }).end();
    if (p === '/app.js') return void res.writeHead(200, { 'content-type': 'text/javascript' }).end('window.__app = 1;');
    res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>staged</title>
<script src="/app.js"></script><script src="${third.url}/x.js"></script><img src="${third.url}/i.png">
<script>fetch(${JSON.stringify(`${third.url}/api`)}).catch(() => {})</script>`);
  });
});
after(async () => { await deploy?.close(); await third?.close(); });

test('bypassFor: only the deployment origin gets the header', () => {
  assert.deepEqual(bypassFor('https://misthos-abc.vercel.app/docs', 'https://misthos-abc.vercel.app', SECRET), { [BYPASS_HEADER]: SECRET });
  assert.deepEqual(bypassFor('https://misthos-abc.vercel.app.evil.com/', 'https://misthos-abc.vercel.app', SECRET), {});
  assert.deepEqual(bypassFor('http://misthos-abc.vercel.app/', 'https://misthos-abc.vercel.app', SECRET), {}, 'scheme is part of the origin');
  assert.deepEqual(bypassFor('https://misthos-abc.vercel.app:8443/', 'https://misthos-abc.vercel.app', SECRET), {}, 'port is part of the origin');
  assert.deepEqual(bypassFor('https://misthos-abc.vercel.app/', 'https://misthos-abc.vercel.app', undefined), {});
});

test('--crawl: the secret reaches the deployment and its same-origin redirects, never another origin', async () => {
  deploy.seen.length = 0; third.seen.length = 0;
  const pages = await crawl(deploy.url, ['/', '/to-same', '/to-other'], () => {}, SECRET);
  assert.deepEqual(pages.map((p) => p.path), ['/', '/to-same', '/to-other']);
  assert.match(pages[1]!.html, /staged/, 'same-origin redirect followed with the secret');
  assert.match(pages[2]!.html, /elsewhere/, 'cross-origin redirect followed without it');
  assert.ok(deploy.seen.length >= 3 && deploy.seen.every((r) => r.bypass === SECRET), JSON.stringify(deploy.seen));
  assert.ok(third.seen.some((r) => r.url === '/landing'));
  assert.ok(third.seen.every((r) => r.bypass === undefined), `leaked to the third party: ${JSON.stringify(third.seen)}`);
});

// playwright comes from a sibling package here (seal --crawl-browser uses the sealed project's own)
const PW_PROJECT = fileURLToPath(new URL('../../dashboard/', import.meta.url));
const hasPw = (() => { try { createRequire(`${PW_PROJECT}package.json`).resolve('playwright'); return true; } catch { return false; } })();

test('--crawl-browser: subresources, fetches and redirects to another origin never carry the secret', { skip: !hasPw && 'no playwright' }, async () => {
  deploy.seen.length = 0; third.seen.length = 0;
  // both test origins are loopback: Chromium's local-network check blocks a page answered by route.fulfill (an
  // "unknown" address space) from loading them. A Vercel deployment and real third parties are public addresses.
  const pages = await crawlBrowser(PW_PROJECT, deploy.url, ['/', '/to-same', '/to-other'], () => {}, SECRET,
    { args: ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'] });
  assert.deepEqual(pages.map((p) => p.path), ['/', '/to-same', '/to-other']);
  assert.match(pages[0]!.html, /staged/);
  assert.match(pages[1]!.html, /staged/, 'same-origin redirect: the deployment saw the secret on the new hop too');
  assert.match(pages[2]!.html, /elsewhere/);
  for (const p of ['/', '/app.js', '/to-same', '/to-other']) assert.ok(deploy.seen.some((r) => r.url === p), `deployment never saw ${p}`);
  assert.ok(deploy.seen.every((r) => r.bypass === SECRET), `a deployment request without the secret: ${JSON.stringify(deploy.seen)}`);
  for (const p of ['/x.js', '/api', '/i.png', '/landing']) assert.ok(third.seen.some((r) => r.url === p), `third party never saw ${p}: ${JSON.stringify(third.seen)}`);
  assert.ok(third.seen.every((r) => r.bypass === undefined), `leaked to the third party: ${JSON.stringify(third.seen)}`);
});

test('without a secret nothing is added (an unprotected deployment)', async () => {
  deploy.seen.length = 0;
  const pages = await crawl(deploy.url, ['/'], () => {}, undefined);
  assert.equal(pages[0]!.html, 'protected', 'the test server answers 401 without the secret; the crawl still records the page');
  assert.ok(deploy.seen.every((r) => r.bypass === undefined));
});
