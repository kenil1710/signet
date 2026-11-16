// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {ReleaseGate, ISignetDomains} from "../src/ReleaseGate.sol";
import {SignetRegistry} from "../src/SignetRegistry.sol";
import {
    IPolicyProcessor,
    ICircuitBeacon,
    ISiteRegistryWriter,
    IContainerOpener,
    ICircuitNFT
} from "../src/interfaces/ITapeOutPolicy.sol";

interface IERC721T {
    function safeTransferFrom(address from, address to, uint256 id) external;
}

/// End to end on a LOCAL fork of X Layer mainnet, no mocks: the real policy circuit #6 decides, the real beacon is
/// checked, and SignetRegistry (holding the real circuit #5) writes the manifest into the real shared container.
/// Nothing is broadcast. SKIPPED when XLAYER_RPC_URL is unset.
contract CoreForkTest is Test {
    address constant CPU = 0x73153e5fd2Acac604D49d6ca9fea27b750718F22; // processor #101
    address constant BEACON = 0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C;
    address constant IMPL = 0x977f217887E085D298Cb3819cDAD5A0ee35F29B2;
    address constant SITES = 0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6;
    address constant OPENER = 0x536adD8F30f03b69f6fbF29d425A816A0dC50106;
    address constant DEV = 0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE; // holds circuits #5 and #6
    address constant CONTAINER = 0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed;
    string constant DOMAIN = "demo.signet.example";

    SignetRegistry reg;
    ReleaseGate gate;
    address A0 = makeAddr("a0");
    address A1 = makeAddr("a1");
    address A2 = makeAddr("a2");
    address P = makeAddr("ci");

    function setUp() public {
        string memory rpc = vm.envOr("XLAYER_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        reg = new SignetRegistry(ISiteRegistryWriter(SITES), IContainerOpener(OPENER), ICircuitNFT(CPU), 5);
        vm.prank(DEV);
        IERC721T(CPU).safeTransferFrom(DEV, address(reg), 5);

        string memory json = vm.readFile("../circuit/artifacts/policy.json");
        ReleaseGate.Config memory c;
        c.approvers = [A0, A1, A2];
        c.proposer = P;
        c.recovery = makeAddr("recovery");
        c.policyProcessor = IPolicyProcessor(CPU);
        c.policyCircuitId = 6;
        c.policyNetlistSha256 = vm.parseJsonBytes32(json, ".netlistSha256");
        c.beacon = ICircuitBeacon(BEACON);
        c.expectedImplementation = IMPL;
        c.registry = ISignetDomains(address(reg));
        c.domains = new string[](1);
        c.domains[0] = DOMAIN;
        gate = new ReleaseGate(c);
    }

    function _approve(uint64 id, uint8 mask) internal {
        address[3] memory a = [A0, A1, A2];
        for (uint256 i; i < 3; i++) {
            if (mask & (1 << i) != 0) {
                vm.prank(a[i]);
                gate.approve(id);
            }
        }
    }

    function test_fork_endToEnd_realCircuitDecides_manifestLandsInSharedContainer() public {
        if (address(gate) == address(0)) vm.skip(true);
        assertEq(reg.sharedContainer(), CONTAINER);

        // 1. first release: tier 10, fast lane 3 of 3 + e
        bytes memory m1 = bytes('{"signet":"manifest/0","domain":"demo.signet.example","release":1}');
        bytes32 h1 = sha256(m1); // computed before vm.prank: sha256 is a precompile call and would take the prank
        vm.prank(P);
        uint64 r1 = gate.proposeRelease(h1, keccak256("allow"), keccak256("orig"), true);
        _approve(r1, 7);
        uint256 g = gasleft();
        gate.publish(r1);
        console2.log("publish gas (real eval on circuit #6):", g - gasleft());

        // 2. relay the approved manifest into projects/<domain>/manifest.json of the real shared container
        g = gasleft();
        reg.writeManifest(DOMAIN, m1);
        console2.log("writeManifest gas (real SiteRegistry):", g - gasleft());
        (uint32 size,, bytes32 h,, uint256 chunks) =
            ISiteRegistryWriter(SITES).fileInfo(CONTAINER, "projects/demo.signet.example/manifest.json");
        assertEq(chunks, 1);
        assertEq(size, m1.length);
        assertEq(h, sha256(m1));

        // 3. tier 00 with one approval: denied before 1 h, published after
        bytes memory m2 = bytes('{"signet":"manifest/0","domain":"demo.signet.example","release":2}');
        bytes32 h2 = sha256(m2);
        vm.prank(P);
        uint64 r2 = gate.proposeRelease(h2, keccak256("allow"), keccak256("orig"), false);
        assertEq(gate.getProposal(r2).tier, 0);
        _approve(r2, 2);
        vm.expectRevert(ReleaseGate.PolicyDenied.selector);
        gate.publish(r2);
        vm.warp(block.timestamp + 1 hours);
        gate.publish(r2);
        assertTrue(gate.isValidManifest(sha256(m2)));
        assertTrue(gate.isValidManifest(sha256(m1))); // grace window

        // 4. tier 01 with one approval: denied by the real circuit even after a long time
        vm.prank(P);
        uint64 r3 = gate.proposeRelease(keccak256("m3"), keccak256("allow"), keccak256("orig2"), false);
        _approve(r3, 1);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(ReleaseGate.PolicyDenied.selector);
        gate.publish(r3);

        // 5. frozen: nothing publishes; 2 approvals unfreeze through the real circuit's UNFREEZE output
        _approve(r3, 2);
        vm.prank(A2);
        gate.freeze();
        vm.expectRevert(ReleaseGate.PolicyDenied.selector);
        gate.publish(r3);
        vm.prank(A0);
        gate.approveUnfreeze();
        vm.prank(A1);
        gate.approveUnfreeze();
        gate.unfreeze();
        gate.publish(r3);
        console2.log("end-to-end on the real circuit: OK");
    }
}
