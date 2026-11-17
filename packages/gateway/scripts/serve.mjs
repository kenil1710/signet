// A static server that behaves like a deployed gateway: the gateway's own files by path, the boot page for
// everything else, on every host. Local use: http://<label>.localhost:8097/ (browsers resolve *.localhost).
//   node scripts/serve.mjs [port] [distDir]
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TYPES = { 'index.html': 'text/html; charset=utf-8', 'sw.js': 'text/javascript', '.signet/boot.js': 'text/javascript', '.signet/hashes.json': 'application/json' };

export function serveGateway(dist, port = 0) {
  const log = [];
  const server = http.createServer((req, res) => {
    const path = req.url.split('?')[0].slice(1);
    log.push(`${(req.headers.host ?? '').split(':')[0]}/${path}`);
    const file = path in TYPES && existsSync(`${dist}/${path}`) ? path : 'index.html';
    res.setHeader('content-type', TYPES[file]);
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('x-content-type-options', 'nosniff');
    res.end(readFileSync(`${dist}/${file}`));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, log, close: () => server.close() })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = process.argv[3] ?? fileURLToPath(new URL('../dist', import.meta.url));
  const g = await serveGateway(dist, Number(process.argv[2] ?? 8097));
  console.log(`Signet gateway on http://localhost:${g.port}/   a project: http://<domain-with-dashes>.localhost:${g.port}/`);
}
