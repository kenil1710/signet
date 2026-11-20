// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ITapeOutProcessor, ITapeOutTransistors, ITapeOutFactory} from "../src/spike/ITapeOut.sol";

/// Mints the NANDs and tapes out the Signet release-policy circuit (packages/circuit/artifacts/policy.json)
/// on processor #101, then checks eval() on all 512 inputs against the reference truth table.
///
/// SIMULATE ONLY:  forge script script/PolicyTapeout.s.sol --rpc-url xlayer --sender <dev address>
/// SEND (only after the team's explicit go-ahead):
///   forge script script/PolicyTapeout.s.sol --rpc-url xlayer --account signet-dev --broadcast --slow
contract PolicyTapeout is Script {
    ITapeOutFactory constant FACTORY = ITapeOutFactory(0x1f09DAeFA827f02CBb40967cc91b259763760761);
    ITapeOutProcessor constant CPU = ITapeOutProcessor(0x73153e5fd2Acac604D49d6ca9fea27b750718F22); // #101
    address constant BEACON = 0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C;
    address constant CIRCUIT_IMPL = 0x977f217887E085D298Cb3819cDAD5A0ee35F29B2;

    // Approved caps (wei). The script refuses to send if the chain asks for more.
    uint256 constant MAX_MINT_COST = 700_000_000_000_000; // 34 * 1e12 + 6.6e14 = 6.94e14
    uint256 constant MAX_TAPEOUT_FEE = 1_300_000_000_000_000;
    bytes32 constant NETLIST_SHA256 = 0x1a2e19870a19f653af4bddf049e1070461b7466577640a4cb341a579838b20db;

    function run() external {
        require(block.chainid == 196, "wrong chain");
        require(FACTORY.isCPU(address(CPU)), "cpu not registered");
        (bool ok, bytes memory impl) = BEACON.staticcall(abi.encodeWithSignature("implementation()"));
        require(ok && abi.decode(impl, (address)) == CIRCUIT_IMPL, "circuit implementation changed");

        string memory json = vm.readFile("../circuit/artifacts/policy.json");
        bytes memory netlist = vm.parseJsonBytes(json, ".netlist");
        bytes memory expected = vm.parseJsonBytes(json, ".expected");
        uint256 gates = vm.parseJsonUint(json, ".gates");
        require(sha256(netlist) == NETLIST_SHA256, "netlist is not the reviewed one");
        require(netlist.length == gates * 7 && expected.length == 512, "bad artifact");

        ITapeOutTransistors t = ITapeOutTransistors(CPU.transistors());
        uint256 nandId = t.NAND();
        uint256 have = t.balanceOf(msg.sender, nandId);
        uint256 need = have >= gates ? 0 : gates - have;
        require(t.supplyCap() - t.minted() >= need, "transistor supply exhausted");
        uint256 mintCost = need == 0 ? 0 : need * t.mintPrice() + t.protocolFee();
        uint256 fee = CPU.TAPEOUT_FEE();
        require(mintCost <= MAX_MINT_COST, "mint cost above approved cap");
        require(fee <= MAX_TAPEOUT_FEE, "tapeout fee above approved cap");

        console2.log("sender:", msg.sender);
        console2.log("gates:", gates);
        console2.log("NANDs to mint:", need);
        console2.log("mint cost (wei):", mintCost);
        console2.log("tapeout fee (wei):", fee);

        vm.startBroadcast();
        if (need > 0) t.mint{value: mintCost}(nandId, need);
        uint256 id = CPU.tapeout{value: fee}(netlist, 9, 2);
        vm.stopBroadcast();

        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gc) = CPU.circuitInfo(id);
        require(nIn == 9 && nOut == 2 && nState == 0 && gc == gates, "circuitInfo mismatch");
        require(keccak256(CPU.netlist(id)) == keccak256(netlist), "stored netlist mismatch");
        for (uint256 n; n < 512; n++) {
            bytes memory out = CPU.eval(id, abi.encodePacked(uint8(n & 0xff), uint8(n >> 8)));
            require(out.length == 1 && out[0] == expected[n], string.concat("eval mismatch at #", vm.toString(n)));
        }
        console2.log("policy circuit id:", id);
        console2.log("all 512 inputs match the reference");
    }
}
