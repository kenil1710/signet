// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {ITapeOutProcessor, ITapeOutContainerOpener, ISiteRegistry} from "../../src/spike/ITapeOut.sol";

interface IERC721Transfer {
    function safeTransferFrom(address from, address to, uint256 id) external;
}

/// Minimal contract that holds a circuit NFT and writes through SiteRegistry.
contract HolderProbe {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function put(ISiteRegistry s, address c, string calldata p, bytes calldata data) external {
        s.putFile(c, p, "application/json", sha256(data), data);
    }
}

/// Question before building SignetRegistry: can a CONTRACT that holds a circuit NFT write to SiteRegistry?
/// LOCAL fork of X Layer mainnet; nothing is broadcast. SKIPPED when XLAYER_RPC_URL is unset.
contract ContractHolderForkTest is Test {
    ITapeOutProcessor constant CPU = ITapeOutProcessor(0x73153e5fd2Acac604D49d6ca9fea27b750718F22);
    uint256 constant ID = 5; // Signet's shared container circuit (opened in Spike B)
    address constant DEV = 0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE;
    ITapeOutContainerOpener constant OPENER = ITapeOutContainerOpener(0x536adD8F30f03b69f6fbF29d425A816A0dC50106);
    ISiteRegistry constant SITES = ISiteRegistry(0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6);

    function test_contractHolderCanWrite() public {
        string memory rpc = vm.envOr("XLAYER_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc, 76_306_000); // before circuit #5 moved into the site gate (block 76,306,374)
        address container = OPENER.accountOf(address(CPU), ID);
        assertTrue(OPENER.isOpened(address(CPU), ID));

        HolderProbe holder = new HolderProbe();
        vm.prank(DEV);
        IERC721Transfer(address(CPU)).safeTransferFrom(DEV, address(holder), ID);
        assertEq(CPU.ownerOf(ID), address(holder));
        console2.log("canEdit(holder contract):", SITES.canEdit(container, address(holder)));
        console2.log("canEdit(old EOA holder):", SITES.canEdit(container, DEV));
        console2.log("still opened after transfer:", OPENER.isOpened(address(CPU), ID));

        bytes memory data = bytes('{"probe":"contract holder"}');
        holder.put(SITES, container, "projects/example.org/manifest.json", data);
        (uint32 size,, bytes32 h,, uint256 chunks) = SITES.fileInfo(container, "projects/example.org/manifest.json");
        bytes memory back = SITES.read(container, "projects/example.org/manifest.json");
        assertEq(chunks, 1);
        assertEq(size, data.length);
        assertEq(sha256(back), h);
        assertEq(h, sha256(data));
        console2.log("contract holder wrote and read back OK");

        // and the previous EOA holder can no longer write
        vm.prank(DEV);
        vm.expectRevert();
        SITES.putFile(container, "x.txt", "text/plain", bytes32(0), "x");
    }
}
