// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {ITapeOutProcessor, ITapeOutTransistors, ITapeOutFactory} from "../../src/spike/ITapeOut.sol";
import {CircuitProbe} from "../../src/spike/CircuitProbe.sol";

/// Spike A dry run on a LOCAL fork of X Layer mainnet. Nothing is broadcast.
/// Run: XLAYER_RPC_URL=https://xlayerrpc.okx.com forge test --match-path test/spike/SpikeA.fork.t.sol -vv
/// Reported as SKIPPED when XLAYER_RPC_URL is unset.
contract SpikeAForkTest is Test {
    ITapeOutFactory constant FACTORY = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    // Cheapest open processor found in the 2026-11-16 scan (index 101). See docs/tapeout-interfaces.md.
    ITapeOutProcessor constant CPU = ITapeOutProcessor(0x73153e5fd2Acac604D49d6ca9fea27b750718F22);

    // 2-input AND: s4 = NAND(in0, in1); s5 = NAND(s4, s4) = AND. nIn = 2, nOut = 1.
    bytes constant AND_NETLIST = hex"00" hex"000002" hex"000003" hex"00" hex"000004" hex"000004";

    address user = makeAddr("spikeUser");
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("XLAYER_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        vm.deal(user, 1 ether); // fork-only balance
    }

    function _transistors() internal view returns (ITapeOutTransistors) {
        return ITapeOutTransistors(CPU.transistors());
    }

    /// Mint rule measured on X Layer (eth_call + this fork test): msg.value >= n * mintPrice + protocolFee.
    /// protocolFee is flat per mint() call, not per transistor. Overpayment is kept (no refund).
    function _mintCost(uint256 n) internal view returns (uint256) {
        ITapeOutTransistors t = _transistors();
        return n * t.mintPrice() + t.protocolFee();
    }

    function _mint(uint256 n) internal returns (uint256 paid) {
        ITapeOutTransistors t = _transistors();
        uint256 nandId = t.NAND();
        uint256 cost = _mintCost(n);
        uint256 before = user.balance;
        vm.prank(user);
        t.mint{value: cost}(nandId, n);
        assertEq(t.balanceOf(user, nandId), n);
        paid = before - user.balance;
        console2.log("mint cost (wei):", paid);
    }

    function test_spikeA_fullFlow() public {
        if (!forked) vm.skip(true);
        assertTrue(FACTORY.isCPU(address(CPU)), "not a registered cpu");

        // 1. mint 2 NAND transistors
        uint256 g = gasleft();
        uint256 mintPaid = _mint(2);
        console2.log("mint gas (approx):", g - gasleft());

        // 2. tape out the AND circuit
        uint256 fee = CPU.TAPEOUT_FEE();
        vm.prank(user);
        g = gasleft();
        uint256 id = CPU.tapeout{value: fee}(AND_NETLIST, 2, 1);
        console2.log("tapeout gas:", g - gasleft());
        console2.log("tapeout fee (wei):", fee);
        console2.log("circuit id:", id);
        assertEq(CPU.ownerOf(id), user);
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = CPU.circuitInfo(id);
        assertEq(nIn, 2);
        assertEq(nOut, 1);
        assertEq(nState, 0);
        assertEq(gates, 2);
        assertEq(CPU.netlist(id), AND_NETLIST);

        // 3. deploy the probe and read the circuit from Solidity
        vm.prank(user);
        CircuitProbe probe = new CircuitProbe(CPU, id);
        assertEq(probe.evaluate(false, false), false);
        assertEq(probe.evaluate(true, false), false);
        assertEq(probe.evaluate(false, true), false);
        assertEq(probe.evaluate(true, true), true);

        // 4. in-transaction call (the path ReleaseGate will use)
        vm.prank(user);
        g = gasleft();
        assertTrue(probe.record(true, true));
        console2.log("probe.record gas (outer):", g - gasleft());
        console2.log("total OKB wei spent on fees (mint + tapeout):", mintPaid + fee);
    }

    /// Pins the measured payment rule: exact minimum accepted, one wei less reverts "insufficient".
    function test_spikeA_mintPaymentRule() public {
        if (!forked) vm.skip(true);
        ITapeOutTransistors t = _transistors();
        uint256 nandId = t.NAND();
        for (uint256 n = 1; n <= 10; n += 9) {
            uint256 cost = _mintCost(n);
            uint256 snap = vm.snapshotState();
            vm.prank(user);
            vm.expectRevert(bytes("insufficient"));
            t.mint{value: cost - 1}(nandId, n);
            vm.prank(user);
            t.mint{value: cost}(nandId, n);
            assertEq(t.balanceOf(user, nandId), n);
            vm.revertToState(snap);
        }
    }

    /// tapeout must revert when the caller holds no transistors of this processor.
    function test_spikeA_tapeoutRejectsWithoutTransistors() public {
        if (!forked) vm.skip(true);
        uint256 fee = CPU.TAPEOUT_FEE();
        address nobody = makeAddr("nobody");
        vm.deal(nobody, 1 ether);
        vm.prank(nobody);
        vm.expectRevert();
        CPU.tapeout{value: fee}(AND_NETLIST, 2, 1);
    }

    function test_spikeA_wrongFeeReverts() public {
        if (!forked) vm.skip(true);
        vm.prank(user);
        vm.expectRevert(bytes("tapeout fee"));
        CPU.tapeout{value: 1}(AND_NETLIST, 2, 1);
    }
}
