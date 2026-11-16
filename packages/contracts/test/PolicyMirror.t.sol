// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyMirror} from "../src/PolicyMirror.sol";
import {NetlistProcessor} from "./mocks/Mocks.sol";

contract MirrorHarness {
    function eval(uint16 b) external pure returns (bool, bool) {
        return PolicyMirror.eval(b);
    }
}

/// M-1: the Solidity mirror equals the policy circuit on all 512 inputs. Checked against the generated truth
/// table and against the real netlist bytes run by a TAP-02 evaluator. (Against the real circuit #6 on a fork:
/// test/Core.fork.t.sol.)
contract PolicyMirrorTest is Test {
    function test_M1_mirrorEqualsCircuit_all512Inputs() public {
        string memory json = vm.readFile("../circuit/artifacts/policy.json");
        bytes memory expected = vm.parseJsonBytes(json, ".expected");
        NetlistProcessor cpu = new NetlistProcessor();
        cpu.set(6, vm.parseJsonBytes(json, ".netlist"), 9, 2);
        MirrorHarness m = new MirrorHarness();
        assertEq(expected.length, 512);
        for (uint16 n; n < 512; n++) {
            (bool pub, bool unf) = m.eval(n);
            uint8 got = (pub ? 1 : 0) | (unf ? 2 : 0);
            assertEq(got, uint8(expected[n]), string.concat("truth table, input ", vm.toString(n)));
            bytes memory out = cpu.eval(6, abi.encodePacked(uint8(n & 0xff), uint8(n >> 8)));
            assertEq(got, uint8(out[0]), string.concat("netlist, input ", vm.toString(n)));
        }
    }

    function test_M1_mirrorIgnoresBitsAbove9() public {
        MirrorHarness m = new MirrorHarness();
        for (uint16 n; n < 512; n++) {
            (bool p1, bool u1) = m.eval(n);
            (bool p2, bool u2) = m.eval(n | 0xfe00);
            assertEq(p1, p2);
            assertEq(u1, u2);
        }
    }
}
