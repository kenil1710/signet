// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {GateBase} from "./GateBase.sol";
import {ReleaseGate} from "../src/ReleaseGate.sol";
import {SignetRegistry} from "../src/SignetRegistry.sol";

/// SignetRegistry: domain bindings and the shared-container writer (docs/decisions.md, shared container).
contract SignetRegistryTest is GateBase {
    bytes constant MANIFEST = bytes('{"signet":"manifest/0","release":1}');

    function _publish(bytes memory manifest) internal {
        uint64 id = propose(sha256(manifest), ALLOW, ORIG, true);
        approveMask(id, 7);
        gate.publish(id);
    }

    // ---------------------------------------------------------------- writer

    function test_writeManifest_onlyApprovedBytes_underProjectsDomain() public {
        _publish(MANIFEST);
        vm.prank(X); // anyone may relay: the content is fixed by the gate's approval
        reg.writeManifest(DOMAIN, MANIFEST);
        (bytes32 h, , address c, uint256 writes) = sites.files("projects/app.example.org/manifest.json");
        assertEq(h, sha256(MANIFEST));
        assertEq(c, CONTAINER);
        assertEq(writes, 1);
        assertEq(sites.fileData("projects/app.example.org/manifest.json"), MANIFEST);
    }

    function test_writeManifest_beforeAnyRelease_rejected() public {
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        reg.writeManifest(DOMAIN, MANIFEST);
    }

    function test_writeManifest_unapprovedBytes_rejected() public {
        _publish(MANIFEST);
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        reg.writeManifest(DOMAIN, bytes('{"signet":"evil"}'));
    }

    function test_writeManifest_oldManifestAfterNewRelease_rejected() public {
        _publish(MANIFEST);
        bytes memory m2 = bytes('{"signet":"manifest/0","release":2}');
        _publish(m2);
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        reg.writeManifest(DOMAIN, MANIFEST);
        reg.writeManifest(DOMAIN, m2);
    }

    function test_writeManifest_proposedButNotPublished_rejected() public {
        _publish(MANIFEST);
        bytes memory m2 = bytes('{"pending":true}');
        uint64 id = propose(sha256(m2), ALLOW, ORIG, false);
        approveMask(id, 1); // not yet past the timelock
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        reg.writeManifest(DOMAIN, m2);
    }

    function test_writeManifest_unboundDomain_rejected() public {
        vm.expectRevert(SignetRegistry.NotBoundGate.selector);
        reg.writeManifest("nobody.example.org", MANIFEST);
    }

    function test_writeManifest_ownContainerDomain_rejected() public {
        uint64 id = proposeAdmin(ReleaseGate.Action.BindDomain, abi.encode(DOMAIN, makeAddr("teamContainer")));
        approveMask(id, 7);
        vm.warp(block.timestamp + 24 hours);
        gate.publish(id);
        _publish(MANIFEST);
        vm.expectRevert(SignetRegistry.NotShared.selector);
        reg.writeManifest(DOMAIN, MANIFEST);
    }

    function test_writeManifest_tooLarge_rejected() public {
        bytes memory big = new bytes(24_001);
        _publish(big);
        vm.expectRevert(SignetRegistry.TooLarge.selector);
        reg.writeManifest(DOMAIN, big);
    }

    function test_writeManifest_registryNotHolder_rejected() public {
        _publish(MANIFEST);
        cpu.setOwner(SHARED_ID, X);
        vm.expectRevert(SignetRegistry.NotHolder.selector);
        reg.writeManifest(DOMAIN, MANIFEST);
    }

    function test_writeManifest_projectsAreIsolated() public {
        ReleaseGate other = new ReleaseGate(config("shop.example.com"));
        _publish(MANIFEST);
        // other gate has no release: its domain can't be written with app.example.org's approved manifest
        vm.expectRevert(SignetRegistry.NotApproved.selector);
        reg.writeManifest("shop.example.com", MANIFEST);
        assertTrue(address(other) != address(gate));
    }

    // ---------------------------------------------------------------- bindings

    function test_claim_firstWins_secondReverts() public {
        vm.expectRevert(SignetRegistry.AlreadyBound.selector);
        new ReleaseGate(config(DOMAIN));
        vm.prank(X);
        vm.expectRevert(SignetRegistry.AlreadyBound.selector);
        reg.claim(DOMAIN, address(0));
    }

    function test_onlyBoundGateChangesBinding() public {
        vm.startPrank(X);
        vm.expectRevert(SignetRegistry.NotBoundGate.selector);
        reg.setContainer(DOMAIN, X);
        vm.expectRevert(SignetRegistry.NotBoundGate.selector);
        reg.transfer(DOMAIN, X);
        vm.expectRevert(SignetRegistry.NotBoundGate.selector);
        reg.unbind(DOMAIN);
        vm.stopPrank();
    }

    function test_domainValidation() public {
        string[12] memory bad = [
            "", "ab", "nodot", "UPPER.example.org", "a..b.org", ".a.org", "a.org.", "-a.org", "a-.org",
            "a/b.org", "../x.org", "a b.org"
        ];
        for (uint256 i; i < bad.length; i++) {
            vm.expectRevert(SignetRegistry.BadDomain.selector);
            reg.claim(bad[i], address(0));
        }
        reg.claim("a-b.c0.org", address(0));
        reg.claim("x.io", address(0));
    }

    function test_nft_onlySharedCircuitAccepted() public {
        vm.expectRevert(SignetRegistry.WrongNFT.selector);
        reg.onERC721Received(address(0), X, SHARED_ID, "");
        vm.prank(address(cpu));
        vm.expectRevert(SignetRegistry.WrongNFT.selector);
        reg.onERC721Received(address(0), X, 99, "");
        vm.prank(address(cpu));
        assertEq(reg.onERC721Received(address(0), X, SHARED_ID, ""), SignetRegistry.onERC721Received.selector);
    }

    function test_manifestPath() public view {
        assertEq(reg.manifestPath(DOMAIN), "projects/app.example.org/manifest.json");
    }
}
