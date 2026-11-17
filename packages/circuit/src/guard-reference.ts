// Reference function for the Signet Guard decision circuit: what Guard does with a signing request on a sealed
// site. Written from the spec ("Threat model", "Edge cases": observe mode, fail-open, unverified calls) with no
// gate-level tricks, so it is the independent check for the netlist (src/guard.ts).
//
// Guard computes the facts below for every signing request; the circuit decides. Exactly one output is 1.
//   checked = 0                         -> WARN   (fail-open: Guard could not read the sealed release)
//   a violation (page differs, target / spender / recipient not allowed, release revoked)
//        enforce mode                   -> BLOCK
//        observe mode                   -> WARN   (reported, never blocked)
//   no violation, but Guard can't decode the call or the gate is frozen
//                                       -> WARN
//   otherwise                           -> ALLOW

/** Circuit input order. Input i is netlist signal 2 + i and bit i of the packed input (TAP-02 §2, §5). */
export const GUARD_INPUTS = ['checked', 'pageMatches', 'targetSealed', 'spenderSealed', 'recipientOk', 'decoded', 'frozen', 'revoked', 'enforceMode'] as const;
/** Circuit output order. Output j is bit j of the packed output. */
export const GUARD_OUTPUTS = ['ALLOW', 'WARN', 'BLOCK'] as const;

export type GuardInputName = (typeof GUARD_INPUTS)[number];
export type GuardInputs = Record<GuardInputName, boolean>;
export type GuardOutputs = { ALLOW: boolean; WARN: boolean; BLOCK: boolean };

/// What each input means, for the truth table and the docs.
export const GUARD_MEANING: Record<GuardInputName, string> = {
  checked: 'Guard read this domain\'s release from two RPCs that agree, and its manifest hashed to the on-chain values (or did so less than 24 h ago)',
  pageMatches: 'no file the page loaded differs from the sealed release, and nothing unsealed was loaded',
  targetSealed: 'the contract called (or the EIP-712 verifying contract) is in the sealed allowlist for this chain',
  spenderSealed: 'any spender being given an allowance (approve, permit, Permit2, setApprovalForAll) is sealed; 1 when there is none',
  recipientOk: 'any recipient of tokens is the user, or is allowed by the project\'s sealed "transfers" rule; 1 when there is none',
  decoded: 'Guard understood the call (a known format); 0 for unknown calldata, eth_sign, contract creation',
  frozen: 'the project\'s gate is frozen (an incident is in progress)',
  revoked: 'the project\'s approvers revoked the current release',
  enforceMode: 'the gate is in enforce mode (otherwise observe mode: report, never block)',
};

export function guard(x: GuardInputs): GuardOutputs {
  let out: keyof GuardOutputs;
  if (!x.checked) out = 'WARN';
  else if (!x.pageMatches || !x.targetSealed || !x.spenderSealed || !x.recipientOk || x.revoked) out = x.enforceMode ? 'BLOCK' : 'WARN';
  else if (!x.decoded || x.frozen) out = 'WARN';
  else out = 'ALLOW';
  return { ALLOW: out === 'ALLOW', WARN: out === 'WARN', BLOCK: out === 'BLOCK' };
}

/** Input combination number n (0..511): input i is bit i of n. */
export function guardInputsOf(n: number): GuardInputs {
  const out = {} as GuardInputs;
  GUARD_INPUTS.forEach((name, i) => (out[name] = ((n >> i) & 1) === 1));
  return out;
}

/** The packed input number of a set of facts (what Guard sends to eval). */
export function guardInputNumber(x: GuardInputs): number {
  return GUARD_INPUTS.reduce((n, name, i) => n | (x[name] ? 1 << i : 0), 0);
}

/** The packed output byte: bit 0 ALLOW, bit 1 WARN, bit 2 BLOCK. */
export const packGuard = (o: GuardOutputs) => (o.ALLOW ? 1 : 0) | (o.WARN ? 2 : 0) | (o.BLOCK ? 4 : 0);
export const unpackGuard = (b: number): GuardOutputs => ({ ALLOW: (b & 1) === 1, WARN: (b & 2) === 2, BLOCK: (b & 4) === 4 });

export const GUARD_COMBINATIONS = 1 << GUARD_INPUTS.length; // 512
