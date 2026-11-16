// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {ITapeOutProcessor, ITapeOutContainerOpener, ISiteRegistry} from "../../src/spike/ITapeOut.sol";

/// Spike B dry run on a LOCAL fork of X Layer: open the container of our circuit #5, write files through
/// SiteRegistry, read them back and verify length + SHA-256 the way TapeKit does (TAP-10 §7.1 step 4).
/// Nothing is broadcast. Reported as SKIPPED when XLAYER_RPC_URL is unset (it is read from .env).
contract SpikeBForkTest is Test {
    ITapeOutProcessor constant CPU = ITapeOutProcessor(0x73153e5fd2Acac604D49d6ca9fea27b750718F22); // #101
    uint256 constant CIRCUIT_ID = 5; // taped out in Spike A
    address constant DEV = 0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE; // holder of circuit 5
    ITapeOutContainerOpener constant OPENER = ITapeOutContainerOpener(0x536adD8F30f03b69f6fbF29d425A816A0dC50106);
    ISiteRegistry constant SITES = ISiteRegistry(0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6);

    address container;
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("XLAYER_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        vm.deal(DEV, 1 ether); // fork-only balance
        container = OPENER.accountOf(address(CPU), CIRCUIT_ID);
    }

    function _bytes(uint256 n, uint256 seed) internal pure returns (bytes memory b) {
        b = new bytes(n);
        for (uint256 i; i < n; i += 32) {
            bytes32 w = keccak256(abi.encode(seed, i));
            for (uint256 j; j < 32 && i + j < n; j++) b[i + j] = w[j];
        }
    }

    function _open() internal returns (uint256 gasUsed) {
        uint256 fee = OPENER.FEE();
        vm.prank(DEV);
        uint256 g = gasleft();
        OPENER.open{value: fee}(address(CPU), CIRCUIT_ID);
        gasUsed = g - gasleft();
    }

    /// TapeKit-style verification: declared size == bytes read, sha256(bytes) == declared hash.
    function _readAndVerify(string memory path, bytes memory expected) internal view {
        (uint32 size,, bytes32 h,, uint256 chunks) = SITES.fileInfo(container, path);
        assertGt(chunks, 0, "no such file");
        bytes memory got = SITES.read(container, path);
        assertEq(got.length, size, "size mismatch");
        assertEq(sha256(got), h, "sha256 mismatch");
        assertEq(keccak256(got), keccak256(expected), "content mismatch");
    }

    function test_spikeB_openRules() public {
        if (!forked) vm.skip(true);
        assertFalse(OPENER.isOpened(address(CPU), CIRCUIT_ID));
        assertFalse(SITES.canEdit(container, DEV));
        uint256 fee = OPENER.FEE();
        console2.log("open FEE (wei):", fee);

        // writing before opening must fail (hash computed first: sha256 is a precompile call and would eat the prank)
        bytes32 hx = sha256("x");
        vm.prank(DEV);
        vm.expectRevert();
        SITES.putFile(container, "a.txt", "text/plain", hx, "x");

        // underpaying must fail
        vm.prank(DEV);
        vm.expectRevert();
        OPENER.open{value: fee - 1}(address(CPU), CIRCUIT_ID);

        uint256 before = DEV.balance;
        uint256 g = _open();
        console2.log("open gas:", g);
        console2.log("open net cost (wei):", before - DEV.balance);
        assertTrue(OPENER.isOpened(address(CPU), CIRCUIT_ID));
        assertTrue(SITES.isOpenedContainer(container));
        assertTrue(SITES.canEdit(container, DEV));

        // someone who does not hold the circuit cannot write
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert();
        SITES.putFile(container, "a.txt", "text/plain", hx, "x");
    }

    function test_spikeB_writeReadVerify_costPerKB() public {
        if (!forked) vm.skip(true);
        _open();
        uint256[5] memory sizes = [uint256(300), 1024, 4096, 12_000, 24_000];
        for (uint256 i; i < sizes.length; i++) {
            bytes memory data = _bytes(sizes[i], i);
            string memory path = string.concat("spike/f", vm.toString(sizes[i]), ".bin");
            bytes32 h = sha256(data);
            vm.prank(DEV);
            uint256 g = gasleft();
            SITES.putFile(container, path, "application/octet-stream", h, data);
            uint256 used = g - gasleft();
            console2.log("putFile bytes:", sizes[i], "gas (execution):", used);
            _readAndVerify(path, data);
        }

        // second chunk on the 24,000-byte file
        bytes memory more = _bytes(24_000, 99);
        bytes memory whole = bytes.concat(_bytes(24_000, 4), more);
        // putFile declares the hash of the WHOLE file up front; append the rest.
        bytes32 hw = sha256(whole);
        bytes memory first = _bytes(24_000, 4);
        vm.prank(DEV);
        SITES.putFile(container, "spike/two.bin", "application/octet-stream", hw, first);
        vm.prank(DEV);
        uint256 g2 = gasleft();
        SITES.appendChunk(container, "spike/two.bin", 1, more);
        console2.log("appendChunk 24000 bytes gas (execution):", g2 - gasleft());
        _readAndVerify("spike/two.bin", whole);
        (,,,, uint256 chunks) = SITES.fileInfo(container, "spike/two.bin");
        assertEq(chunks, 2);
    }

    /// The small file Spike B will write on mainnet.
    function test_spikeB_manifestSample() public {
        if (!forked) vm.skip(true);
        _open();
        bytes memory data = vm.readFileBinary("spike-data/manifest-sample.json");
        bytes32 h = sha256(data);
        vm.prank(DEV);
        uint256 g = gasleft();
        SITES.putFile(container, "signet/manifest-sample.json", "application/json", h, data);
        console2.log("manifest bytes:", data.length, "putFile gas:", g - gasleft());
        _readAndVerify("signet/manifest-sample.json", data);
    }
}
