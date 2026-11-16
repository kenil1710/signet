// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {GateBase} from "./GateBase.sol";
import {ReleaseGate} from "../src/ReleaseGate.sol";
import {SignetRegistry} from "../src/SignetRegistry.sol";
import {SignetFactory} from "../src/SignetFactory.sol";
import {ISiteRegistryWriter, IContainerOpener} from "../src/interfaces/ITapeOutPolicy.sol";

/// SignetRegistry and SignetFactory: sealed-file writer (as SiteRegistry operator), bindings, migration.
/// Security-review fixes are named in the test names (H-1, H-3, M-6, M-7, L-4).
contract SignetRegistryTest is GateBase {
    bytes constant ALLOWLIST = bytes('{"196":{"targets":["0x1111111111111111111111111111111111111111"]}}');
    bytes constant ALLOWLIST_EVIL = bytes('{"196":{"targets":["0x000000000000000000000000000000000000dEaD"]}}');
    bytes constant ORIGINS = bytes('["https://xlayerrpc.okx.com"]');
    bytes constant INDEX = bytes("<!doctype html><title>app</title>");
    bytes constant APP_JS = bytes("console.log('app')");
    string constant JSON = "application/json";
    string constant HTML = "text/html";
    string constant JS = "text/javascript";
    string constant P_ALLOW = "signet/allowlist.json";
    string constant P_ORIG = "signet/origins.json";
    bytes32[] none;

    // ---------------------------------------------------------------- helpers

    function leaf(string memory path, string memory ct, bytes memory data) internal pure returns (bytes32) {
        return sha256(abi.encode(path, ct, sha256(data)));
    }

    function pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? sha256(abi.encodePacked(a, b)) : sha256(abi.encodePacked(b, a));
    }

    function proof1(bytes32 sibling) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = sibling;
    }

    /// Publishes a release of index.html + assets/app.js with the given allowlist and origins bytes.
    function release(bytes memory allowlist, bytes memory origins) internal returns (uint64 id) {
        bytes32 root = pair(leaf("index.html", HTML, INDEX), leaf("assets/app.js", JS, APP_JS));
        id = propose(root, sha256(allowlist), sha256(origins), true);
        approveMask(id, 7);
        gate.publish(id);
    }

    function releaseRoot(bytes32 root) internal returns (uint64 id) {
        id = propose(root, sha256(ALLOWLIST), sha256(ORIGINS), true);
        approveMask(id, 7);
        gate.publish(id);
    }

    function stored(address container, string memory path) internal view returns (bytes memory) {
        return sites.read(container, path);
    }

    // ---------------------------------------------------------------- H-1: only bytes that hash to the sealed values

    function test_H1_allowlistAndOrigins_mustHashToOnChainValues() public {
        release(ALLOWLIST, ORIGINS);
        vm.startPrank(X); // anyone may relay: the content is fixed by the gate's approval
        reg.writeFile(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
        reg.writeFile(DOMAIN, P_ORIG, JSON, ORIGINS, none);
        vm.stopPrank();
        assertEq(stored(sharedContainer, "projects/app.example.org/signet/allowlist.json"), ALLOWLIST);
        assertEq(stored(sharedContainer, "projects/app.example.org/signet/origins.json"), ORIGINS);
        (,, bytes32 h,, uint256 chunks) = sites.fileInfo(sharedContainer, "projects/app.example.org/signet/allowlist.json");
        assertEq(h, sha256(ALLOWLIST));
        assertEq(chunks, 1);
    }

    function test_H1_ciKeepsOldAllowlistHash_newAllowlistBytesAreRejected() public {
        release(ALLOWLIST, ORIGINS);
        // CI proposes "code only" (same allowlist hash) but tries to ship a different allowlist file.
        releaseRoot(keccak256("files-2"));
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        reg.writeFile(DOMAIN, P_ALLOW, JSON, ALLOWLIST_EVIL, none);
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        reg.writeFile(DOMAIN, P_ORIG, JSON, bytes('["https://evil.example"]'), none);
        // the allowlist cannot be passed off as an origins file either
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        reg.writeFile(DOMAIN, P_ORIG, JSON, ALLOWLIST, none);
    }

    function test_H1_siteFiles_needMerkleProofAgainstFilesRoot() public {
        release(ALLOWLIST, ORIGINS);
        bytes32 lIndex = leaf("index.html", HTML, INDEX);
        bytes32 lApp = leaf("assets/app.js", JS, APP_JS);
        reg.writeFile(DOMAIN, "index.html", HTML, INDEX, proof1(lApp));
        reg.writeFile(DOMAIN, "assets/app.js", JS, APP_JS, proof1(lIndex));
        assertEq(stored(sharedContainer, "projects/app.example.org/index.html"), INDEX);
        assertEq(stored(sharedContainer, "projects/app.example.org/assets/app.js"), APP_JS);

        vm.expectRevert(SignetRegistry.NotApproved.selector); // tampered bytes
        reg.writeFile(DOMAIN, "assets/app.js", JS, bytes("drain()"), proof1(lIndex));
        vm.expectRevert(SignetRegistry.NotApproved.selector); // right bytes, other path
        reg.writeFile(DOMAIN, "assets/other.js", JS, APP_JS, proof1(lIndex));
        vm.expectRevert(SignetRegistry.NotApproved.selector); // right bytes, other content type
        reg.writeFile(DOMAIN, "assets/app.js", HTML, APP_JS, proof1(lIndex));
        vm.expectRevert(SignetRegistry.NotApproved.selector); // no proof
        reg.writeFile(DOMAIN, "assets/app.js", JS, APP_JS, none);
    }

    function test_H1_singleFileRelease_rootIsTheLeaf() public {
        releaseRoot(leaf("index.html", HTML, INDEX));
        reg.writeFile(DOMAIN, "index.html", HTML, INDEX, none);
        assertEq(stored(sharedContainer, "projects/app.example.org/index.html"), INDEX);
    }

    function test_write_beforeAnyRelease_rejected() public {
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        reg.writeFile(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
    }

    function test_write_proposedButNotPublished_rejected() public {
        release(ALLOWLIST, ORIGINS);
        uint64 id = propose(keccak256("f"), sha256(ALLOWLIST_EVIL), sha256(ORIGINS), false);
        approveMask(id, 3); // tier 10, still inside the 24 h timelock
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        reg.writeFile(DOMAIN, P_ALLOW, JSON, ALLOWLIST_EVIL, none);
    }

    function test_write_oldReleaseFilesAfterNewRelease_rejected() public {
        release(ALLOWLIST, ORIGINS);
        releaseRoot(leaf("index.html", HTML, bytes("v2")));
        bytes32[] memory oldProof = proof1(leaf("assets/app.js", JS, APP_JS)); // before expectRevert (sha256 is a call)
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        reg.writeFile(DOMAIN, "index.html", HTML, INDEX, oldProof);
        reg.writeFile(DOMAIN, "index.html", HTML, bytes("v2"), none);
    }

    function test_M7_revokedRelease_filesAreNotWritten() public {
        uint64 id = release(ALLOWLIST, ORIGINS);
        vm.prank(A1);
        gate.revoke(id);
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        reg.writeFile(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
    }

    function test_write_projectsAreIsolated() public {
        ReleaseGate mine = gate;
        release(ALLOWLIST, ORIGINS);
        gate = newGate("shop.example.com");
        // the other project has no release: app.example.org's approved file can't be written under its name
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        reg.writeFile("shop.example.com", P_ALLOW, JSON, ALLOWLIST, none);
        release(ALLOWLIST_EVIL, ORIGINS);
        reg.writeFile("shop.example.com", P_ALLOW, JSON, ALLOWLIST_EVIL, none);
        // ... and the other project's approved file can't land under app.example.org
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        reg.writeFile(DOMAIN, P_ALLOW, JSON, ALLOWLIST_EVIL, none);
        assertEq(stored(sharedContainer, "projects/shop.example.com/signet/allowlist.json"), ALLOWLIST_EVIL);
        assertEq(stored(sharedContainer, "projects/app.example.org/signet/allowlist.json").length, 0);
        gate = mine;
    }

    function test_write_unboundDomain_rejected() public {
        vm.expectRevert(SignetRegistry.NotBoundGate.selector);
        reg.writeFile("nobody.example.org", P_ALLOW, JSON, ALLOWLIST, none);
    }

    // ---------------------------------------------------------------- H-3: big files, remove, fallback

    function test_H3_fileLargerThanOneChunk_isSplitAndVerified() public {
        bytes memory big = new bytes(50_000);
        for (uint256 i; i < big.length; i += 97) big[i] = bytes1(uint8(i));
        releaseRoot(leaf("signet/files.json", JSON, big));
        reg.writeFile(DOMAIN, "signet/files.json", JSON, big, none);
        (uint32 size,, bytes32 h,, uint256 chunks) = sites.fileInfo(sharedContainer, "projects/app.example.org/signet/files.json");
        assertEq(size, 50_000);
        assertEq(chunks, 3); // 24,000 + 24,000 + 2,000
        assertEq(h, sha256(big));
        assertEq(sha256(stored(sharedContainer, "projects/app.example.org/signet/files.json")), sha256(big));
    }

    function test_H3_exactChunkBoundaries() public {
        uint256[4] memory sizes = [uint256(24_000), 24_001, 48_000, 96_000];
        uint256[4] memory chunksWant = [uint256(1), 2, 2, 4];
        for (uint256 i; i < 4; i++) {
            bytes memory data = new bytes(sizes[i]);
            data[sizes[i] - 1] = 0x01;
            releaseRoot(leaf("f.bin", "application/octet-stream", data));
            reg.writeFile(DOMAIN, "f.bin", "application/octet-stream", data, none);
            (uint32 size,,,, uint256 chunks) = sites.fileInfo(sharedContainer, "projects/app.example.org/f.bin");
            assertEq(size, sizes[i]);
            assertEq(chunks, chunksWant[i]);
        }
    }

    function test_H3_sizeLimits() public {
        bytes memory tooBig = new bytes(96_001);
        releaseRoot(leaf("f.bin", JS, tooBig));
        vm.expectRevert(SignetRegistry.BadSize.selector);
        reg.writeFile(DOMAIN, "f.bin", JS, tooBig, none);
        vm.expectRevert(SignetRegistry.BadSize.selector);
        reg.writeFile(DOMAIN, "f.bin", JS, "", none);
    }

    function test_H3_removeFile_onlyByTheBoundGate_viaTier11() public {
        release(ALLOWLIST, ORIGINS);
        reg.writeFile(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
        vm.prank(X);
        vm.expectRevert(SignetRegistry.NotBoundGate.selector);
        reg.removeFile(DOMAIN, P_ALLOW);
        vm.prank(A0); // even an approver can't call the registry directly
        vm.expectRevert(SignetRegistry.NotBoundGate.selector);
        reg.removeFile(DOMAIN, P_ALLOW);
        admin(ReleaseGate.Action.RemoveFile, abi.encode(DOMAIN, P_ALLOW));
        assertEq(stored(sharedContainer, "projects/app.example.org/signet/allowlist.json").length, 0);
    }

    function test_H3_removeFile_staysInsideTheProject() public {
        ReleaseGate mine = gate;
        release(ALLOWLIST, ORIGINS);
        reg.writeFile(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
        gate = newGate("shop.example.com");
        // the other gate can only name its own domain; a path can't climb out of projects/<domain>/
        uint64 id = proposeAdmin(ReleaseGate.Action.RemoveFile, abi.encode(DOMAIN, P_ALLOW));
        approveMask(id, 7);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(SignetRegistry.NotBoundGate.selector);
        gate.publish(id);
        id = proposeAdmin(ReleaseGate.Action.RemoveFile, abi.encode("shop.example.com", "../app.example.org/signet/allowlist.json"));
        approveMask(id, 7);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(SignetRegistry.BadPath.selector);
        gate.publish(id);
        gate = mine;
        assertEq(stored(sharedContainer, "projects/app.example.org/signet/allowlist.json"), ALLOWLIST);
    }

    function test_H3_sharedContainerProject_cannotSetFallback() public {
        // measured on X Layer: SiteRegistry has ONE fallback path per container
        uint64 id = proposeAdmin(ReleaseGate.Action.SetFallback, abi.encode(DOMAIN, "index.html"));
        approveMask(id, 7);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(SignetRegistry.SharedHasNoFallback.selector);
        gate.publish(id);
    }

    function test_H3_registryNeverHoldsTheNFT_itWritesAsOperator() public {
        assertEq(cpu.ownerOf(SHARED_ID), SHARED_HOLDER);
        assertEq(sites.operatorOf(sharedContainer), address(reg));
        release(ALLOWLIST, ORIGINS);
        vm.warp(block.timestamp + 30 days); // the operator grant lapsed
        vm.expectRevert(bytes("NotOwner"));
        reg.writeFile(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
        vm.prank(SHARED_HOLDER);
        sites.setOperator(sharedContainer, address(reg), 30 days); // the holder renews
        reg.writeFile(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
    }

    // ---------------------------------------------------------------- H-3: migration (ops 2 of 3, 7 days, events)

    function test_H3_migration_needsTwoOps_sevenDays_andEmitsEvents() public {
        address next = makeAddr("registryV2");
        vm.prank(X);
        vm.expectRevert(SignetRegistry.NotOps.selector);
        reg.proposeMigration(next);

        vm.expectEmit(true, true, false, false, address(reg));
        emit SignetRegistry.MigrationProposed(next, O0);
        vm.prank(O0);
        reg.proposeMigration(next);
        vm.prank(O0);
        reg.proposeMigration(next); // the same op twice does not schedule
        assertEq(reg.migrationAt(), 0);
        vm.expectRevert(SignetRegistry.MigrationClosed.selector);
        reg.executeMigration();

        vm.expectEmit(true, false, false, true, address(reg));
        emit SignetRegistry.MigrationScheduled(next, block.timestamp + 7 days);
        vm.prank(O2);
        reg.proposeMigration(next);

        vm.warp(block.timestamp + 7 days - 1);
        vm.expectRevert(SignetRegistry.TooEarly.selector);
        reg.executeMigration();
        assertEq(reg.successor(), address(0));
        vm.warp(block.timestamp + 1);
        vm.expectEmit(true, false, false, false, address(reg));
        emit SignetRegistry.Migrated(next);
        vm.prank(X); // anyone may execute after the delay
        reg.executeMigration();
        assertEq(reg.successor(), next);
    }

    function test_H3_migration_differentTargetsDoNotCombine_andAnyOpCancels() public {
        address n1 = makeAddr("v2a");
        address n2 = makeAddr("v2b");
        vm.prank(O0);
        reg.proposeMigration(n1);
        vm.prank(O1);
        reg.proposeMigration(n2); // a different target replaces the pending one
        assertEq(reg.migrationAt(), 0);
        vm.prank(O0);
        reg.proposeMigration(n2);
        assertGt(reg.migrationAt(), 0);
        vm.prank(X);
        vm.expectRevert(SignetRegistry.NotOps.selector);
        reg.cancelMigration();
        vm.prank(O2);
        reg.cancelMigration();
        vm.warp(block.timestamp + 8 days);
        vm.expectRevert(SignetRegistry.MigrationClosed.selector);
        reg.executeMigration();
    }

    function test_H3_afterMigration_oldRegistryStopsWriting_bindingsStayReadable() public {
        release(ALLOWLIST, ORIGINS);
        _migrate(makeAddr("registryV2"));
        vm.expectRevert(SignetRegistry.MigrationClosed.selector);
        reg.writeFile(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
        vm.expectRevert(SignetRegistry.MigrationClosed.selector);
        newGate("late.example.org");
        vm.prank(O0);
        vm.expectRevert(SignetRegistry.MigrationClosed.selector);
        reg.proposeMigration(makeAddr("v3"));
        (address g,,) = reg.bindingOf(DOMAIN);
        assertEq(g, address(gate));
    }

    function test_H3_gateFollowsMigration_onlyByItsOwnTier11Vote() public {
        uint256 snap = vm.snapshotState();
        uint64 id = proposeAdmin(ReleaseGate.Action.FollowRegistry, "");
        approveMask(id, 7);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(ReleaseGate.BadConfig.selector); // nothing announced
        gate.publish(id);
        vm.revertToState(snap);

        address next = makeAddr("registryV2");
        _migrate(next);
        assertEq(address(gate.registry()), address(reg)); // ops alone don't move a gate
        admin(ReleaseGate.Action.FollowRegistry, "");
        assertEq(address(gate.registry()), next);
    }

    function test_H3_opsMustBeThreeDistinctAddresses() public {
        vm.expectRevert(SignetRegistry.BadConfig.selector);
        new SignetRegistry(ISiteRegistryWriter(address(sites)), IContainerOpener(address(opener)), address(cpu), 5, [O0, O0, O2]);
        vm.expectRevert(SignetRegistry.BadConfig.selector);
        new SignetRegistry(ISiteRegistryWriter(address(sites)), IContainerOpener(address(opener)), address(cpu), 5, [O0, O1, address(0)]);
    }

    // ---------------------------------------------------------------- M-6: factory-made gates only

    function test_M6_factoryDeploysGateAndClaimsDomainInOneTransaction() public {
        SignetFactory.DomainInit[] memory d = new SignetFactory.DomainInit[](2);
        d[0] = SignetFactory.DomainInit("one.example.org", address(0), 0);
        d[1] = SignetFactory.DomainInit("two.example.org", address(cpu), 77);
        vm.expectEmit(false, true, false, false, address(factory));
        emit SignetFactory.GateCreated(address(0), X);
        vm.prank(X);
        address g = factory.createGate([A0, A1, A2], P, R, G, d);
        assertTrue(reg.isGate(g));
        (address b1, address c1,) = reg.bindingOf("one.example.org");
        (address b2, address c2,) = reg.bindingOf("two.example.org");
        assertEq(b1, g);
        assertEq(c1, sharedContainer);
        assertEq(b2, g);
        assertEq(c2, opener.accountOf(address(cpu), 77));
        assertEq(ReleaseGate(g).getApprovers()[2], A2);
        assertEq(address(ReleaseGate(g).policyProcessor()), address(cpu));
        assertEq(ReleaseGate(g).pinnedImplementation(), IMPL);
    }

    function test_M6_claimFromAnythingButAFactoryGate_rejected() public {
        vm.prank(X); // an EOA or a hand-made "gate" contract
        vm.expectRevert(SignetRegistry.NotFactoryGate.selector);
        reg.claim("fake.example.org", address(0), 0);
        ReleaseGate handMade = new ReleaseGate();
        vm.prank(address(handMade));
        vm.expectRevert(SignetRegistry.NotFactoryGate.selector);
        reg.claim("fake.example.org", address(0), 0);
        vm.prank(X);
        vm.expectRevert(SignetRegistry.NotFactoryGate.selector);
        reg.register(X);
        vm.prank(X);
        vm.expectRevert(SignetRegistry.NotFactoryGate.selector);
        reg.claimFor(X, "fake.example.org", address(0), 0);
    }

    function test_M6_transferOnlyToFactoryGates() public {
        uint64 id = proposeAdmin(ReleaseGate.Action.TransferDomain, abi.encode(DOMAIN, X));
        approveMask(id, 7);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(SignetRegistry.NotFactoryGate.selector);
        gate.publish(id);
    }

    function test_M6_initFactory_once_byDeployerOnly() public {
        vm.expectRevert(SignetRegistry.BadConfig.selector);
        reg.initFactory(X); // already set
        SignetRegistry r2 =
            new SignetRegistry(ISiteRegistryWriter(address(sites)), IContainerOpener(address(opener)), address(cpu), 5, [O0, O1, O2]);
        vm.prank(X);
        vm.expectRevert(SignetRegistry.BadConfig.selector);
        r2.initFactory(X);
        r2.initFactory(address(factory));
        assertEq(r2.factory(), address(factory));
    }

    function test_claim_firstWins() public {
        vm.expectRevert(SignetRegistry.AlreadyBound.selector);
        newGate(DOMAIN);
    }

    function test_onlyBoundGateChangesBinding() public {
        vm.startPrank(X);
        vm.expectRevert(SignetRegistry.NotBoundGate.selector);
        reg.setContainer(DOMAIN, X, 1);
        vm.expectRevert(SignetRegistry.NotBoundGate.selector);
        reg.transfer(DOMAIN, X);
        vm.expectRevert(SignetRegistry.NotBoundGate.selector);
        reg.unbind(DOMAIN);
        vm.expectRevert(SignetRegistry.NotBoundGate.selector);
        reg.setFallback(DOMAIN, "index.html");
        vm.stopPrank();
    }

    function test_domainValidation() public {
        string[12] memory bad = [
            "x", "ab", "nodot", "UPPER.example.org", "a..b.org", ".a.org", "a.org.", "-a.org", "a-.org",
            "a/b.org", "../x.org", "a b.org"
        ];
        for (uint256 i; i < bad.length; i++) {
            vm.expectRevert(SignetRegistry.BadDomain.selector);
            newGate(bad[i]);
        }
        newGate("a-b.c0.org");
        newGate("x.io");
    }

    function test_pathValidation() public {
        release(ALLOWLIST, ORIGINS);
        string[9] memory bad = ["/index.html", "a//b.js", "a/", "../x", "a/../b", "./a", "a/./b", "a b.js", "a\\b.js"];
        for (uint256 i; i < bad.length; i++) {
            releaseRoot(leaf(bad[i], JS, APP_JS)); // even when a release approves it
            vm.expectRevert(SignetRegistry.BadPath.selector);
            reg.writeFile(DOMAIN, bad[i], JS, APP_JS, none);
        }
        string memory long = new string(201);
        vm.expectRevert(SignetRegistry.BadPath.selector);
        reg.writeFile(DOMAIN, long, JS, APP_JS, none);
        releaseRoot(leaf("assets/index-B3tP3rSP.js", JS, APP_JS));
        reg.writeFile(DOMAIN, "assets/index-B3tP3rSP.js", JS, APP_JS, none);
        releaseRoot(leaf(".well-known/a_b~c@1.json", JSON, APP_JS));
        reg.writeFile(DOMAIN, ".well-known/a_b~c@1.json", JSON, APP_JS, none);
    }

    // ---------------------------------------------------------------- L-4: a gate's own container

    function _ownContainerGate(string memory domain, uint256 tokenId) internal returns (ReleaseGate g, address container) {
        g = newGateWith([A0, A1, A2], P, R, G, domain, address(cpu), tokenId);
        container = opener.accountOf(address(cpu), tokenId);
        sites.registerContainer(container, cpu, tokenId);
    }

    function test_L4_gateHoldsItsContainer_filesGoToItsRoot_viaTheReleaseFlow() public {
        (ReleaseGate own, address container) = _ownContainerGate("pro.example.org", 77);
        cpu.setOwner(77, X);
        vm.prank(X);
        cpu.safeTransferFrom(X, address(own), 77); // the team hands its container to its gate
        own.renewOperator(address(cpu), 77);
        gate = own;
        release(ALLOWLIST, ORIGINS);
        reg.writeFile("pro.example.org", "index.html", HTML, INDEX, proof1(leaf("assets/app.js", JS, APP_JS)));
        reg.writeFile("pro.example.org", P_ALLOW, JSON, ALLOWLIST, none);
        assertEq(stored(container, "index.html"), INDEX);
        assertEq(stored(container, "signet/allowlist.json"), ALLOWLIST);
        // nothing unapproved gets in, and the old holder can no longer write directly
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        reg.writeFile("pro.example.org", "index.html", HTML, bytes("<script>drain()</script>"), none);
        vm.prank(X);
        vm.expectRevert(bytes("NotOwner"));
        sites.putFile(container, "index.html", HTML, bytes32(0), "x");
        // own containers can have a fallback (tier 11)
        admin(ReleaseGate.Action.SetFallback, abi.encode("pro.example.org", "index.html"));
        assertEq(sites.fallbackPath(container), "index.html");
    }

    function test_L4_bindingSomeoneElsesContainer_writesNothing() public {
        (ReleaseGate victim, address container) = _ownContainerGate("pro.example.org", 77);
        cpu.setOwner(77, address(victim));
        victim.renewOperator(address(cpu), 77);
        // an attacker's (genuine, factory-made) gate binds its domain to the victim's container
        gate = newGateWith([A0, A1, A2], P, R, G, "evil.example.org", address(cpu), 77);
        release(ALLOWLIST_EVIL, ORIGINS);
        vm.expectRevert(SignetRegistry.NotHolder.selector);
        reg.writeFile("evil.example.org", P_ALLOW, JSON, ALLOWLIST_EVIL, none);
        assertEq(stored(container, "signet/allowlist.json").length, 0);
    }

    function test_L4_ownContainerNotYetHandedToTheGate_rejected() public {
        (ReleaseGate own,) = _ownContainerGate("pro.example.org", 77);
        cpu.setOwner(77, X); // still with the team's wallet
        gate = own;
        release(ALLOWLIST, ORIGINS);
        vm.expectRevert(SignetRegistry.NotHolder.selector);
        reg.writeFile("pro.example.org", P_ALLOW, JSON, ALLOWLIST, none);
    }

    function test_L4_signetsOwnSite_inTheSharedContainer_cannotTouchProjects() public {
        ReleaseGate free = gate;
        release(ALLOWLIST, ORIGINS);
        // Signet's own gate holds circuit #5 and binds signet.example to it (root of the shared container)
        ReleaseGate own = newGateWith([A0, A1, A2], P, R, G, "signet.example", address(cpu), SHARED_ID);
        vm.prank(SHARED_HOLDER);
        cpu.safeTransferFrom(SHARED_HOLDER, address(own), SHARED_ID);
        own.renewOperator(address(cpu), SHARED_ID); // anyone can keep the registry's operator grant alive
        gate = own;
        string memory inProjects = "projects/app.example.org/signet/allowlist.json";
        bytes32 root = pair(leaf("index.html", HTML, INDEX), leaf(inProjects, JSON, ALLOWLIST_EVIL));
        releaseRoot(root);
        reg.writeFile("signet.example", "index.html", HTML, INDEX, proof1(leaf(inProjects, JSON, ALLOWLIST_EVIL)));
        assertEq(stored(sharedContainer, "index.html"), INDEX);
        bytes32[] memory pr = proof1(leaf("index.html", HTML, INDEX));
        vm.expectRevert(SignetRegistry.BadPath.selector); // even Signet's own approved release can't write there
        reg.writeFile("signet.example", inProjects, JSON, ALLOWLIST_EVIL, pr);
        // free-tier projects keep working next to it
        gate = free;
        reg.writeFile(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
        assertEq(stored(sharedContainer, inProjects), ALLOWLIST);
    }

    function test_L4_afterMigration_gateRenewsOperatorToTheNewRegistry() public {
        ReleaseGate own = newGateWith([A0, A1, A2], P, R, G, "signet.example", address(cpu), SHARED_ID);
        vm.prank(SHARED_HOLDER);
        cpu.safeTransferFrom(SHARED_HOLDER, address(own), SHARED_ID);
        SignetRegistry v2 =
            new SignetRegistry(ISiteRegistryWriter(address(sites)), IContainerOpener(address(opener)), address(cpu), SHARED_ID, [O0, O1, O2]);
        _migrate(address(v2));
        own.renewOperator(address(cpu), SHARED_ID);
        assertEq(sites.operatorOf(sharedContainer), address(reg)); // not until the gate's own tier-11 vote
        gate = own;
        admin(ReleaseGate.Action.FollowRegistry, "");
        own.renewOperator(address(cpu), SHARED_ID);
        assertEq(sites.operatorOf(sharedContainer), address(v2));
    }

    // ---------------------------------------------------------------- helpers

    function _migrate(address next) internal {
        vm.prank(O0);
        reg.proposeMigration(next);
        vm.prank(O1);
        reg.proposeMigration(next);
        vm.warp(block.timestamp + 7 days);
        reg.executeMigration();
    }
}
