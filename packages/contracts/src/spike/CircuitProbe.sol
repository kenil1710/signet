// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ITapeOutProcessor} from "./ITapeOut.sol";

/// Spike A: the smallest contract that calls a taped-out TapeOut circuit and reads its output.
/// Test circuit: 2-input AND (two NANDs). Not production code.
contract CircuitProbe {
    ITapeOutProcessor public immutable cpu;
    uint256 public immutable circuitId;

    bool public lastOut;

    event Evaluated(bool a, bool b, bool out, uint256 gasUsed);

    constructor(ITapeOutProcessor cpu_, uint256 circuitId_) {
        cpu = cpu_;
        circuitId = circuitId_;
    }

    /// Pack two input bits LSB-first (TAP-02 §5): input 0 = bit 0, input 1 = bit 1.
    function evaluate(bool a, bool b) public view returns (bool) {
        uint8 packed = (a ? 1 : 0) | (b ? 2 : 0);
        bytes memory out = cpu.eval(circuitId, abi.encodePacked(packed));
        require(out.length == 1, "probe: bad output length");
        return uint8(out[0]) & 1 == 1;
    }

    /// State-changing variant: proves the call works inside a real transaction, and records gas.
    function record(bool a, bool b) external returns (bool out) {
        uint256 g = gasleft();
        out = evaluate(a, b);
        lastOut = out;
        emit Evaluated(a, b, out, g - gasleft());
    }
}
