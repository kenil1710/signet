// The exact hashing SignetRegistry.writeFile checks (packages/contracts/src/SignetRegistry.sol):
//   leaf  = sha256(abi.encode(string domain, string path, string contentType, bytes32 sha256(fileBytes)))
//   node  = sha256(abi.encodePacked(min(a, b), max(a, b)))          (sorted pairs)
//   root  = filesRoot passed to ReleaseGate.proposeRelease
// Tree shape (the contract only needs a valid path, so the shape is ours): leaves sorted ascending, paired left
// to right, an odd last node moves up unchanged. One leaf: the root is the leaf.
import { createHash } from 'node:crypto';
import { encodeAbiParameters, type Hex } from 'viem';

export function sha256Hex(data: Uint8Array | string): Hex {
  return `0x${createHash('sha256').update(data).digest('hex')}`;
}

function bytesOf(hex: Hex): Buffer {
  return Buffer.from(hex.slice(2), 'hex');
}

export function leafOf(domain: string, path: string, contentType: string, contentSha256: Hex): Hex {
  const encoded = encodeAbiParameters(
    [{ type: 'string' }, { type: 'string' }, { type: 'string' }, { type: 'bytes32' }],
    [domain, path, contentType, contentSha256],
  );
  return sha256Hex(bytesOf(encoded));
}

export function hashPair(a: Hex, b: Hex): Hex {
  const [lo, hi] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return sha256Hex(Buffer.concat([bytesOf(lo), bytesOf(hi)]));
}

function levelsOf(leaves: Hex[]): Hex[][] {
  if (leaves.length === 0) throw new Error('no files to seal');
  if (new Set(leaves).size !== leaves.length) throw new Error('duplicate leaf');
  const levels: Hex[][] = [[...leaves].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))];
  while (levels[levels.length - 1]!.length > 1) {
    const cur = levels[levels.length - 1]!;
    const next: Hex[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? hashPair(cur[i]!, cur[i + 1]!) : cur[i]!);
    levels.push(next);
  }
  return levels;
}

export function merkleRoot(leaves: Hex[]): Hex {
  const levels = levelsOf(leaves);
  return levels[levels.length - 1]![0]!;
}

export function merkleProof(leaves: Hex[], leaf: Hex): Hex[] {
  const levels = levelsOf(leaves);
  let index = levels[0]!.indexOf(leaf);
  if (index < 0) throw new Error('leaf is not in the tree');
  const proof: Hex[] = [];
  for (let l = 0; l < levels.length - 1; l++) {
    const sibling = index ^ 1;
    if (sibling < levels[l]!.length) proof.push(levels[l]![sibling]!);
    index >>= 1;
  }
  return proof;
}

/// Same loop as SignetRegistry._checkApproved.
export function verifyProof(leaf: Hex, proof: Hex[], root: Hex): boolean {
  let node = leaf;
  for (const p of proof) node = hashPair(node, p);
  return node === root;
}
