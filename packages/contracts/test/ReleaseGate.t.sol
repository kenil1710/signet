// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {GateBase} from "./GateBase.sol";
import {ReleaseGate} from "../src/ReleaseGate.sol";
import {SignetRegistry} from "../src/SignetRegistry.sol";
import {SignetFactory} from "../src/SignetFactory.sol";
import {NetlistProcessor, FakeProcessor} from "./mocks/Mocks.sol";

/// ReleaseGate against docs/signet-spec.md and the security-review fixes (H-1..L-4, named in the test names).
contract ReleaseGateTest is GateBase {
    bytes32 constant ALLOW2 = keccak256("allowlist-v2");
    bytes32 constant ORIG2 = keccak256("origins-v2");

    // ================================================================ exhaustive: gate x circuit

    /// For every circuit input a gate can produce, build that exact state through the gate (approvals, time since
    /// the last approval, tier from hashes, freeze, emergency flag), check the gate hands the circuit exactly
    /// those 9 bits, and check publish succeeds iff the truth table says PUBLISH = 1.
    /// Unreachable by construction: tL without tS; a timelock bit with fewer approvals than the tier needs (the
    /// clock starts when that count is reached); tier 11 with e (admin proposals have no fast lane).
    function test_exhaustive_gateBitsAndPublishMatchTruthTable() public {
        uint256 checked;
        uint256 published;
        for (uint16 n; n < 512; n++) {
            bool tS = n & 8 != 0;
            bool tL = n & 16 != 0;
            uint8 tier = uint8(((n >> 5) & 1) << 1 | ((n >> 6) & 1)); // r1 r0
            bool e = n & 256 != 0;
            if (tL && !tS) continue;
            uint8 count = uint8((n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1));
            if (tS && count < (tier == 0 ? 1 : tier == 3 ? 3 : 2)) continue; // the clock starts at the tier's count
            if (tier == 3 && e) continue;

            uint256 snap = vm.snapshotState();
            baseline(F1);
            uint64 id = tier == 3
                ? proposeAdmin(ReleaseGate.Action.SetObserveMode, "")
                : propose(F2, tier == 2 ? ALLOW2 : ALLOW, tier == 1 ? ORIG2 : ORIG, e);
            assertEq(gate.getProposal(id).tier, tier, "tier");
            approveMask(id, uint8(n & 7));
            if (tL) vm.warp(block.timestamp + 24 hours);
            else if (tS) vm.warp(block.timestamp + 1 hours);
            if (n & 128 != 0) {
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
        assertEq(checked, 236); // per tier: 22 x 2 (00), 16 x 2 (01), 16 x 2 (10), 10 (11); x 2 freeze states
        emit log_named_uint("reachable inputs checked", checked);
        emit log_named_uint("of which PUBLISH", published);
    }

    // ================================================================ tier calculation (on-chain, never from CI)

    function test_tier_firstReleaseIsNewContracts() public {
        assertEq(gate.getProposal(propose(F1, ALLOW, ORIG, false)).tier, 2);
    }

    function test_tier_codeOnly_00() public {
        baseline(F1);
        assertEq(gate.getProposal(propose(F2, ALLOW, ORIG, false)).tier, 0);
    }

    function test_tier_newOrigin_01() public {
        baseline(F1);
        assertEq(gate.getProposal(propose(F2, ALLOW, ORIG2, false)).tier, 1);
    }

    function test_tier_newContract_10() public {
        baseline(F1);
        assertEq(gate.getProposal(propose(F2, ALLOW2, ORIG, false)).tier, 2);
    }

    function test_tier_bothChanged_isHigherTier_10() public {
        baseline(F1);
        assertEq(gate.getProposal(propose(F2, ALLOW2, ORIG2, false)).tier, 2);
    }

    function test_tier_admin_11() public {
        assertEq(gate.getProposal(proposeAdmin(ReleaseGate.Action.SetObserveMode, "")).tier, 3);
    }

    // ================================================================ H-1: manifest hash and tier from the same inputs

    function test_H1_manifestHashIsComputedOnChainFromTheThreeHashes() public {
        baseline(F1);
        assertEq(gate.currentManifestHash(), sha256(abi.encode(F1, ALLOW, ORIG)));
        assertTrue(gate.isValidManifest(mh(F1, ALLOW, ORIG)));
        (bytes32 root, bytes32 a, bytes32 o, bool ok) = gate.activeRelease();
        assertEq(root, F1);
        assertEq(a, ALLOW);
        assertEq(o, ORIG);
        assertTrue(ok);
    }

    function test_H1_ciCannotShipNewAllowlistAtALowerTier() public {
        baseline(F1);
        // Honest: the new allowlist's hash is given, so the tier is 10.
        assertEq(gate.getProposal(propose(F2, ALLOW2, ORIG, false)).tier, 2);
        // Lying: CI repeats the OLD allowlist hash to get tier 00. Then the sealed manifest hash commits to the
        // old allowlist, so a manifest carrying the new allowlist can never be valid.
        uint64 lie = propose(F2, ALLOW, ORIG, false);
        assertEq(gate.getProposal(lie).tier, 0);
        approveMask(lie, 1);
        vm.warp(block.timestamp + 1 hours);
        gate.publish(lie);
        assertTrue(gate.isValidManifest(mh(F2, ALLOW, ORIG)));
        assertFalse(gate.isValidManifest(mh(F2, ALLOW2, ORIG)));
    }

    function test_H1_emptyFilesRoot_rejected() public {
        vm.prank(P);
        vm.expectRevert(ReleaseGate.BadProposal.selector);
        gate.proposeRelease(bytes32(0), ALLOW, ORIG, false);
    }

    // ================================================================ H-2: timelocks from the last approval, expiry

    function test_H2_timelockRunsFromApproval_notFromProposal() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, false);
        vm.warp(block.timestamp + 6 days); // an old, unreviewed proposal
        approveMask(id, 1);
        assertFalse(tryPublish(id)); // approved a second ago: the 1 h window for others to react starts now
        vm.warp(block.timestamp + 1 hours - 1);
        assertFalse(tryPublish(id));
        vm.warp(block.timestamp + 1);
        assertTrue(tryPublish(id));
    }

    // ---- L-3 (second review): the clock starts when the tier's approval count is first reached

    function test_L3_clockStartsWhenRequiredCountIsReached() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW2, ORIG, false); // tier 10 needs 2
        approveMask(id, 1);
        assertEq(gate.getProposal(id).readyAt, 0); // one approval: not started
        vm.warp(block.timestamp + 23 hours);
        approveMask(id, 2); // the count is reached now
        assertEq(gate.getProposal(id).readyAt, block.timestamp);
        vm.warp(block.timestamp + 24 hours - 1);
        assertFalse(tryPublish(id));
        vm.warp(block.timestamp + 1);
        assertTrue(tryPublish(id));
    }

    function test_L3_extraApprovalsDoNotRestartTheClock() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, false); // tier 00 needs 1
        approveMask(id, 1);
        vm.warp(block.timestamp + 50 minutes);
        approveMask(id, 6); // two more approvals, late
        vm.warp(block.timestamp + 10 minutes);
        assertTrue(tryPublish(id)); // 1 h after the FIRST approval
    }

    function test_L3_droppingBelowTheCountResetsTheClock() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG2, false); // tier 01 needs 2
        approveMask(id, 7);
        vm.warp(block.timestamp + 30 minutes);
        vm.prank(A2);
        gate.withdrawApproval(id); // 2 left: still at the count, clock keeps running
        assertTrue(gate.getProposal(id).readyAt != 0);
        vm.prank(A1);
        gate.withdrawApproval(id); // 1 left: below the count
        assertEq(gate.getProposal(id).readyAt, 0);
        vm.warp(block.timestamp + 2 hours);
        assertFalse(tryPublish(id));
        vm.prank(A1);
        gate.approve(id); // reached again: the clock starts over
        vm.warp(block.timestamp + 1 hours - 1);
        assertFalse(tryPublish(id));
        vm.warp(block.timestamp + 1);
        assertTrue(tryPublish(id));
    }

    function test_H2_releaseProposalExpiresAfter7Days() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, false);
        approveMask(id, 1);
        vm.warp(block.timestamp + 7 days + 1);
        vm.expectRevert(ReleaseGate.Expired.selector);
        gate.publish(id);
        vm.prank(A1);
        vm.expectRevert(ReleaseGate.Expired.selector);
        gate.approve(id);
    }

    function test_H2_stillPublishableAtExactly7Days() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, false);
        approveMask(id, 1);
        vm.warp(block.timestamp + 7 days);
        assertTrue(tryPublish(id));
    }

    function test_H2_adminProposalExpiresAfter7Days() public {
        uint64 id = proposeAdmin(ReleaseGate.Action.SetObserveMode, "");
        approveMask(id, 7);
        vm.warp(block.timestamp + 7 days + 1);
        vm.expectRevert(ReleaseGate.Expired.selector);
        gate.publish(id);
    }

    // ================================================================ tier table rows

    // 00 Code only: >=1 approval and tS, or 3 of 3 with e
    function test_row00_oneApprovalAfterShortTimelock_publishes() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, false);
        approveMask(id, 2);
        vm.warp(block.timestamp + 1 hours);
        assertTrue(tryPublish(id));
    }

    function test_row00_oneApprovalBeforeTimelock_denied() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, false);
        approveMask(id, 1);
        vm.warp(block.timestamp + 1 hours - 1);
        assertFalse(tryPublish(id));
    }

    function test_row00_noApproval_denied() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, false);
        vm.warp(block.timestamp + 6 days);
        assertFalse(tryPublish(id));
    }

    function test_row00_fastLane_threeOfThreeWithE_noTimelock() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, true);
        approveMask(id, 7);
        assertTrue(tryPublish(id));
    }

    function test_row00_fastLane_needsAllThree() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, true);
        approveMask(id, 3);
        assertFalse(tryPublish(id));
    }

    function test_row00_threeOfThreeWithoutE_stillWaitsForTimelock() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, false);
        approveMask(id, 7);
        assertFalse(tryPublish(id));
    }

    // 01 New external origin: >=2 approvals and tS (no fast lane)
    function test_row01_twoApprovalsAfterShortTimelock_publishes() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG2, false);
        approveMask(id, 5);
        vm.warp(block.timestamp + 1 hours);
        assertTrue(tryPublish(id));
    }

    function test_row01_oneApproval_denied() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG2, false);
        approveMask(id, 4);
        vm.warp(block.timestamp + 5 days);
        assertFalse(tryPublish(id));
    }

    function test_row01_twoApprovalsBeforeTimelock_denied() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG2, false);
        approveMask(id, 3);
        assertFalse(tryPublish(id));
    }

    function test_row01_noFastLane() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG2, true);
        approveMask(id, 7);
        assertFalse(tryPublish(id));
    }

    // 10 New contract / spender: >=2 approvals and tL, or 3 of 3 with e
    function test_row10_twoApprovalsAfterLongTimelock_publishes() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW2, ORIG, false);
        approveMask(id, 6);
        vm.warp(block.timestamp + 24 hours);
        assertTrue(tryPublish(id));
    }

    function test_row10_shortTimelockIsNotEnough() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW2, ORIG, false);
        approveMask(id, 7);
        vm.warp(block.timestamp + 24 hours - 1);
        assertFalse(tryPublish(id));
    }

    function test_row10_oneApproval_denied() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW2, ORIG, false);
        approveMask(id, 1);
        vm.warp(block.timestamp + 5 days);
        assertFalse(tryPublish(id));
    }

    function test_row10_fastLane_threeOfThreeWithE() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW2, ORIG, true);
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
        vm.warp(block.timestamp + 5 days);
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

    // ================================================================ L-1: no tier-10 fast lane with a new origin

    function test_L1_tier10FastLane_refusedWhenOriginsAlsoChanged() public {
        baseline(F1);
        vm.prank(P);
        vm.expectRevert(ReleaseGate.FastLaneNotAllowed.selector);
        gate.proposeRelease(F2, ALLOW2, ORIG2, true);
        // without the fast lane it is a normal tier-10 proposal
        uint64 id = propose(F2, ALLOW2, ORIG2, false);
        approveMask(id, 7);
        assertFalse(tryPublish(id));
        vm.warp(block.timestamp + 24 hours);
        assertTrue(tryPublish(id));
    }

    function test_L1_firstRelease_mayUseFastLane() public {
        baseline(F1); // both hashes "change" from nothing; there is no earlier release to protect
        assertEq(gate.currentRelease(), 1);
    }

    /// The exemption only lets a first release ASK for the fast lane. The circuit still wants 3 of 3 for it.
    function test_L1_firstRelease_fastLaneStillNeedsThreeOfThree() public {
        uint8[6] memory masks = [1, 2, 4, 3, 5, 6]; // every set of one or two approvers
        for (uint256 i; i < masks.length; i++) {
            uint256 snap = vm.snapshotState();
            uint64 id = propose(F1, ALLOW, ORIG, true);
            approveMask(id, masks[i]);
            assertFalse(tryPublish(id));
            vm.warp(block.timestamp + 24 hours - 1); // without 3 of 3 it is plain tier 10: 2 approvals + 24 h
            assertFalse(tryPublish(id));
            vm.warp(block.timestamp + 1);
            assertEq(tryPublish(id), masks[i] == 3 || masks[i] == 5 || masks[i] == 6);
            vm.revertToState(snap);
        }
        uint64 all = propose(F1, ALLOW, ORIG, true);
        approveMask(all, 7);
        assertTrue(tryPublish(all));
    }

    // ================================================================ freeze / unfreeze, M-2

    function test_freeze_blocksEveryTier() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, true);
        approveMask(id, 7);
        uint64 adm = proposeAdmin(ReleaseGate.Action.SetObserveMode, "");
        approveMask(adm, 7);
        vm.prank(A2);
        gate.freeze();
        vm.warp(block.timestamp + 2 days);
        assertFalse(tryPublish(id));
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
        _unfreezeWith(3);
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
        vm.prank(A2);
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

    function test_M2_freezeCooldown_oneFreezePerKeyPer24h() public {
        vm.prank(A2);
        gate.freeze();
        _unfreezeWith(3);
        vm.prank(A2);
        vm.expectRevert(ReleaseGate.FreezeCooldown.selector);
        gate.freeze(); // the same key can't re-freeze right away
        vm.warp(block.timestamp + 24 hours - 1);
        vm.prank(A2);
        vm.expectRevert(ReleaseGate.FreezeCooldown.selector);
        gate.freeze();
        vm.prank(A1);
        gate.freeze(); // another approver still can
        _unfreezeWith(5);
        vm.warp(block.timestamp + 1);
        vm.prank(A2);
        gate.freeze();
        assertTrue(gate.frozen());
    }

    function test_M2_freezeCooldown_appliesToGuardian_andFreezingTwiceReverts() public {
        vm.prank(G);
        gate.freeze();
        vm.prank(A0);
        vm.expectRevert(ReleaseGate.AlreadyFrozen.selector);
        gate.freeze(); // does not burn A0's cooldown
        _unfreezeWith(3);
        vm.prank(G);
        vm.expectRevert(ReleaseGate.FreezeCooldown.selector);
        gate.freeze();
        vm.prank(A0);
        gate.freeze();
    }

    function test_M2_unfreezeAndPublish_inOneTransaction() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, false);
        approveMask(id, 1);
        vm.prank(G);
        gate.freeze();
        vm.warp(block.timestamp + 1 hours); // the timelock keeps running while frozen
        vm.prank(A0);
        gate.approveUnfreeze();
        vm.prank(A1);
        gate.approveUnfreeze();
        gate.unfreezeAndPublish(id);
        assertEq(gate.currentRelease(), id);
        assertFalse(gate.frozen());
    }

    function test_M2_unfreezeAndPublish_revertsAsAWholeIfPolicyDenies() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, false); // no approval
        vm.prank(A0);
        gate.freeze();
        vm.prank(A0);
        gate.approveUnfreeze();
        vm.prank(A1);
        gate.approveUnfreeze();
        vm.expectRevert(ReleaseGate.PolicyDenied.selector);
        gate.unfreezeAndPublish(id);
        assertTrue(gate.frozen());
    }

    function test_M2_twoApproversRemoveGuardian_whileFrozen() public {
        vm.prank(G);
        gate.freeze(); // a rogue guardian
        vm.prank(A0);
        gate.voteRemoveGuardian();
        assertEq(gate.guardian(), G); // one vote is not enough
        vm.prank(A0);
        gate.voteRemoveGuardian();
        assertEq(gate.guardian(), G); // the same approver twice counts once
        vm.prank(A1);
        gate.voteRemoveGuardian();
        assertEq(gate.guardian(), address(0));
        assertTrue(gate.frozen());
        _unfreezeWith(3);
        vm.warp(block.timestamp + 2 days);
        vm.prank(G);
        vm.expectRevert(ReleaseGate.NotFreezer.selector);
        gate.freeze();
    }

    function test_M2_removeGuardian_onlyApprovers() public {
        vm.prank(P);
        vm.expectRevert(ReleaseGate.NotApprover.selector);
        gate.voteRemoveGuardian();
    }

    function test_M2_setGuardianZero_viaTier11() public {
        admin(ReleaseGate.Action.SetGuardian, abi.encode(address(0)));
        assertEq(gate.guardian(), address(0));
    }

    function test_M2_recoveryRemovesApprover_whileFrozen() public {
        vm.prank(A2);
        gate.freeze(); // rogue approver A2
        address honest = makeAddr("honest3");
        vm.prank(R);
        gate.proposeRecovery([A0, A1, honest]);
        vm.warp(block.timestamp + 7 days);
        gate.executeRecovery();
        assertTrue(gate.frozen());
        vm.prank(A2);
        vm.expectRevert(ReleaseGate.NotApprover.selector);
        gate.approveUnfreeze();
        _unfreezeWith(3);
        vm.prank(A2);
        vm.expectRevert(ReleaseGate.NotFreezer.selector);
        gate.freeze();
    }

    // ================================================================ M-1: Solidity mirror fallback

    function test_M1_beaconChanged_mirrorDecides_andEventIsEmitted() public {
        baseline(F1);
        uint64 denied = propose(F2, ALLOW, ORIG2, true); // tier 01 has no fast lane
        approveMask(denied, 7);
        uint64 ok = propose(F3, ALLOW, ORIG, true);
        approveMask(ok, 7);
        address evil = makeAddr("newImplementation");
        beacon.set(evil);
        assertFalse(tryPublish(denied)); // the mirror applies the same policy
        vm.expectEmit(false, false, false, true, address(gate));
        emit ReleaseGate.PolicyFallbackActive(evil, 1);
        gate.publish(ok);
        assertEq(gate.currentRelease(), ok);
    }

    function test_M1_beaconChanged_circuitIsNotCalled() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, true);
        approveMask(id, 7);
        beacon.set(makeAddr("x"));
        vm.mockCallRevert(address(cpu), abi.encodeWithSelector(NetlistProcessor.eval.selector), "must not be called");
        gate.publish(id);
    }

    function test_M1_beaconChanged_unfreezeUsesMirror() public {
        vm.prank(A0);
        gate.freeze();
        beacon.set(makeAddr("x"));
        vm.prank(A0);
        gate.approveUnfreeze();
        vm.expectRevert(ReleaseGate.PolicyDenied.selector);
        gate.unfreeze();
        vm.prank(A1);
        gate.approveUnfreeze();
        gate.unfreeze();
        assertFalse(gate.frozen());
    }

    function test_info_circuitEvalReverts_mirrorDecides_andEventIsEmitted() public {
        baseline(F1);
        uint64 denied = propose(F2, ALLOW, ORIG2, true); // tier 01: no fast lane, also under the mirror
        approveMask(denied, 7);
        uint64 ok = propose(F3, ALLOW, ORIG, true);
        approveMask(ok, 7);
        vm.mockCallRevert(address(cpu), abi.encodeWithSelector(NetlistProcessor.eval.selector), "circuit unavailable");
        assertFalse(tryPublish(denied));
        vm.expectEmit(false, false, false, true, address(gate));
        emit ReleaseGate.PolicyFallbackActive(IMPL, 2);
        gate.publish(ok);
        assertEq(gate.currentRelease(), ok);
    }

    function test_info_circuitAnswersWithBadLength_mirrorDecides() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, false); // one approval, no timelock yet: must stay denied
        approveMask(id, 1);
        vm.mockCall(address(cpu), abi.encodeWithSelector(NetlistProcessor.eval.selector), abi.encode(hex"0303"));
        assertFalse(tryPublish(id));
        vm.warp(block.timestamp + 1 hours);
        assertTrue(tryPublish(id));
    }

    function test_M1_beaconUnchanged_noFallbackEvent() public {
        vm.recordLogs();
        baseline(F1);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("PolicyFallbackActive(address,uint8)");
        assertGt(logs.length, 0);
        for (uint256 i; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != topic);
        }
    }

    // ================================================================ M-3: circuit swap

    function test_M3_swapToAnotherCopyOfTheSameNetlist() public {
        cpu.set(8, netlist, 9, 2);
        admin(ReleaseGate.Action.SetPolicyCircuit, abi.encode(address(cpu), uint256(8)));
        assertEq(gate.policyCircuitId(), 8);
    }

    function test_M3_swapToFakeProcessor_rejected_evenWithTheRightNetlistBytes() public {
        FakeProcessor fake = new FakeProcessor(netlist); // returns the right netlist, evals "always yes"
        _expectBadAdmin(ReleaseGate.Action.SetPolicyCircuit, abi.encode(address(fake), uint256(6)));
        assertEq(address(gate.policyProcessor()), address(cpu));
    }

    function test_M3_swapToDifferentNetlist_rejected() public {
        bytes memory other = netlist;
        other[other.length - 1] = 0x0e; // a different 9-in / 2-out circuit
        cpu.set(9, other, 9, 2);
        _expectBadAdmin(ReleaseGate.Action.SetPolicyCircuit, abi.encode(address(cpu), uint256(9)));
    }

    function test_M3_swapToWrongShape_rejected() public {
        cpu.set(7, hex"00000002000003", 2, 1);
        _expectBadAdmin(ReleaseGate.Action.SetPolicyCircuit, abi.encode(address(cpu), uint256(7)));
    }

    // ================================================================ M-4: distinct roles

    function test_M4_creation_rejectsClashingRoles() public {
        address[3] memory a = [A0, A1, A2];
        _expectBadCreate([A0, A0, A2], P, R, G); // duplicate approver
        _expectBadCreate([A0, address(0), A2], P, R, G);
        _expectBadCreate([A0, P, A2], P, R, G); // proposer is an approver
        _expectBadCreate([A0, R, A2], P, R, G); // recovery is an approver
        _expectBadCreate([A0, G, A2], P, R, G); // guardian is an approver
        _expectBadCreate(a, P, P, G); // proposer == recovery
        _expectBadCreate(a, P, R, P); // guardian == proposer
        _expectBadCreate(a, P, R, R); // guardian == recovery
        _expectBadCreate(a, address(0), R, G);
        _expectBadCreate(a, P, address(0), G);
        newGateWith(a, P, R, address(0), "", address(0), 0); // no guardian is fine
    }

    function test_M4_everySetter_rejectsClashingRoles() public {
        _expectBadAdmin(ReleaseGate.Action.SetApprover, abi.encode(uint8(1), P));
        _expectBadAdmin(ReleaseGate.Action.SetApprover, abi.encode(uint8(1), R));
        _expectBadAdmin(ReleaseGate.Action.SetApprover, abi.encode(uint8(1), G));
        _expectBadAdmin(ReleaseGate.Action.SetApprover, abi.encode(uint8(1), A0));
        _expectBadAdmin(ReleaseGate.Action.SetApprover, abi.encode(uint8(1), address(0)));
        _expectBadAdmin(ReleaseGate.Action.SetApprover, abi.encode(uint8(3), X));
        _expectBadAdmin(ReleaseGate.Action.SetProposer, abi.encode(A0));
        _expectBadAdmin(ReleaseGate.Action.SetProposer, abi.encode(R));
        _expectBadAdmin(ReleaseGate.Action.SetProposer, abi.encode(G));
        _expectBadAdmin(ReleaseGate.Action.SetProposer, abi.encode(address(0)));
        _expectBadAdmin(ReleaseGate.Action.SetRecovery, abi.encode(A1));
        _expectBadAdmin(ReleaseGate.Action.SetRecovery, abi.encode(P));
        _expectBadAdmin(ReleaseGate.Action.SetRecovery, abi.encode(G));
        _expectBadAdmin(ReleaseGate.Action.SetRecovery, abi.encode(address(0)));
        _expectBadAdmin(ReleaseGate.Action.SetGuardian, abi.encode(A2));
        _expectBadAdmin(ReleaseGate.Action.SetGuardian, abi.encode(P));
        _expectBadAdmin(ReleaseGate.Action.SetGuardian, abi.encode(R));
    }

    function test_M4_recovery_rejectsClashingRoles() public {
        vm.startPrank(R);
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        gate.proposeRecovery([A0, A0, A1]);
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        gate.proposeRecovery([A0, A1, P]);
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        gate.proposeRecovery([A0, A1, R]);
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        gate.proposeRecovery([A0, A1, G]);
        vm.stopPrank();
    }

    function test_M4_recovery_recheckedAtExecution() public {
        address n = makeAddr("n");
        vm.prank(R);
        gate.proposeRecovery([A0, A1, n]);
        admin(ReleaseGate.Action.SetGuardian, abi.encode(n)); // n becomes the guardian meanwhile
        vm.warp(block.timestamp + 7 days);
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        gate.executeRecovery();
    }

    function test_M4_validSetters() public {
        address n = makeAddr("n");
        admin(ReleaseGate.Action.SetApprover, abi.encode(uint8(1), n));
        assertEq(gate.getApprovers()[1], n);
        assertEq(gate.approverSet(), 1);
        admin2(n, ReleaseGate.Action.SetProposer, abi.encode(X));
        assertEq(gate.proposer(), X);
        admin2(n, ReleaseGate.Action.SetRecovery, abi.encode(makeAddr("r2")));
        assertEq(gate.recovery(), makeAddr("r2"));
    }

    // ================================================================ M-5: cancel and withdraw

    function test_M5_anyApproverCancelsAProposal() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, true);
        approveMask(id, 3);
        vm.prank(P);
        vm.expectRevert(ReleaseGate.NotApprover.selector);
        gate.cancel(id);
        vm.prank(A2);
        gate.cancel(id);
        vm.prank(A2);
        vm.expectRevert(ReleaseGate.NotLive.selector);
        gate.approve(id);
        vm.expectRevert(ReleaseGate.NotLive.selector);
        gate.publish(id);
        vm.prank(A0);
        vm.expectRevert(ReleaseGate.NotLive.selector);
        gate.cancel(id);
    }

    function test_M5_cancelAdminProposal_andExecutedOnesCannotBeCancelled() public {
        uint64 adm = proposeAdmin(ReleaseGate.Action.SetObserveMode, "");
        vm.prank(A1);
        gate.cancel(adm);
        vm.prank(A0);
        vm.expectRevert(ReleaseGate.NotLive.selector);
        gate.approve(adm);
        uint64 rel = baseline(F1);
        vm.prank(A0);
        vm.expectRevert(ReleaseGate.NotLive.selector);
        gate.cancel(rel);
    }

    function test_M5_withdrawOwnApproval() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG2, false);
        approveMask(id, 3);
        vm.prank(A1);
        gate.withdrawApproval(id);
        assertEq(gate.getProposal(id).approvals, 1);
        vm.warp(block.timestamp + 1 hours);
        assertFalse(tryPublish(id)); // back to one approval: tier 01 needs two
        vm.prank(A1);
        gate.approve(id); // approving again restarts the clock
        assertFalse(tryPublish(id));
        vm.warp(block.timestamp + 1 hours);
        assertTrue(tryPublish(id));
    }

    function test_M5_approveTwice_reverts_soTheClockIsNotResetByAccident() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, false);
        approveMask(id, 1);
        vm.prank(A0);
        vm.expectRevert(ReleaseGate.AlreadyApproved.selector);
        gate.approve(id);
    }

    // ================================================================ M-7: revoke, grace while frozen

    function test_M7_oneApproverRevokesImmediately_unrevokeNeedsTwo() public {
        uint64 id = baseline(F1);
        bytes32 m = mh(F1, ALLOW, ORIG);
        assertTrue(gate.isValidManifest(m));
        vm.prank(A2);
        gate.revoke(id);
        assertFalse(gate.isValidManifest(m));
        (,,, bool ok) = gate.activeRelease();
        assertFalse(ok);
        vm.prank(A2);
        gate.voteUnrevoke(id);
        assertFalse(gate.isValidManifest(m));
        vm.prank(A2);
        gate.voteUnrevoke(id); // the same approver twice counts once
        assertFalse(gate.isValidManifest(m));
        vm.prank(A0);
        gate.voteUnrevoke(id);
        assertTrue(gate.isValidManifest(m));
    }

    function test_M7_revokeAgainClearsUnrevokeVotes() public {
        uint64 id = baseline(F1);
        vm.prank(A0);
        gate.revoke(id);
        vm.prank(A1);
        gate.voteUnrevoke(id);
        vm.prank(A2);
        gate.revoke(id);
        vm.prank(A0);
        gate.voteUnrevoke(id);
        assertFalse(gate.isValidManifest(mh(F1, ALLOW, ORIG)));
    }

    function test_M7_onlyApprovers_onlyPublishedReleases() public {
        uint64 id = baseline(F1);
        vm.prank(P);
        vm.expectRevert(ReleaseGate.NotApprover.selector);
        gate.revoke(id);
        vm.prank(G);
        vm.expectRevert(ReleaseGate.NotApprover.selector);
        gate.revoke(id);
        uint64 pending = propose(F2, ALLOW, ORIG, false);
        vm.prank(A0);
        vm.expectRevert(ReleaseGate.BadProposal.selector);
        gate.revoke(pending);
        vm.prank(A0);
        vm.expectRevert(ReleaseGate.BadProposal.selector);
        gate.voteUnrevoke(id); // not revoked
    }

    function test_M7_revokedPreviousRelease_notValidInGraceWindow() public {
        uint64 r1 = baseline(F1);
        uint64 r2 = propose(F2, ALLOW, ORIG, true);
        approveMask(r2, 7);
        gate.publish(r2);
        assertTrue(gate.isValidManifest(mh(F1, ALLOW, ORIG)));
        vm.prank(A1);
        gate.revoke(r1);
        assertFalse(gate.isValidManifest(mh(F1, ALLOW, ORIG)));
        assertTrue(gate.isValidManifest(mh(F2, ALLOW, ORIG)));
    }

    function test_M7_whileFrozen_previousReleaseGraceEnds() public {
        baseline(F1);
        uint64 r2 = propose(F2, ALLOW, ORIG, true);
        approveMask(r2, 7);
        gate.publish(r2);
        assertTrue(gate.isValidManifest(mh(F1, ALLOW, ORIG)));
        vm.prank(A0);
        gate.freeze();
        assertFalse(gate.isValidManifest(mh(F1, ALLOW, ORIG)));
        assertTrue(gate.isValidManifest(mh(F2, ALLOW, ORIG))); // the current release stays valid
        _unfreezeWith(3);
        assertTrue(gate.isValidManifest(mh(F1, ALLOW, ORIG))); // still inside the 6 h window
    }

    // ================================================================ grace window

    function test_graceWindow_previousValidFor6h() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, true);
        approveMask(id, 7);
        gate.publish(id);
        vm.warp(block.timestamp + 6 hours - 1);
        assertTrue(gate.isValidManifest(mh(F1, ALLOW, ORIG)));
        vm.warp(block.timestamp + 1);
        assertFalse(gate.isValidManifest(mh(F1, ALLOW, ORIG)));
        assertTrue(gate.isValidManifest(mh(F2, ALLOW, ORIG)));
        assertFalse(gate.isValidManifest(mh(F3, ALLOW, ORIG)));
        assertFalse(gate.isValidManifest(bytes32(0)));
    }

    function test_noReleaseYet_nothingValid() public view {
        assertFalse(gate.isValidManifest(mh(F1, ALLOW, ORIG)));
        assertEq(gate.currentManifestHash(), bytes32(0));
        (,,, bool ok) = gate.activeRelease();
        assertFalse(ok);
    }

    // ================================================================ roles (threats 7, 8)

    function test_threat7_proposerCanOnlyPropose() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG, false);
        vm.startPrank(P);
        vm.expectRevert(ReleaseGate.NotApprover.selector);
        gate.approve(id);
        vm.expectRevert(ReleaseGate.NotApprover.selector);
        gate.cancel(id);
        vm.expectRevert(ReleaseGate.NotApprover.selector);
        gate.revoke(1);
        vm.expectRevert(ReleaseGate.NotApprover.selector);
        gate.enforce();
        vm.stopPrank();
        vm.warp(block.timestamp + 6 days);
        assertFalse(tryPublish(id)); // no human approval, no release
    }

    function test_threat8_oneStolenApproverKey_cannotPassTiers01_10_11() public {
        baseline(F1);
        uint64 a = propose(F2, ALLOW, ORIG2, true);
        uint64 b = propose(F3, ALLOW2, ORIG, true);
        uint64 c = proposeAdmin(ReleaseGate.Action.SetGuardian, abi.encode(X));
        approveMask(a, 1);
        approveMask(b, 1);
        approveMask(c, 1);
        vm.warp(block.timestamp + 5 days);
        assertFalse(tryPublish(a));
        assertFalse(tryPublish(b));
        assertFalse(tryPublish(c));
    }

    function test_strangerCannotProposeOrApprove() public {
        vm.prank(X);
        vm.expectRevert(ReleaseGate.NotProposer.selector);
        gate.proposeRelease(F1, ALLOW, ORIG, false);
        uint64 id = propose(F1, ALLOW, ORIG, false);
        vm.prank(X);
        vm.expectRevert(ReleaseGate.NotApprover.selector);
        gate.approve(id);
    }

    function test_approverMayProposeRelease_butApprovalIsSeparate() public {
        vm.prank(A0);
        uint64 id = gate.proposeRelease(F1, ALLOW, ORIG, false);
        assertEq(gate.getProposal(id).approvals, 0);
    }

    // ================================================================ proposal hygiene

    function test_staleBase_cannotSmuggleNewContractsAsCodeOnly() public {
        baseline(F1);
        uint64 old = propose(F2, ALLOW, ORIG, false);
        uint64 upd = propose(F3, ALLOW2, ORIG, true);
        approveMask(upd, 7);
        gate.publish(upd);
        approveMask(old, 1);
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(ReleaseGate.StaleBase.selector);
        gate.publish(old);
    }

    function test_publishTwice_reverts() public {
        uint64 id = baseline(F1);
        vm.expectRevert(ReleaseGate.NotLive.selector);
        gate.publish(id);
    }

    function test_unknownProposal_reverts() public {
        vm.expectRevert(ReleaseGate.NotLive.selector);
        gate.publish(99);
    }

    function test_approverChange_invalidatesOpenApprovals() public {
        baseline(F1);
        uint64 id = propose(F2, ALLOW, ORIG2, false);
        approveMask(id, 3);
        vm.prank(R);
        gate.proposeRecovery([A0, makeAddr("n1"), makeAddr("n2")]);
        vm.warp(block.timestamp + 7 days);
        gate.executeRecovery();
        vm.expectRevert(ReleaseGate.NotLive.selector);
        gate.publish(id);
    }

    // ================================================================ setup and beacon

    function test_initialize_onlyOnce_andImplementationIsLocked() public {
        ReleaseGate.Init memory c;
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        gate.initialize(c);
        ReleaseGate impl = ReleaseGate(factory.implementation());
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        impl.initialize(c);
    }

    function test_creation_rejectsChangedBeacon() public {
        beacon.set(makeAddr("other"));
        _expectBadCreate([A0, A1, A2], P, R, G);
    }

    // ================================================================ recovery (edge: approver lost a key)

    function test_lostKey_twoApproversCannotPassTier11_recoveryCan() public {
        address newA2 = makeAddr("newApprover2");
        uint64 id = proposeAdmin(ReleaseGate.Action.SetApprover, abi.encode(uint8(2), newA2));
        approveMask(id, 3);
        vm.warp(block.timestamp + 5 days);
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

    // ================================================================ timelocks, L-3

    function test_L3_minimumAndMaximumTimelocks() public {
        _expectBadAdmin(ReleaseGate.Action.SetTimelocks, abi.encode(uint32(10 minutes - 1), uint32(6 hours), uint32(0)));
        _expectBadAdmin(ReleaseGate.Action.SetTimelocks, abi.encode(uint32(10 minutes), uint32(6 hours - 1), uint32(0)));
        _expectBadAdmin(ReleaseGate.Action.SetTimelocks, abi.encode(uint32(0), uint32(0), uint32(0)));
        _expectBadAdmin(ReleaseGate.Action.SetTimelocks, abi.encode(uint32(2 days), uint32(1 days), uint32(0)));
        _expectBadAdmin(ReleaseGate.Action.SetTimelocks, abi.encode(uint32(1 hours), uint32(5 days + 1), uint32(0)));
        _expectBadAdmin(ReleaseGate.Action.SetTimelocks, abi.encode(uint32(1 hours), uint32(1 days), uint32(7 days + 1)));
        admin(ReleaseGate.Action.SetTimelocks, abi.encode(uint32(10 minutes), uint32(6 hours), uint32(1 hours)));
        assertEq(gate.shortDelay(), 10 minutes);
        assertEq(gate.longDelay(), 6 hours);
        assertEq(gate.graceWindow(), 1 hours);
    }

    function test_L3_defaults() public view {
        assertEq(gate.shortDelay(), 1 hours);
        assertEq(gate.longDelay(), 24 hours);
        assertEq(gate.graceWindow(), 6 hours);
    }

    // ================================================================ domains (threat 11, edge cases)

    function test_domain_boundAtCreation_sharedContainer() public view {
        (address g, address c, string memory prefix) = reg.bindingOf(DOMAIN);
        assertEq(g, address(gate));
        assertEq(c, sharedContainer);
        assertEq(prefix, "projects/app.example.org/");
    }

    function test_threat11_rebindDomainNeedsTier11_andTheNewGateMustAccept() public {
        ReleaseGate mine = gate;
        ReleaseGate other = newGate("other.example.org");
        uint64 id = proposeAdmin(ReleaseGate.Action.TransferDomain, abi.encode(DOMAIN, address(other)));
        approveMask(id, 3);
        vm.warp(block.timestamp + 5 days);
        assertFalse(tryPublish(id)); // 2 of 3 is not enough
        approveMask(id, 4);
        vm.warp(block.timestamp + 24 hours);
        assertTrue(tryPublish(id));
        (address g,,) = reg.bindingOf(DOMAIN);
        assertEq(g, address(mine)); // L-4: nothing moves until the receiving gate accepts
        assertEq(reg.pendingGateOf(DOMAIN), address(other));
        gate = other;
        admin(ReleaseGate.Action.AcceptDomain, abi.encode(DOMAIN));
        (g,,) = reg.bindingOf(DOMAIN);
        assertEq(g, address(other));
        assertEq(reg.pendingGateOf(DOMAIN), address(0));
    }

    function test_edge_manyDomains_oneGate_andOwnContainer() public {
        bindDomain("docs.example.org", address(0), 0);
        bindDomain("beta.example.org", address(cpu), 77);
        (address g1, address c1,) = reg.bindingOf("docs.example.org");
        (address g2, address c2, string memory p2) = reg.bindingOf("beta.example.org");
        assertEq(g1, address(gate));
        assertEq(c1, sharedContainer);
        assertEq(g2, address(gate));
        assertEq(c2, opener.accountOf(address(cpu), 77));
        assertEq(p2, "");
        // an existing binding moves to an own container (Pro/Enterprise upgrade)
        admin(ReleaseGate.Action.SetContainer, abi.encode(DOMAIN, address(cpu), uint256(77)));
        (, address c3,) = reg.bindingOf(DOMAIN);
        assertEq(c3, opener.accountOf(address(cpu), 77));
    }

    function test_info_bindDomain_showsTheRealError() public {
        // an already-bound domain: the registry's own error comes through, nothing is silently retried
        bytes32 salt = keccak256("s");
        bytes32 c = factory.commitmentOf(DOMAIN, salt, address(gate)); // before vm.prank (it is a call)
        vm.prank(A0);
        gate.commitDomain(c);
        vm.roll(block.number + 2);
        uint64 id = proposeAdmin(ReleaseGate.Action.BindDomain, abi.encode(DOMAIN, salt, address(0), uint256(0)));
        approveMask(id, 7);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(SignetRegistry.AlreadyBound.selector);
        gate.publish(id);
        // no commit: the factory's error comes through
        id = proposeAdmin(ReleaseGate.Action.BindDomain, abi.encode("new.example.org", salt, address(0), uint256(0)));
        approveMask(id, 7);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(SignetFactory.NoCommit.selector);
        gate.publish(id);
    }

    function test_commitDomain_onlyApprovers() public {
        vm.prank(P);
        vm.expectRevert(ReleaseGate.NotApprover.selector);
        gate.commitDomain(bytes32(uint256(1)));
    }

    function test_edge_giveUpDomain_unbindIsTier11() public {
        admin(ReleaseGate.Action.UnbindDomain, abi.encode(DOMAIN));
        (address g, address c,) = reg.bindingOf(DOMAIN);
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
        vm.prank(A0);
        gate.enforce();
        assertTrue(gate.enforced());
        admin(ReleaseGate.Action.SetObserveMode, "");
        assertFalse(gate.enforced());
    }

    // ================================================================ L-4: a gate holds its own container NFT

    function test_L4_gateAcceptsOnlyTapeOutCircuitNFTs() public {
        cpu.setOwner(77, X);
        vm.prank(X);
        cpu.safeTransferFrom(X, address(gate), 77);
        assertEq(cpu.ownerOf(77), address(gate));
        vm.prank(X); // some other contract's NFT callback
        vm.expectRevert(ReleaseGate.NotTapeOutCircuit.selector);
        gate.onERC721Received(X, X, 1, "");
    }

    function test_L4_renewOperator_anyoneMayCall_onlyForHeldCircuits() public {
        cpu.setOwner(77, X);
        address container = opener.accountOf(address(cpu), 77);
        sites.registerContainer(container, cpu, 77);
        vm.expectRevert(ReleaseGate.NotHolder.selector);
        gate.renewOperator(address(cpu), 77);
        vm.prank(X);
        cpu.safeTransferFrom(X, address(gate), 77);
        vm.prank(X);
        gate.renewOperator(address(cpu), 77);
        assertEq(sites.operatorOf(container), address(reg));
        assertEq(sites.operatorUntil(container), block.timestamp + 30 days);
    }

    function test_L4_transferCircuitOut_isTier11() public {
        cpu.setOwner(77, X);
        vm.prank(X);
        cpu.safeTransferFrom(X, address(gate), 77);
        admin(ReleaseGate.Action.TransferCircuit, abi.encode(address(cpu), uint256(77), X));
        assertEq(cpu.ownerOf(77), X);
    }

    // ================================================================ second review

    // M-1: the tier is compared with the most recent NON-revoked release
    function test_R2M1_tierIsComparedWithLastNonRevokedRelease() public {
        baseline(F1); // allowlist v1
        uint64 r2 = propose(F2, ALLOW2, ORIG, true); // allowlist v2, fast lane
        approveMask(r2, 7);
        gate.publish(r2);
        assertEq(gate.getProposal(propose(F3, ALLOW2, ORIG, false)).tier, 0); // vs r2: code only
        vm.prank(A0);
        gate.revoke(r2); // v2 turned out to be bad
        // the same hashes are now a NEW contract list compared with the last good release (r1)
        assertEq(gate.getProposal(propose(F3, ALLOW2, ORIG, false)).tier, 2);
        assertEq(gate.getProposal(propose(F3, ALLOW, ORIG, false)).tier, 0);
    }

    function test_R2M1_proposalMadeBeforeARevoke_isStale() public {
        baseline(F1);
        uint64 r2 = propose(F2, ALLOW2, ORIG, true);
        approveMask(r2, 7);
        gate.publish(r2);
        uint64 pending = propose(F3, ALLOW2, ORIG, false); // tier 00 against r2
        approveMask(pending, 1);
        vm.prank(A2);
        gate.revoke(r2);
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(ReleaseGate.StaleBase.selector); // its tier was computed against a now-revoked release
        gate.publish(pending);
    }

    function test_R2M1_revokedManifestCannotBeProposedAgain_onlyUnrevoked() public {
        baseline(F1);
        uint64 r2 = propose(F2, ALLOW2, ORIG, true);
        approveMask(r2, 7);
        gate.publish(r2);
        vm.prank(A0);
        gate.revoke(r2);
        vm.prank(P);
        vm.expectRevert(ReleaseGate.RevokedManifest.selector);
        gate.proposeRelease(F2, ALLOW2, ORIG, false);
        vm.prank(A1); // an approver can't re-propose it either
        vm.expectRevert(ReleaseGate.RevokedManifest.selector);
        gate.proposeRelease(F2, ALLOW2, ORIG, true);
        vm.prank(A1);
        gate.voteUnrevoke(r2);
        vm.prank(A2);
        gate.voteUnrevoke(r2);
        assertTrue(gate.isValidManifest(mh(F2, ALLOW2, ORIG)));
        propose(F2, ALLOW2, ORIG, false); // allowed again
    }

    function test_R2M1_everyReleaseRevoked_nextOneIsTier10() public {
        uint64 r1 = baseline(F1);
        vm.prank(A0);
        gate.revoke(r1);
        assertEq(gate.getProposal(propose(F2, ALLOW, ORIG, false)).tier, 2); // nothing good to compare with
    }

    // M-4: the approver who proposed a release can't count their own approval
    function test_R2M4_proposingApproverCannotApproveOwnRelease() public {
        baseline(F1);
        vm.prank(A0);
        uint64 id = gate.proposeRelease(F2, ALLOW, ORIG, false); // tier 00 would need just one approval
        vm.prank(A0);
        vm.expectRevert(ReleaseGate.OwnProposal.selector);
        gate.approve(id);
        vm.warp(block.timestamp + 6 days);
        assertFalse(tryPublish(id)); // one stolen approver key can't propose and approve alone
        approveMask(id, 2); // another approver
        vm.warp(block.timestamp + 1 hours);
        assertTrue(tryPublish(id));
    }

    function test_R2M4_ownProposal_cannotUseTheFastLane_adminIsUnaffected() public {
        baseline(F1);
        vm.prank(A0);
        uint64 id = gate.proposeRelease(F2, ALLOW, ORIG, true);
        approveMask(id, 6); // only 2 of 3 can ever approve it
        assertFalse(tryPublish(id));
        vm.warp(block.timestamp + 1 hours);
        assertTrue(tryPublish(id)); // the normal path still works
        // admin proposals need 3 of 3, so the proposing approver's approval counts
        admin(ReleaseGate.Action.SetObserveMode, "");
    }

    // L-1: revoke cooldown
    function test_R2L1_revokeCooldown_onePer24hPerApprover() public {
        uint64 r1 = baseline(F1);
        uint64 r2 = propose(F2, ALLOW, ORIG, true);
        approveMask(r2, 7);
        gate.publish(r2);
        vm.prank(A0);
        gate.revoke(r1);
        vm.prank(A0);
        vm.expectRevert(ReleaseGate.RevokeCooldown.selector);
        gate.revoke(r2);
        vm.warp(block.timestamp + 24 hours - 1);
        vm.prank(A0);
        vm.expectRevert(ReleaseGate.RevokeCooldown.selector);
        gate.revoke(r2);
        vm.prank(A1);
        gate.revoke(r2); // another approver is not blocked
        vm.warp(block.timestamp + 1);
        vm.prank(A0);
        gate.revoke(r2);
    }

    // L-2: guardian-removal votes expire after 7 days
    function test_R2L2_guardianRemovalVotesExpireAfter7Days() public {
        vm.prank(A0);
        gate.voteRemoveGuardian();
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(A1);
        gate.voteRemoveGuardian();
        assertEq(gate.guardian(), G); // A0's vote is too old
        vm.warp(block.timestamp + 7 days);
        vm.prank(A2);
        gate.voteRemoveGuardian(); // exactly 7 days after A1: still counts
        assertEq(gate.guardian(), address(0));
    }

    // L-7: zero hashes are rejected
    function test_R2L7_zeroAllowlistOrOriginsHash_rejected() public {
        vm.startPrank(P);
        vm.expectRevert(ReleaseGate.BadProposal.selector);
        gate.proposeRelease(F1, bytes32(0), ORIG, false);
        vm.expectRevert(ReleaseGate.BadProposal.selector);
        gate.proposeRelease(F1, ALLOW, bytes32(0), false);
        gate.proposeRelease(F1, sha256("[]"), sha256("[]"), false); // an explicit empty list is fine
        vm.stopPrank();
    }

    // ================================================================ helpers

    /// Like admin(), for after approver slot 1 was replaced by `slot1`.
    function admin2(address slot1, ReleaseGate.Action a, bytes memory args) internal {
        uint64 id = proposeAdmin(a, args);
        vm.prank(A0);
        gate.approve(id);
        vm.prank(slot1);
        gate.approve(id);
        vm.prank(A2);
        gate.approve(id);
        vm.warp(block.timestamp + gate.longDelay());
        gate.publish(id);
    }

    function _expectBadCreate(address[3] memory a, address prop, address rec, address guard) internal {
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        newGateWith(a, prop, rec, guard, "", address(0), 0);
    }

    function _expectBadAdmin(ReleaseGate.Action a, bytes memory args) internal {
        uint256 snap = vm.snapshotState();
        uint64 id = proposeAdmin(a, args);
        approveMask(id, 7);
        vm.warp(block.timestamp + gate.longDelay());
        vm.expectRevert(ReleaseGate.BadConfig.selector);
        gate.publish(id);
        vm.revertToState(snap);
    }

    function _unfreezeWith(uint8 mask) internal {
        address[3] memory a = approvers();
        for (uint256 i; i < 3; i++) {
            if (mask & (1 << i) != 0) {
                vm.prank(a[i]);
                gate.approveUnfreeze();
            }
        }
        gate.unfreeze();
    }
}
