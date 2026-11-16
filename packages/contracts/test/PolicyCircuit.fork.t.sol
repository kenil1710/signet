// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {ITapeOutProcessor, ITapeOutTransistors} from "../src/spike/ITapeOut.sol";

/// Tapes out the Signet policy circuit (packages/circuit/artifacts/policy.json) on a LOCAL fork of processor
/// #101 and checks eval() against the reference truth table for all 512 inputs. Nothing is broadcast.
/// SKIPPED when XLAYER_RPC_URL is unset (it is read from .env).
contract PolicyCircuitForkTest is Test {
    ITapeOutProcessor constant CPU = ITapeOutProcessor(0x73153e5fd2Acac604D49d6ca9fea27b750718F22); // #101
    address user = makeAddr("policyUser");

    bytes netlist;
    bytes expected;
    uint32 nIn;
    uint32 nOut;
    uint256 gates;
    bool forked;

    function setUp() public {
        string memory json = vm.readFile("../circuit/artifacts/policy.json");
        netlist = vm.parseJsonBytes(json, ".netlist");
        expected = vm.parseJsonBytes(json, ".expected");
        nIn = uint32(vm.parseJsonUint(json, ".nIn"));
        nOut = uint32(vm.parseJsonUint(json, ".nOut"));
        gates = vm.parseJsonUint(json, ".gates");

        string memory rpc = vm.envOr("XLAYER_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        vm.deal(user, 1 ether);
    }

    function test_policy_allInputs_eval_matchesReference() public {
        if (!forked) vm.skip(true);
        assertEq(nIn, 9);
        assertEq(nOut, 2);
        assertEq(expected.length, 512);
        assertEq(netlist.length, gates * 7);

        ITapeOutTransistors t = ITapeOutTransistors(CPU.transistors());
        uint256 nandId = t.NAND();
        uint256 mintCost = gates * t.mintPrice() + t.protocolFee();
        uint256 fee = CPU.TAPEOUT_FEE();
        vm.startPrank(user);
        uint256 g = gasleft();
        t.mint{value: mintCost}(nandId, gates);
        uint256 mintGas = g - gasleft();
        g = gasleft();
        uint256 id = CPU.tapeout{value: fee}(netlist, nIn, nOut);
        uint256 tapeoutGas = g - gasleft();
        vm.stopPrank();

        (uint32 i_, uint32 o_, uint32 st, uint32 gc) = CPU.circuitInfo(id);
        assertEq(i_, 9);
        assertEq(o_, 2);
        assertEq(st, 0);
        assertEq(gc, gates);
        assertEq(CPU.netlist(id), netlist);
        assertEq(t.balanceOf(user, nandId), 0, "all minted NANDs burned");

        uint256 maxEvalGas;
        for (uint256 n; n < 512; n++) {
            bytes memory input = abi.encodePacked(uint8(n & 0xff), uint8(n >> 8));
            g = gasleft();
            bytes memory out = CPU.eval(id, input);
            uint256 used = g - gasleft();
            if (used > maxEvalGas) maxEvalGas = used;
            assertEq(out.length, 1);
            assertEq(uint8(out[0]), uint8(expected[n]), string.concat("input #", vm.toString(n)));
        }
        console2.log("gates:", gates);
        console2.log("mint cost (wei):", mintCost);
        console2.log("tapeout fee (wei):", fee);
        console2.log("mint gas (execution):", mintGas);
        console2.log("tapeout gas (execution):", tapeoutGas);
        console2.log("max eval gas (contract -> eval):", maxEvalGas);
        console2.log("all 512 inputs match the reference");
    }
}
