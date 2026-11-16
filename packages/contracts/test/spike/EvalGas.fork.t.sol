// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {ITapeOutProcessor, ITapeOutTransistors} from "../../src/spike/ITapeOut.sol";

/// Measures eval() gas vs NAND count for 10-input, 2-output circuits, on a LOCAL fork. Nothing is broadcast.
/// Run: XLAYER_RPC_URL=https://xlayerrpc.okx.com forge test --match-path test/spike/EvalGas.fork.t.sol -vv
contract EvalGasForkTest is Test {
    ITapeOutProcessor constant CPU = ITapeOutProcessor(0x73153e5fd2Acac604D49d6ca9fea27b750718F22);
    uint32 constant N_IN = 10;
    uint32 constant N_OUT = 2;
    address user = makeAddr("gasUser");
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("XLAYER_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        vm.deal(user, 10 ether);
    }

    /// Deterministic NAND-only netlist: every gate reads two earlier signals (inputs or gates).
    function _netlist(uint256 gates) internal pure returns (bytes memory nl) {
        for (uint256 k; k < gates; k++) {
            uint256 s = 2 + N_IN + k; // index of the signal this gate produces
            uint256 a = 2 + (k * 7 + 3) % (s - 2);
            uint256 b = 2 + (k * 13 + 5) % (s - 2);
            nl = bytes.concat(nl, hex"00", bytes3(uint24(a)), bytes3(uint24(b)));
        }
    }

    function _tapeout(uint256 gates) internal returns (uint256 id) {
        ITapeOutTransistors t = ITapeOutTransistors(CPU.transistors());
        uint256 nandId = t.NAND();
        uint256 cost = gates * t.mintPrice() + t.protocolFee();
        uint256 fee = CPU.TAPEOUT_FEE();
        vm.startPrank(user);
        t.mint{value: cost}(nandId, gates);
        id = CPU.tapeout{value: fee}(_netlist(gates), N_IN, N_OUT);
        vm.stopPrank();
    }

    /// Gas of the external eval() call as seen by a calling contract (includes call + proxy + beacon lookup).
    function _evalGas(uint256 id, uint256 nIn) internal view returns (uint256 maxGas) {
        uint256 nBytes = (nIn + 7) / 8;
        for (uint256 r; r < 8; r++) {
            bytes memory input = new bytes(nBytes);
            for (uint256 i; i < nBytes; i++) input[i] = bytes1(uint8(uint256(keccak256(abi.encode(id, r, i)))));
            uint256 g = gasleft();
            CPU.eval(id, input);
            uint256 used = g - gasleft();
            if (used > maxGas) maxGas = used;
        }
    }

    function test_evalGasVsGates() public {
        if (!forked) vm.skip(true);
        uint256[5] memory sizes = [uint256(2), 30, 60, 90, 120];
        for (uint256 i; i < sizes.length; i++) {
            uint256 id = _tapeout(sizes[i]);
            (,,, uint32 gateCount) = CPU.circuitInfo(id);
            assertEq(gateCount, sizes[i]);
            console2.log("synthetic 10in/2out gates:", sizes[i], "eval gas:", _evalGas(id, N_IN));
        }
        // Existing on-chain circuits of processor #101 (NAND-only, read via circuitInfo/netlist on 2026-11-16).
        console2.log("existing #3  (2in/1out,     3 gates) eval gas:", _evalGas(3, 2));
        console2.log("existing #2  (9in/5out,    72 gates) eval gas:", _evalGas(2, 9));
        console2.log("existing #1  (16in/16out, 1204 gates) eval gas:", _evalGas(1, 16));
    }
}
