// Serves a build directory the way a host or CDN would, with the misbehaviors `signet verify` looks for
// switched on. Used by the verify tests and the staging demo:
//   node test/serve.ts <dir> <port> [--no-store] [--rocket] [--ssr]
import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { contentTypeOf } from '../src/seal.ts';

export interface ServeOptions {
  port?: number;
  cacheControl?: (path: string) => string;
  rewrite?: (path: string, body: Buffer) => Buffer;
  ssr?: boolean;
  cookie?: boolean;
}

export const ROCKET = '<script src="/cdn-cgi/scripts/7d0fa10a/cloudflare-static/rocket-loader.min.js" data-cf-settings="x-|49" defer></script>';

export async function serve(dir: string, o: ServeOptions = {}): Promise<{ url: string; close: () => Promise<unknown> }> {
  let n = 0;
  const server: Server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url!, 'http://x').pathname).slice(1);
    if (path === '' || path.endsWith('/')) path += 'index.html';
    if (!existsSync(join(dir, path))) return void res.writeHead(404).end('not found');
    let body: Buffer = readFileSync(join(dir, path));
    if (o.rewrite) body = o.rewrite(path, body);
    if (o.ssr && path.endsWith('.html')) body = Buffer.from(body.toString().replace('</body>', `<script nonce="n${++n}">window.__t=${n}</script></body>`));
    const headers: Record<string, string> = { 'content-type': contentTypeOf(path), 'cache-control': o.cacheControl?.(path) ?? 'public, max-age=60' };
    if (o.cookie && path.endsWith('.html')) headers['set-cookie'] = 'sid=1';
    res.writeHead(200, headers).end(body);
  });
  await new Promise<void>((r) => server.listen(o.port ?? 0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, close: () => new Promise((r) => server.close(r)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, port, ...flags] = process.argv.slice(2);
  if (!dir || !port) throw new Error('usage: node test/serve.ts <dir> <port> [--no-store] [--rocket] [--ssr]');
  const s = await serve(dir, {
    port: Number(port),
    ssr: flags.includes('--ssr'),
    cacheControl: flags.includes('--no-store') ? () => 'no-store' : undefined,
    rewrite: flags.includes('--rocket') ? (p, b) => (p.endsWith('.html') ? Buffer.from(b.toString().replace('</body>', `${ROCKET}</body>`)) : b) : undefined,
  });
  console.log(`serving ${dir} at ${s.url}`);
}
