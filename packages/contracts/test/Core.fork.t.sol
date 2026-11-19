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
import {ITapeOutProcessor, ITapeOutTransistors, ITapeOutContainerOpener} from "../src/spike/ITapeOut.sol";

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
/// processor code hash, and the real SiteRegistry with SignetRegistry as operator of circuit #5's container.
/// That one container holds Signet's own site under `signet/<domain>/` and free-tier projects under
/// `projects/<domain>/`.
/// Circuit #5 stays with its holder (the dev wallet until 2026-11-19, Signet's site gate since; read at the fork block).
/// Nothing is broadcast. SKIPPED when XLAYER_RPC_URL is unset.
contract CoreForkTest is Test {
    address constant CPU = 0x73153e5fd2Acac604D49d6ca9fea27b750718F22; // processor #101
    bytes32 constant CPU_CODEHASH = 0x57aa306fd0be97087da3534e03398f5ff4efd533b5be4e45a405ce86fa6717d5;
    address constant BEACON = 0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C;
    address constant IMPL = 0x977f217887E085D298Cb3819cDAD5A0ee35F29B2;
    address constant SITES = 0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6;
    address constant OPENER = 0x536adD8F30f03b69f6fbF29d425A816A0dC50106;
    address constant DEV = 0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE; // signet-dev: held circuits #5 and #6 (#5 moved to the site gate 2026-11-19)
    address constant SHARED = 0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed; // circuit #5's container
    string constant DOMAIN = "demo.signet.example";
    string constant SITE = "signet.example";
    string constant JSON = "application/json";

    SignetRegistry reg;
    SignetFactory factory;
    ReleaseGate gate; // a free-tier project
    ReleaseGate site; // Signet's own site
    bool forked;
    address A0 = makeAddr("a0");
    address A1 = makeAddr("a1");
    address A2 = makeAddr("a2");
    address P = makeAddr("ci");
    bytes32[] none;

    bytes constant ALLOWLIST = bytes('{"196":{"targets":[],"spenders":[],"eip712":[]}}');
    bytes constant ORIGINS = bytes('["https://xlayerrpc.okx.com"]');
    address holder; // circuit #5's holder at the fork block

    function setUp() public {
        string memory rpc = vm.envOr("XLAYER_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        string memory json = vm.readFile("../circuit/artifacts/policy.json");
        // the factory and Signet's site gate are fixed in the registry at deployment, as predicted addresses
        address predictedFactory = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        reg = new SignetRegistry(
            ISiteRegistryWriter(SITES), IContainerOpener(OPENER), CPU, 5, predictedFactory, vm.computeCreateAddress(predictedFactory, 2)
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
        require(address(factory) == predictedFactory, "factory address");
        holder = ICircuitNFT(CPU).ownerOf(5); // whoever holds circuit #5 at the fork block (the site gate since 2026-11-19)
        vm.prank(holder); // the holder keeps circuit #5 and makes the registry the container's operator
        ISiteRegistryWriter(SITES).setOperator(SHARED, address(reg), 30 days);
        site = _newGate(SITE, address(0), 0); // the factory's first gate
        require(address(site) == reg.signetSiteGate(), "site gate address");
        gate = _newGate(DOMAIN, address(0), 0);
    }

    function _newGate(string memory domain, address circuits, uint256 tokenId) internal returns (ReleaseGate) {
        SignetFactory.DomainInit[] memory d = new SignetFactory.DomainInit[](1);
        bytes32 salt = keccak256(bytes(domain));
        d[0] = SignetFactory.DomainInit(domain, salt, circuits, tokenId);
        factory.commit(factory.commitmentOf(domain, salt, address(this)));
        vm.roll(block.number + 2);
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

    function _leaf(string memory domain, string memory path, string memory ct, bytes memory data) internal pure returns (bytes32) {
        return sha256(abi.encode(domain, path, ct, sha256(data)));
    }

    function _write(string memory d, string memory path, string memory ct, bytes memory data, bytes32[] memory proof) internal {
        reg.writeFile(SignetRegistry.File(d, path, ct, data, proof));
    }

    /// Hashes are computed before vm.prank: sha256 is a precompile call and would take the prank.
    function _release(ReleaseGate g, bytes32 root, bytes memory allow, bytes memory orig, bool e) internal returns (uint64 id) {
        bytes32 ha = sha256(allow);
        bytes32 ho = sha256(orig);
        vm.prank(P);
        id = g.proposeRelease(root, ha, ho, e);
    }

    function _publishFast(ReleaseGate g, bytes32 root) internal returns (uint64 id) {
        id = _release(g, root, ALLOWLIST, ORIGINS, true);
        _approve(g, id, 7);
        g.publish(id);
    }

    // M-1 (first review) against the real circuit
    function test_fork_mirrorEqualsRealCircuit6_all512Inputs() public {
        if (!forked) vm.skip(true);
        MirrorProbe m = new MirrorProbe();
        for (uint16 n; n < 512; n++) {
            bytes memory out = IPolicyProcessor(CPU).eval(6, abi.encodePacked(uint8(n & 0xff), uint8(n >> 8)));
            (bool pub, bool unf) = m.eval(n);
            assertEq(uint8(out[0]), (pub ? 1 : 0) | (unf ? 2 : 0), string.concat("input ", vm.toString(n)));
        }
    }

    function test_fork_endToEnd_realCircuit_realSiteRegistry() public {
        if (!forked) vm.skip(true);
        assertEq(reg.sharedContainer(), SHARED);
        assertEq(ICircuitNFT(CPU).ownerOf(5), holder); // not transferred by any of this

        // release 1: the largest allowed file (48,000 bytes, 2 chunks) as the file list
        bytes memory filesJson = new bytes(48_000);
        for (uint256 i; i < filesJson.length; i += 31) filesJson[i] = bytes1(uint8(i));
        uint64 r1 = _release(gate, _leaf(DOMAIN, "signet/files.json", JSON, filesJson), ALLOWLIST, ORIGINS, true);
        _approve(gate, r1, 7);
        uint256 g = gasleft();
        gate.publish(r1); // first release: 3 of 3 + e, decided by the real circuit
        console2.log("publish gas (clone + real eval on circuit #6):", g - gasleft());

        g = gasleft();
        _write(DOMAIN, "signet/files.json", JSON, filesJson, none);
        uint256 used = g - gasleft();
        console2.log("writeFile gas, 48,000 bytes (the maximum, 2 chunks):", used);
        assertLt(used + 1_000_000, 16_777_216); // execution + calldata (~0.8M) stays under a 2^24 cap
        g = gasleft();
        _write(DOMAIN, "signet/allowlist.json", JSON, ALLOWLIST, none);
        console2.log("writeFile gas, allowlist (49 bytes):", g - gasleft());
        _write(DOMAIN, "signet/origins.json", JSON, ORIGINS, none);

        string memory base = "projects/demo.signet.example/";
        (uint32 size,, bytes32 h,, uint256 chunks) =
            ISiteRegistryWriter(SITES).fileInfo(SHARED, string.concat(base, "signet/files.json"));
        assertEq(size, 48_000);
        assertEq(chunks, 2);
        assertEq(h, sha256(filesJson));
        assertEq(sha256(ISiteRead(SITES).read(SHARED, string.concat(base, "signet/files.json"))), h); // TapeKit rule
        assertEq(ISiteRead(SITES).read(SHARED, string.concat(base, "signet/allowlist.json")), ALLOWLIST);

        vm.expectRevert(SignetRegistry.NotApproved.selector); // other allowlist bytes are refused
        _write(DOMAIN, "signet/allowlist.json", JSON, bytes('{"196":{"targets":["0xdead"]}}'), none);

        // tier 00, one approval: the clock runs from that approval; denied before 1 h, published after
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

        // revoke r3: no more writes; the next proposal is compared with r2, so a new origin is tier 01 again
        vm.prank(A0);
        gate.revoke(r3);
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        _write(DOMAIN, "signet/allowlist.json", JSON, ALLOWLIST, none);
        uint64 r4 = _release(gate, keccak256("files-4"), ALLOWLIST, bytes('["https://new.example"]'), false);
        assertEq(gate.getProposal(r4).tier, 1);
        // two approvers clear a file of the revoked release from the real container
        vm.prank(A1);
        gate.voteRemoveFile(DOMAIN, "signet/allowlist.json");
        vm.prank(A2);
        gate.voteRemoveFile(DOMAIN, "signet/allowlist.json");
        (,,,, chunks) = ISiteRegistryWriter(SITES).fileInfo(SHARED, string.concat(base, "signet/allowlist.json"));
        assertEq(chunks, 0);
    }

    /// One container, two worlds: Signet's own site under signet/, projects under projects/<domain>/.
    function test_fork_container_signetSiteAndProjects_neverMix() public {
        if (!forked) vm.skip(true);
        bytes memory index = bytes("<!doctype html><title>Signet dashboard</title>");
        string memory deep = "projects/demo.signet.example/signet/allowlist.json";
        bytes32 lIndex = _leaf(SITE, "index.html", "text/html", index);
        bytes32 lDeep = _leaf(SITE, deep, JSON, bytes("{}"));
        _publishFast(site, lIndex < lDeep ? sha256(abi.encodePacked(lIndex, lDeep)) : sha256(abi.encodePacked(lDeep, lIndex)));
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = lDeep;
        _write(SITE, "index.html", "text/html", index, proof);
        assertEq(ISiteRead(SITES).read(SHARED, "signet/signet.example/index.html"), index);
        // a "projects/..." path approved by Signet's own gate lands inside signet/, not in the project
        proof[0] = lIndex;
        _write(SITE, deep, JSON, bytes("{}"), proof);
        (,,,, uint256 chunks) = ISiteRegistryWriter(SITES).fileInfo(SHARED, deep);
        assertEq(chunks, 0);
        vm.expectRevert(SignetRegistry.BadPath.selector);
        _write(SITE, "../projects/demo.signet.example/x", JSON, bytes("{}"), none);

        // a project: its own "signet/index.html" lands inside projects/<domain>/, Signet's page is untouched
        bytes memory fake = bytes("<h1>fake dashboard</h1>");
        _publishFast(gate, _leaf(DOMAIN, "signet/index.html", "text/html", fake));
        _write(DOMAIN, "signet/index.html", "text/html", fake, none);
        _write(DOMAIN, "signet/allowlist.json", JSON, ALLOWLIST, none);
        assertEq(ISiteRead(SITES).read(SHARED, "projects/demo.signet.example/signet/index.html"), fake);
        assertEq(ISiteRead(SITES).read(SHARED, "signet/signet.example/index.html"), index);
        assertEq(ISiteRead(SITES).read(SHARED, deep), ALLOWLIST);

        // the Spike B file is still there, untouched, and no fallback was ever set (hash routing)
        (,,,, chunks) = ISiteRegistryWriter(SITES).fileInfo(SHARED, "signet/manifest-sample.json");
        assertEq(chunks, 1);
        assertEq(ISiteRead(SITES).fallbackPath(SHARED), "");
        assertEq(ICircuitNFT(CPU).ownerOf(5), holder);
    }

    function test_fork_fallbackToMirror_beaconChanged_orCircuitCallFails() public {
        if (!forked) vm.skip(true);
        uint64 denied = _release(gate, keccak256("f1"), ALLOWLIST, ORIGINS, false);
        _approve(gate, denied, 1);
        uint64 ok = _release(gate, keccak256("f2"), ALLOWLIST, ORIGINS, true);
        _approve(gate, ok, 7);
        uint256 snap = vm.snapshotState();

        address other = makeAddr("upgradedImplementation");
        vm.mockCall(BEACON, abi.encodeWithSelector(ICircuitBeacon.implementation.selector), abi.encode(other));
        vm.expectRevert(ReleaseGate.PolicyDenied.selector);
        gate.publish(denied);
        vm.expectEmit(false, false, false, true, address(gate));
        emit ReleaseGate.PolicyFallbackBeaconChanged(other);
        gate.publish(ok);

        vm.revertToState(snap);
        vm.clearMockedCalls();
        vm.mockCallRevert(CPU, abi.encodeWithSelector(IPolicyProcessor.eval.selector), "down");
        vm.expectRevert(ReleaseGate.PolicyDenied.selector);
        gate.publish(denied);
        vm.expectEmit(false, false, false, true, address(gate));
        emit ReleaseGate.PolicyFallbackEvalFailed();
        gate.publish(ok);
    }

    function test_fork_circuitSwap_realProcessorChecks() public {
        if (!forked) vm.skip(true);
        uint64 id = _admin(ReleaseGate.Action.SetPolicyCircuit, abi.encode(CPU, uint256(5))); // the 2-input AND
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        gate.publish(id);
        id = _admin(ReleaseGate.Action.SetPolicyCircuit, abi.encode(BEACON, uint256(6))); // not a processor proxy
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        gate.publish(id);
        id = _admin(ReleaseGate.Action.SetPolicyCircuit, abi.encode(CPU, uint256(6))); // the genuine circuit
        gate.publish(id);
    }

    function _admin(ReleaseGate.Action a, bytes memory args) internal returns (uint64 id) {
        vm.prank(A0);
        id = gate.proposeAdmin(a, args);
        _approve(gate, id, 7);
        vm.warp(block.timestamp + 24 hours);
    }

    /// Pro/Enterprise: a team tapes out and opens its own container (here: on the fork), hands the circuit NFT to
    /// its gate, and the registry writes release-approved files at that container's root.
    function test_fork_ownContainer_gateHoldsARealCircuitNFT() public {
        if (!forked) vm.skip(true);
        address team = makeAddr("team");
        vm.deal(team, 1 ether);
        vm.startPrank(team);
        ITapeOutTransistors t = ITapeOutTransistors(ITapeOutProcessor(CPU).transistors());
        t.mint{value: t.mintPrice() + t.protocolFee()}(t.NAND(), 1);
        uint256 id = ITapeOutProcessor(CPU).tapeout{value: ITapeOutProcessor(CPU).TAPEOUT_FEE()}(hex"00000002000003", 2, 1);
        ITapeOutContainerOpener(OPENER).open{value: ITapeOutContainerOpener(OPENER).FEE()}(CPU, id);
        vm.stopPrank();
        address container = IContainerOpener(OPENER).accountOf(CPU, id);

        ReleaseGate own = _newGate("pro.example.org", CPU, id);
        vm.prank(team);
        ICircuitNFT(CPU).safeTransferFrom(team, address(own), id); // the real processor calls onERC721Received
        own.renewOperator(CPU, id); // anyone may call
        bytes memory index = bytes("<!doctype html><title>pro</title>");
        _publishFast(own, _leaf("pro.example.org", "index.html", "text/html", index));
        _write("pro.example.org", "index.html", "text/html", index, none);
        assertEq(ISiteRead(SITES).read(container, "index.html"), index);
        (,,,, uint256 inShared) = ISiteRegistryWriter(SITES).fileInfo(SHARED, "index.html");
        assertEq(inShared, 0);

        vm.prank(team); // the old holder can no longer write
        vm.expectRevert();
        ISiteRegistryWriter(SITES).putFile(container, "index.html", "text/html", bytes32(0), "x");
        vm.prank(BEACON); // a non-TapeOut NFT callback is refused
        vm.expectRevert(ReleaseGate.NotTapeOutCircuit.selector);
        own.onERC721Received(team, team, 1, "");
    }
}
