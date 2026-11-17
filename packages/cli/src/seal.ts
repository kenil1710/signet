// `signet seal <buildDir>`: hash every file, build filesRoot, extract the allowlist and the external origins,
// and write the four sealed files:
//   <buildDir>/signet/allowlist.json   its SHA-256 is allowlistHash
//   <buildDir>/signet/origins.json     external origins + SRI hashes of cross-origin scripts; its SHA-256 is originsHash
//   <buildDir>/signet/files.json       the file list; it is itself a leaf of filesRoot
//   <buildDir>/signet-manifest.json    the three hashes + manifestHash (what `signet propose` sends)
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { encodeAbiParameters, getAddress, type Hex } from 'viem';
import { sha256Hex, leafOf, leavesOf, merkleRoot, merkleProof, chunkPath, CHUNK_BYTES, CHUNK_TYPE } from './merkle.ts';
import { findCalls, countCalls, isCode, type CallCounts } from './calls.ts';
import { extractAddresses, extractOrigins, DOC_HOSTS, PERMIT2 } from './extract.ts';
export { extractAddresses, extractOrigins, DOC_HOSTS } from './extract.ts';

export const ALLOWLIST_PATH = 'signet/allowlist.json';
export const ORIGINS_PATH = 'signet/origins.json';
export const FILES_PATH = 'signet/files.json';
export const MANIFEST_NAME = 'signet-manifest.json';
export const MAX_ONCHAIN_BYTES = 48_000; // SignetRegistry.MAX_FILE_BYTES
const RESERVED = new Set([ALLOWLIST_PATH, ORIGINS_PATH, FILES_PATH, MANIFEST_NAME]);
const JSON_TYPE = 'application/json';

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.htm': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': JSON_TYPE, '.map': JSON_TYPE, '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain', '.xml': 'application/xml',
  '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf',
};
const TEXT = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json', '.txt', '.xml', '.svg', '.webmanifest']);

export function contentTypeOf(path: string): string {
  return TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/// Same rule as SignetRegistry._checkDomain.
export function isValidDomain(d: string): boolean {
  if (d.length < 3 || d.length > 253 || !d.includes('.')) return false;
  return d.split('.').every((l) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l));
}

/// Same rule as SignetRegistry._checkPath: only such paths can be written on-chain.
export function isOnchainPath(p: string): boolean {
  if (p.length === 0 || p.length > 200 || !/^[\x21-\x7e]+$/.test(p) || p.includes('\\')) return false;
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/// chunks: for a file over MAX_ONCHAIN_BYTES, the SHA-256 of each CHUNK_BYTES piece (stored one per transaction)
export interface SealedFile { path: string; contentType: string; sha256: Hex; size: number; chunks?: Hex[] }
/// Chunk count limit of SiteRegistry (CHUNKS_MAX, docs/tapeout-interfaces.md §8): 350 × 24,000 bytes.
export const MAX_CHUNKS = 350;
export interface ExternalScript { url: string; integrity: string | null; page: string }
export interface SealedScript { url: string; integrity: string | null }
/// Who a token transfer / transferFrom may send to: only the user's own address, also the sealed contracts, or
/// anyone (an app whose purpose is sending tokens). Sealed per chain in allowlist.json, so loosening it is an
/// allowlist change (tier 10).
export type Transfers = 'user' | 'allowlist' | 'any';
export const TRANSFERS: Transfers[] = ['user', 'allowlist', 'any'];
export type Allowlist = Record<string, { targets: string[]; spenders: string[]; eip712: string[]; transfers: Transfers }>;
/// signet/origins.json. Its hash is originsHash, so a new origin, a new cross-origin script and a changed SRI
/// hash all raise the on-chain tier to 01.
export interface OriginsFile { origins: string[]; scripts: SealedScript[] }
/// signet/files.json. `calls` = signing-call counts found in the code (see calls.ts), for Diff Guard.
export interface FilesFile { version: 1; domain: string; files: SealedFile[]; calls: CallCounts }
export interface AllowlistRules { targets?: string[]; spenders?: string[]; eip712?: string[]; exclude?: string[] }
export interface SealConfig {
  domain: string;
  chainId: number;
  allowlist?: Record<string, AllowlistRules>;
  transfers?: Transfers; // default "user"
  origins?: { include?: string[]; exclude?: string[] };
}
export interface Manifest {
  version: 1;
  domain: string;
  filesRoot: Hex;
  allowlistHash: Hex;
  originsHash: Hex;
  manifestHash: Hex;
  fileCount: number;
  totalBytes: number;
  paths: { allowlist: string; origins: string; files: string };
}
export interface SealResult {
  manifest: Manifest;
  files: SealedFile[]; // every sealed file except allowlist.json and origins.json (includes signet/files.json)
  allowlist: Allowlist;
  origins: string[];
  scripts: SealedScript[]; // cross-origin scripts with their SRI hash, as sealed in origins.json
  calls: CallCounts;
  externalScripts: ExternalScript[];
  found: { address: string; files: string[] }[]; // addresses seen in the build, for the team to confirm
  ignoredOrigins: string[];
  warnings: string[];
}

export function walk(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, base), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, rel));
    else if (e.isFile() && e.name !== '.DS_Store') out.push(rel);
  }
  return out;
}

// allowlist and origin extraction: extract.ts (shared with the dashboard)

// ---------------------------------------------------------------- HTML

export interface Tag { name: string; attrs: Record<string, string | true>; raw: string }

/// Small tag scanner (no HTML parser): good for the <script> and <link> tags bundlers emit.
export function tagsOf(html: string, name: string): Tag[] {
  const tags: Tag[] = [];
  const re = new RegExp(`<${name}\\b([^>]*)>`, 'gi');
  for (const m of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(re)) {
    const attrs: Record<string, string | true> = {};
    for (const a of m[1]!.matchAll(/([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      attrs[a[1]!.toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? true;
    }
    tags.push({ name, attrs, raw: m[0] });
  }
  return tags;
}

export function externalScriptsOf(html: string, page: string, siteOrigin: string): ExternalScript[] {
  const out: ExternalScript[] = [];
  for (const t of tagsOf(html, 'script')) {
    const src = t.attrs.src;
    if (typeof src !== 'string' || !/^(https?:)?\/\//i.test(src)) continue;
    const url = src.startsWith('//') ? `https:${src}` : src;
    try {
      if (new URL(url).origin === siteOrigin) continue;
    } catch { continue; }
    out.push({ url, integrity: typeof t.attrs.integrity === 'string' ? t.attrs.integrity : null, page });
  }
  return out;
}

// ---------------------------------------------------------------- seal

function canonical(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

export function manifestHashOf(filesRoot: Hex, allowlistHash: Hex, originsHash: Hex): Hex {
  const enc = encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }], [filesRoot, allowlistHash, originsHash]);
  return sha256Hex(Buffer.from(enc.slice(2), 'hex'));
}

export function seal(buildDir: string, cfg: SealConfig, opts: { write?: boolean } = {}): SealResult {
  if (!existsSync(buildDir) || !statSync(buildDir).isDirectory()) throw new Error(`${buildDir} is not a directory`);
  if (!isValidDomain(cfg.domain)) throw new Error(`"${cfg.domain}" is not a valid lowercase domain`);
  const warnings: string[] = [];
  const siteOrigin = `https://${cfg.domain}`;
  const paths = walk(buildDir).filter((p) => !RESERVED.has(p));
  if (paths.length === 0) throw new Error(`${buildDir} has no files`);

  const files: SealedFile[] = [];
  const seenIn = new Map<string, Set<string>>();
  const originSet = new Set<string>();
  const externalScripts: ExternalScript[] = [];
  const callSites = [];
  for (const path of paths) {
    const bytes = readFileSync(join(buildDir, path));
    const entry: SealedFile = { path, contentType: contentTypeOf(path), sha256: sha256Hex(bytes), size: bytes.length };
    if (bytes.length > MAX_ONCHAIN_BYTES && bytes.length <= MAX_CHUNKS * CHUNK_BYTES && isOnchainPath(path)) {
      entry.chunks = [];
      for (let off = 0; off < bytes.length; off += CHUNK_BYTES) entry.chunks.push(sha256Hex(bytes.subarray(off, off + CHUNK_BYTES)));
    }
    files.push(entry);
    if (!isOnchainPath(path)) warnings.push(`${path}: sealed by hash, but this path can't be stored on-chain (printable ASCII without spaces, at most 200 bytes)`);
    const ext = extname(path).toLowerCase();
    if (!TEXT.has(ext)) continue;
    const text = bytes.toString('utf8');
    for (const a of extractAddresses(text)) {
      if (!seenIn.has(a)) seenIn.set(a, new Set());
      seenIn.get(a)!.add(path);
    }
    for (const o of extractOrigins(text)) originSet.add(o);
    if (isCode(path)) callSites.push(...findCalls(path, text));
    if (ext === '.html' || ext === '.htm') externalScripts.push(...externalScriptsOf(text, path, siteOrigin));
  }

  // allowlist: every address found in the build is a target on the project's chain, unless the config excludes
  // it. Spenders and EIP-712 verifying contracts come from the config (Permit2 is recognized on its own).
  const chain = String(cfg.chainId);
  const rules = cfg.allowlist ?? {};
  const norm = (list: string[] | undefined): string[] => (list ?? []).map((a) => getAddress(a.toLowerCase()));
  const sortAddrs = (s: Set<string>) => [...s].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  const transfers = cfg.transfers ?? 'user';
  if (!TRANSFERS.includes(transfers)) throw new Error(`"transfers" must be "user", "allowlist" or "any" (got ${JSON.stringify(cfg.transfers)})`);
  const allowlist: SealResult['allowlist'] = {};
  for (const id of [...new Set([chain, ...Object.keys(rules)])].sort((a, b) => Number(a) - Number(b))) {
    const r = rules[id] ?? {};
    const exclude = new Set(norm(r.exclude));
    const targets = new Set(norm(r.targets));
    const spenders = new Set(norm(r.spenders));
    const eip712 = new Set(norm(r.eip712));
    if (id === chain) {
      for (const a of seenIn.keys()) if (!exclude.has(a)) targets.add(a);
      if (seenIn.has(PERMIT2) && !exclude.has(PERMIT2)) {
        spenders.add(PERMIT2);
        eip712.add(PERMIT2);
      }
    }
    allowlist[id] = { targets: sortAddrs(targets), spenders: sortAddrs(spenders), eip712: sortAddrs(eip712), transfers };
  }

  // origins: every origin found in the build except documentation links and the site itself
  const oInclude = (cfg.origins?.include ?? []).map((o) => new URL(o).origin.toLowerCase());
  const oExclude = new Set((cfg.origins?.exclude ?? []).map((o) => new URL(o).origin.toLowerCase()));
  const ignoredOrigins: string[] = [];
  const origins = new Set<string>(oInclude);
  for (const s of externalScripts) originSet.add(new URL(s.url).origin.toLowerCase());
  for (const o of originSet) {
    if (o === siteOrigin || oExclude.has(o)) continue;
    if (DOC_HOSTS.has(new URL(o).hostname) && !oInclude.includes(o)) ignoredOrigins.push(o);
    else origins.add(o);
  }
  for (const s of externalScripts) {
    if (!s.integrity) warnings.push(`${s.page}: cross-origin script ${s.url} has no integrity attribute (signet verify fails on this)`);
  }

  const allowlistBytes = canonical(allowlist);
  const originsList = [...origins].sort();
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const scripts: SealedScript[] = externalScripts
    .map(({ url, integrity }) => ({ url, integrity }))
    .filter((s, i, all) => all.findIndex((x) => x.url === s.url && x.integrity === s.integrity) === i)
    .sort((a, b) => (a.url < b.url ? -1 : 1));
  const originsBytes = canonical({ origins: originsList, scripts } satisfies OriginsFile);
  const calls = countCalls(callSites);
  const filesBytes = canonical({ version: 1, domain: cfg.domain, files, calls } satisfies FilesFile);
  const listEntry: SealedFile = { path: FILES_PATH, contentType: JSON_TYPE, sha256: sha256Hex(filesBytes), size: filesBytes.length };
  const sealed = [...files, listEntry];
  for (const f of sealed) {
    if (f.chunks) warnings.push(`${f.path}: ${f.size} bytes, over ${MAX_ONCHAIN_BYTES}: stored on-chain in ${f.chunks.length} chunks, one transaction each`);
    else if (f.size > MAX_ONCHAIN_BYTES) warnings.push(`${f.path}: ${f.size} bytes, sealed by hash but too large to store on-chain (limit ${MAX_CHUNKS} chunks of ${CHUNK_BYTES} bytes)`);
  }

  const filesRoot = merkleRoot(leavesOf(cfg.domain, sealed));
  const allowlistHash = sha256Hex(allowlistBytes);
  const originsHash = sha256Hex(originsBytes);
  const manifest: Manifest = {
    version: 1,
    domain: cfg.domain,
    filesRoot,
    allowlistHash,
    originsHash,
    manifestHash: manifestHashOf(filesRoot, allowlistHash, originsHash),
    fileCount: sealed.length,
    totalBytes: sealed.reduce((n, f) => n + f.size, 0),
    paths: { allowlist: ALLOWLIST_PATH, origins: ORIGINS_PATH, files: FILES_PATH },
  };

  if (opts.write !== false) {
    mkdirSync(join(buildDir, 'signet'), { recursive: true });
    writeFileSync(join(buildDir, ALLOWLIST_PATH), allowlistBytes);
    writeFileSync(join(buildDir, ORIGINS_PATH), originsBytes);
    writeFileSync(join(buildDir, FILES_PATH), filesBytes);
    writeFileSync(join(buildDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n');
  }
  const found = [...seenIn.entries()]
    .map(([address, where]) => ({ address, files: [...where].sort() }))
    .sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1));
  return { manifest, files: sealed, allowlist, origins: originsList, scripts, calls, externalScripts, found, ignoredOrigins: ignoredOrigins.sort(), warnings };
}

/// A sealed build dir, read back from disk and re-checked (propose, publish and upload start here).
export interface SealedBuild {
  manifest: Manifest;
  files: SealedFile[];
  sealed: SealedLists;
  bytes(path: string): Buffer;
  proof(path: string): Hex[];
  /// Merkle proof of chunk `index` of a chunked file
  chunkProof(path: string, index: number): Hex[];
}

export function loadSealed(buildDir: string): SealedBuild {
  const mf = join(buildDir, MANIFEST_NAME);
  if (!existsSync(mf)) throw new Error(`${mf} not found. Run: signet seal ${buildDir}`);
  const manifest = JSON.parse(readFileSync(mf, 'utf8')) as Manifest;
  const bytes = (path: string) => readFileSync(join(buildDir, path));
  const listBytes = bytes(FILES_PATH);
  const list = JSON.parse(listBytes.toString('utf8')) as FilesFile;
  const files: SealedFile[] = [...list.files, { path: FILES_PATH, contentType: JSON_TYPE, sha256: sha256Hex(listBytes), size: listBytes.length }];
  const stale = (what: string) => new Error(`${what} changed since the build was sealed. Run: signet seal ${buildDir}`);
  for (const f of list.files) if (!existsSync(join(buildDir, f.path)) || sha256Hex(bytes(f.path)) !== f.sha256) throw stale(f.path);
  const onDisk = walk(buildDir).filter((p) => !RESERVED.has(p));
  if (onDisk.length !== list.files.length) throw stale('The set of files');
  const leaves = leavesOf(manifest.domain, files);
  if (list.domain !== manifest.domain || merkleRoot(leaves) !== manifest.filesRoot) throw stale(FILES_PATH);
  if (sha256Hex(bytes(ALLOWLIST_PATH)) !== manifest.allowlistHash) throw stale(ALLOWLIST_PATH);
  if (sha256Hex(bytes(ORIGINS_PATH)) !== manifest.originsHash) throw stale(ORIGINS_PATH);
  if (manifestHashOf(manifest.filesRoot, manifest.allowlistHash, manifest.originsHash) !== manifest.manifestHash) throw stale(MANIFEST_NAME);
  // the call summary must be what the code really contains: Diff Guard compares later releases against it
  const sites = list.files.filter((f) => isCode(f.path)).flatMap((f) => findCalls(f.path, bytes(f.path).toString('utf8')));
  if (JSON.stringify(countCalls(sites)) !== JSON.stringify(list.calls ?? null)) throw stale(`The signing-call summary in ${FILES_PATH}`);
  const sealed = parseSealed(manifest.domain, bytes(ALLOWLIST_PATH), bytes(ORIGINS_PATH), listBytes);
  return {
    manifest,
    files,
    sealed,
    bytes,
    proof(path) {
      const i = files.findIndex((f) => f.path === path);
      if (i < 0) throw new Error(`${path} is not a sealed file`);
      return merkleProof(leaves, leafOf(manifest.domain, files[i]!.path, files[i]!.contentType, files[i]!.sha256));
    },
    chunkProof(path, index) {
      const f = files.find((x) => x.path === path);
      if (!f?.chunks?.[index]) throw new Error(`${path} has no chunk ${index}`);
      return merkleProof(leaves, leafOf(manifest.domain, chunkPath(path, index), CHUNK_TYPE, f.chunks[index]!));
    },
  };
}

/// The three sealed lists, parsed from their exact bytes, with the hashes those bytes give. The caller compares
/// the hashes with the on-chain values (spec: reject any manifest that doesn't hash to them).
export interface SealedLists {
  filesRoot: Hex;
  allowlistHash: Hex;
  originsHash: Hex;
  manifestHash: Hex;
  allowlist: Allowlist;
  origins: string[];
  scripts: SealedScript[];
  files: SealedFile[]; // without signet/files.json itself
  calls: CallCounts | null; // null: sealed before call counts existed
}

export function parseSealed(domain: string, allowlistBytes: Uint8Array, originsBytes: Uint8Array, filesBytes: Uint8Array): SealedLists {
  const text = (b: Uint8Array) => Buffer.from(b).toString('utf8');
  const list = JSON.parse(text(filesBytes)) as Partial<FilesFile>;
  if (list.domain !== domain || !Array.isArray(list.files)) throw new Error(`${FILES_PATH} is not a file list for ${domain}`);
  const o = JSON.parse(text(originsBytes)) as OriginsFile | string[];
  const of: OriginsFile = Array.isArray(o) ? { origins: o, scripts: [] } : o; // a bare list: sealed before SRI hashes moved here
  if (!Array.isArray(of.origins) || !Array.isArray(of.scripts)) throw new Error(`${ORIGINS_PATH} is not an origins file`);
  const own: SealedFile = { path: FILES_PATH, contentType: JSON_TYPE, sha256: sha256Hex(filesBytes), size: filesBytes.length };
  const filesRoot = merkleRoot(leavesOf(domain, [...list.files, own]));
  const allowlistHash = sha256Hex(allowlistBytes);
  const originsHash = sha256Hex(originsBytes);
  return {
    filesRoot, allowlistHash, originsHash, manifestHash: manifestHashOf(filesRoot, allowlistHash, originsHash),
    allowlist: JSON.parse(text(allowlistBytes)) as Allowlist, origins: of.origins, scripts: of.scripts, files: list.files, calls: list.calls ?? null,
  };
}
