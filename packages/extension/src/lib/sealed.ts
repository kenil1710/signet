// Parses the three sealed lists and recomputes what the chain committed to. Same rules as the CLI
// (packages/cli/src/seal.ts, merkle.ts) and SignetRegistry.writeFile; test/sealed.test.ts checks both agree.
//   allowlistHash = sha256(bytes of signet/allowlist.json)
//   originsHash   = sha256(bytes of signet/origins.json)
//   filesRoot     = Merkle root (sorted pairs) over sha256(abi.encode(domain, path, contentType, sha256(bytes)))
//                   for every listed file plus signet/files.json itself
import { encodeAbiParameters, sha256, concat } from 'viem';
import type { Hex, Sealed, SealedFile } from './types.ts';

export const ALLOWLIST_PATH = 'signet/allowlist.json';
export const ORIGINS_PATH = 'signet/origins.json';
export const FILES_PATH = 'signet/files.json';

export function leafOf(domain: string, path: string, contentType: string, contentSha256: Hex): Hex {
  return sha256(encodeAbiParameters([{ type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'bytes32' }], [domain, path, contentType, contentSha256]));
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
  const list = JSON.parse(text(filesBytes)) as { domain?: string; files?: SealedFile[] };
  if (list.domain !== domain || !Array.isArray(list.files)) throw new Error('the file list is for another domain');
  const o = JSON.parse(text(originsBytes)) as { origins?: string[]; scripts?: Sealed['scripts'] } | string[];
  const origins = Array.isArray(o) ? o : o.origins;
  const scripts = Array.isArray(o) ? [] : o.scripts;
  if (!Array.isArray(origins) || !Array.isArray(scripts)) throw new Error('the origins file is malformed');
  const own = { path: FILES_PATH, contentType: 'application/json', sha256: sha256(filesBytes), size: filesBytes.length };
  const filesRoot = merkleRoot([...list.files, own].map((f) => leafOf(domain, f.path, f.contentType, f.sha256)));
  const allowlistHash = sha256(allowlistBytes);
  const originsHash = sha256(originsBytes);
  return {
    manifestHash: manifestHashOf(filesRoot, allowlistHash, originsHash), filesRoot, allowlistHash, originsHash,
    allowlist: JSON.parse(text(allowlistBytes)) as Sealed['allowlist'], origins, scripts, files: list.files,
  };
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
