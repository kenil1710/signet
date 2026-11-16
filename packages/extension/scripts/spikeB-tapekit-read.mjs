// Spike B read-back through TapeKit's own kernel (TapeOutProtocol/TapeKit@37c617e, kernel/).
// Uses the kernel defaults: its built-in X Layer nodes (OKX + dRPC must agree), pinned block,
// ERC-1967 implementation check of SiteRegistry, and per-file length + SHA-256 verification.
// Read-only. Usage: node scripts/spikeB-tapekit-read.mjs [name] [path]
import { createKernel } from '@tapekit/kernel';

const name = process.argv[2] ?? '5.2.101'; // circuit 5, area 2 (X Layer), processor #101
const path = process.argv[3] ?? 'signet/manifest-sample.json';

const k = createKernel();
const res = await k.resolve(name);
console.log({ name, status: res.status, network: res.network, chainId: res.chainId, block: BigInt(res.block),
  circuits: res.circuits, tokenId: res.tokenId, container: res.container, holder: res.holder,
  opened: res.opened, paid: res.paid, storesOk: res.stores?.ok ?? res.stores });
if (!res.container) { console.error('no container resolved'); process.exit(1); }
const man = await k.manifest(res);
console.log({ paths: man.paths, truncated: man.truncated });
const f = await k.getFile(res, man, path);
if (!f) { console.error('file not found'); process.exit(1); }
console.log({ path: f.path, size: f.size, bytesRead: f.bytes.length, contentType: f.contentType,
  declaredSha: f.declaredSha, sha256: f.sha256, status: f.status, verified: f.verified });
process.exit(f.verified ? 0 : 1);
