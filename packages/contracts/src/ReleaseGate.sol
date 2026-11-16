// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IPolicyProcessor, ICircuitBeacon} from "./interfaces/ITapeOutPolicy.sol";

/// Domain functions of SignetRegistry that a gate calls (only through executed tier-11 proposals,
/// except the first claim at deployment).
interface ISignetDomains {
    function claim(string calldata domain, address container) external;
    function setContainer(string calldata domain, address container) external;
    function transfer(string calldata domain, address newGate) external;
    function unbind(string calldata domain) external;
}

/// One project's release gate (docs/signet-spec.md, "Release-lock circuit and approval tiers").
///
/// CI (the proposer key) can only propose. A proposal goes live only when the immutable TapeOut policy circuit
/// (eval on circuit #6 of processor #101 on X Layer) returns PUBLISH = 1 for the facts this contract supplies:
///   a0 a1 a2  approver 1/2/3 approved          (from on-chain approvals)
///   tS tL     short / long timelock passed     (block.timestamp - proposedAt)
///   r1 r0     risk tier, computed HERE         (allowlistHash / originsHash vs the current release; admin = 11)
///   f         project frozen                   (contract state)
///   e         emergency fast lane requested    (by the proposer of the proposal)
/// Unfreezing needs the circuit's UNFREEZE output (>= 2 approvals). Every eval first checks that the circuit
/// beacon still points at the implementation pinned at deployment (docs/decisions.md).
contract ReleaseGate {
    // ---------------------------------------------------------------- types

    enum Kind {
        None,
        Release,
        Admin
    }

    /// Tier-11 admin actions (spec: approver set, domain binding, timelocks, circuit swap; plus the other
    /// security settings, see docs/decisions.md).
    enum Action {
        None,
        SetApprover, //        (uint8 slot, address approver)
        SetProposer, //        (address)
        SetRecovery, //        (address)
        SetGuardian, //        (address, 0 = none)
        SetTimelocks, //       (uint32 short, uint32 long, uint32 grace)
        SetPolicyCircuit, //   (address processor, uint256 circuitId, bytes32 netlistSha256)
        BindDomain, //         (string domain, address container)  claim a new domain or change its container
        TransferDomain, //     (string domain, address newGate)
        UnbindDomain, //       (string domain)
        SetObserveMode //      ()  back to observe mode from enforce
    }

    struct Proposal {
        Kind kind;
        uint8 tier; // r1 r0 as a 2-bit number
        bool emergency;
        bool executed;
        uint8 approvals; // bit i = approver slot i
        uint40 proposedAt;
        uint64 baseRelease; // current release id when proposed (releases only)
        uint64 approverSet; // approver-set version when proposed
        bytes32 manifestHash; // sha256 of the sealed manifest file
        bytes32 allowlistHash;
        bytes32 originsHash;
        bytes adminData; // abi.encode(Action, bytes args)
    }

    struct Release {
        bytes32 manifestHash;
        bytes32 allowlistHash;
        bytes32 originsHash;
        uint40 publishedAt;
    }

    struct Config {
        address[3] approvers;
        address proposer;
        address recovery;
        address guardian; // optional watchtower key that may only freeze (0 = none)
        IPolicyProcessor policyProcessor;
        uint256 policyCircuitId;
        bytes32 policyNetlistSha256;
        ICircuitBeacon beacon;
        address expectedImplementation;
        ISignetDomains registry;
        string[] domains; // first claim, no tier needed (spec: DNS TXT proof at first claim, off-chain)
        address container; // 0 = Signet's shared container
    }

    // ---------------------------------------------------------------- constants

    uint8 public constant TIER_CODE = 0; // 00
    uint8 public constant TIER_ORIGIN = 1; // 01
    uint8 public constant TIER_CONTRACT = 2; // 10
    uint8 public constant TIER_ADMIN = 3; // 11
    uint32 public constant RECOVERY_DELAY = 7 days;
    uint32 public constant OBSERVE_PERIOD = 7 days;
    uint32 public constant MAX_TIMELOCK = 30 days;

    // ---------------------------------------------------------------- state

    ICircuitBeacon public immutable beacon;
    address public immutable pinnedImplementation;
    ISignetDomains public immutable registry;
    uint40 public immutable deployedAt;

    IPolicyProcessor public policyProcessor;
    uint256 public policyCircuitId;

    address[3] public approvers;
    address public proposer;
    address public recovery;
    address public guardian;
    uint64 public approverSet; // bumped on every approver change; older approvals stop counting

    uint32 public shortDelay = 1 hours;
    uint32 public longDelay = 24 hours;
    uint32 public graceWindow = 6 hours;

    bool public frozen;
    bool public enforced; // false = observe mode (Guard reports, never blocks)
    uint64 public freezeEpoch;
    uint8 public unfreezeApprovals;
    uint64 private unfreezeKey; // (freezeEpoch, approverSet) the approvals belong to

    uint64 public proposalCount;
    uint64 public currentRelease; // proposal id, 0 = none yet
    uint64 public previousRelease;
    mapping(uint64 => Proposal) internal proposals;
    mapping(uint64 => Release) public releases;

    struct PendingRecovery {
        address[3] approvers;
        uint40 proposedAt;
        uint8 cancelVotes;
        uint64 approverSet;
        bool active;
    }

    PendingRecovery internal pendingRecovery;

    // ---------------------------------------------------------------- events

    event Proposed(uint64 indexed id, Kind kind, uint8 tier, bool emergency, address indexed by, bytes32 manifestHash);
    event Approved(uint64 indexed id, uint8 slot, address indexed approver);
    event Published(uint64 indexed id, bytes32 manifestHash, uint8 tier);
    event AdminExecuted(uint64 indexed id, Action action);
    event Frozen(address indexed by);
    event UnfreezeApproved(uint8 slot, address indexed approver);
    event Unfrozen();
    event Enforced(address indexed by);
    event RecoveryProposed(address[3] approvers);
    event RecoveryCancelVote(uint8 slot);
    event RecoveryCancelled();
    event RecoveryExecuted(address[3] approvers);

    // ---------------------------------------------------------------- errors

    error NotProposer();
    error NotApprover();
    error NotRecovery();
    error NotFreezer();
    error BadConfig();
    error BadProposal();
    error AlreadyExecuted();
    error StaleBase();
    error StaleApprovers();
    error PolicyDenied();
    error BeaconChanged();
    error BadCircuitOutput();
    error NotFrozen();
    error TooEarly();
    error NoRecovery();

    // ---------------------------------------------------------------- construction

    constructor(Config memory c) {
        beacon = c.beacon;
        if (c.beacon.implementation() != c.expectedImplementation || c.expectedImplementation == address(0)) {
            revert BeaconChanged();
        }
        pinnedImplementation = c.expectedImplementation;
        registry = c.registry;
        deployedAt = uint40(block.timestamp);

        _setPolicy(c.policyProcessor, c.policyCircuitId, c.policyNetlistSha256);
        _checkApprovers(c.approvers, c.proposer);
        approvers = c.approvers;
        if (c.recovery == address(0)) revert BadConfig();
        proposer = c.proposer;
        recovery = c.recovery;
        guardian = c.guardian;

        for (uint256 i; i < c.domains.length; i++) {
            c.registry.claim(c.domains[i], c.container);
        }
    }

    // ---------------------------------------------------------------- proposals

    /// Propose a release. Only the proposer (CI) or an approver. The tier is computed here.
    function proposeRelease(bytes32 manifestHash, bytes32 allowlistHash, bytes32 originsHash, bool emergency)
        external
        returns (uint64 id)
    {
        if (msg.sender != proposer && _slotOf(msg.sender) == type(uint8).max) revert NotProposer();
        if (manifestHash == bytes32(0)) revert BadProposal();
        Release storage cur = releases[currentRelease];
        uint8 tier = allowlistHash != cur.allowlistHash
            ? TIER_CONTRACT
            : originsHash != cur.originsHash ? TIER_ORIGIN : TIER_CODE;

        id = ++proposalCount;
        Proposal storage p = proposals[id];
        p.kind = Kind.Release;
        p.tier = tier;
        p.emergency = emergency;
        p.proposedAt = uint40(block.timestamp);
        p.baseRelease = currentRelease;
        p.approverSet = approverSet;
        p.manifestHash = manifestHash;
        p.allowlistHash = allowlistHash;
        p.originsHash = originsHash;
        emit Proposed(id, Kind.Release, tier, emergency, msg.sender, manifestHash);
    }

    /// Propose a tier-11 admin change. Approvers only (the proposer key can't). No fast lane.
    function proposeAdmin(Action action, bytes calldata args) external returns (uint64 id) {
        if (_slotOf(msg.sender) == type(uint8).max) revert NotApprover();
        if (action == Action.None) revert BadProposal();
        id = ++proposalCount;
        Proposal storage p = proposals[id];
        p.kind = Kind.Admin;
        p.tier = TIER_ADMIN;
        p.proposedAt = uint40(block.timestamp);
        p.approverSet = approverSet;
        p.adminData = abi.encode(action, args);
        emit Proposed(id, Kind.Admin, TIER_ADMIN, false, msg.sender, bytes32(0));
    }

    function approve(uint64 id) external {
        uint8 slot = _slotOf(msg.sender);
        if (slot == type(uint8).max) revert NotApprover();
        Proposal storage p = proposals[id];
        if (p.kind == Kind.None) revert BadProposal();
        if (p.executed) revert AlreadyExecuted();
        if (p.approverSet != approverSet) revert StaleApprovers();
        p.approvals |= uint8(1 << slot);
        emit Approved(id, slot, msg.sender);
    }

    /// Anyone may call. Publishes (or executes an admin change) only if the policy circuit says PUBLISH.
    function publish(uint64 id) external {
        Proposal storage p = proposals[id];
        if (p.kind == Kind.None) revert BadProposal();
        if (p.executed) revert AlreadyExecuted();
        if (p.approverSet != approverSet) revert StaleApprovers();
        if (p.kind == Kind.Release && p.baseRelease != currentRelease) revert StaleBase();

        (bool ok,) = _policy(policyInputs(id));
        if (!ok) revert PolicyDenied();

        p.executed = true;
        if (p.kind == Kind.Release) {
            previousRelease = currentRelease;
            currentRelease = id;
            releases[id] = Release(p.manifestHash, p.allowlistHash, p.originsHash, uint40(block.timestamp));
            emit Published(id, p.manifestHash, p.tier);
        } else {
            _execute(id, p.adminData);
        }
    }

    /// The 9 input bits this contract would give the circuit for proposal `id` right now
    /// (bit order a0 a1 a2 tS tL r1 r0 f e = bits 0..8, docs/policy-truth-table.md).
    function policyInputs(uint64 id) public view returns (uint16 bits) {
        Proposal storage p = proposals[id];
        bits = uint16(p.approvals & 7);
        uint256 age = block.timestamp - p.proposedAt;
        if (age >= shortDelay) bits |= 1 << 3;
        if (age >= longDelay) bits |= 1 << 4;
        if (p.tier & 2 != 0) bits |= 1 << 5; // r1
        if (p.tier & 1 != 0) bits |= 1 << 6; // r0
        if (frozen) bits |= 1 << 7;
        if (p.emergency) bits |= 1 << 8;
    }

    // ---------------------------------------------------------------- freeze

    /// Any one approver (or the opt-in guardian) can freeze, with no circuit and no delay.
    function freeze() external {
        if (_slotOf(msg.sender) == type(uint8).max && (msg.sender != guardian || guardian == address(0))) {
            revert NotFreezer();
        }
        if (!frozen) {
            frozen = true;
            freezeEpoch++;
        }
        emit Frozen(msg.sender);
    }

    function approveUnfreeze() external {
        uint8 slot = _slotOf(msg.sender);
        if (slot == type(uint8).max) revert NotApprover();
        if (!frozen) revert NotFrozen();
        uint64 key = _unfreezeKey();
        if (unfreezeKey != key) {
            unfreezeKey = key;
            unfreezeApprovals = 0;
        }
        unfreezeApprovals |= uint8(1 << slot);
        emit UnfreezeApproved(slot, msg.sender);
    }

    /// Anyone may call; the circuit's UNFREEZE output decides (>= 2 approvals for this freeze).
    function unfreeze() external {
        if (!frozen) revert NotFrozen();
        uint16 bits = unfreezeKey == _unfreezeKey() ? uint16(unfreezeApprovals & 7) : 0;
        bits |= 1 << 7; // f
        (, bool ok) = _policy(bits);
        if (!ok) revert PolicyDenied();
        frozen = false;
        unfreezeApprovals = 0;
        emit Unfrozen();
    }

    // ---------------------------------------------------------------- observe / enforce

    /// New projects start in observe mode. After 7 days any approver may switch to enforce (stricter only).
    /// Going back to observe is a tier-11 admin change.
    function enforce() external {
        if (_slotOf(msg.sender) == type(uint8).max) revert NotApprover();
        if (block.timestamp < uint256(deployedAt) + OBSERVE_PERIOD) revert TooEarly();
        enforced = true;
        emit Enforced(msg.sender);
    }

    // ---------------------------------------------------------------- recovery

    /// The recovery address can replace the whole approver set after RECOVERY_DELAY (7 days), even while frozen.
    /// Any 2 current approvers can cancel it.
    function proposeRecovery(address[3] calldata newApprovers) external {
        if (msg.sender != recovery) revert NotRecovery();
        _checkApprovers(newApprovers, proposer);
        pendingRecovery = PendingRecovery(newApprovers, uint40(block.timestamp), 0, approverSet, true);
        emit RecoveryProposed(newApprovers);
    }

    function voteCancelRecovery() external {
        uint8 slot = _slotOf(msg.sender);
        if (slot == type(uint8).max) revert NotApprover();
        PendingRecovery storage r = pendingRecovery;
        if (!r.active) revert NoRecovery();
        if (r.approverSet != approverSet) {
            r.approverSet = approverSet;
            r.cancelVotes = 0;
        }
        r.cancelVotes |= uint8(1 << slot);
        emit RecoveryCancelVote(slot);
        if (_popcount3(r.cancelVotes) >= 2) {
            delete pendingRecovery;
            emit RecoveryCancelled();
        }
    }

    function executeRecovery() external {
        PendingRecovery storage r = pendingRecovery;
        if (!r.active) revert NoRecovery();
        if (block.timestamp < uint256(r.proposedAt) + RECOVERY_DELAY) revert TooEarly();
        address[3] memory next = r.approvers;
        _checkApprovers(next, proposer);
        delete pendingRecovery;
        approvers = next;
        approverSet++;
        emit RecoveryExecuted(next);
    }

    // ---------------------------------------------------------------- views

    /// True for the current release, and for the previous one during the grace window after a new publish
    /// (spec: users with the old version cached).
    function isValidManifest(bytes32 manifestHash) external view returns (bool) {
        if (manifestHash == bytes32(0)) return false;
        Release storage cur = releases[currentRelease];
        if (currentRelease != 0 && manifestHash == cur.manifestHash) return true;
        return previousRelease != 0 && manifestHash == releases[previousRelease].manifestHash
            && block.timestamp < uint256(cur.publishedAt) + graceWindow;
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

    function _policy(uint16 bits) internal view returns (bool publishOut, bool unfreezeOut) {
        if (beacon.implementation() != pinnedImplementation) revert BeaconChanged();
        bytes memory out = policyProcessor.eval(policyCircuitId, abi.encodePacked(uint8(bits & 0xff), uint8(bits >> 8)));
        if (out.length != 1) revert BadCircuitOutput();
        uint8 o = uint8(out[0]);
        return (o & 1 != 0, o & 2 != 0);
    }

    function _execute(uint64 id, bytes memory data) internal {
        (Action action, bytes memory args) = abi.decode(data, (Action, bytes));
        if (action == Action.SetApprover) {
            (uint8 slot, address a) = abi.decode(args, (uint8, address));
            if (slot > 2) revert BadConfig();
            address[3] memory next = approvers;
            next[slot] = a;
            _checkApprovers(next, proposer);
            approvers = next;
            approverSet++;
        } else if (action == Action.SetProposer) {
            address a = abi.decode(args, (address));
            _checkApprovers(approvers, a);
            proposer = a;
        } else if (action == Action.SetRecovery) {
            address a = abi.decode(args, (address));
            if (a == address(0)) revert BadConfig();
            recovery = a;
        } else if (action == Action.SetGuardian) {
            guardian = abi.decode(args, (address));
        } else if (action == Action.SetTimelocks) {
            (uint32 s, uint32 l, uint32 g) = abi.decode(args, (uint32, uint32, uint32));
            if (s > l || l > MAX_TIMELOCK || g > MAX_TIMELOCK) revert BadConfig();
            shortDelay = s;
            longDelay = l;
            graceWindow = g;
        } else if (action == Action.SetPolicyCircuit) {
            (address cpu, uint256 cid, bytes32 h) = abi.decode(args, (address, uint256, bytes32));
            _setPolicy(IPolicyProcessor(cpu), cid, h);
        } else if (action == Action.BindDomain) {
            (string memory d, address container) = abi.decode(args, (string, address));
            // claim if new; if already ours, change its container (the registry checks ownership)
            try registry.claim(d, container) {}
            catch {
                registry.setContainer(d, container);
            }
        } else if (action == Action.TransferDomain) {
            (string memory d, address g2) = abi.decode(args, (string, address));
            registry.transfer(d, g2);
        } else if (action == Action.UnbindDomain) {
            registry.unbind(abi.decode(args, (string)));
        } else if (action == Action.SetObserveMode) {
            enforced = false;
        } else {
            revert BadProposal();
        }
        emit AdminExecuted(id, action);
    }

    function _setPolicy(IPolicyProcessor cpu, uint256 cid, bytes32 netlistSha256) internal {
        (uint32 nIn, uint32 nOut, uint32 nState,) = cpu.circuitInfo(cid);
        if (nIn != 9 || nOut != 2 || nState != 0) revert BadConfig();
        if (sha256(cpu.netlist(cid)) != netlistSha256) revert BadConfig();
        policyProcessor = cpu;
        policyCircuitId = cid;
    }

    function _checkApprovers(address[3] memory a, address prop) internal pure {
        for (uint256 i; i < 3; i++) {
            if (a[i] == address(0) || a[i] == prop) revert BadConfig();
            for (uint256 j = i + 1; j < 3; j++) {
                if (a[i] == a[j]) revert BadConfig();
            }
        }
        if (prop == address(0)) revert BadConfig();
    }

    function _slotOf(address a) internal view returns (uint8) {
        for (uint8 i; i < 3; i++) {
            if (approvers[i] == a) return i;
        }
        return type(uint8).max;
    }

    function _unfreezeKey() internal view returns (uint64) {
        return (freezeEpoch << 32) | (approverSet & 0xffffffff);
    }

    function _popcount3(uint8 m) internal pure returns (uint8) {
        return (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1);
    }
}
