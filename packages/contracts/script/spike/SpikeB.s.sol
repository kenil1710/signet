// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ITapeOutProcessor, ITapeOutContainerOpener, ISiteRegistry} from "../../src/spike/ITapeOut.sol";

/// Spike B on X Layer mainnet: open the container of circuit #5 (processor #101, taped out in Spike A)
/// and write one small file to it through SiteRegistry. Read-back: script/spike/spikeB-verify.sh.
///
/// SIMULATE ONLY:  forge script script/spike/SpikeB.s.sol --rpc-url xlayer --sender <dev address>
/// SEND (only after the team's explicit go-ahead):
///   forge script script/spike/SpikeB.s.sol --rpc-url xlayer --account signet-dev --broadcast --slow
contract SpikeB is Script {
    ITapeOutProcessor constant CPU = ITapeOutProcessor(0x73153e5fd2Acac604D49d6ca9fea27b750718F22);
    uint256 constant CIRCUIT_ID = 5;
    ITapeOutContainerOpener constant OPENER = ITapeOutContainerOpener(0x536adD8F30f03b69f6fbF29d425A816A0dC50106);
    ISiteRegistry constant SITES = ISiteRegistry(0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6);

    string constant PATH = "signet/manifest-sample.json";
    string constant CONTENT_TYPE = "application/json";
    uint256 constant MAX_OPEN_FEE = 80_000_000_000_000_000; // 0.08 OKB, the approved amount

    function run() external {
        require(block.chainid == 196, "wrong chain");
        require(CPU.ownerOf(CIRCUIT_ID) == msg.sender, "sender does not hold circuit 5");

        address container = OPENER.accountOf(address(CPU), CIRCUIT_ID);
        bytes memory data = vm.readFileBinary("spike-data/manifest-sample.json");
        require(data.length <= SITES.CHUNK_MAX(), "file larger than one chunk");
        bytes32 h = sha256(data);
        bool opened = OPENER.isOpened(address(CPU), CIRCUIT_ID);
        uint256 fee = OPENER.FEE();
        if (!opened) require(fee <= MAX_OPEN_FEE, "open fee above approved cap");

        console2.log("sender:", msg.sender);
        console2.log("container:", container);
        console2.log("already opened:", opened);
        console2.log("open fee (wei):", opened ? 0 : fee);
        console2.log("file bytes:", data.length);
        console2.logBytes32(h);

        vm.startBroadcast();
        if (!opened) OPENER.open{value: fee}(address(CPU), CIRCUIT_ID); // exact fee; overpayment not tested
        SITES.putFile(container, PATH, CONTENT_TYPE, h, data);
        vm.stopBroadcast();

        (uint32 size,, bytes32 declared,, uint256 chunks) = SITES.fileInfo(container, PATH);
        bytes memory back = SITES.read(container, PATH);
        require(chunks == 1 && size == data.length && back.length == size, "size check failed");
        require(declared == h && sha256(back) == h, "sha256 check failed");
        console2.log("read back and sha256 verified");
    }
}
