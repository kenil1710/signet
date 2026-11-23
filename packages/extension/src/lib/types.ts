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
  /// The Guard decision circuit Guard asks before every signature (packages/circuit, docs/guard-truth-table.md).
  /// Absent: the local mirror of the same truth table decides.
  guardCircuit?: { processor: Hex; id: number; netlistSha256: Hex; beacon: Hex; implementation: Hex } | null;
  /// Other chains Guard may read for a sealed factory rule: two independent RPCs each, fixed at build time (a sealed
  /// release can't choose which RPCs Guard talks to). A chain not listed here can't pass a factory rule.
  chains?: Record<string, { rpcUrl: string; rpcUrl2: string }>;
}

/// "Contracts created by this factory" (allowlist.json, per chain): a target or spender that isn't listed passes only
/// if factory.<predict>(X, target.<id>()) == target for X = the signer or target.<roles[0]>(), and the signer is one
/// of target.<roles>(). Read on two RPCs that must agree; any failure means "not sealed" (strict).
export interface FactoryRule { factory: string; predict: string; id: string; roles: string[] }

export interface SealedFile { path: string; contentType: string; sha256: Hex; size: number; chunks?: Hex[] }
export interface Allowlist { [chainId: string]: { targets: string[]; spenders: string[]; eip712: string[]; transfers?: 'user' | 'allowlist' | 'any'; factories?: FactoryRule[] } }
/// Page mode "ssr" (origins.json "pages"): the HTML isn't sealed; every script file must be, and every inline script
/// must be a sealed hash or a data template (packages/cli/src/inline.ts). serviceWorkers: sealed paths allowed as one.
export interface PagesPolicy { mode: 'ssr'; inline: string[]; serviceWorkers: string[] }
export interface Sealed {
  manifestHash: Hex;
  filesRoot: Hex;
  allowlistHash: Hex;
  originsHash: Hex;
  allowlist: Allowlist;
  origins: string[];
  scripts: { url: string; integrity: string | null }[];
  files: SealedFile[];
  calls?: Record<string, number> | null; // signing-call counts sealed in files.json (Diff Guard); null = sealed before they existed
  pages?: PagesPolicy | null; // null/absent: a static site, the HTML is sealed like any file
}

/// What Guard knows about one sealed domain.
///   sealed      a release is published and its manifest hashed to the on-chain values
///   no-release  the domain is bound to a gate that has not published yet
///   revoked     the team revoked the current release
///   unbound     in the local list of sealed domains, but the registry no longer binds it
///   unverified  could not check (RPCs down or disagreeing, manifest missing or not matching): fail-open
///   unconfirmed the domain hasn't confirmed this gate (/.well-known/signet.json): treated as not sealed, fail-open,
///               never red, no verified copy. Stops a gate bound to a domain its owner doesn't control (squatting)
export type SiteStatus = 'sealed' | 'no-release' | 'revoked' | 'unbound' | 'unverified' | 'unconfirmed';
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

export type FileStatus = 'ok' | 'ok-sri' | 'ok-gateway' | 'ok-inline' | 'ok-ssr' | 'mismatch' | 'unknown' | 'unknown-origin' | 'sri-mismatch' | 'injected' | 'not-cached' | 'cross-origin' | 'no-crypto';
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
  pages: PagesPolicy | null; // ssr mode: the union of the valid releases' inline hashes and service workers
  proof?: { url: string; gate: string }; // unconfirmed: fetch this same-origin file and send it back (message 'proof')
}

export interface SignRequest { method: string; params: unknown; chainId: string | null; accounts: string[] }
export type Action = 'allow' | 'warn' | 'block';
export interface Decision {
  by: 'circuit' | 'circuit-cached' | 'mirror' | 'conflict' | 'none'; // who decided: the on-chain circuit, its cached answer,
  // the local mirror (only while the circuit is unreachable), conflict (the circuit answered but can't be trusted: the
  // strictest of circuit, mirror and WARN), or none (not a sealed tab: nothing was decided)
  why?: string; // for mirror and conflict: the reason
  input: number; // the circuit's packed input (docs/guard-truth-table.md row)
  action: Action; // the circuit's answer: allow / warn / block
  enforced: boolean; // enforce mode on the gate
  refused: boolean; // action === 'block'
  title: string;
  reason: string;
  details: string[];
}

export interface GuardEvent { at: number; domain: string; kind: 'page' | 'sign'; refused: boolean; title: string; reason: string; details: string[]; url: string }
