// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Solidity mirror of the Signet release-policy circuit (circuit #6 on processor #101, X Layer).
/// Verified equal to the circuit on all 512 inputs (test/PolicyMirror.t.sol, and against the real circuit in
/// test/Core.fork.t.sol). ReleaseGate uses it only if the circuit beacon's implementation ever changes.
/// Input bits 0..8 = a0 a1 a2 tS tL r1 r0 f e (docs/policy-truth-table.md).
library PolicyMirror {
    function eval(uint16 b) internal pure returns (bool publish, bool unfreeze) {
        uint256 n = (b & 1) + ((b >> 1) & 1) + ((b >> 2) & 1);
        bool r1 = b & 32 != 0;
        bool r0 = b & 64 != 0;
        unfreeze = n >= 2;
        if (b & 128 != 0) return (false, unfreeze); // frozen
        uint256 need = 1 + (r1 ? 1 : 0) + (r0 ? 1 : 0);
        bool timelock = r1 ? b & 16 != 0 : b & 8 != 0;
        publish = (timelock && n >= need) || (!r0 && b & 256 != 0 && n == 3);
    }
}
