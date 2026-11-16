// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {ReleaseGate} from "../src/ReleaseGate.sol";
import {SignetRegistry} from "../src/SignetRegistry.sol";
import {SignetFactory} from "../src/SignetFactory.sol";
import {PolicyMirror} from "../src/PolicyMirror.sol";
import {
    IPolicyProcessor,
    ICircuitBeacon,
    ISiteRegistryWriter,
    IContainerOpener,
    ICircuitNFT
} from "../src/interfaces/ITapeOutPolicy.sol";

interface ISiteRead {
    function read(address container, string calldata path) external view returns (bytes memory);
    function fallbackPath(address container) external view returns (string memory);
}

contract MirrorProbe {
    function eval(uint16 b) external pure returns (bool, bool) {
        return PolicyMirror.eval(b);
    }
}

/// End to end on a LOCAL fork of X Layer mainnet, no mocks: the real policy circuit #6, the real beacon, the real
/// processor code hash, and the real SiteRegistry with SignetRegistry as operator of the real shared container.
/// Nothing is broadcast. SKIPPED when XLAYER_RPC_URL is unset.
contract CoreForkTest is Test {
    address constant CPU = 0x73153e5fd2Acac604D49d6ca9fea27b750718F22; // processor #101
    bytes32 constant CPU_CODEHASH = 0x57aa306fd0be97087da3534e03398f5ff4efd533b5be4e45a405ce86fa6717d5;
    address constant BEACON = 0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C;
    address constant IMPL = 0x977f217887E085D298Cb3819cDAD5A0ee35F29B2;
    address constant SITES = 0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6;
    address constant OPENER = 0x536adD8F30f03b69f6fbF29d425A816A0dC50106;
    address constant DEV = 0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE; // holds circuits #5 and #6
    address constant CONTAINER = 0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed;
    string constant DOMAIN = "demo.signet.example";
    string constant JSON = "application/json";

    SignetRegistry reg;
    SignetFactory factory;
    ReleaseGate gate;
    bool forked;
    address A0 = makeAddr("a0");
    address A1 = makeAddr("a1");
    address A2 = makeAddr("a2");
    address P = makeAddr("ci");
    bytes32[] none;

    bytes constant ALLOWLIST = bytes('{"196":{"targets":[],"spenders":[],"eip712":[]}}');
    bytes constant ORIGINS = bytes('["https://xlayerrpc.okx.com"]');

    function setUp() public {
        string memory rpc = vm.envOr("XLAYER_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        string memory json = vm.readFile("../circuit/artifacts/policy.json");
        reg = new SignetRegistry(
            ISiteRegistryWriter(SITES), IContainerOpener(OPENER), CPU, 5, [makeAddr("o0"), makeAddr("o1"), makeAddr("o2")]
        );
        factory = new SignetFactory(
            address(reg),
            IPolicyProcessor(CPU),
            6,
            vm.parseJsonBytes32(json, ".netlistSha256"),
            CPU_CODEHASH,
            ICircuitBeacon(BEACON),
            IMPL
        );
        reg.initFactory(address(factory));
        // Circuit #5 stays with its holder; the holder makes the registry the container's operator.
        vm.prank(DEV);
        ISiteRegistryWriter(SITES).setOperator(CONTAINER, address(reg), 30 days);
        gate = _newGate(DOMAIN, address(0), 0);
    }

    function _newGate(string memory domain, address circuits, uint256 tokenId) internal returns (ReleaseGate) {
        SignetFactory.DomainInit[] memory d = new SignetFactory.DomainInit[](1);
        d[0] = SignetFactory.DomainInit(domain, circuits, tokenId);
        return ReleaseGate(factory.createGate([A0, A1, A2], P, makeAddr("recovery"), address(0), d));
    }

    function _approve(ReleaseGate g, uint64 id, uint8 mask) internal {
        address[3] memory a = [A0, A1, A2];
        for (uint256 i; i < 3; i++) {
            if (mask & (1 << i) != 0) {
                vm.prank(a[i]);
                g.approve(id);
            }
        }
    }

    function _leaf(string memory path, string memory ct, bytes memory data) internal pure returns (bytes32) {
        return sha256(abi.encode(path, ct, sha256(data)));
    }

    /// Hashes are computed before vm.prank: sha256 is a precompile call and would take the prank.
    function _release(ReleaseGate g, bytes32 root, bytes memory allow, bytes memory orig, bool e) internal returns (uint64 id) {
        bytes32 ha = sha256(allow);
        bytes32 ho = sha256(orig);
        vm.prank(P);
        id = g.proposeRelease(root, ha, ho, e);
    }

    // M-1 against the real circuit
    function test_fork_M1_mirrorEqualsRealCircuit6_all512Inputs() public {
        if (!forked) vm.skip(true);
        MirrorProbe m = new MirrorProbe();
        for (uint16 n; n < 512; n++) {
            bytes memory out = IPolicyProcessor(CPU).eval(6, abi.encodePacked(uint8(n & 0xff), uint8(n >> 8)));
            (bool pub, bool unf) = m.eval(n);
            assertEq(uint8(out[0]), (pub ? 1 : 0) | (unf ? 2 : 0), string.concat("input ", vm.toString(n)));
        }
    }

    function test_fork_endToEnd_realCircuit_realSiteRegistry_sharedContainer() public {
        if (!forked) vm.skip(true);
        assertEq(reg.sharedContainer(), CONTAINER);
        assertEq(ICircuitNFT(CPU).ownerOf(5), DEV); // not transferred

        // a 30,000-byte file list (2 chunks) is the only site file of release 1
        bytes memory filesJson = new bytes(30_000);
        for (uint256 i; i < filesJson.length; i += 31) filesJson[i] = bytes1(uint8(i));
        uint64 r1 = _release(gate, _leaf("signet/files.json", JSON, filesJson), ALLOWLIST, ORIGINS, true);
        _approve(gate, r1, 7);
        uint256 g = gasleft();
        gate.publish(r1); // first release: 3 of 3 + e, decided by the real circuit
        console2.log("publish gas (clone + real eval on circuit #6):", g - gasleft());

        g = gasleft();
        reg.writeFile(DOMAIN, "signet/files.json", JSON, filesJson, none);
        console2.log("writeFile gas, 30,000 bytes in 2 chunks:", g - gasleft());
        g = gasleft();
        reg.writeFile(DOMAIN, "signet/allowlist.json", JSON, ALLOWLIST, none);
        console2.log("writeFile gas, allowlist (49 bytes):", g - gasleft());
        reg.writeFile(DOMAIN, "signet/origins.json", JSON, ORIGINS, none);

        string memory base = "projects/demo.signet.example/";
        (uint32 size,, bytes32 h,, uint256 chunks) =
            ISiteRegistryWriter(SITES).fileInfo(CONTAINER, string.concat(base, "signet/files.json"));
        assertEq(size, 30_000);
        assertEq(chunks, 2);
        assertEq(h, sha256(filesJson));
        assertEq(sha256(ISiteRead(SITES).read(CONTAINER, string.concat(base, "signet/files.json"))), h); // TapeKit rule
        assertEq(ISiteRead(SITES).read(CONTAINER, string.concat(base, "signet/allowlist.json")), ALLOWLIST);

        // H-1 on the real chain: other allowlist bytes are refused
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        reg.writeFile(DOMAIN, "signet/allowlist.json", JSON, bytes('{"196":{"targets":["0xdead"]}}'), none);

        // tier 00, one approval: H-2 clock runs from the approval; denied before 1 h, published after
        uint64 r2 = _release(gate, keccak256("files-2"), ALLOWLIST, ORIGINS, false);
        assertEq(gate.getProposal(r2).tier, 0);
        vm.warp(block.timestamp + 2 hours);
        _approve(gate, r2, 2);
        vm.expectRevert(ReleaseGate.PolicyDenied.selector);
        gate.publish(r2);
        vm.warp(block.timestamp + 1 hours);
        gate.publish(r2);

        // frozen: nothing publishes; unfreezeAndPublish through the real circuit's UNFREEZE output
        uint64 r3 = _release(gate, keccak256("files-3"), ALLOWLIST, bytes('["https://new.example"]'), false);
        _approve(gate, r3, 3);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(A2);
        gate.freeze();
        vm.expectRevert(ReleaseGate.PolicyDenied.selector);
        gate.publish(r3);
        vm.prank(A0);
        gate.approveUnfreeze();
        vm.expectRevert(ReleaseGate.PolicyDenied.selector);
        gate.unfreezeAndPublish(r3);
        vm.prank(A1);
        gate.approveUnfreeze();
        gate.unfreezeAndPublish(r3);
        assertEq(gate.currentRelease(), r3);

        // M-7: revoked release, no more writes
        vm.prank(A0);
        gate.revoke(r3);
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        reg.writeFile(DOMAIN, "signet/allowlist.json", JSON, ALLOWLIST, none);
    }

    function test_fork_M1_beaconImplementationChanged_mirrorDecides() public {
        if (!forked) vm.skip(true);
        uint64 denied = _release(gate, keccak256("f1"), ALLOWLIST, ORIGINS, false);
        _approve(gate, denied, 1);
        uint64 ok = _release(gate, keccak256("f2"), ALLOWLIST, ORIGINS, true);
        _approve(gate, ok, 7);
        address other = makeAddr("upgradedImplementation");
        vm.mockCall(BEACON, abi.encodeWithSelector(ICircuitBeacon.implementation.selector), abi.encode(other));
        vm.expectRevert(ReleaseGate.PolicyDenied.selector);
        gate.publish(denied);
        vm.expectEmit(false, false, false, true, address(gate));
        emit ReleaseGate.PolicyFallbackActive(other);
        gate.publish(ok);
    }

    function test_fork_M3_realProcessorChecks() public {
        if (!forked) vm.skip(true);
        // circuit #5 (the 2-input AND) on the real processor is not the policy netlist
        uint64 id = _admin(ReleaseGate.Action.SetPolicyCircuit, abi.encode(CPU, uint256(5)));
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        gate.publish(id);
        // the beacon is a real contract but not a TapeOut processor proxy
        id = _admin(ReleaseGate.Action.SetPolicyCircuit, abi.encode(BEACON, uint256(6)));
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        gate.publish(id);
        // re-pointing at the genuine circuit #6 passes every check
        id = _admin(ReleaseGate.Action.SetPolicyCircuit, abi.encode(CPU, uint256(6)));
        gate.publish(id);
    }

    function _admin(ReleaseGate.Action a, bytes memory args) internal returns (uint64 id) {
        vm.prank(A0);
        id = gate.proposeAdmin(a, args);
        _approve(gate, id, 7);
        vm.warp(block.timestamp + 24 hours);
    }

    /// L-4: Signet's own gate takes circuit #5, keeps the registry as operator, and publishes Signet's own site
    /// at the container root, while free-tier projects keep working beside it.
    function test_fork_L4_gateHoldsRealCircuit5_ownSiteAndSharedProjects() public {
        if (!forked) vm.skip(true);
        ReleaseGate own = _newGate("signet.example", CPU, 5);
        vm.prank(DEV);
        ICircuitNFT(CPU).safeTransferFrom(DEV, address(own), 5); // real processor calls onERC721Received
        assertEq(ICircuitNFT(CPU).ownerOf(5), address(own));
        // measured: an NFT transfer clears the operator, so the registry can't write until it is renewed
        own.renewOperator(CPU, 5);

        bytes memory index = bytes("<!doctype html><title>Signet</title>");
        string memory inProjects = "projects/demo.signet.example/signet/allowlist.json";
        bytes32 lIndex = _leaf("index.html", "text/html", index);
        bytes32 lEvil = _leaf(inProjects, JSON, bytes("{}"));
        bytes32 root = lIndex < lEvil ? sha256(abi.encodePacked(lIndex, lEvil)) : sha256(abi.encodePacked(lEvil, lIndex));
        uint64 id = _release(own, root, ALLOWLIST, ORIGINS, true);
        _approve(own, id, 7);
        own.publish(id);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = lEvil;
        reg.writeFile("signet.example", "index.html", "text/html", index, proof);
        assertEq(ISiteRead(SITES).read(CONTAINER, "index.html"), index);
        proof[0] = lIndex;
        vm.expectRevert(SignetRegistry.BadPath.selector);
        reg.writeFile("signet.example", inProjects, JSON, bytes("{}"), proof);

        // a free-tier project in the same container
        uint64 r = _release(gate, keccak256("files"), ALLOWLIST, ORIGINS, true);
        _approve(gate, r, 7);
        gate.publish(r);
        reg.writeFile(DOMAIN, "signet/allowlist.json", JSON, ALLOWLIST, none);
        assertEq(ISiteRead(SITES).read(CONTAINER, inProjects), ALLOWLIST);

        // the old holder can no longer write; a non-TapeOut NFT callback is refused
        vm.prank(DEV);
        vm.expectRevert();
        ISiteRegistryWriter(SITES).putFile(CONTAINER, "index.html", "text/html", bytes32(0), "x");
        vm.prank(BEACON);
        vm.expectRevert(ReleaseGate.NotTapeOutCircuit.selector);
        own.onERC721Received(DEV, DEV, 1, "");
    }
}
