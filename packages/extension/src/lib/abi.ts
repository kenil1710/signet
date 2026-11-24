// The few functions Guard reads. Signet's own contracts: packages/contracts/src. SiteRegistry.read / fileInfo:
// docs/tapeout-interfaces.md §8 (TAP-10 + measured).
import { parseAbi } from 'viem';

export const registryAbi = parseAbi([
  'function bindingOf(string domain) view returns (address gate, address container, string prefix)',
  'function domainCount() view returns (uint256)',
  'function domainsRange(uint256 start, uint256 count) view returns (string[])',
]);
export const gateAbi = parseAbi([
  'function activeRelease() view returns (bytes32 filesRoot, bytes32 allowlistHash, bytes32 originsHash, bool ok)',
  'function currentManifestHash() view returns (bytes32)',
  'function releases(uint64) view returns (bytes32 manifestHash, bytes32 filesRoot, bytes32 allowlistHash, bytes32 originsHash, uint40 publishedAt, uint64 prev)',
  'function getCurrentBlockTimestamp() view returns (uint256)', // Multicall3 (MULTICALL3): the chain's time, read at the same block
  'function currentRelease() view returns (uint64)',
  'function isValidManifest(bytes32 manifestHash) view returns (bool)',
  'function enforced() view returns (bool)',
  'function frozen() view returns (bool)',
  'function getApprovers() view returns (address[3])',
  // Guard 0.3.3: is a release about to be published (lib/publishing.ts)
  'function proposalCount() view returns (uint64)',
  'function approverSet() view returns (uint64)',
  'struct Proposal { uint8 kind; uint8 tier; bool emergency; bool executed; bool cancelled; uint8 approvals; uint8 proposerSlot; uint40 proposedAt; uint40 readyAt; uint64 baseRelease; uint64 baseline; uint64 approverSet; bytes32 filesRoot; bytes32 allowlistHash; bytes32 originsHash; bytes adminData; }',
  'function getProposal(uint64 id) view returns (Proposal)',
  'function policyInputs(uint64 id) view returns (uint16 bits)',
]);
export const siteAbi = parseAbi([
  'function read(address container, string path) view returns (bytes)',
  'function fileInfo(address container, string path) view returns (uint32 size, string contentType, bytes32 sha256Hash, uint40 updatedAt, uint256 chunkCount)',
]);

/// Multicall3, deployed at the same address on X Layer (and its forks): `getCurrentBlockTimestamp()` gives the chain's
/// time at the block both RPCs are read at.
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;
