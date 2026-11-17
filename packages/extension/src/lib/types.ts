// Shared shapes. Everything that crosses a message boundary is plain JSON.
export type Hex = `0x${string}`;

export interface Net {
  name: string;
  chainId: number;
  rpcUrl: string;
  rpcUrl2: string | null;
  registry: Hex | null; // SignetRegistry; null = Signet is not deployed on this network
  siteRegistry: Hex; // TapeOut SiteRegistry (docs/tapeout-interfaces.md §8)
  /// The Signet gateway (packages/gateway) that "Open verified copy" uses, with the SHA-256 of its three own
  /// files so Guard can tell a changed gateway. Absent: the copy is shown as a preview inside the extension.
  gateway?: { url: string; pins: Record<string, string> } | null;
}

export interface SealedFile { path: string; contentType: string; sha256: Hex; size: number }
export interface Allowlist { [chainId: string]: { targets: string[]; spenders: string[]; eip712: string[]; transfers?: 'user' | 'allowlist' | 'any' } }
export interface Sealed {
  manifestHash: Hex;
  filesRoot: Hex;
  allowlistHash: Hex;
  originsHash: Hex;
  allowlist: Allowlist;
  origins: string[];
  scripts: { url: string; integrity: string | null }[];
  files: SealedFile[];
}

/// What Guard knows about one sealed domain.
///   sealed      a release is published and its manifest hashed to the on-chain values
///   no-release  the domain is bound to a gate that has not published yet
///   revoked     the team revoked the current release
///   unbound     in the local list of sealed domains, but the registry no longer binds it
///   unverified  could not check (RPCs down or disagreeing, manifest missing or not matching): fail-open
export type SiteStatus = 'sealed' | 'no-release' | 'revoked' | 'unbound' | 'unverified';
export interface SiteState {
  domain: string;
  status: SiteStatus;
  reason: string;
  checkedAt: number; // ms; when the chain was last read successfully
  stale: boolean; // true: the chain could not be read just now and this is the cached answer
  gate: Hex | null;
  container: Hex | null;
  prefix: string;
  enforced: boolean;
  frozen: boolean;
  release: number;
  approvers: string[];
  current: Hex | null; // manifest hash of the current release
  valid: Hex[]; // manifest hashes a page may match now (current, and the previous one during its grace window)
  manifests: Record<string, Sealed>; // by manifest hash; at most the last two
}

export type FileStatus = 'ok' | 'ok-sri' | 'ok-gateway' | 'mismatch' | 'unknown' | 'unknown-origin' | 'sri-mismatch' | 'not-cached' | 'cross-origin' | 'no-crypto';
export interface FileResult { url: string; status: FileStatus; sha256?: string; note?: string }
export type PageStatus = 'ok' | 'tampered' | 'unverified';
export interface PageReport { url: string; status: PageStatus; files: FileResult[] }

/// What the content script gets for a sealed domain. Null = not a sealed domain: do nothing at all.
export interface PageInfo {
  domain: string;
  site: SiteStatus;
  reason: string;
  enforce: boolean;
  bypass: boolean; // the user chose "go back to the site": no redirect to the warning page, signing stays blocked
  hashes: Record<string, string[]>; // sealed path -> the SHA-256 values valid now
  origins: string[];
  scripts: { url: string; integrity: string | null }[];
  gateway: Record<string, string> | null; // on the gateway's copy of this domain: the pinned hashes of the gateway's own files
}

export interface SignRequest { method: string; params: unknown; chainId: string | null; accounts: string[] }
export type Action = 'allow' | 'warn' | 'block';
export interface Decision {
  action: Action; // what the policy says
  enforced: boolean; // false in observe mode or when Guard could not check: a "block" is then only recorded
  refused: boolean; // action === 'block' && enforced
  title: string;
  reason: string;
  details: string[];
}

export interface GuardEvent { at: number; domain: string; kind: 'page' | 'sign'; refused: boolean; title: string; reason: string; details: string[]; url: string }
