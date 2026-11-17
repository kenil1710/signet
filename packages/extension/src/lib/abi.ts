// The few functions Guard reads. Signet's own contracts: packages/contracts/src. SiteRegistry.read / fileInfo:
// docs/tapeout-interfaces.md §8 (TAP-10 + measured).
import { parseAbi } from 'viem';

export const registryAbi = parseAbi([
  'function bindingOf(string domain) view returns (address gate, address container, string prefix)',
  'event Claimed(string domain, address indexed gate, address circuits, uint256 tokenId)',
  'event Transferred(string domain, address indexed fromGate, address indexed toGate)',
]);
export const gateAbi = parseAbi([
  'function activeRelease() view returns (bytes32 filesRoot, bytes32 allowlistHash, bytes32 originsHash, bool ok)',
  'function currentManifestHash() view returns (bytes32)',
  'function currentRelease() view returns (uint64)',
  'function isValidManifest(bytes32 manifestHash) view returns (bool)',
  'function enforced() view returns (bool)',
  'function frozen() view returns (bool)',
  'function getApprovers() view returns (address[3])',
]);
export const siteAbi = parseAbi([
  'function read(address container, string path) view returns (bytes)',
  'function fileInfo(address container, string path) view returns (uint32 size, string contentType, bytes32 sha256Hash, uint40 updatedAt, uint256 chunkCount)',
]);
