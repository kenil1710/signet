// Spike C test server. Serves packages/demo-dapp/dist on the "sealed" origin (http://localhost:5181) plus
// an extra page with edge-case scripts, and a second, unsealed origin (http://127.0.0.1:5182) for the
// cross-origin script. Not product code.
//
// Tamper modes (set with POST /__mode?tamper=<mode>):
//   off        serve the real build
//   always     main bundle has an injected line on every request (DNS-hijack / CDN swap)
//   once       main bundle is tampered on the FIRST request only, clean afterwards (Bybit-style: bad bytes
//              served to the victim, then removed). A checker that re-downloads sees clean bytes.
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DIST = path.resolve(here, '../../demo-dapp/dist');
export const SEALED = 'http://localhost:5181';
export const OTHER = 'http://127.0.0.1:5182';
export const TAMPER_LINE = '\n;console.log("drainer injected");\n';

const EDGE_HTML = (indexHtml) =>
  indexHtml
    .replace('<title>Signet Demo dApp</title>', '<title>Signet Demo dApp: edge cases</title>')
    .replace(
      '</body>',
      `  <script src="/edge/nocache.js"></script>
    <script src="/edge/nostore.js"></script>
    <script src="${OTHER}/edge/crossorigin.js"></script>
  </body>`,
    );

const EXTRA = {
  '/edge/nocache.js': { body: 'window.__nocache = 1;\n', cc: 'no-cache' },
  '/edge/nostore.js': { body: 'window.__nostore = 1;\n', cc: 'no-store' },
};
const CROSS = { '/edge/crossorigin.js': { body: 'window.__cross = 1;\n', cc: 'public, max-age=3600' } };

/** Every (url -> bytes) the clean sealed origin serves. Used by the server and by gen-manifest. */
export async function cleanFiles() {
  const files = new Map();
  const index = await readFile(path.join(DIST, 'index.html'), 'utf8');
  files.set(`${SEALED}/`, Buffer.from(index));
  files.set(`${SEALED}/edge.html`, Buffer.from(EDGE_HTML(index)));
  for (const f of await readdir(path.join(DIST, 'assets'))) {
    files.set(`${SEALED}/assets/${f}`, await readFile(path.join(DIST, 'assets', f)));
  }
  for (const [p, v] of Object.entries(EXTRA)) files.set(`${SEALED}${p}`, Buffer.from(v.body));
  return { files, crossFiles: new Map(Object.entries(CROSS).map(([p, v]) => [`${OTHER}${p}`, Buffer.from(v.body)])) };
}

export const sha256 = (b) => createHash('sha256').update(b).digest('hex');

export async function start() {
  const { files, crossFiles } = await cleanFiles();
  const mainUrl = [...files.keys()].find((u) => /\/assets\/index-.*\.js$/.test(u));
  const state = { tamper: 'off', served: new Map(), log: [] };

  const type = (u) => (u.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
  const ccFor = (u) => {
    for (const [p, v] of Object.entries(EXTRA)) if (u === `${SEALED}${p}`) return v.cc;
    if (u.endsWith('/') || u.endsWith('.html')) return 'no-cache';
    return 'public, max-age=3600';
  };

  const sealed = http.createServer((req, res) => {
    const url = `${SEALED}${req.url.split('?')[0]}`;
    if (req.method === 'POST' && req.url.startsWith('/__mode')) {
      state.tamper = new URL(url + req.url.slice(req.url.indexOf('?'))).searchParams.get('tamper') ?? 'off';
      state.served.clear();
      res.end(state.tamper);
      return;
    }
    state.log.push(url);
    let body = files.get(url);
    if (!body) { res.statusCode = 404; res.end(); return; }
    if (url === mainUrl) {
      const n = (state.served.get(url) ?? 0) + 1;
      state.served.set(url, n);
      if (state.tamper === 'always' || (state.tamper === 'once' && n === 1)) body = Buffer.concat([body, Buffer.from(TAMPER_LINE)]);
    }
    res.setHeader('content-type', type(url));
    res.setHeader('cache-control', ccFor(url));
    res.end(body);
  });

  const other = http.createServer((req, res) => {
    const url = `${OTHER}${req.url.split('?')[0]}`;
    state.log.push(url);
    const body = crossFiles.get(url);
    if (!body) {
      // An unsealed site for the "no network calls on unsealed domains" check.
      if (url === `${OTHER}/`) { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>unsealed</title><script>1</script>'); return; }
      res.statusCode = 404; res.end(); return;
    }
    res.setHeader('content-type', 'text/javascript');
    res.setHeader('cache-control', 'public, max-age=3600');
    res.setHeader('access-control-allow-origin', '*');
    res.end(body);
  });

  await new Promise((r) => sealed.listen(5181, 'localhost', r));
  await new Promise((r) => other.listen(5182, '127.0.0.1', r));
  return { state, mainUrl, close: () => { sealed.close(); other.close(); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await start();
  console.log(`sealed origin ${SEALED}  (edge cases: ${SEALED}/edge.html)  other origin ${OTHER}`);
  console.log(`tamper: curl -X POST '${SEALED}/__mode?tamper=always|once|off'`);
  process.on('SIGINT', () => { s.close(); process.exit(0); });
}
