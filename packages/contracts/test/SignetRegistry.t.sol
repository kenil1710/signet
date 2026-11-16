// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {GateBase} from "./GateBase.sol";
import {ReleaseGate} from "../src/ReleaseGate.sol";
import {SignetRegistry} from "../src/SignetRegistry.sol";
import {SignetFactory} from "../src/SignetFactory.sol";

/// SignetRegistry and SignetFactory: sealed-file writer (as SiteRegistry operator), bindings, commit-reveal.
/// Review fixes are named in the test names: H-1, H-3, M-6, M-7, L-4 (first review); R2 = second review.
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
    string constant BASE = "projects/app.example.org/";
    bytes32[] none;

    // ---------------------------------------------------------------- helpers

    function leaf(string memory domain, string memory path, string memory ct, bytes memory data) internal pure returns (bytes32) {
        return sha256(abi.encode(domain, path, ct, sha256(data)));
    }

    function pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? sha256(abi.encodePacked(a, b)) : sha256(abi.encodePacked(b, a));
    }

    function proof1(bytes32 sibling) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = sibling;
    }

    /// The only external call in here is reg.writeFile, so vm.expectRevert before write() applies to it.
    function write(string memory d, string memory path, string memory ct, bytes memory data, bytes32[] memory proof) internal {
        reg.writeFile(SignetRegistry.File(d, path, ct, data, proof));
    }

    /// Publishes, on `gate`, a release of index.html + assets/app.js for `domain`.
    function release(string memory domain, bytes memory allowlist, bytes memory origins) internal returns (uint64 id) {
        bytes32 root = pair(leaf(domain, "index.html", HTML, INDEX), leaf(domain, "assets/app.js", JS, APP_JS));
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

    function at(string memory path) internal pure returns (string memory) {
        return string.concat(BASE, path);
    }

    // ---------------------------------------------------------------- H-1: only bytes that hash to the sealed values

    function test_H1_allowlistAndOrigins_mustHashToOnChainValues() public {
        release(DOMAIN, ALLOWLIST, ORIGINS);
        vm.startPrank(X); // anyone may relay: the content is fixed by the gate's approval
        write(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
        write(DOMAIN, P_ORIG, JSON, ORIGINS, none);
        vm.stopPrank();
        assertEq(stored(sharedContainer, at(P_ALLOW)), ALLOWLIST);
        assertEq(stored(sharedContainer, at(P_ORIG)), ORIGINS);
        (,, bytes32 h,, uint256 chunks) = sites.fileInfo(sharedContainer, at(P_ALLOW));
        assertEq(h, sha256(ALLOWLIST));
        assertEq(chunks, 1);
    }

    function test_H1_ciKeepsOldAllowlistHash_newAllowlistBytesAreRejected() public {
        release(DOMAIN, ALLOWLIST, ORIGINS);
        releaseRoot(keccak256("files-2")); // "code only": same allowlist hash
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        write(DOMAIN, P_ALLOW, JSON, ALLOWLIST_EVIL, none);
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        write(DOMAIN, P_ORIG, JSON, bytes('["https://evil.example"]'), none);
        vm.expectRevert(SignetRegistry.NotApproved.selector); // the allowlist can't pass as an origins file
        write(DOMAIN, P_ORIG, JSON, ALLOWLIST, none);
    }

    function test_H1_siteFiles_needMerkleProofAgainstFilesRoot() public {
        release(DOMAIN, ALLOWLIST, ORIGINS);
        bytes32[] memory pIndex = proof1(leaf(DOMAIN, "assets/app.js", JS, APP_JS));
        bytes32[] memory pApp = proof1(leaf(DOMAIN, "index.html", HTML, INDEX));
        write(DOMAIN, "index.html", HTML, INDEX, pIndex);
        write(DOMAIN, "assets/app.js", JS, APP_JS, pApp);
        assertEq(stored(sharedContainer, at("index.html")), INDEX);
        assertEq(stored(sharedContainer, at("assets/app.js")), APP_JS);

        vm.expectRevert(SignetRegistry.NotApproved.selector); // tampered bytes
        write(DOMAIN, "assets/app.js", JS, bytes("drain()"), pApp);
        vm.expectRevert(SignetRegistry.NotApproved.selector); // right bytes, other path
        write(DOMAIN, "assets/other.js", JS, APP_JS, pApp);
        vm.expectRevert(SignetRegistry.NotApproved.selector); // right bytes, other content type
        write(DOMAIN, "assets/app.js", HTML, APP_JS, pApp);
        vm.expectRevert(SignetRegistry.NotApproved.selector); // no proof
        write(DOMAIN, "assets/app.js", JS, APP_JS, none);
    }

    function test_H1_singleFileRelease_rootIsTheLeaf() public {
        releaseRoot(leaf(DOMAIN, "index.html", HTML, INDEX));
        write(DOMAIN, "index.html", HTML, INDEX, none);
        assertEq(stored(sharedContainer, at("index.html")), INDEX);
    }

    function test_R2info_domainIsPartOfTheLeaf_sameGateOtherDomain() public {
        bindDomain("docs.example.org", address(0), 0); // one gate, two domains
        releaseRoot(leaf(DOMAIN, "index.html", HTML, INDEX)); // sealed for app.example.org only
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        write("docs.example.org", "index.html", HTML, INDEX, none);
        write(DOMAIN, "index.html", HTML, INDEX, none);
        assertEq(stored(sharedContainer, "projects/docs.example.org/index.html").length, 0);
    }

    function test_write_beforeAnyRelease_rejected() public {
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        write(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
    }

    function test_write_proposedButNotPublished_rejected() public {
        release(DOMAIN, ALLOWLIST, ORIGINS);
        uint64 id = propose(keccak256("f"), sha256(ALLOWLIST_EVIL), sha256(ORIGINS), false);
        approveMask(id, 3); // tier 10, still inside the 24 h timelock
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        write(DOMAIN, P_ALLOW, JSON, ALLOWLIST_EVIL, none);
    }

    function test_write_oldReleaseFilesAfterNewRelease_rejected() public {
        release(DOMAIN, ALLOWLIST, ORIGINS);
        releaseRoot(leaf(DOMAIN, "index.html", HTML, bytes("v2")));
        bytes32[] memory oldProof = proof1(leaf(DOMAIN, "assets/app.js", JS, APP_JS));
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        write(DOMAIN, "index.html", HTML, INDEX, oldProof);
        write(DOMAIN, "index.html", HTML, bytes("v2"), none);
    }

    function test_M7_revokedRelease_filesAreNotWritten() public {
        uint64 id = release(DOMAIN, ALLOWLIST, ORIGINS);
        vm.prank(A1);
        gate.revoke(id);
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        write(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
    }

    function test_write_projectsAreIsolated() public {
        ReleaseGate mine = gate;
        release(DOMAIN, ALLOWLIST, ORIGINS);
        gate = newGate("shop.example.com");
        vm.expectRevert(SignetRegistry.NotApproved.selector); // the other project has no release
        write("shop.example.com", P_ALLOW, JSON, ALLOWLIST, none);
        release("shop.example.com", ALLOWLIST_EVIL, ORIGINS);
        write("shop.example.com", P_ALLOW, JSON, ALLOWLIST_EVIL, none);
        vm.expectRevert(SignetRegistry.NotApproved.selector); // its approved file can't land under app.example.org
        write(DOMAIN, P_ALLOW, JSON, ALLOWLIST_EVIL, none);
        assertEq(stored(sharedContainer, "projects/shop.example.com/signet/allowlist.json"), ALLOWLIST_EVIL);
        assertEq(stored(sharedContainer, at(P_ALLOW)).length, 0);
        gate = mine;
    }

    function test_write_unboundDomain_rejected() public {
        vm.expectRevert(SignetRegistry.NotBoundGate.selector);
        write("nobody.example.org", P_ALLOW, JSON, ALLOWLIST, none);
    }

    // ---------------------------------------------------------------- H-3: big files, remove, fallback, operator

    function test_H3_fileLargerThanOneChunk_isSplitAndVerified() public {
        bytes memory big = new bytes(30_000);
        for (uint256 i; i < big.length; i += 97) big[i] = bytes1(uint8(i));
        releaseRoot(leaf(DOMAIN, "signet/files.json", JSON, big));
        write(DOMAIN, "signet/files.json", JSON, big, none);
        (uint32 size,, bytes32 h,, uint256 chunks) = sites.fileInfo(sharedContainer, at("signet/files.json"));
        assertEq(size, 30_000);
        assertEq(chunks, 2); // 24,000 + 6,000
        assertEq(h, sha256(big));
        assertEq(sha256(stored(sharedContainer, at("signet/files.json"))), sha256(big));
    }

    function test_H3_exactChunkBoundaries() public {
        uint256[3] memory sizes = [uint256(24_000), 24_001, 48_000];
        uint256[3] memory chunksWant = [uint256(1), 2, 2];
        for (uint256 i; i < 3; i++) {
            bytes memory data = new bytes(sizes[i]);
            data[sizes[i] - 1] = 0x01;
            releaseRoot(leaf(DOMAIN, "f.bin", "application/octet-stream", data));
            write(DOMAIN, "f.bin", "application/octet-stream", data, none);
            (uint32 size,,,, uint256 chunks) = sites.fileInfo(sharedContainer, at("f.bin"));
            assertEq(size, sizes[i]);
            assertEq(chunks, chunksWant[i]);
        }
    }

    function test_R2info_maxFileSizeFitsUnderA16MGasCap() public {
        assertEq(reg.MAX_FILE_BYTES(), 48_000); // 2 chunks; see Core.fork.t.sol for the measured gas
        bytes memory tooBig = new bytes(48_001);
        releaseRoot(leaf(DOMAIN, "f.bin", JS, tooBig));
        vm.expectRevert(SignetRegistry.BadSize.selector);
        write(DOMAIN, "f.bin", JS, tooBig, none);
        vm.expectRevert(SignetRegistry.BadSize.selector);
        write(DOMAIN, "f.bin", JS, "", none);
    }

    function test_H3_removeFile_onlyByTheBoundGate_viaTier11() public {
        release(DOMAIN, ALLOWLIST, ORIGINS);
        write(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
        vm.prank(X);
        vm.expectRevert(SignetRegistry.NotBoundGate.selector);
        reg.removeFile(DOMAIN, P_ALLOW);
        vm.prank(A0); // even an approver can't call the registry directly
        vm.expectRevert(SignetRegistry.NotBoundGate.selector);
        reg.removeFile(DOMAIN, P_ALLOW);
        admin(ReleaseGate.Action.RemoveFile, abi.encode(DOMAIN, P_ALLOW));
        assertEq(stored(sharedContainer, at(P_ALLOW)).length, 0);
    }

    function test_H3_removeFile_staysInsideTheProject() public {
        ReleaseGate mine = gate;
        release(DOMAIN, ALLOWLIST, ORIGINS);
        write(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
        gate = newGate("shop.example.com");
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
        assertEq(stored(sharedContainer, at(P_ALLOW)), ALLOWLIST);
    }

    function test_H3_registryNeverHoldsTheNFT_itWritesAsOperator() public {
        assertEq(cpu.ownerOf(SHARED_ID), SHARED_HOLDER);
        assertEq(sites.operatorOf(sharedContainer), address(reg));
        release(DOMAIN, ALLOWLIST, ORIGINS);
        vm.warp(block.timestamp + 30 days); // the operator grant lapsed
        vm.expectRevert(bytes("NotOwner"));
        write(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
        vm.prank(SHARED_HOLDER);
        sites.setOperator(sharedContainer, address(reg), 30 days); // the holder renews
        write(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
    }

    // ---------------------------------------------------------------- R2 M-2: no migration

    function test_R2M2_noMigrationSurface_registryNeverLocks() public {
        (bool ok,) = address(reg).call(abi.encodeWithSignature("proposeMigration(address)", X));
        assertFalse(ok);
        (ok,) = address(reg).call(abi.encodeWithSignature("executeMigration()"));
        assertFalse(ok);
        (ok,) = address(reg).call(abi.encodeWithSignature("successor()"));
        assertFalse(ok);
        (ok,) = address(reg).call(abi.encodeWithSignature("ops(uint256)", 0));
        assertFalse(ok);
        // years later, claims and writes still work
        vm.warp(block.timestamp + 1000 days);
        vm.prank(SHARED_HOLDER);
        sites.setOperator(sharedContainer, address(reg), 30 days);
        newGate("late.example.org");
        release(DOMAIN, ALLOWLIST, ORIGINS);
        write(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
    }

    // ---------------------------------------------------------------- R2 M-3: commit-reveal

    function _domains(string memory d, bytes32 salt) internal pure returns (SignetFactory.DomainInit[] memory a) {
        a = new SignetFactory.DomainInit[](1);
        a[0] = SignetFactory.DomainInit(d, salt, address(0), 0);
    }

    function test_R2M3_claimNeedsACommit_atLeastTwoBlocksOld() public {
        string memory d = "new.example.org";
        bytes32 salt = keccak256("secret");
        SignetFactory.DomainInit[] memory ds = _domains(d, salt);
        vm.expectRevert(SignetFactory.NoCommit.selector);
        factory.createGate([A0, A1, A2], P, R, G, ds);

        factory.commit(factory.commitmentOf(d, salt, address(this)));
        vm.expectRevert(SignetFactory.CommitTooNew.selector); // same block
        factory.createGate([A0, A1, A2], P, R, G, ds);
        vm.roll(block.number + 1);
        vm.expectRevert(SignetFactory.CommitTooNew.selector); // one block later
        factory.createGate([A0, A1, A2], P, R, G, ds);
        vm.roll(block.number + 1);
        address g = factory.createGate([A0, A1, A2], P, R, G, ds);
        (address bound,,) = reg.bindingOf(d);
        assertEq(bound, g);
    }

    function test_R2M3_copyingTheRevealFromTheMempool_fails() public {
        string memory d = "new.example.org";
        bytes32 salt = keccak256("secret");
        SignetFactory.DomainInit[] memory ds = _domains(d, salt);
        bytes32 c = factory.commitmentOf(d, salt, address(this));
        factory.commit(c);
        vm.roll(block.number + 2);
        // the attacker sees our reveal (domain + salt) and sends the same call first
        vm.prank(X);
        vm.expectRevert(SignetFactory.NoCommit.selector); // the commitment names US as the claimant
        factory.createGate([A0, A1, A2], P, R, G, ds);
        // ... or commits now for themselves: never old enough to beat us in this block
        bytes32 theirs = factory.commitmentOf(d, salt, X);
        vm.startPrank(X);
        factory.commit(theirs);
        vm.expectRevert(SignetFactory.CommitTooNew.selector);
        factory.createGate([A0, A1, A2], P, R, G, ds);
        vm.stopPrank();
        address g = factory.createGate([A0, A1, A2], P, R, G, ds);
        (address bound,,) = reg.bindingOf(d);
        assertEq(bound, g);
        vm.roll(block.number + 2); // their late commit matures, but the domain is taken
        vm.prank(X);
        vm.expectRevert(SignetRegistry.AlreadyBound.selector);
        factory.createGate([A0, A1, A2], P, R, G, ds);
    }

    function test_R2M3_earlierCommitWins() public {
        string memory d = "new.example.org";
        bytes32 c1 = factory.commitmentOf(d, keccak256("ours"), address(this));
        bytes32 c2 = factory.commitmentOf(d, keccak256("theirs"), X);
        factory.commit(c1); // block n
        vm.roll(block.number + 1);
        factory.commit(c2); // block n + 1
        vm.roll(block.number + 1); // block n + 2: only the earlier commit is valid
        vm.prank(X);
        vm.expectRevert(SignetFactory.CommitTooNew.selector);
        factory.createGate([A0, A1, A2], P, R, G, _domains(d, keccak256("theirs")));
        address g = factory.createGate([A0, A1, A2], P, R, G, _domains(d, keccak256("ours")));
        (address bound,,) = reg.bindingOf(d);
        assertEq(bound, g);
    }

    function test_R2M3_commitRules_onceOnly_expires_singleUse() public {
        string memory d = "new.example.org";
        bytes32 salt = keccak256("secret");
        bytes32 c = factory.commitmentOf(d, salt, address(this));
        factory.commit(c);
        vm.prank(X); // re-sending someone's commitment can't refresh or block it
        vm.expectRevert(SignetFactory.CommitExists.selector);
        factory.commit(c);
        uint256 snap = vm.snapshotState();
        vm.roll(block.number + 2);
        vm.warp(block.timestamp + 7 days + 1);
        vm.expectRevert(SignetFactory.CommitExpired.selector);
        factory.createGate([A0, A1, A2], P, R, G, _domains(d, salt));
        vm.revertToState(snap);
        vm.roll(block.number + 2);
        factory.createGate([A0, A1, A2], P, R, G, _domains(d, salt));
        (uint64 blockNo,) = factory.commits(c);
        assertEq(blockNo, 0); // used up
    }

    // ---------------------------------------------------------------- M-6: factory-made gates only

    function test_M6_factoryDeploysGateAndClaimsDomainsInOneTransaction() public {
        SignetFactory.DomainInit[] memory d = new SignetFactory.DomainInit[](2);
        d[0] = SignetFactory.DomainInit("one.example.org", bytes32(uint256(1)), address(0), 0);
        d[1] = SignetFactory.DomainInit("two.example.org", bytes32(uint256(2)), address(cpu), 77);
        bytes32 c0 = factory.commitmentOf("one.example.org", bytes32(uint256(1)), X);
        bytes32 c1 = factory.commitmentOf("two.example.org", bytes32(uint256(2)), X);
        factory.commit(c0);
        factory.commit(c1);
        vm.roll(block.number + 2);
        vm.expectEmit(false, true, false, false, address(factory));
        emit SignetFactory.GateCreated(address(0), X);
        vm.prank(X);
        address g = factory.createGate([A0, A1, A2], P, R, G, d);
        assertTrue(reg.isGate(g));
        (address b1, address k1,) = reg.bindingOf("one.example.org");
        (address b2, address k2,) = reg.bindingOf("two.example.org");
        assertEq(b1, g);
        assertEq(k1, sharedContainer);
        assertEq(b2, g);
        assertEq(k2, opener.accountOf(address(cpu), 77));
        assertEq(ReleaseGate(g).getApprovers()[2], A2);
        assertEq(address(ReleaseGate(g).policyProcessor()), address(cpu));
        assertEq(ReleaseGate(g).pinnedImplementation(), IMPL);
    }

    function test_M6_onlyTheFactoryAndFactoryGatesCanClaim() public {
        vm.prank(X);
        vm.expectRevert(SignetRegistry.NotFactoryGate.selector);
        reg.claimFor(X, "fake.example.org", address(0), 0);
        vm.prank(X);
        vm.expectRevert(SignetRegistry.NotFactoryGate.selector);
        reg.register(X);
        vm.prank(address(factory)); // even the factory can only bind gates it made
        vm.expectRevert(SignetRegistry.NotFactoryGate.selector);
        reg.claimFor(X, "fake.example.org", address(0), 0);
        ReleaseGate handMade = new ReleaseGate();
        bytes32 c = factory.commitmentOf("fake.example.org", bytes32(0), address(handMade));
        factory.commit(c);
        vm.roll(block.number + 2);
        vm.prank(address(handMade));
        vm.expectRevert(SignetFactory.NotFactoryGate.selector);
        factory.claim("fake.example.org", bytes32(0), address(0), 0);
    }

    function test_M6_initFactory_once_byDeployerOnly() public {
        vm.expectRevert(SignetRegistry.BadConfig.selector);
        reg.initFactory(X); // already set
    }

    function test_claim_firstWins() public {
        expectCreateRevert(SignetRegistry.AlreadyBound.selector, DOMAIN);
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

    // ---------------------------------------------------------------- R2 L-4: two-step transfer

    function test_R2L4_transferNeedsTheReceivingGateToAccept() public {
        ReleaseGate mine = gate;
        ReleaseGate other = newGate("other.example.org");
        ReleaseGate third = newGate("third.example.org");
        uint64 id = proposeAdmin(ReleaseGate.Action.TransferDomain, abi.encode(DOMAIN, X)); // not a gate
        approveMask(id, 7);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(SignetRegistry.NotFactoryGate.selector);
        gate.publish(id);

        admin(ReleaseGate.Action.TransferDomain, abi.encode(DOMAIN, address(other)));
        (address g,,) = reg.bindingOf(DOMAIN);
        assertEq(g, address(mine)); // still ours
        release(DOMAIN, ALLOWLIST, ORIGINS);
        write(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none); // and still writable by our releases

        vm.prank(address(third)); // only the named gate can accept
        vm.expectRevert(SignetRegistry.NotBoundGate.selector);
        reg.acceptTransfer(DOMAIN);
        vm.prank(X);
        vm.expectRevert(SignetRegistry.NotBoundGate.selector);
        reg.acceptTransfer(DOMAIN);

        gate = other;
        admin(ReleaseGate.Action.AcceptDomain, abi.encode(DOMAIN));
        (g,,) = reg.bindingOf(DOMAIN);
        assertEq(g, address(other));
        vm.prank(address(mine)); // the old gate lost every right
        vm.expectRevert(SignetRegistry.NotBoundGate.selector);
        reg.unbind(DOMAIN);
    }

    function test_R2L4_unwantedTransfer_changesNothingForTheTarget() public {
        ReleaseGate other = newGate("other.example.org");
        admin(ReleaseGate.Action.TransferDomain, abi.encode(DOMAIN, address(other)));
        (address g,,) = reg.bindingOf(DOMAIN);
        assertEq(g, address(gate)); // `other` never accepted: it is not responsible for this domain
        admin(ReleaseGate.Action.TransferDomain, abi.encode(DOMAIN, address(gate))); // the sender can retarget
        assertEq(reg.pendingGateOf(DOMAIN), address(gate));
    }

    // ---------------------------------------------------------------- R2 L-5: fast removal after a revoke

    function test_R2L5_revokedRelease_twoApproversRemoveFiles() public {
        uint64 id = release(DOMAIN, ALLOWLIST, ORIGINS);
        write(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
        vm.prank(A0);
        vm.expectRevert(ReleaseGate.BadProposal.selector); // not revoked: removal stays tier 11
        gate.voteRemoveFile(DOMAIN, P_ALLOW);

        vm.prank(A0);
        gate.revoke(id);
        vm.prank(P);
        vm.expectRevert(ReleaseGate.NotApprover.selector);
        gate.voteRemoveFile(DOMAIN, P_ALLOW);
        vm.prank(A0);
        gate.voteRemoveFile(DOMAIN, P_ALLOW);
        vm.prank(A0);
        gate.voteRemoveFile(DOMAIN, P_ALLOW); // the same approver twice counts once
        assertEq(stored(sharedContainer, at(P_ALLOW)), ALLOWLIST);
        vm.prank(A2);
        gate.voteRemoveFile(DOMAIN, P_ALLOW);
        assertEq(stored(sharedContainer, at(P_ALLOW)).length, 0);
    }

    function test_R2L5_votesArePerFile() public {
        uint64 id = release(DOMAIN, ALLOWLIST, ORIGINS);
        write(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
        write(DOMAIN, P_ORIG, JSON, ORIGINS, none);
        vm.prank(A0);
        gate.revoke(id);
        vm.prank(A0);
        gate.voteRemoveFile(DOMAIN, P_ALLOW);
        vm.prank(A1);
        gate.voteRemoveFile(DOMAIN, P_ORIG); // a vote for another file
        assertEq(stored(sharedContainer, at(P_ALLOW)), ALLOWLIST);
        assertEq(stored(sharedContainer, at(P_ORIG)), ORIGINS);
    }

    // ---------------------------------------------------------------- R2 L-6: re-claim window after unbind

    function test_R2L6_afterUnbind_onlyThePreviousGateCanReclaimFor30Days() public {
        admin(ReleaseGate.Action.UnbindDomain, abi.encode(DOMAIN));
        (address g,,) = reg.bindingOf(DOMAIN);
        assertEq(g, address(0));
        expectCreateRevert(SignetRegistry.Reserved.selector, DOMAIN); // someone else, right away
        vm.warp(block.timestamp + 20 days);
        bindDomain(DOMAIN, address(0), 0); // the previous gate changed its mind
        (g,,) = reg.bindingOf(DOMAIN);
        assertEq(g, address(gate));
    }

    function test_R2L6_after30Days_anyoneCanClaim() public {
        admin(ReleaseGate.Action.UnbindDomain, abi.encode(DOMAIN));
        uint256 t = block.timestamp;
        vm.warp(t + 29 days);
        expectCreateRevert(SignetRegistry.Reserved.selector, DOMAIN);
        vm.warp(t + 30 days);
        ReleaseGate other = newGate(DOMAIN);
        (address g,,) = reg.bindingOf(DOMAIN);
        assertEq(g, address(other));
    }

    // ---------------------------------------------------------------- one container: Signet's site + projects

    function _signetSite() internal returns (ReleaseGate site) {
        site = newGate("signet.example");
        reg.initSignetSite(address(site));
    }

    function test_container_signetSiteUnderSignet_projectsUnderProjects_neverMix() public {
        ReleaseGate project = gate;
        ReleaseGate site = _signetSite();
        (, address c, string memory prefix) = reg.bindingOf("signet.example");
        assertEq(c, sharedContainer);
        assertEq(prefix, "signet/");
        (,, string memory projectPrefix) = reg.bindingOf(DOMAIN);
        assertEq(projectPrefix, BASE);

        // Signet's own release: index.html, plus two paths that TRY to reach into a project
        gate = site;
        string memory climb = "../projects/app.example.org/signet/allowlist.json";
        string memory deep = "projects/app.example.org/signet/allowlist.json";
        bytes32 lIndex = leaf("signet.example", "index.html", HTML, INDEX);
        bytes32 lDeep = leaf("signet.example", deep, JSON, ALLOWLIST_EVIL);
        releaseRoot(pair(lIndex, lDeep));
        write("signet.example", "index.html", HTML, INDEX, proof1(lDeep));
        write("signet.example", P_ALLOW, JSON, ALLOWLIST, none);
        assertEq(stored(sharedContainer, "signet/index.html"), INDEX);
        assertEq(stored(sharedContainer, "signet/signet/allowlist.json"), ALLOWLIST);
        vm.expectRevert(SignetRegistry.BadPath.selector);
        write("signet.example", climb, JSON, ALLOWLIST_EVIL, none);
        // an approved "projects/..." path only ever lands INSIDE signet/
        write("signet.example", deep, JSON, ALLOWLIST_EVIL, proof1(lIndex));
        assertEq(stored(sharedContainer, string.concat("signet/", deep)), ALLOWLIST_EVIL);
        assertEq(stored(sharedContainer, deep).length, 0);

        // a project's release: its "signet/..." paths only ever land inside projects/<domain>/
        gate = project;
        bytes32 pIndex = leaf(DOMAIN, "signet/index.html", HTML, bytes("<h1>fake dashboard</h1>"));
        releaseRoot(pIndex);
        write(DOMAIN, "signet/index.html", HTML, bytes("<h1>fake dashboard</h1>"), none);
        write(DOMAIN, P_ALLOW, JSON, ALLOWLIST, none);
        assertEq(stored(sharedContainer, at("signet/index.html")), bytes("<h1>fake dashboard</h1>"));
        assertEq(stored(sharedContainer, "signet/index.html"), INDEX); // Signet's site is untouched
        assertEq(stored(sharedContainer, at(P_ALLOW)), ALLOWLIST);
        vm.expectRevert(SignetRegistry.BadPath.selector);
        write(DOMAIN, "../../signet/index.html", HTML, INDEX, none);
        // nothing was ever written at the container root
        assertEq(stored(sharedContainer, "index.html").length, 0);
    }

    function test_container_noFallback_forProjectsOrSignetSite() public {
        // measured on X Layer: SiteRegistry has ONE fallback path per container; the dashboard uses hash routing
        uint64 id = proposeAdmin(ReleaseGate.Action.SetFallback, abi.encode(DOMAIN, "index.html"));
        approveMask(id, 7);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(SignetRegistry.SharedHasNoFallback.selector);
        gate.publish(id);
        gate = _signetSite();
        id = proposeAdmin(ReleaseGate.Action.SetFallback, abi.encode("signet.example", "index.html"));
        approveMask(id, 7);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(SignetRegistry.SharedHasNoFallback.selector);
        gate.publish(id);
        assertEq(sites.fallbackPath(sharedContainer), "");
    }

    function test_container_initSignetSite_once_deployerOnly_factoryGatesOnly() public {
        ReleaseGate site = newGate("signet.example");
        vm.prank(X);
        vm.expectRevert(SignetRegistry.BadConfig.selector);
        reg.initSignetSite(address(site));
        vm.expectRevert(SignetRegistry.BadConfig.selector);
        reg.initSignetSite(X); // not a factory gate
        reg.initSignetSite(address(site));
        vm.expectRevert(SignetRegistry.BadConfig.selector);
        reg.initSignetSite(address(gate)); // only once
    }

    function test_container_noGateCanBindTheSharedContainerAsItsOwn() public {
        // even a gate that somehow holds circuit #5 can't get root access to the shared container
        ReleaseGate rogue = newGateWith([A0, A1, A2], P, R, G, "root.example.org", address(cpu), SHARED_ID);
        vm.prank(SHARED_HOLDER);
        cpu.safeTransferFrom(SHARED_HOLDER, address(rogue), SHARED_ID);
        rogue.renewOperator(address(cpu), SHARED_ID);
        gate = rogue;
        releaseRoot(leaf("root.example.org", "index.html", HTML, INDEX));
        vm.expectRevert(SignetRegistry.NotHolder.selector);
        write("root.example.org", "index.html", HTML, INDEX, none);
    }

    // ---------------------------------------------------------------- L-4 (first review): a gate's own container

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
        release("pro.example.org", ALLOWLIST, ORIGINS);
        write("pro.example.org", "index.html", HTML, INDEX, proof1(leaf("pro.example.org", "assets/app.js", JS, APP_JS)));
        write("pro.example.org", P_ALLOW, JSON, ALLOWLIST, none);
        assertEq(stored(container, "index.html"), INDEX);
        assertEq(stored(container, "signet/allowlist.json"), ALLOWLIST);
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        write("pro.example.org", "index.html", HTML, bytes("<script>drain()</script>"), none);
        vm.prank(X); // the old holder can no longer write directly
        vm.expectRevert(bytes("NotOwner"));
        sites.putFile(container, "index.html", HTML, bytes32(0), "x");
        admin(ReleaseGate.Action.SetFallback, abi.encode("pro.example.org", "index.html")); // own containers may
        assertEq(sites.fallbackPath(container), "index.html");
    }

    function test_L4_bindingSomeoneElsesContainer_writesNothing() public {
        (ReleaseGate victim, address container) = _ownContainerGate("pro.example.org", 77);
        cpu.setOwner(77, address(victim));
        victim.renewOperator(address(cpu), 77);
        gate = newGateWith([A0, A1, A2], P, R, G, "evil.example.org", address(cpu), 77);
        release("evil.example.org", ALLOWLIST_EVIL, ORIGINS);
        vm.expectRevert(SignetRegistry.NotHolder.selector);
        write("evil.example.org", P_ALLOW, JSON, ALLOWLIST_EVIL, none);
        assertEq(stored(container, "signet/allowlist.json").length, 0);
    }

    function test_L4_ownContainerNotYetHandedToTheGate_rejected() public {
        (ReleaseGate own,) = _ownContainerGate("pro.example.org", 77);
        cpu.setOwner(77, X); // still with the team's wallet
        gate = own;
        release("pro.example.org", ALLOWLIST, ORIGINS);
        vm.expectRevert(SignetRegistry.NotHolder.selector);
        write("pro.example.org", P_ALLOW, JSON, ALLOWLIST, none);
    }

    // ---------------------------------------------------------------- validation

    function test_domainValidation() public {
        string[12] memory bad = [
            "x", "ab", "nodot", "UPPER.example.org", "a..b.org", ".a.org", "a.org.", "-a.org", "a-.org",
            "a/b.org", "../x.org", "a b.org"
        ];
        for (uint256 i; i < bad.length; i++) {
            expectCreateRevert(SignetRegistry.BadDomain.selector, bad[i]);
        }
        newGate("a-b.c0.org");
        newGate("x.io");
    }

    function test_pathValidation() public {
        release(DOMAIN, ALLOWLIST, ORIGINS);
        string[9] memory bad = ["/index.html", "a//b.js", "a/", "../x", "a/../b", "./a", "a/./b", "a b.js", "a\\b.js"];
        for (uint256 i; i < bad.length; i++) {
            vm.expectRevert(SignetRegistry.BadPath.selector);
            write(DOMAIN, bad[i], JS, APP_JS, none);
        }
        string memory long = new string(201);
        vm.expectRevert(SignetRegistry.BadPath.selector);
        write(DOMAIN, long, JS, APP_JS, none);
        releaseRoot(leaf(DOMAIN, "assets/index-B3tP3rSP.js", JS, APP_JS));
        write(DOMAIN, "assets/index-B3tP3rSP.js", JS, APP_JS, none);
        releaseRoot(leaf(DOMAIN, ".well-known/a_b~c@1.json", JSON, APP_JS));
        write(DOMAIN, ".well-known/a_b~c@1.json", JSON, APP_JS, none);
    }
}
