// The policy circuit artifact: everything the fork test, the mainnet script and the docs need.
import { createHash } from 'node:crypto';
import { buildPolicy } from '../src/policy.ts';
import { policy, inputsOf, N_COMBINATIONS, INPUTS, OUTPUTS } from '../src/reference.ts';
import { toHex } from '../src/netlist.ts';

export function artifact() {
  const { netlist, builder } = buildPolicy();
  const expected = new Uint8Array(N_COMBINATIONS);
  for (let n = 0; n < N_COMBINATIONS; n++) {
    const o = policy(inputsOf(n));
    expected[n] = (o.PUBLISH ? 1 : 0) | (o.UNFREEZE ? 2 : 0);
  }
  return {
    name: 'signet-release-policy',
    version: 1,
    inputs: [...INPUTS],
    outputs: [...OUTPUTS],
    nIn: netlist.nIn,
    nOut: netlist.nOut,
    gates: builder.gates,
    netlist: toHex(netlist.bytes),
    netlistSha256: '0x' + createHash('sha256').update(netlist.bytes).digest('hex'),
    // expected[n] = packed outputs (bit0 PUBLISH, bit1 UNFREEZE) for packed input n (bit i = input i)
    expected: toHex(expected),
  };
}

import { buildGuard } from '../src/guard.ts';
import { guard, guardInputsOf, packGuard, GUARD_COMBINATIONS, GUARD_INPUTS, GUARD_OUTPUTS } from '../src/guard-reference.ts';

/// The Guard decision circuit artifact (artifacts/guard.json).
export function guardArtifact() {
  const { netlist, builder } = buildGuard();
  const expected = new Uint8Array(GUARD_COMBINATIONS);
  for (let n = 0; n < GUARD_COMBINATIONS; n++) expected[n] = packGuard(guard(guardInputsOf(n)));
  return {
    name: 'signet-guard-decision',
    version: 1,
    inputs: [...GUARD_INPUTS],
    outputs: [...GUARD_OUTPUTS],
    nIn: netlist.nIn,
    nOut: netlist.nOut,
    gates: builder.gates,
    netlist: toHex(netlist.bytes),
    netlistSha256: '0x' + createHash('sha256').update(netlist.bytes).digest('hex'),
    // expected[n] = packed outputs (bit0 ALLOW, bit1 WARN, bit2 BLOCK) for packed input n (bit i = input i)
    expected: toHex(expected),
  };
}
