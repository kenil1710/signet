// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    IPolicyProcessor,
    ICircuitBeacon,
    ICircuitNFT,
    IContainerOpener,
    ISiteRegistryWriter
} from "./interfaces/ITapeOutPolicy.sol";
import {PolicyMirror} from "./PolicyMirror.sol";

/// SignetRegistry functions a gate calls (from executed tier-11 proposals, file removal votes, renewOperator).
interface ISignetRegistryForGate {
    function setContainer(string calldata domain, address circuits, uint256 tokenId) external;
    function transfer(string calldata domain, address newGate) external;
    function acceptTransfer(string calldata domain) external;
    function unbind(string calldata domain) external;
    function removeFile(string calldata domain, string calldata path) external;
    function setFallback(string calldata domain, string calldata path) external;
    function factory() external view returns (address);
    function siteRegistry() external view returns (address);
    function opener() external view returns (address);
}

/// SignetFactory functions a gate calls: commit-reveal for a further domain.
interface ISignetFactoryForGate {
    function commit(bytes32 commitment) external;
    function claim(string calldata domain, bytes32 salt, address circuits, uint256 tokenId) external;
}

/// One project's release gate (docs/signet-spec.md, "Release-lock circuit and approval tiers").
/// Deployed as a minimal clone by SignetFactory and set up once through initialize().
///
/// CI (the proposer key) can only propose. A proposal goes live only when the immutable TapeOut policy circuit
/// returns PUBLISH = 1 for the facts this contract supplies:
///   a0 a1 a2  approver 1/2/3 approved          (on-chain approvals)
///   tS tL     short / long timelock passed     (time since the tier's approval count was first reached)
///   r1 r0     risk tier, computed HERE         (allowlistHash / originsHash vs the current release; admin = 11)
///   f         project frozen
///   e         emergency fast lane requested
/// If the circuit beacon's implementation ever differs from the pinned one, or the circuit call fails, the
/// Solidity mirror of the same policy decides instead and PolicyFallbackActive is emitted.
contract ReleaseGate {
    // ---------------------------------------------------------------- types

    enum Kind {
        None,
        Release,
        Admin
    }

    /// Tier-11 admin actions.
    enum Action {
        None,
        SetApprover, //      (uint8 slot, address approver)
        SetProposer, //      (address)
        SetRecovery, //      (address)
        SetGuardian, //      (address, 0 = none)
        SetTimelocks, //     (uint32 short, uint32 long, uint32 grace)
        SetPolicyCircuit, // (address processor, uint256 circuitId): another copy of the SAME netlist
        BindDomain, //       (string domain, bytes32 salt, address circuits, uint256 tokenId)  a NEW domain (commit first)
        SetContainer, //     (string domain, address circuits, uint256 tokenId)  circuits 0 = shared container
        TransferDomain, //   (string domain, address newGate)  the new gate must accept
        AcceptDomain, //     (string domain)
        UnbindDomain, //     (string domain)
        SetObserveMode, //   ()
        RemoveFile, //       (string domain, string path)
        SetFallback, //      (string domain, string path)  own containers only
        TransferCircuit //   (address circuits, uint256 tokenId, address to)  a circuit NFT this gate holds
    }

    struct Proposal {
        Kind kind;
        uint8 tier; // r1 r0 as a 2-bit number
        bool emergency;
        bool executed;
        bool cancelled;
        uint8 approvals; // bit i = approver slot i
        uint8 proposerSlot; // approver slot of the proposer (their own approval doesn't count), 255 = the CI key
        uint40 proposedAt;
        uint40 readyAt; // when the tier's approval count was first reached (0 = not reached); timelocks run from here
        uint64 baseRelease; // current release id when proposed (releases only)
        uint64 baseline; // most recent non-revoked release the tier was computed against
        uint64 approverSet; // approver-set version when proposed
        bytes32 filesRoot;
        bytes32 allowlistHash;
        bytes32 originsHash;
        bytes adminData; // abi.encode(Action, bytes args)
    }

    struct Release {
        bytes32 manifestHash; // sha256(abi.encode(filesRoot, allowlistHash, originsHash)), computed on-chain
        bytes32 filesRoot;
        bytes32 allowlistHash;
        bytes32 originsHash;
        uint40 publishedAt;
        uint64 prev; // the release this one replaced
    }

    /// Revocation is per manifest hash, so a revoked manifest can't come back under a new release id.
    struct Revocation {
        bool revoked;
        uint8 unrevokeVotes;
        uint64 unrevokeSet;
    }

    struct Init {
        address[3] approvers;
        address proposer;
        address recovery;
        address guardian; // optional watchtower key that may only freeze (0 = none)
        IPolicyProcessor policyProcessor;
        uint256 policyCircuitId;
        bytes32 policyNetlistSha256;
        bytes32 processorCodehash; // code hash of a TapeOut processor proxy (embeds the beacon address)
        ICircuitBeacon beacon;
        address expectedImplementation;
        ISignetRegistryForGate registry;
    }

    struct PendingRecovery {
        address[3] approvers;
        uint40 proposedAt;
        uint8 cancelVotes;
        uint64 approverSet;
        bool active;
    }

    // ---------------------------------------------------------------- constants

    uint8 internal constant TIER_ADMIN = 3;
    uint32 public constant RECOVERY_DELAY = 7 days;
    uint32 public constant OBSERVE_PERIOD = 7 days;
    uint32 public constant PROPOSAL_TTL = 7 days;
    uint32 public constant FREEZE_COOLDOWN = 24 hours;
    uint32 public constant REVOKE_COOLDOWN = 24 hours;
    uint32 public constant GUARDIAN_VOTE_TTL = 7 days;
    uint32 public constant MIN_SHORT = 10 minutes;
    uint32 public constant MIN_LONG = 6 hours;
    uint32 public constant MAX_LONG = 5 days; // must stay below PROPOSAL_TTL
    uint32 public constant OPERATOR_TTL = 30 days;

    // ---------------------------------------------------------------- state

    bool public initialized;
    ICircuitBeacon public beacon;
    address public pinnedImplementation;
    bytes32 public processorCodehash;
    bytes32 public policyNetlistSha256;
    ISignetRegistryForGate public registry;
    uint40 public deployedAt;

    IPolicyProcessor public policyProcessor;
    uint256 public policyCircuitId;

    address[3] public approvers;
    address public proposer;
    address public recovery;
    address public guardian;
    uint64 public approverSet; // bumped on every approver change; older approvals stop counting

    uint32 public shortDelay;
    uint32 public longDelay;
    uint32 public graceWindow;

    bool public frozen;
    bool public enforced; // false = observe mode (Guard reports, never blocks)
    uint8 public unfreezeApprovals;
    uint40[3] public guardianVoteAt; // when each approver slot voted to remove the guardian (0 = no vote)
    mapping(address => uint40) public lastFreezeAt;
    mapping(address => uint40) public lastRevokeAt;
    mapping(bytes32 => Revocation) public revocations; // by manifest hash
    mapping(bytes32 => uint8) internal removeVotes; // keccak256(domain, path, approverSet) => approver bits

    uint64 public proposalCount;
    uint64 public currentRelease; // proposal id, 0 = none yet
    mapping(uint64 => Proposal) internal proposals;
    mapping(uint64 => Release) public releases;
    PendingRecovery internal pendingRecovery;

    // ---------------------------------------------------------------- events

    event Proposed(uint64 indexed id, Kind kind, uint8 tier, bool emergency, address indexed by, bytes32 manifestHash);
    event Approved(uint64 indexed id, uint8 slot, address indexed approver);
    event ApprovalWithdrawn(uint64 indexed id, uint8 slot);
    event Cancelled(uint64 indexed id, address indexed by);
    event Published(uint64 indexed id, bytes32 manifestHash, uint8 tier);
    event AdminExecuted(uint64 indexed id, Action action);
    /// reason 1 = the beacon's implementation changed, 2 = the circuit call failed or answered badly
    event PolicyFallbackActive(address beaconImplementation, uint8 reason);
    event FileRemovalVote(string domain, string path, uint8 slot);
    event Frozen(address indexed by);
    event UnfreezeApproved(uint8 slot);
    event Unfrozen();
    event Enforced(address indexed by);
    event GuardianRemoved();
    event Revoked(uint64 indexed releaseId, bytes32 manifestHash, address indexed by);
    event Unrevoked(uint64 indexed releaseId, bytes32 manifestHash);
    event RecoveryProposed(address[3] approvers);
    event RecoveryCancelled();
    event RecoveryExecuted(address[3] approvers);

    // ---------------------------------------------------------------- errors

    error NotProposer();
    error NotApprover();
    error NotRecovery();
    error NotFreezer();
    error BadConfig();
    error BadProposal();
    error NotLive();
    error Expired();
    error AlreadyApproved();
    error StaleBase();
    error PolicyDenied();
    error OwnProposal();
    error RevokedManifest();
    error RevokeCooldown();
    error FastLaneNotAllowed();
    error NotFrozen();
    error AlreadyFrozen();
    error FreezeCooldown();
    error TooEarly();
    error NoRecovery();
    error NotHolder();
    error NotTapeOutCircuit();

    // ---------------------------------------------------------------- setup

    constructor() {
        initialized = true; // the implementation itself can never be set up
    }

    function initialize(Init calldata c) external {
        if (initialized) revert BadConfig();
        initialized = true;
        if (c.expectedImplementation == address(0) || c.beacon.implementation() != c.expectedImplementation) {
            revert BadConfig();
        }
        beacon = c.beacon;
        pinnedImplementation = c.expectedImplementation;
        processorCodehash = c.processorCodehash;
        policyNetlistSha256 = c.policyNetlistSha256;
        registry = c.registry;
        deployedAt = uint40(block.timestamp);
        shortDelay = 1 hours;
        longDelay = 24 hours;
        graceWindow = 6 hours;
        _setPolicy(c.policyProcessor, c.policyCircuitId);
        _checkRoles(c.approvers, c.proposer, c.recovery, c.guardian);
        approvers = c.approvers;
        proposer = c.proposer;
        recovery = c.recovery;
        guardian = c.guardian;
    }

    // ---------------------------------------------------------------- proposals

    /// Propose a release. Only the proposer (CI) or an approver. The tier and the manifest hash are computed here
    /// from the three hashes, so CI can't claim a lower tier than the allowlist/origins it actually ships.
    /// An empty allowlist or origins list is the hash of an explicit empty list, never zero.
    function proposeRelease(bytes32 filesRoot, bytes32 allowlistHash, bytes32 originsHash, bool emergency)
        external
        returns (uint64 id)
    {
        uint8 slot = _slotOf(msg.sender);
        if (msg.sender != proposer && slot > 2) revert NotProposer();
        if (filesRoot == bytes32(0) || allowlistHash == bytes32(0) || originsHash == bytes32(0)) revert BadProposal();
        bytes32 mHash = manifestHashOf(filesRoot, allowlistHash, originsHash);
        if (revocations[mHash].revoked) revert RevokedManifest(); // only a 2-of-3 un-revoke brings it back

        uint64 base = _baseline();
        uint8 tier = _tier(base, allowlistHash, originsHash, emergency);
        id = ++proposalCount;
        Proposal storage p = proposals[id];
        p.kind = Kind.Release;
        p.tier = tier;
        p.emergency = emergency;
        p.proposerSlot = slot;
        p.proposedAt = uint40(block.timestamp);
        p.baseRelease = currentRelease;
        p.baseline = base;
        p.approverSet = approverSet;
        p.filesRoot = filesRoot;
        p.allowlistHash = allowlistHash;
        p.originsHash = originsHash;
        emit Proposed(id, Kind.Release, tier, emergency, msg.sender, mHash);
    }

    /// The most recent release whose manifest is not revoked (0 = none).
    function _baseline() internal view returns (uint64 id) {
        id = currentRelease;
        while (id != 0 && revocations[releases[id].manifestHash].revoked) id = releases[id].prev;
    }

    /// Risk tier from the hashes, compared with the most recent non-revoked release. Never taken from the caller.
    function _tier(uint64 base, bytes32 allowlistHash, bytes32 originsHash, bool emergency) internal view returns (uint8) {
        Release storage cur = releases[base];
        bool allowChanged = allowlistHash != cur.allowlistHash;
        bool originsChanged = originsHash != cur.originsHash;
        // Tier 10's fast lane must not carry a new origin past tier 01's "no fast lane" rule.
        // (With no release to compare with, it stays eligible; the circuit still wants 3 of 3.)
        if (emergency && allowChanged && originsChanged && base != 0) revert FastLaneNotAllowed();
        return allowChanged ? 2 : originsChanged ? 1 : 0;
    }

    /// Propose a tier-11 admin change. Approvers only (the proposer key can't). No fast lane.
    function proposeAdmin(Action action, bytes calldata args) external returns (uint64 id) {
        _approver();
        if (action == Action.None) revert BadProposal();
        id = ++proposalCount;
        Proposal storage p = proposals[id];
        p.kind = Kind.Admin;
        p.tier = TIER_ADMIN;
        p.proposerSlot = type(uint8).max; // admin needs 3 of 3, so the proposing approver's approval counts
        p.proposedAt = uint40(block.timestamp);
        p.approverSet = approverSet;
        p.adminData = abi.encode(action, args);
        emit Proposed(id, Kind.Admin, TIER_ADMIN, false, msg.sender, bytes32(0));
    }

    function approve(uint64 id) external {
        uint8 slot = _approver();
        Proposal storage p = _live(id);
        if (slot == p.proposerSlot) revert OwnProposal(); // the approver who proposed a release can't approve it
        uint8 bit = uint8(1 << slot);
        if (p.approvals & bit != 0) revert AlreadyApproved();
        p.approvals |= bit;
        // The timelock starts when the tier's approval count is first reached; extra approvals don't restart it.
        if (p.readyAt == 0 && _count(p.approvals) >= _need(p.tier)) p.readyAt = uint40(block.timestamp);
        emit Approved(id, slot, msg.sender);
    }

    function withdrawApproval(uint64 id) external {
        uint8 slot = _approver();
        Proposal storage p = _live(id);
        p.approvals &= ~uint8(1 << slot);
        if (_count(p.approvals) < _need(p.tier)) p.readyAt = 0; // below the count: the timelock starts over
        emit ApprovalWithdrawn(id, slot);
    }

    /// Approvals the tier's normal path needs: 00 -> 1, 01 and 10 -> 2, 11 -> 3.
    function _need(uint8 tier) internal pure returns (uint8) {
        return tier == 0 ? 1 : tier == TIER_ADMIN ? 3 : 2;
    }

    /// Any approver can cancel any proposal that hasn't been executed.
    function cancel(uint64 id) external {
        _approver();
        Proposal storage p = proposals[id];
        if (p.kind == Kind.None || p.executed || p.cancelled) revert NotLive();
        p.cancelled = true;
        emit Cancelled(id, msg.sender);
    }

    /// Anyone may call. Publishes (or executes an admin change) only if the policy says PUBLISH.
    function publish(uint64 id) public {
        Proposal storage p = _live(id);
        bytes32 mHash;
        if (p.kind == Kind.Release) {
            // the tier was computed against these; if either moved (a publish, a revoke, an un-revoke), re-propose
            if (p.baseRelease != currentRelease || p.baseline != _baseline()) revert StaleBase();
            mHash = manifestHashOf(p.filesRoot, p.allowlistHash, p.originsHash);
            if (revocations[mHash].revoked) revert RevokedManifest();
        }
        (bool ok,) = _policy(policyInputs(id));
        if (!ok) revert PolicyDenied();

        p.executed = true;
        if (p.kind == Kind.Release) {
            Release storage r = releases[id];
            r.manifestHash = mHash;
            r.filesRoot = p.filesRoot;
            r.allowlistHash = p.allowlistHash;
            r.originsHash = p.originsHash;
            r.publishedAt = uint40(block.timestamp);
            r.prev = currentRelease;
            currentRelease = id;
            emit Published(id, mHash, p.tier);
        } else {
            _execute(id, p.adminData);
        }
    }

    /// The 9 input bits this contract gives the policy for proposal `id` right now
    /// (bit order a0 a1 a2 tS tL r1 r0 f e = bits 0..8, docs/policy-truth-table.md).
    function policyInputs(uint64 id) public view returns (uint16 bits) {
        Proposal storage p = proposals[id];
        bits = uint16(p.approvals & 7);
        if (p.readyAt != 0) {
            uint256 age = block.timestamp - p.readyAt;
            if (age >= shortDelay) bits |= 8;
            if (age >= longDelay) bits |= 16;
        }
        if (p.tier & 2 != 0) bits |= 32; // r1
        if (p.tier & 1 != 0) bits |= 64; // r0
        if (frozen) bits |= 128;
        if (p.emergency) bits |= 256;
    }

    function manifestHashOf(bytes32 filesRoot, bytes32 allowlistHash, bytes32 originsHash) public pure returns (bytes32) {
        return sha256(abi.encode(filesRoot, allowlistHash, originsHash));
    }

    // ---------------------------------------------------------------- freeze

    /// Any one approver (or the opt-in guardian) can freeze, with no circuit and no delay.
    /// Each key can freeze once per 24 h.
    function freeze() external {
        if (_slotOf(msg.sender) > 2 && (msg.sender != guardian || msg.sender == address(0))) revert NotFreezer();
        if (frozen) revert AlreadyFrozen();
        uint40 last = lastFreezeAt[msg.sender];
        if (last != 0 && block.timestamp < uint256(last) + FREEZE_COOLDOWN) revert FreezeCooldown();
        lastFreezeAt[msg.sender] = uint40(block.timestamp);
        frozen = true;
        unfreezeApprovals = 0;
        emit Frozen(msg.sender);
    }

    function approveUnfreeze() external {
        uint8 slot = _approver();
        if (!frozen) revert NotFrozen();
        unfreezeApprovals |= uint8(1 << slot);
        emit UnfreezeApproved(slot);
    }

    /// Anyone may call; the policy's UNFREEZE output decides (>= 2 approvals for this freeze).
    function unfreeze() public {
        if (!frozen) revert NotFrozen();
        (, bool ok) = _policy(uint16(unfreezeApprovals & 7) | 128);
        if (!ok) revert PolicyDenied();
        frozen = false;
        unfreezeApprovals = 0;
        emit Unfrozen();
    }

    /// Unfreeze and publish an already-approved proposal in one transaction, so a freeze-spammer
    /// can't slip a new freeze in between.
    function unfreezeAndPublish(uint64 id) external {
        unfreeze();
        publish(id);
    }

    /// Two approvers can remove the guardian at any time, also while frozen. A vote counts for 7 days.
    function voteRemoveGuardian() external {
        uint8 slot = _approver();
        if (guardian == address(0)) revert BadConfig();
        guardianVoteAt[slot] = uint40(block.timestamp);
        uint256 live;
        for (uint256 i; i < 3; i++) {
            uint40 at = guardianVoteAt[i];
            if (at != 0 && block.timestamp <= uint256(at) + GUARDIAN_VOTE_TTL) live++;
        }
        if (live >= 2) {
            guardian = address(0);
            delete guardianVoteAt;
            emit GuardianRemoved();
        }
    }

    // ---------------------------------------------------------------- revoke

    /// Any one approver can revoke a published release immediately (once per 24 h per approver).
    /// Un-revoking needs 2 of 3.
    function revoke(uint64 releaseId) external {
        _approver();
        Release storage r = releases[releaseId];
        if (r.publishedAt == 0) revert BadProposal();
        uint40 last = lastRevokeAt[msg.sender];
        if (last != 0 && block.timestamp < uint256(last) + REVOKE_COOLDOWN) revert RevokeCooldown();
        lastRevokeAt[msg.sender] = uint40(block.timestamp);
        Revocation storage v = revocations[r.manifestHash];
        v.revoked = true;
        v.unrevokeVotes = 0;
        emit Revoked(releaseId, r.manifestHash, msg.sender);
    }

    function voteUnrevoke(uint64 releaseId) external {
        uint8 slot = _approver();
        bytes32 mHash = releases[releaseId].manifestHash;
        Revocation storage v = revocations[mHash];
        if (!v.revoked) revert BadProposal();
        if (v.unrevokeSet != approverSet) {
            v.unrevokeSet = approverSet;
            v.unrevokeVotes = 0;
        }
        v.unrevokeVotes |= uint8(1 << slot);
        if (_count(v.unrevokeVotes) >= 2) {
            v.revoked = false;
            v.unrevokeVotes = 0;
            emit Unrevoked(releaseId, mHash);
        }
    }

    /// While the current release is revoked, two approvers can remove any file of a domain right away
    /// (otherwise removing a file is a tier-11 change).
    function voteRemoveFile(string calldata domain, string calldata path) external {
        uint8 slot = _approver();
        if (currentRelease == 0 || !revocations[releases[currentRelease].manifestHash].revoked) revert BadProposal();
        bytes32 key = keccak256(abi.encode(domain, path, approverSet));
        uint8 votes = removeVotes[key] | uint8(1 << slot);
        emit FileRemovalVote(domain, path, slot);
        if (_count(votes) >= 2) {
            delete removeVotes[key];
            registry.removeFile(domain, path);
        } else {
            removeVotes[key] = votes;
        }
    }

    /// Any approver can commit to a further domain (commit-reveal in SignetFactory) before a tier-11 BindDomain.
    function commitDomain(bytes32 commitment) external {
        _approver();
        ISignetFactoryForGate(registry.factory()).commit(commitment);
    }

    // ---------------------------------------------------------------- observe / enforce

    /// New projects start in observe mode. After 7 days any approver may switch to enforce (stricter only).
    function enforce() external {
        _approver();
        if (block.timestamp < uint256(deployedAt) + OBSERVE_PERIOD) revert TooEarly();
        enforced = true;
        emit Enforced(msg.sender);
    }

    // ---------------------------------------------------------------- recovery

    /// The recovery address can replace the whole approver set after 7 days, also while frozen.
    /// Any 2 current approvers can cancel it.
    function proposeRecovery(address[3] calldata next) external {
        if (msg.sender != recovery) revert NotRecovery();
        _checkRoles(next, proposer, recovery, guardian);
        pendingRecovery = PendingRecovery(next, uint40(block.timestamp), 0, approverSet, true);
        emit RecoveryProposed(next);
    }

    function voteCancelRecovery() external {
        uint8 slot = _approver();
        PendingRecovery storage r = pendingRecovery;
        if (!r.active) revert NoRecovery();
        if (r.approverSet != approverSet) {
            r.approverSet = approverSet;
            r.cancelVotes = 0;
        }
        r.cancelVotes |= uint8(1 << slot);
        if (_count(r.cancelVotes) >= 2) {
            delete pendingRecovery;
            emit RecoveryCancelled();
        }
    }

    function executeRecovery() external {
        PendingRecovery storage r = pendingRecovery;
        if (!r.active) revert NoRecovery();
        if (block.timestamp < uint256(r.proposedAt) + RECOVERY_DELAY) revert TooEarly();
        address[3] memory next = r.approvers;
        _checkRoles(next, proposer, recovery, guardian);
        delete pendingRecovery;
        approvers = next;
        _bump();
        emit RecoveryExecuted(next);
    }

    // ---------------------------------------------------------------- own container

    /// A gate may hold TapeOut circuit NFTs (its own container). Nothing else is accepted.
    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender.codehash != processorCodehash) revert NotTapeOutCircuit();
        return this.onERC721Received.selector;
    }

    /// Anyone may call. Makes the current SignetRegistry the SiteRegistry operator of a container this gate holds
    /// (operators last at most 30 days). The registry only writes files the gate's releases approve.
    function renewOperator(address circuits, uint256 tokenId) external {
        if (ICircuitNFT(circuits).ownerOf(tokenId) != address(this)) revert NotHolder();
        address container = IContainerOpener(registry.opener()).accountOf(circuits, tokenId);
        ISiteRegistryWriter(registry.siteRegistry()).setOperator(container, address(registry), OPERATOR_TTL);
    }

    // ---------------------------------------------------------------- views

    /// True for the current release, and for the previous one during the grace window after a new publish.
    /// A revoked manifest is never valid. While frozen, the previous release's grace ends.
    function isValidManifest(bytes32 manifestHash) external view returns (bool) {
        if (manifestHash == bytes32(0) || currentRelease == 0 || revocations[manifestHash].revoked) return false;
        Release storage cur = releases[currentRelease];
        if (manifestHash == cur.manifestHash) return true;
        return cur.prev != 0 && manifestHash == releases[cur.prev].manifestHash && !frozen
            && block.timestamp < uint256(cur.publishedAt) + graceWindow;
    }

    /// The hashes files may be written for: the current release, unless it is revoked.
    function activeRelease() external view returns (bytes32 filesRoot, bytes32 allowlistHash, bytes32 originsHash, bool ok) {
        Release storage r = releases[currentRelease];
        return (r.filesRoot, r.allowlistHash, r.originsHash, currentRelease != 0 && !revocations[r.manifestHash].revoked);
    }

    function currentManifestHash() external view returns (bytes32) {
        return releases[currentRelease].manifestHash;
    }

    function getProposal(uint64 id) external view returns (Proposal memory) {
        return proposals[id];
    }

    function getApprovers() external view returns (address[3] memory) {
        return approvers;
    }

    function getPendingRecovery() external view returns (PendingRecovery memory) {
        return pendingRecovery;
    }

    // ---------------------------------------------------------------- internals

    function _policy(uint16 bits) internal returns (bool publishOut, bool unfreezeOut) {
        address impl = beacon.implementation();
        if (impl != pinnedImplementation) {
            emit PolicyFallbackActive(impl, 1);
            return PolicyMirror.eval(bits);
        }
        try policyProcessor.eval(policyCircuitId, abi.encodePacked(uint8(bits & 0xff), uint8(bits >> 8))) returns (
            bytes memory out
        ) {
            if (out.length == 1) return (uint8(out[0]) & 1 != 0, uint8(out[0]) & 2 != 0);
        } catch {}
        // the circuit could not be read: the mirror (equal to it on all 512 inputs) decides
        emit PolicyFallbackActive(impl, 2);
        return PolicyMirror.eval(bits);
    }

    function _live(uint64 id) internal view returns (Proposal storage p) {
        p = proposals[id];
        if (p.kind == Kind.None || p.executed || p.cancelled || p.approverSet != approverSet) revert NotLive();
        if (block.timestamp > uint256(p.proposedAt) + PROPOSAL_TTL) revert Expired();
    }

    function _execute(uint64 id, bytes memory data) internal {
        (Action action, bytes memory args) = abi.decode(data, (Action, bytes));
        if (action == Action.SetApprover) {
            (uint8 slot, address a) = abi.decode(args, (uint8, address));
            if (slot > 2) revert BadConfig();
            address[3] memory next = approvers;
            next[slot] = a;
            _checkRoles(next, proposer, recovery, guardian);
            approvers = next;
            _bump();
        } else if (action == Action.SetProposer) {
            proposer = abi.decode(args, (address));
        } else if (action == Action.SetRecovery) {
            recovery = abi.decode(args, (address));
        } else if (action == Action.SetGuardian) {
            guardian = abi.decode(args, (address));
            delete guardianVoteAt;
        } else if (action == Action.SetTimelocks) {
            (uint32 s, uint32 l, uint32 g) = abi.decode(args, (uint32, uint32, uint32));
            if (s < MIN_SHORT || l < MIN_LONG || s > l || l > MAX_LONG || g > PROPOSAL_TTL) revert BadConfig();
            shortDelay = s;
            longDelay = l;
            graceWindow = g;
        } else if (action == Action.SetPolicyCircuit) {
            (address cpu, uint256 cid) = abi.decode(args, (address, uint256));
            _setPolicy(IPolicyProcessor(cpu), cid);
        } else if (action == Action.BindDomain) {
            (string memory d, bytes32 salt, address circuits, uint256 tokenId) =
                abi.decode(args, (string, bytes32, address, uint256));
            ISignetFactoryForGate(registry.factory()).claim(d, salt, circuits, tokenId);
        } else if (action == Action.SetContainer) {
            (string memory d, address circuits, uint256 tokenId) = abi.decode(args, (string, address, uint256));
            registry.setContainer(d, circuits, tokenId);
        } else if (action == Action.TransferDomain) {
            (string memory d, address g2) = abi.decode(args, (string, address));
            registry.transfer(d, g2);
        } else if (action == Action.AcceptDomain) {
            registry.acceptTransfer(abi.decode(args, (string)));
        } else if (action == Action.UnbindDomain) {
            registry.unbind(abi.decode(args, (string)));
        } else if (action == Action.SetObserveMode) {
            enforced = false;
        } else if (action == Action.RemoveFile) {
            (string memory d, string memory path) = abi.decode(args, (string, string));
            registry.removeFile(d, path);
        } else if (action == Action.SetFallback) {
            (string memory d, string memory path) = abi.decode(args, (string, string));
            registry.setFallback(d, path);
        } else if (action == Action.TransferCircuit) {
            (address circuits, uint256 tokenId, address to) = abi.decode(args, (address, uint256, address));
            ICircuitNFT(circuits).safeTransferFrom(address(this), to, tokenId);
        } else {
            revert BadProposal();
        }
        // every role setter ends here: the four roles must stay distinct
        _checkRoles(approvers, proposer, recovery, guardian);
        emit AdminExecuted(id, action);
    }

    /// The processor must be a genuine TapeOut processor proxy (its code hash embeds the pinned beacon), and the
    /// circuit, read from the processor itself, must be the reviewed policy netlist.
    function _setPolicy(IPolicyProcessor cpu, uint256 cid) internal {
        if (address(cpu).codehash != processorCodehash) revert BadConfig();
        (uint32 nIn, uint32 nOut, uint32 nState,) = cpu.circuitInfo(cid);
        if (nIn != 9 || nOut != 2 || nState != 0) revert BadConfig();
        if (sha256(cpu.netlist(cid)) != policyNetlistSha256) revert BadConfig();
        policyProcessor = cpu;
        policyCircuitId = cid;
    }

    /// Approvers: 3 distinct non-zero addresses. Proposer and recovery: non-zero. Guardian: optional.
    /// Proposer, recovery and guardian are all different and none of them is an approver.
    function _checkRoles(address[3] memory a, address prop, address rec, address guard) internal pure {
        if (prop == address(0) || rec == address(0) || prop == rec) revert BadConfig();
        if (guard != address(0) && (guard == prop || guard == rec)) revert BadConfig();
        for (uint256 i; i < 3; i++) {
            if (a[i] == address(0) || a[i] == prop || a[i] == rec || a[i] == guard) revert BadConfig();
            for (uint256 j = i + 1; j < 3; j++) {
                if (a[i] == a[j]) revert BadConfig();
            }
        }
    }

    function _bump() internal {
        approverSet++;
        unfreezeApprovals = 0;
        delete guardianVoteAt;
    }

    function _approver() internal view returns (uint8 slot) {
        slot = _slotOf(msg.sender);
        if (slot > 2) revert NotApprover();
    }

    function _slotOf(address a) internal view returns (uint8) {
        for (uint8 i; i < 3; i++) {
            if (approvers[i] == a) return i;
        }
        return type(uint8).max;
    }

    function _count(uint8 m) internal pure returns (uint8) {
        return (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1);
    }
}
