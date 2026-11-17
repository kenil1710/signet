// The gateway's service worker. It runs in the visitor's browser on the project's own subdomain
// (app-example-org.<gateway>) and answers every request of that origin itself:
//   1. the subdomain names the sealed domain; SignetRegistry says which gate and container it has
//      (two RPCs, same block, identical answers);
//   2. the gate's current release gives filesRoot / allowlistHash / originsHash; the three sealed lists are read
//      from the container and rejected unless they hash to those values;
//   3. each requested file is read from the container and served only if its SHA-256 is the sealed one.
// The gateway's server never handles site content: it only hands out this worker and the boot page.
// The design follows TapeKit's sw-gateway (TapeOutProtocol/TapeKit); the difference is what a file is checked
// against: the release the team's approvers published, not the hash stored next to the file.
import { decodeFunctionResult, encodeFunctionData, hexToBytes, sha256, zeroAddress, type Abi } from 'viem';
import { gateAbi, registryAbi, siteAbi } from '@signet/extension/src/lib/abi.ts';
import { agree, either, type Call } from '@signet/extension/src/lib/rpc.ts';
import { parseSealed, pathOfUrl, ALLOWLIST_PATH, ORIGINS_PATH, FILES_PATH } from '@signet/extension/src/lib/sealed.ts';
import { decodeLabel } from '@signet/extension/src/lib/label.ts';
import type { Hex, Net, Sealed } from '@signet/extension/src/lib/types.ts';

declare const __NET__: Net;
const NET = __NET__;
const sw = self as unknown as ServiceWorkerGlobalScope;
const DOMAIN = decodeLabel(sw.location.hostname.split('.')[0]!);
/// The gateway's own files: always from the gateway's server, so a sealed site can't replace them.
const RESERVED = /^\/(sw\.js|\.signet\/(boot\.js|hashes\.json))$/;
const STATUS_PATH = '/.signet/status';
const FRESH_MS = 60_000;
const STALE_MS = 24 * 3600_000;

sw.addEventListener('install', () => void sw.skipWaiting());
sw.addEventListener('activate', (e) => e.waitUntil(sw.clients.claim()));

// ---------------------------------------------------------------- the chain

const call = (to: Hex, abi: Abi, functionName: string, args: unknown[] = []): Call => ({ to, data: encodeFunctionData({ abi, functionName, args }) });
const out = <T>(abi: Abi, functionName: string, data: string): T => {
  if (data === 'revert') throw new Error(`${functionName} reverted`);
  return decodeFunctionResult({ abi, functionName, data: data as Hex }) as T;
};

type Site =
  | { ok: true; gate: Hex; container: Hex; prefix: string; release: number; enforced: boolean; sealed: Sealed; at: number; stale: boolean }
  | { ok: false; title: string; text: string; at: number };

async function readFile(container: Hex, path: string): Promise<Uint8Array | null> {
  const data = await either(NET, call(NET.siteRegistry, siteAbi, 'read', [container, path]));
  if (data === 'revert') return null;
  const bytes = hexToBytes(out<Hex>(siteAbi, 'read', data));
  return bytes.length ? bytes : null;
}

async function loadSite(domain: string, known: Site | null): Promise<Site> {
  const at = Date.now();
  const no = (title: string, text: string): Site => ({ ok: false, title, text, at });
  if (!NET.registry) return no('Signet is not deployed on this network', 'There is nothing to read yet.');
  const [b] = await agree(NET, [call(NET.registry, registryAbi, 'bindingOf', [domain])]);
  const [gate, container, prefix] = out<[Hex, Hex, string]>(registryAbi, 'bindingOf', b!);
  if (gate === zeroAddress) return no(`${domain} is not a sealed site`, 'Signet has no release for this domain.');
  const r = await agree(NET, ['activeRelease', 'currentManifestHash', 'currentRelease', 'enforced'].map((f) => call(gate, gateAbi as Abi, f)));
  const [filesRoot, allowlistHash, originsHash, valid] = out<[Hex, Hex, Hex, boolean]>(gateAbi as Abi, 'activeRelease', r[0]!);
  const current = out<Hex>(gateAbi as Abi, 'currentManifestHash', r[1]!);
  const release = Number(out<bigint>(gateAbi as Abi, 'currentRelease', r[2]!));
  if (release === 0) return no(`${domain} has no release yet`, 'Its team has not published a sealed release.');
  if (!valid) return no(`The release of ${domain} was revoked`, 'Its team withdrew the current release. Nothing is shown until a new one is published.');
  let sealed = known?.ok && known.sealed.manifestHash === current ? known.sealed : null;
  if (!sealed) {
    const bytes = await Promise.all([ALLOWLIST_PATH, ORIGINS_PATH, FILES_PATH].map((p) => readFile(container, prefix + p)));
    if (bytes.some((x) => !x)) return no(`No copy of ${domain} on-chain`, "The release's manifest files are not in its container.");
    try {
      sealed = parseSealed(domain, bytes[0]!, bytes[1]!, bytes[2]!);
    } catch {
      return no(`The manifest of ${domain} can't be read`, 'The files in its container are not a sealed manifest.');
    }
    if (sealed.filesRoot !== filesRoot || sealed.allowlistHash !== allowlistHash || sealed.originsHash !== originsHash || sealed.manifestHash !== current) {
      return no(`The manifest of ${domain} was rejected`, 'The manifest files in its container do not hash to the release published on-chain.');
    }
  }
  return { ok: true, gate, container, prefix, release, enforced: out<boolean>(gateAbi as Abi, 'enforced', r[3]!), sealed, at, stale: false };
}

let site: Site | null = null;
let loading: Promise<Site> | null = null;
function getSite(domain: string): Promise<Site> {
  if (site && !('stale' in site && site.stale) && Date.now() - site.at < FRESH_MS) return Promise.resolve(site);
  loading ??= loadSite(domain, site)
    .catch((e: unknown): Site => {
      // the chain can't be read right now: a release verified less than 24 h ago still counts
      if (site?.ok && Date.now() - site.at < STALE_MS) return { ...site, stale: true };
      return { ok: false, title: 'Could not check the chain', text: `${e instanceof Error ? e.message : String(e)}. Nothing is shown that could not be verified.`, at: 0 };
    })
    .then((s) => {
      if (!(s.ok && s.stale)) site = s;
      return s;
    })
    .finally(() => (loading = null));
  return loading;
}

// ---------------------------------------------------------------- responses

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'";
function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:44rem;margin:12vh auto;padding:0 1.25rem;color:#111827}@media(prefers-color-scheme:dark){body{background:#111827;color:#f3f4f6}}h1{font-size:1.5rem}code,td{font:13px ui-monospace,monospace;overflow-wrap:anywhere}.d{color:#6b7280}table{border-collapse:collapse;width:100%}td{border-top:1px solid #8884;padding:4px 8px 4px 0;vertical-align:top}</style>
<p class="d">Signet gateway · verified copy</p><h1>${esc(title)}</h1>${body}</html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': PAGE_CSP } });
}

/// What a sealed site may do on its gateway origin: its code comes only from the verified files (and the sealed
/// cross-origin scripts), and it may talk only to the origins its team sealed.
function siteCsp(s: Sealed): string {
  const origins = s.origins.join(' ');
  const scripts = [...new Set(s.scripts.map((x) => new URL(x.url).origin))].join(' ');
  return [
    "default-src 'self' blob: data:",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: ${scripts}`,
    "style-src 'self' 'unsafe-inline' blob: data: https:", "img-src 'self' blob: data: https:", "font-src 'self' blob: data: https:", "media-src 'self' blob: data: https:",
    `connect-src 'self' blob: data: ${origins}`,
    "frame-src 'self' https:", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'",
  ].join('; ');
}

const verified = new Map<string, Uint8Array>(); // sealed sha256 -> bytes already checked in this worker's lifetime

async function serve(url: URL, isNavigation: boolean): Promise<Response> {
  if (!DOMAIN) return page(404, 'Not a Signet gateway address', `<p><code>${esc(sw.location.hostname)}</code> does not name a sealed domain. The address is the domain with dots written as dashes, for example <code>app-example-org</code>.</p>`);
  const s = await getSite(DOMAIN);
  if (!s.ok) return page(s.at === 0 ? 503 : 404, s.title, `<p>${esc(s.text)}</p>`);
  if (url.pathname === STATUS_PATH) return statusPage(s);
  let path = pathOfUrl(url.pathname);
  let f = s.sealed.files.find((x) => x.path === path);
  if (!f && isNavigation && !/\.[a-z0-9]+$/i.test(path)) {
    path = 'index.html'; // a route of a single-page app
    f = s.sealed.files.find((x) => x.path === path);
  }
  if (!f) return page(404, 'Not part of the sealed release', `<p><code>${esc(url.pathname)}</code> is not a file of release #${s.release} of ${esc(DOMAIN)}.</p>`);
  let bytes = verified.get(f.sha256);
  if (!bytes) {
    const got = await readFile(s.container, s.prefix + f.path).catch(() => null);
    if (!got) return page(502, 'This file has no copy on-chain', `<p><code>${esc(f.path)}</code> is sealed (its hash is on-chain) but its bytes are not stored in the container, so the verified copy can't show it. The team can store the full copy with <code>signet upload --full</code>.</p>`);
    if (sha256(got) !== f.sha256) return page(502, 'A file was rejected', `<p>The bytes stored for <code>${esc(f.path)}</code> do not match the sealed hash. They were not shown.</p>`);
    verified.set(f.sha256, got);
    bytes = got;
  }
  const type = /^(text\/|application\/(javascript|json|xml))/.test(f.contentType) ? `${f.contentType}; charset=utf-8` : f.contentType;
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      'content-type': type, 'content-length': String(bytes.length), 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': siteCsp(s.sealed), 'x-signet-domain': DOMAIN, 'x-signet-release': String(s.release), 'x-signet-sha256': f.sha256, 'x-signet-manifest': s.sealed.manifestHash,
    },
  });
}

function statusPage(s: Site & { ok: true }): Response {
  const rows = s.sealed.files.map((f) => `<tr><td>${esc(f.path)}</td><td>${f.size}</td><td>${esc(f.sha256)}</td></tr>`).join('');
  return page(200, `Verified copy of ${DOMAIN}`, `
<p>This page is served by a service worker in your browser. It read release #${s.release} from the project's container on X Layer through two RPCs that must agree, and it serves a file only if its SHA-256 is the one the team's approvers published.${s.stale ? ' <strong>The chain could not be read just now; this is the release checked earlier.</strong>' : ''}</p>
<table><tr><td>domain</td><td>${esc(DOMAIN)}</td></tr><tr><td>gate</td><td>${esc(s.gate)}</td></tr><tr><td>manifest</td><td>${esc(s.sealed.manifestHash)}</td></tr>
<tr><td>container</td><td>${esc(s.container)} / ${esc(s.prefix)}</td></tr><tr><td>may connect to</td><td>${esc(s.sealed.origins.join(', ') || 'nothing')}</td></tr></table>
<h1>Files (${s.sealed.files.length})</h1><table>${rows}</table>`);
}

sw.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== sw.location.origin) return; // other origins: the browser decides, under the site's CSP
  if (RESERVED.test(url.pathname)) return void e.respondWith(fetch(url.href, { cache: 'no-cache' })); // the gateway's own files
  if (e.request.method !== 'GET' && e.request.method !== 'HEAD') return void e.respondWith(page(405, 'Read-only', '<p>The verified copy is static files. There is nothing to send to.</p>'));
  e.respondWith(serve(url, e.request.mode === 'navigate').catch((err: unknown) => page(500, 'The gateway failed', `<p>${esc(err instanceof Error ? err.message : err)}</p>`)));
});
