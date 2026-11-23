// Parses the three sealed lists and recomputes what the chain committed to. Same rules as the CLI
// (packages/cli/src/seal.ts, merkle.ts) and SignetRegistry.writeFile; test/sealed.test.ts checks both agree.
//   allowlistHash = sha256(bytes of signet/allowlist.json)
//   originsHash   = sha256(bytes of signet/origins.json)
//   filesRoot     = Merkle root (sorted pairs) over sha256(abi.encode(domain, path, contentType, sha256(bytes)))
//                   for every listed file plus signet/files.json itself
import { encodeAbiParameters, sha256, concat } from 'viem';
import type { Hex, PagesPolicy, Sealed, SealedFile } from './types.ts';

export const ALLOWLIST_PATH = 'signet/allowlist.json';
export const ORIGINS_PATH = 'signet/origins.json';
export const FILES_PATH = 'signet/files.json';

export function leafOf(domain: string, path: string, contentType: string, contentSha256: Hex): Hex {
  return sha256(encodeAbiParameters([{ type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'bytes32' }], [domain, path, contentType, contentSha256]));
}

/// Chunk leaves of files over 48,000 bytes (same rule as packages/cli/src/merkle.ts and SignetRegistry.writeChunk).
export const CHUNK_TYPE = 'signet/chunk';
export function leavesOf(domain: string, files: SealedFile[]): Hex[] {
  return files.flatMap((f) => [leafOf(domain, f.path, f.contentType, f.sha256), ...(f.chunks ?? []).map((c, i) => leafOf(domain, `${f.path} ${i}`, CHUNK_TYPE, c))]);
}

export function merkleRoot(leaves: Hex[]): Hex {
  if (leaves.length === 0) throw new Error('no files');
  let level = [...leaves].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) next.push(level[i]!);
      else {
        const [lo, hi] = BigInt(level[i]!) < BigInt(level[i + 1]!) ? [level[i]!, level[i + 1]!] : [level[i + 1]!, level[i]!];
        next.push(sha256(concat([lo, hi])));
      }
    }
    level = next;
  }
  return level[0]!;
}

export function manifestHashOf(filesRoot: Hex, allowlistHash: Hex, originsHash: Hex): Hex {
  return sha256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }], [filesRoot, allowlistHash, originsHash]));
}

export function parseSealed(domain: string, allowlistBytes: Uint8Array, originsBytes: Uint8Array, filesBytes: Uint8Array): Sealed {
  const text = (b: Uint8Array) => new TextDecoder().decode(b);
  const list = JSON.parse(text(filesBytes)) as { domain?: string; files?: SealedFile[]; calls?: Record<string, number> };
  if (list.domain !== domain || !Array.isArray(list.files)) throw new Error('the file list is for another domain');
  const o = JSON.parse(text(originsBytes)) as { origins?: string[]; scripts?: Sealed['scripts']; pages?: unknown } | string[];
  const origins = Array.isArray(o) ? o : o.origins;
  const scripts = Array.isArray(o) ? [] : o.scripts;
  if (!Array.isArray(origins) || !Array.isArray(scripts)) throw new Error('the origins file is malformed');
  const pages = Array.isArray(o) || o.pages === undefined ? null : parsePages(o.pages);
  const own: SealedFile = { path: FILES_PATH, contentType: 'application/json', sha256: sha256(filesBytes), size: filesBytes.length };
  // a list over 48,000 bytes is stored in 24,000-byte chunks, whose hashes are leaves too (CLI seal.ts listEntryOf)
  if (filesBytes.length > 48_000 && filesBytes.length <= 350 * 24_000) {
    own.chunks = [];
    for (let off = 0; off < filesBytes.length; off += 24_000) own.chunks.push(sha256(filesBytes.subarray(off, off + 24_000)));
  }
  const filesRoot = merkleRoot(leavesOf(domain, [...list.files, own]));
  const allowlistHash = sha256(allowlistBytes);
  const originsHash = sha256(originsBytes);
  return {
    manifestHash: manifestHashOf(filesRoot, allowlistHash, originsHash), filesRoot, allowlistHash, originsHash,
    allowlist: JSON.parse(text(allowlistBytes)) as Sealed['allowlist'], origins, scripts, files: list.files, calls: list.calls ?? null, pages,
  };
}

/// origins.json "pages". Anything Guard doesn't understand is an error (the release is then "could not check"),
/// never silently ignored: a newer page mode must not be read as a static site.
export function parsePages(p: unknown): PagesPolicy {
  const x = p as Partial<PagesPolicy> | null;
  if (!x || typeof x !== 'object' || x.mode !== 'ssr') throw new Error('unknown page mode in the sealed origins file');
  const inline = x.inline ?? [];
  const serviceWorkers = x.serviceWorkers ?? [];
  if (!Array.isArray(inline) || !inline.every((h) => typeof h === 'string' && /^0x[0-9a-f]{64}$/.test(h))) throw new Error('malformed inline hashes');
  if (!Array.isArray(serviceWorkers) || !serviceWorkers.every((w) => typeof w === 'string')) throw new Error('malformed service worker list');
  return { mode: 'ssr', inline, serviceWorkers };
}

/// Which sealed file a loaded URL must equal, or null if none. `path` comes from pathOfUrl; `has` says whether a
/// path is in the sealed release. In order:
///   1. the exact path (`/app.html` → app.html, `/docs/` → docs/index.html);
///   2. for a document without a file extension, a clean URL: `/app` → app.html, as Cloudflare Pages, Netlify and
///      Vercel serve it. When app.html is sealed, a document at /app must be exactly app.html: no other file;
///   3. otherwise a document without a file extension is a single-page-app route: index.html.
/// One path only, never a choice of several, so a page can't pass by matching some other sealed file.
export function sealedPathFor(path: string, isDocument: boolean, has: (p: string) => boolean): string | null {
  if (has(path)) return path;
  if (!isDocument || /\.[a-z0-9]+$/i.test(path)) return null;
  if (has(`${path}.html`)) return `${path}.html`;
  return has('index.html') ? 'index.html' : null;
}

/// The sealed path a URL of the site stands for: "/" and directories are index.html; the query is ignored.
export function pathOfUrl(pathname: string): string {
  let p = pathname.replace(/^\/+/, '');
  try {
    p = decodeURIComponent(p);
  } catch { /* keep as is */ }
  if (p === '' || p.endsWith('/')) p += 'index.html';
  return p;
}
