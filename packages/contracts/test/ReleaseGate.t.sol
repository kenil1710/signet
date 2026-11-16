// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {GateBase} from "./GateBase.sol";
import {ReleaseGate} from "../src/ReleaseGate.sol";
import {IPolicyProcessor} from "../src/interfaces/ITapeOutPolicy.sol";

/// ReleaseGate against docs/signet-spec.md: tier calculation, every row of the tier table, freeze/unfreeze,
/// recovery, grace window, beacon pin, and the threat-model / edge-case rows that live on-chain.
contract ReleaseGateTest is GateBase {
    bytes32 constant M1 = keccak256("manifest-1");
    bytes32 constant M2 = keccak256("manifest-2");
    bytes32 constant M3 = keccak256("manifest-3");

    // ================================================================ exhaustive: gate x circuit

    /// For every one of the 512 circuit inputs that a gate can produce, build that exact state through the
    /// gate (approvals, time, tier from hashes, freeze, emergency flag), check the gate hands the circuit exactly
    /// those 9 bits, and check publish succeeds iff the truth table says PUBLISH = 1.
    /// Unreachable by construction: tL without tS (longDelay >= shortDelay), and tier 11 with e (admin
    /// proposals have no fast lane flag).
    function test_exhaustive_gateBitsAndPublishMatchTruthTable() public {
        uint256 checked;
        uint256 published;
        for (uint16 n; n < 512; n++) {
            bool tS = n & (1 << 3) != 0;
            bool tL = n & (1 << 4) != 0;
            uint8 tier = uint8(((n >> 5) & 1) << 1 | ((n >> 6) & 1)); // r1 r0
            bool f = n & (1 << 7) != 0;
            bool e = n & (1 << 8) != 0;
            if (tL && !tS) continue;
            if (tier == 3 && e) continue;

            uint256 snap = vm.snapshotState();
            baseline(M1);
            uint64 id;
            if (tier == 3) {
                id = proposeAdmin(ReleaseGate.Action.SetGuardian, abi.encode(makeAddr("guardian2")));
            } else {
                bytes32 allow = tier == 2 ? keccak256("allowlist-v2") : ALLOW;
                bytes32 orig = tier == 1 ? keccak256("origins-v2") : ORIG;
                id = propose(M2, allow, orig, e);
            }
            assertEq(gate.getProposal(id).tier, tier, "tier");
            approveMask(id, uint8(n & 7));
            if (tL) vm.warp(block.timestamp + 24 hours);
            else if (tS) vm.warp(block.timestamp + 1 hours);
            if (f) {
                vm.prank(A0);
                gate.freeze();
            }
            assertEq(gate.policyInputs(id), n, "gate supplies different bits");
            bool want = uint8(expected[n]) & 1 == 1;
            assertEq(tryPublish(id), want, string.concat("publish mismatch at input ", vm.toString(n)));
            if (want) published++;
            checked++;
            vm.revertToState(snap);
        }
        assertEq(checked, 336); // 512 - 128 (tL without tS) - 48 (tier 11 with e, of the remaining 384)
        emit log_named_uint("reachable inputs checked", checked);
        emit log_named_uint("of which PUBLISH", published);
    }

    // ================================================================ tier calculation (on-chain, never from CI)

    function test_tier_firstReleaseIsNewContracts() public {
        uint64 id = propose(M1, ALLOW, ORIG, false);
        assertEq(gate.getProposal(id).tier, 2);
    }

    function test_tier_codeOnly_00() public {
        baseline(M1);
        assertEq(gate.getProposal(propose(M2, ALLOW, ORIG, false)).tier, 0);
    }

    function test_tier_newOrigin_01() public {
        baseline(M1);
        assertEq(gate.getProposal(propose(M2, ALLOW, keccak256("o2"), false)).tier, 1);
    }

    function test_tier_newContract_10() public {
        baseline(M1);
        assertEq(gate.getProposal(propose(M2, keccak256("a2"), ORIG, false)).tier, 2);
    }

    function test_tier_bothChanged_isHigherTier_10() public {
        baseline(M1);
        assertEq(gate.getProposal(propose(M2, keccak256("a2"), keccak256("o2"), false)).tier, 2);
    }

    function test_tier_admin_11() public {
        assertEq(gate.getProposal(proposeAdmin(ReleaseGate.Action.SetGuardian, abi.encode(X))).tier, 3);
    }

    // ================================================================ tier table rows

    // 00 Code only: >=1 approval and tS, or 3 of 3 with e
    function test_row00_oneApprovalAfterShortTimelock_publishes() public {
        baseline(M1);
        uint64 id = propose(M2, ALLOW, ORIG, false);
        approveMask(id, 2);
        vm.warp(block.timestamp + 1 hours);
        assertTrue(tryPublish(id));
    }

    function test_row00_oneApprovalBeforeTimelock_denied() public {
        baseline(M1);
        uint64 id = propose(M2, ALLOW, ORIG, false);
        approveMask(id, 1);
        vm.warp(block.timestamp + 1 hours - 1);
        assertFalse(tryPublish(id));
    }

    function test_row00_noApproval_denied_evenAfterLongTimelock() public {
        baseline(M1);
        uint64 id = propose(M2, ALLOW, ORIG, false);
        vm.warp(block.timestamp + 30 days);
        assertFalse(tryPublish(id));
    }

    function test_row00_fastLane_threeOfThreeWithE_noTimelock() public {
        baseline(M1);
        uint64 id = propose(M2, ALLOW, ORIG, true);
        approveMask(id, 7);
        assertTrue(tryPublish(id));
    }

    function test_row00_fastLane_needsAllThree() public {
        baseline(M1);
        uint64 id = propose(M2, ALLOW, ORIG, true);
        approveMask(id, 3);
        assertFalse(tryPublish(id));
    }

    function test_row00_threeOfThreeWithoutE_stillWaitsForTimelock() public {
        baseline(M1);
        uint64 id = propose(M2, ALLOW, ORIG, false);
        approveMask(id, 7);
        assertFalse(tryPublish(id));
    }

    // 01 New external origin: >=2 approvals and tS (no fast lane)
    function test_row01_twoApprovalsAfterShortTimelock_publishes() public {
        baseline(M1);
        uint64 id = propose(M2, ALLOW, keccak256("o2"), false);
        approveMask(id, 5);
        vm.warp(block.timestamp + 1 hours);
        assertTrue(tryPublish(id));
    }

    function test_row01_oneApproval_denied() public {
        baseline(M1);
        uint64 id = propose(M2, ALLOW, keccak256("o2"), false);
        approveMask(id, 4);
        vm.warp(block.timestamp + 30 days);
        assertFalse(tryPublish(id));
    }

    function test_row01_twoApprovalsBeforeTimelock_denied() public {
        baseline(M1);
        uint64 id = propose(M2, ALLOW, keccak256("o2"), false);
        approveMask(id, 3);
        assertFalse(tryPublish(id));
    }

    function test_row01_noFastLane() public {
        baseline(M1);
        uint64 id = propose(M2, ALLOW, keccak256("o2"), true);
        approveMask(id, 7);
        assertFalse(tryPublish(id));
    }

    // 10 New contract / spender: >=2 approvals and tL, or 3 of 3 with e
    function test_row10_twoApprovalsAfterLongTimelock_publishes() public {
        baseline(M1);
        uint64 id = propose(M2, keccak256("a2"), ORIG, false);
        approveMask(id, 6);
        vm.warp(block.timestamp + 24 hours);
        assertTrue(tryPublish(id));
    }

    function test_row10_shortTimelockIsNotEnough() public {
        baseline(M1);
        uint64 id = propose(M2, keccak256("a2"), ORIG, false);
        approveMask(id, 7);
        vm.warp(block.timestamp + 24 hours - 1);
        assertFalse(tryPublish(id));
    }

    function test_row10_oneApproval_denied() public {
        baseline(M1);
        uint64 id = propose(M2, keccak256("a2"), ORIG, false);
        approveMask(id, 1);
        vm.warp(block.timestamp + 30 days);
        assertFalse(tryPublish(id));
    }

    function test_row10_fastLane_threeOfThreeWithE() public {
        baseline(M1);
        uint64 id = propose(M2, keccak256("a2"), ORIG, true);
        approveMask(id, 7);
        assertTrue(tryPublish(id));
    }

    // 11 Admin change: 3 of 3 and tL, no fast lane
    function test_row11_threeOfThreeAfterLongTimelock_executes() public {
        uint64 id = proposeAdmin(ReleaseGate.Action.SetGuardian, abi.encode(X));
        approveMask(id, 7);
        vm.warp(block.timestamp + 24 hours);
        assertTrue(tryPublish(id));
        assertEq(gate.guardian(), X);
    }

    function test_row11_twoOfThree_denied() public {
        uint64 id = proposeAdmin(ReleaseGate.Action.SetGuardian, abi.encode(X));
        approveMask(id, 3);
        vm.warp(block.timestamp + 30 days);
        assertFalse(tryPublish(id));
    }

    function test_row11_beforeLongTimelock_denied() public {
        uint64 id = proposeAdmin(ReleaseGate.Action.SetGuardian, abi.encode(X));
        approveMask(id, 7);
        vm.warp(block.timestamp + 24 hours - 1);
        assertFalse(tryPublish(id));
    }

    function test_row11_proposerKeyCannotProposeAdmin() public {
        vm.prank(P);
        vm.expectRevert(ReleaseGate.NotApprover.selector);
        gate.proposeAdmin(ReleaseGate.Action.SetGuardian, abi.encode(X));
    }

    // ================================================================ freeze / unfreeze

    function test_freeze_blocksEveryTier() public {
        baseline(M1);
        uint64 id = propose(M2, ALLOW, ORIG, true);
        approveMask(id, 7);
        vm.prank(A2);
        gate.freeze();
        vm.warp(block.timestamp + 30 days);
        assertFalse(tryPublish(id));
        uint64 adm = proposeAdmin(ReleaseGate.Action.SetGuardian, abi.encode(X));
        approveMask(adm, 7);
        vm.warp(block.timestamp + 30 days);
        assertFalse(tryPublish(adm));
    }

    function test_freeze_anyOneApproverOrGuardian_notProposerOrStranger() public {
        vm.prank(A1);
        gate.freeze();
        assertTrue(gate.frozen());
        _unfreezeWith(3);
        vm.prank(G);
        gate.freeze();
        assertTrue(gate.frozen());
        vm.prank(P);
        vm.expectRevert(ReleaseGate.NotFreezer.selector);
        gate.freeze();
        vm.prank(X);
        vm.expectRevert(ReleaseGate.NotFreezer.selector);
        gate.freeze();
    }

    function test_unfreeze_needsTwoApprovals_viaCircuit() public {
        vm.prank(A0);
        gate.freeze();
        vm.prank(A0);
        gate.approveUnfreeze();
        vm.expectRevert(ReleaseGate.PolicyDenied.selector);
        gate.unfreeze();
        vm.prank(A2);
        gate.approveUnfreeze();
        gate.unfreeze();
        assertFalse(gate.frozen());
    }

    function test_unfreeze_approvalsResetOnNewFreeze() public {
        vm.prank(A0);
        gate.freeze();
        _unfreezeWith(3);
        vm.prank(A0);
        gate.freeze(); // new freeze: earlier unfreeze approvals no longer count
        vm.prank(A1);
        gate.approveUnfreeze();
        vm.expectRevert(ReleaseGate.PolicyDenied.selector);
        gate.unfreeze();
    }

    function test_unfreeze_guardianAndProposerCannotApprove() public {
        vm.prank(A0);
        gate.freeze();
        vm.prank(G);
        vm.expectRevert(ReleaseGate.NotApprover.selector);
        gate.approveUnfreeze();
        vm.prank(P);
        vm.expectRevert(ReleaseGate.NotApprover.selector);
        gate.approveUnfreeze();
    }

    function test_unfreeze_whenNotFrozen_reverts() public {
        vm.expectRevert(ReleaseGate.NotFrozen.selector);
        gate.unfreeze();
    }

    // ================================================================ roles (threats 7, 8)

    function test_threat7_proposerCanOnlyPropose() public {
        baseline(M1);
        uint64 id = propose(M2, ALLOW, ORIG, false);
        vm.prank(P);
        vm.expectRevert(ReleaseGate.NotApprover.selector);
        gate.approve(id);
        vm.warp(block.timestamp + 30 days);
        assertFalse(tryPublish(id)); // no human approval, no release
    }

    function test_threat8_oneStolenApproverKey_cannotPassTiers01_10_11() public {
        baseline(M1);
        uint64 a = propose(M2, ALLOW, keccak256("o2"), true);
        uint64 b = propose(M3, keccak256("a2"), ORIG, true);
        uint64 c = proposeAdmin(ReleaseGate.Action.SetGuardian, abi.encode(X));
        approveMask(a, 1);
        approveMask(b, 1);
        approveMask(c, 1);
        vm.warp(block.timestamp + 30 days);
        assertFalse(tryPublish(a));
        assertFalse(tryPublish(b));
        assertFalse(tryPublish(c));
    }

    function test_strangerCannotProposeOrApprove() public {
        vm.prank(X);
        vm.expectRevert(ReleaseGate.NotProposer.selector);
        gate.proposeRelease(M1, ALLOW, ORIG, false);
        uint64 id = propose(M1, ALLOW, ORIG, false);
        vm.prank(X);
        vm.expectRevert(ReleaseGate.NotApprover.selector);
        gate.approve(id);
    }

    function test_approverMayProposeRelease_butApprovalIsSeparate() public {
        vm.prank(A0);
        uint64 id = gate.proposeRelease(M1, ALLOW, ORIG, false);
        assertEq(gate.getProposal(id).approvals, 0);
    }

    function test_approveTwice_countsOnce() public {
        baseline(M1);
        uint64 id = propose(M2, ALLOW, keccak256("o2"), false);
        approveMask(id, 1);
        approveMask(id, 1);
        vm.warp(block.timestamp + 1 hours);
        assertFalse(tryPublish(id));
    }

    // ================================================================ proposal hygiene

    function test_staleBase_afterAnotherRelease_reverts() public {
        baseline(M1);
        uint64 a = propose(M2, ALLOW, ORIG, false);
        uint64 b = propose(M3, ALLOW, ORIG, false); // computed against M1
        approveMask(a, 1);
        approveMask(b, 1);
        vm.warp(block.timestamp + 1 hours);
        gate.publish(a);
        vm.expectRevert(ReleaseGate.StaleBase.selector);
        gate.publish(b);
    }

    function test_staleBase_cannotSmuggleNewContractsAsCodeOnly() public {
        // A tier-10 change published first; a proposal made earlier against the old allowlist would otherwise
        // look like "code only" relative to its stale base.
        baseline(M1);
        uint64 old = propose(M2, ALLOW, ORIG, false);
        uint64 upd = propose(M3, keccak256("a2"), ORIG, true);
        approveMask(upd, 7);
        gate.publish(upd);
        approveMask(old, 1);
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(ReleaseGate.StaleBase.selector);
        gate.publish(old);
    }

    function test_publishTwice_reverts() public {
        uint64 id = baseline(M1);
        vm.expectRevert(ReleaseGate.AlreadyExecuted.selector);
        gate.publish(id);
    }

    function test_emptyManifest_rejected() public {
        vm.prank(P);
        vm.expectRevert(ReleaseGate.BadProposal.selector);
        gate.proposeRelease(bytes32(0), ALLOW, ORIG, false);
    }

    function test_unknownProposal_reverts() public {
        vm.expectRevert(ReleaseGate.BadProposal.selector);
        gate.publish(99);
    }

    // ================================================================ grace window (edge: old version cached)

    function test_graceWindow_previousValidFor6h() public {
        baseline(M1);
        assertTrue(gate.isValidManifest(M1));
        uint64 id = propose(M2, ALLOW, ORIG, true);
        approveMask(id, 7);
        gate.publish(id);
        assertTrue(gate.isValidManifest(M2));
        assertTrue(gate.isValidManifest(M1));
        vm.warp(block.timestamp + 6 hours - 1);
        assertTrue(gate.isValidManifest(M1));
        vm.warp(block.timestamp + 1);
        assertFalse(gate.isValidManifest(M1));
        assertTrue(gate.isValidManifest(M2));
        assertFalse(gate.isValidManifest(M3));
        assertFalse(gate.isValidManifest(bytes32(0)));
    }

    function test_noReleaseYet_nothingValid() public view {
        assertFalse(gate.isValidManifest(M1));
        assertEq(gate.currentManifestHash(), bytes32(0));
    }

    // ================================================================ beacon pin (decisions.md)

    function test_beaconChanged_publishAndUnfreezeRefused() public {
        uint64 id = propose(M1, ALLOW, ORIG, true);
        approveMask(id, 7);
        beacon.set(makeAddr("evilImpl"));
        vm.expectRevert(ReleaseGate.BeaconChanged.selector);
        gate.publish(id);
        vm.prank(A0);
        gate.freeze(); // freezing needs no circuit, still works
        _approveUnfreeze(3);
        vm.expectRevert(ReleaseGate.BeaconChanged.selector);
        gate.unfreeze();
        beacon.set(IMPL);
        gate.unfreeze();
        gate.publish(id);
    }

    function test_constructor_rejectsChangedBeacon() public {
        beacon.set(makeAddr("other"));
        vm.expectRevert(ReleaseGate.BeaconChanged.selector);
        new ReleaseGate(config(""));
    }

    function test_constructor_rejectsWrongNetlist() public {
        ReleaseGate.Config memory c = config("");
        c.policyNetlistSha256 = keccak256("not it");
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        new ReleaseGate(c);
    }

    function test_constructor_rejectsWrongCircuitShape() public {
        cpu.set(7, hex"00000002000003", 2, 1); // a 2-input circuit
        ReleaseGate.Config memory c = config("");
        c.policyCircuitId = 7;
        c.policyNetlistSha256 = sha256(hex"00000002000003");
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        new ReleaseGate(c);
    }

    function test_constructor_rejectsBadApproverSets() public {
        ReleaseGate.Config memory c = config("");
        c.approvers = [A0, A0, A2];
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        new ReleaseGate(c);
        c = config("");
        c.approvers = [A0, P, A2]; // CI key must not be an approver
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        new ReleaseGate(c);
        c = config("");
        c.approvers = [A0, address(0), A2];
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        new ReleaseGate(c);
        c = config("");
        c.recovery = address(0);
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        new ReleaseGate(c);
    }

    // ================================================================ recovery (edge: approver lost a key)

    function test_lostKey_twoApproversCannotPassTier11_recoveryCan() public {
        address newA2 = makeAddr("newApprover2");
        uint64 id = proposeAdmin(ReleaseGate.Action.SetApprover, abi.encode(uint8(2), newA2));
        approveMask(id, 3);
        vm.warp(block.timestamp + 30 days);
        assertFalse(tryPublish(id)); // tier 11 is 3 of 3

        vm.prank(R);
        gate.proposeRecovery([A0, A1, newA2]);
        vm.warp(block.timestamp + 7 days - 1);
        vm.expectRevert(ReleaseGate.TooEarly.selector);
        gate.executeRecovery();
        vm.warp(block.timestamp + 1);
        gate.executeRecovery();
        assertEq(gate.getApprovers()[2], newA2);
    }

    function test_recovery_onlyRecoveryAddress() public {
        vm.prank(A0);
        vm.expectRevert(ReleaseGate.NotRecovery.selector);
        gate.proposeRecovery([A0, A1, X]);
    }

    function test_recovery_cancelNeedsTwoApprovers() public {
        vm.prank(R);
        gate.proposeRecovery([X, makeAddr("y"), makeAddr("z")]); // stolen recovery key
        vm.prank(A0);
        gate.voteCancelRecovery();
        assertTrue(gate.getPendingRecovery().active); // one vote is not enough
        vm.prank(A1);
        gate.voteCancelRecovery();
        assertFalse(gate.getPendingRecovery().active);
        vm.warp(block.timestamp + 8 days);
        vm.expectRevert(ReleaseGate.NoRecovery.selector);
        gate.executeRecovery();
    }

    function test_recovery_worksWhileFrozen_freezeSpamByRogueApprover() public {
        // edge "freeze spam": A2 is rogue and keeps freezing
        vm.prank(A2);
        gate.freeze();
        _unfreezeWith(3);
        vm.prank(A2);
        gate.freeze();
        address newA2 = makeAddr("honest3");
        vm.prank(R);
        gate.proposeRecovery([A0, A1, newA2]);
        vm.warp(block.timestamp + 7 days);
        gate.executeRecovery();
        vm.prank(A2);
        vm.expectRevert(ReleaseGate.NotFreezer.selector);
        gate.freeze(); // A2 is out (project still frozen until 2 unfreeze)
        _unfreezeWith(3);
        assertFalse(gate.frozen());
    }

    function test_recovery_rejectsBadSet() public {
        vm.prank(R);
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        gate.proposeRecovery([A0, A0, A1]);
    }

    function test_approverChange_invalidatesOpenApprovals() public {
        baseline(M1);
        uint64 id = propose(M2, ALLOW, keccak256("o2"), false);
        approveMask(id, 3);
        vm.prank(R);
        gate.proposeRecovery([A0, makeAddr("n1"), makeAddr("n2")]);
        vm.warp(block.timestamp + 7 days);
        gate.executeRecovery();
        vm.expectRevert(ReleaseGate.StaleApprovers.selector);
        gate.publish(id);
    }

    // ================================================================ admin actions (tier 11)

    function test_admin_setApprover() public {
        address n = makeAddr("n");
        _admin(ReleaseGate.Action.SetApprover, abi.encode(uint8(1), n));
        assertEq(gate.getApprovers()[1], n);
        assertEq(gate.approverSet(), 1);
    }

    function test_admin_setApprover_rejectsProposerAsApprover() public {
        uint64 id = proposeAdmin(ReleaseGate.Action.SetApprover, abi.encode(uint8(1), P));
        approveMask(id, 7);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        gate.publish(id);
    }

    function test_admin_setProposer_and_setRecovery() public {
        _admin(ReleaseGate.Action.SetProposer, abi.encode(X));
        assertEq(gate.proposer(), X);
        _admin(ReleaseGate.Action.SetRecovery, abi.encode(makeAddr("r2")));
        assertEq(gate.recovery(), makeAddr("r2"));
    }

    function test_admin_setTimelocks_isTier11_andValidated() public {
        _admin(ReleaseGate.Action.SetTimelocks, abi.encode(uint32(2 hours), uint32(48 hours), uint32(1 hours)));
        assertEq(gate.shortDelay(), 2 hours);
        assertEq(gate.longDelay(), 48 hours);
        assertEq(gate.graceWindow(), 1 hours);
        uint64 bad = proposeAdmin(ReleaseGate.Action.SetTimelocks, abi.encode(uint32(5 hours), uint32(1 hours), uint32(0)));
        approveMask(bad, 7);
        vm.warp(block.timestamp + 48 hours);
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        gate.publish(bad);
    }

    function test_admin_circuitSwap_isTier11_andChecksNetlist() public {
        cpu.set(8, netlist, 9, 2);
        _admin(ReleaseGate.Action.SetPolicyCircuit, abi.encode(address(cpu), uint256(8), netlistSha));
        assertEq(gate.policyCircuitId(), 8);
        uint64 bad = proposeAdmin(ReleaseGate.Action.SetPolicyCircuit, abi.encode(address(cpu), uint256(8), bytes32(0)));
        approveMask(bad, 7);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        gate.publish(bad);
    }

    // ================================================================ domains (threat 11, edge cases)

    function test_domain_firstClaimAtDeploy() public view {
        (address g, address c) = reg.bindingOf(DOMAIN);
        assertEq(g, address(gate));
        assertEq(c, CONTAINER); // shared container
    }

    function test_threat11_rebindDomainNeedsTier11() public {
        ReleaseGate other = new ReleaseGate(config("other.example.org"));
        uint64 id = proposeAdmin(ReleaseGate.Action.TransferDomain, abi.encode(DOMAIN, address(other)));
        approveMask(id, 3);
        vm.warp(block.timestamp + 30 days);
        assertFalse(tryPublish(id));
        approveMask(id, 4);
        assertTrue(tryPublish(id));
        (address g,) = reg.bindingOf(DOMAIN);
        assertEq(g, address(other));
    }

    function test_edge_manyDomains_oneGate() public {
        _admin(ReleaseGate.Action.BindDomain, abi.encode("docs.example.org", address(0)));
        _admin(ReleaseGate.Action.BindDomain, abi.encode("beta.example.org", makeAddr("ownContainer")));
        (address g1, address c1) = reg.bindingOf("docs.example.org");
        (address g2, address c2) = reg.bindingOf("beta.example.org");
        assertEq(g1, address(gate));
        assertEq(c1, CONTAINER);
        assertEq(g2, address(gate));
        assertEq(c2, makeAddr("ownContainer"));
    }

    function test_edge_ownContainer_proEnterprise() public {
        _admin(ReleaseGate.Action.BindDomain, abi.encode(DOMAIN, makeAddr("teamContainer")));
        (, address c) = reg.bindingOf(DOMAIN);
        assertEq(c, makeAddr("teamContainer"));
    }

    function test_edge_giveUpDomain_unbindIsTier11() public {
        _admin(ReleaseGate.Action.UnbindDomain, abi.encode(DOMAIN));
        (address g, address c) = reg.bindingOf(DOMAIN);
        assertEq(g, address(0));
        assertEq(c, address(0)); // Guard then shows "Not protected"
    }

    // ================================================================ observe mode (edge: false positives)

    function test_observeMode_7daysThenApproverMayEnforce() public {
        assertFalse(gate.enforced());
        vm.prank(A0);
        vm.expectRevert(ReleaseGate.TooEarly.selector);
        gate.enforce();
        vm.warp(block.timestamp + 7 days);
        vm.prank(P);
        vm.expectRevert(ReleaseGate.NotApprover.selector);
        gate.enforce();
        vm.prank(A0);
        gate.enforce();
        assertTrue(gate.enforced());
        _admin(ReleaseGate.Action.SetObserveMode, "");
        assertFalse(gate.enforced());
    }

    // ================================================================ helpers

    function _admin(ReleaseGate.Action a, bytes memory args) internal {
        uint64 id = proposeAdmin(a, args);
        approveMask(id, 7);
        vm.warp(block.timestamp + gate.longDelay());
        gate.publish(id);
    }

    function _approveUnfreeze(uint8 mask) internal {
        address[3] memory a = approvers();
        for (uint256 i; i < 3; i++) {
            if (mask & (1 << i) != 0) {
                vm.prank(a[i]);
                gate.approveUnfreeze();
            }
        }
    }

    function _unfreezeWith(uint8 mask) internal {
        _approveUnfreeze(mask);
        gate.unfreeze();
    }
}
