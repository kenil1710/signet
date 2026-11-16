// Reference function for the Signet release-policy circuit.
// Written directly from docs/signet-spec.md, "Release-lock circuit and approval tiers", with no gate-level
// tricks, so it can serve as the independent check for the netlist (src/policy.ts).
//
//   Tier (r1 r0)          Rule (output PUBLISH)
//   00 Code only           >=1 approval and tS, or 3 of 3 with e
//   01 New external origin >=2 approvals and tS
//   10 New contract/spender>=2 approvals and tL, or 3 of 3 with e
//   11 Admin change        3 of 3 and tL, no fast lane
//   If f is set, PUBLISH is always 0.  UNFREEZE needs >=2 approvals.

/** Circuit input order. Input i is netlist signal 2 + i and bit i of the packed input (TAP-02 §2, §5). */
export const INPUTS = ['a0', 'a1', 'a2', 'tS', 'tL', 'r1', 'r0', 'f', 'e'] as const;
/** Circuit output order. Output j is bit j of the packed output. */
export const OUTPUTS = ['PUBLISH', 'UNFREEZE'] as const;

export type InputName = (typeof INPUTS)[number];
export type Inputs = Record<InputName, boolean>;
export type Outputs = { PUBLISH: boolean; UNFREEZE: boolean };

export function policy(x: Inputs): Outputs {
  const approvals = Number(x.a0) + Number(x.a1) + Number(x.a2);
  const all3 = approvals === 3;
  const tier = `${Number(x.r1)}${Number(x.r0)}`;

  let publish: boolean;
  switch (tier) {
    case '00':
      publish = (approvals >= 1 && x.tS) || (all3 && x.e);
      break;
    case '01':
      publish = approvals >= 2 && x.tS;
      break;
    case '10':
      publish = (approvals >= 2 && x.tL) || (all3 && x.e);
      break;
    case '11':
      publish = all3 && x.tL;
      break;
    default:
      throw new Error('unreachable');
  }
  if (x.f) publish = false;

  return { PUBLISH: publish, UNFREEZE: approvals >= 2 };
}

/** Input combination number n (0..2^9-1): input i is bit i of n. */
export function inputsOf(n: number): Inputs {
  const out = {} as Inputs;
  INPUTS.forEach((name, i) => (out[name] = ((n >> i) & 1) === 1));
  return out;
}

export const N_COMBINATIONS = 1 << INPUTS.length; // 512
