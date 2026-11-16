// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ITapeOutProcessor, ITapeOutTransistors, ITapeOutFactory} from "../../src/spike/ITapeOut.sol";
import {CircuitProbe} from "../../src/spike/CircuitProbe.sol";

/// Spike A on X Layer mainnet: mint 2 NAND transistors, tape out a 2-input AND, deploy CircuitProbe,
/// and call the circuit from it in a transaction.
///
/// SIMULATE ONLY (no transactions; safe):
///   forge script script/spike/SpikeA.s.sol --rpc-url xlayer --sender <dev address>
///
/// SEND (only after the human's explicit yes, per CLAUDE.md rule 2):
///   forge script script/spike/SpikeA.s.sol --rpc-url xlayer --account <keystore> --broadcast --slow
///
/// The dev account must be the separate dev wallet, never a prize or personal wallet.
contract SpikeA is Script {
    uint256 constant CHAIN_ID = 196;
    ITapeOutFactory constant FACTORY = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    // Processor index 101 on X Layer, cheapest open mint price in the 2026-11-16 scan.
    ITapeOutProcessor constant CPU = ITapeOutProcessor(0x73153e5fd2Acac604D49d6ca9fea27b750718F22);

    // 2-input AND: s4 = NAND(in0, in1); s5 = NAND(s4, s4). nIn = 2, nOut = 1. 2 NAND transistors.
    bytes constant AND_NETLIST = hex"00" hex"000002" hex"000003" hex"00" hex"000004" hex"000004";
    uint256 constant N_NAND = 2;

    // Refuse to run if prices moved above what the human approved (in wei).
    uint256 constant MAX_MINT_COST = 700_000_000_000_000; // 0.0007 OKB
    uint256 constant MAX_TAPEOUT_FEE = 1_300_000_000_000_000; // 0.0013 OKB

    function run() external {
        require(block.chainid == CHAIN_ID, "wrong chain");
        require(FACTORY.isCPU(address(CPU)), "cpu not registered");

        ITapeOutTransistors t = ITapeOutTransistors(CPU.transistors());
        uint256 nandId = t.NAND();
        require(t.supplyCap() - t.minted() >= N_NAND, "transistor supply exhausted");

        // Measured rule: msg.value >= n * mintPrice + protocolFee (flat per call); overpayment is not refunded.
        uint256 mintCost = N_NAND * t.mintPrice() + t.protocolFee();
        uint256 tapeoutFee = CPU.TAPEOUT_FEE();
        require(mintCost <= MAX_MINT_COST, "mint cost above approved cap");
        require(tapeoutFee <= MAX_TAPEOUT_FEE, "tapeout fee above approved cap");

        console2.log("sender:", msg.sender);
        console2.log("mint cost (wei):", mintCost);
        console2.log("tapeout fee (wei):", tapeoutFee);

        vm.startBroadcast();

        // 1. mint (skip if we already hold enough, e.g. on a re-run)
        uint256 have = t.balanceOf(msg.sender, nandId);
        if (have < N_NAND) t.mint{value: mintCost}(nandId, N_NAND - have);

        // 2. tape out
        uint256 id = CPU.tapeout{value: tapeoutFee}(AND_NETLIST, 2, 1);

        // 3. deploy the probe
        CircuitProbe probe = new CircuitProbe(CPU, id);

        // 4. call the circuit from a contract inside a transaction
        bool out = probe.record(true, true);

        vm.stopBroadcast();

        require(out, "AND(1,1) != 1");
        require(!probe.evaluate(true, false), "AND(1,0) != 0");
        console2.log("circuit id:", id);
        console2.log("probe:", address(probe));
    }
}
