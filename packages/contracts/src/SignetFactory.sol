// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReleaseGate, ISignetRegistryForGate} from "./ReleaseGate.sol";
import {IPolicyProcessor, ICircuitBeacon} from "./interfaces/ITapeOutPolicy.sol";

interface ISignetRegistryForFactory {
    function register(address gate) external;
    function claimFor(address gate, string calldata domain, address circuits, uint256 tokenId) external;
    function isGate(address gate) external view returns (bool);
}

/// Deploys a project's ReleaseGate (a minimal EIP-1167 clone of one audited implementation), sets it up and
/// claims its domains in the SAME transaction. SignetRegistry binds domains only to gates made here, so a
/// binding always points at genuine ReleaseGate code wired to the real policy circuit.
///
/// Domain claims are commit-reveal, so nobody can copy a claim out of the mempool:
///   1. commit(keccak256(abi.encode(domain, salt, claimant)))   reveals nothing
///   2. at least 2 blocks later (and within 7 days): createGate(...) or, for a gate adding a domain, claim(...)
/// A commit made after seeing someone's reveal is never old enough, so the earlier valid commit wins.
contract SignetFactory {
    struct DomainInit {
        string domain;
        bytes32 salt;
        address circuits; // 0 = Signet's shared container
        uint256 tokenId;
    }

    address public immutable implementation;
    ISignetRegistryForFactory public immutable registry;
    IPolicyProcessor public immutable policyProcessor;
    uint256 public immutable policyCircuitId;
    bytes32 public immutable policyNetlistSha256;
    bytes32 public immutable processorCodehash;
    ICircuitBeacon public immutable beacon;
    address public immutable expectedImplementation;

    uint256 public constant MIN_COMMIT_BLOCKS = 2;
    uint256 public constant MAX_COMMIT_AGE = 7 days;

    struct Commit {
        uint64 blockNumber;
        uint64 time;
    }

    mapping(bytes32 => Commit) public commits;

    event GateCreated(address indexed gate, address indexed creator);
    event Committed(bytes32 indexed commitment);

    error CommitExists();
    error NoCommit();
    error CommitTooNew();
    error CommitExpired();
    error NotFactoryGate();

    constructor(
        address registry_,
        IPolicyProcessor policyProcessor_,
        uint256 policyCircuitId_,
        bytes32 policyNetlistSha256_,
        bytes32 processorCodehash_,
        ICircuitBeacon beacon_,
        address expectedImplementation_
    ) {
        implementation = address(new ReleaseGate());
        registry = ISignetRegistryForFactory(registry_);
        policyProcessor = policyProcessor_;
        policyCircuitId = policyCircuitId_;
        policyNetlistSha256 = policyNetlistSha256_;
        processorCodehash = processorCodehash_;
        beacon = beacon_;
        expectedImplementation = expectedImplementation_;
    }

    /// Step 1. Anyone may send it; the claimant is inside the hash. A commitment is recorded once.
    function commit(bytes32 commitment) external {
        if (commits[commitment].blockNumber != 0) revert CommitExists();
        commits[commitment] = Commit(uint64(block.number), uint64(block.timestamp));
        emit Committed(commitment);
    }

    function commitmentOf(string calldata domain, bytes32 salt, address claimant) public pure returns (bytes32) {
        return keccak256(abi.encode(domain, salt, claimant));
    }

    /// A factory-made gate adds a domain (the gate's tier-11 BindDomain). The gate is the claimant.
    function claim(string calldata domain, bytes32 salt, address circuits, uint256 tokenId) external {
        if (!registry.isGate(msg.sender)) revert NotFactoryGate();
        _useCommit(domain, salt, msg.sender);
        registry.claimFor(msg.sender, domain, circuits, tokenId);
    }

    function _useCommit(string calldata domain, bytes32 salt, address claimant) internal {
        bytes32 c = commitmentOf(domain, salt, claimant);
        Commit memory m = commits[c];
        if (m.blockNumber == 0) revert NoCommit();
        if (block.number < uint256(m.blockNumber) + MIN_COMMIT_BLOCKS) revert CommitTooNew();
        if (block.timestamp > uint256(m.time) + MAX_COMMIT_AGE) revert CommitExpired();
        delete commits[c];
    }

    function createGate(
        address[3] calldata approvers,
        address proposer,
        address recovery,
        address guardian,
        DomainInit[] calldata domains
    ) external returns (address gate) {
        gate = _clone(implementation);
        ReleaseGate.Init memory c;
        c.approvers = approvers;
        c.proposer = proposer;
        c.recovery = recovery;
        c.guardian = guardian;
        c.policyProcessor = policyProcessor;
        c.policyCircuitId = policyCircuitId;
        c.policyNetlistSha256 = policyNetlistSha256;
        c.processorCodehash = processorCodehash;
        c.beacon = beacon;
        c.expectedImplementation = expectedImplementation;
        c.registry = ISignetRegistryForGate(address(registry));
        ReleaseGate(gate).initialize(c);
        registry.register(gate);
        for (uint256 i; i < domains.length; i++) {
            _useCommit(domains[i].domain, domains[i].salt, msg.sender); // the creator is the claimant
            registry.claimFor(gate, domains[i].domain, domains[i].circuits, domains[i].tokenId);
        }
        emit GateCreated(gate, msg.sender);
    }

    /// EIP-1167 minimal proxy (same bytes as OpenZeppelin Clones.clone).
    function _clone(address impl) internal returns (address instance) {
        assembly ("memory-safe") {
            mstore(0x00, or(shr(0xe8, shl(0x60, impl)), 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000))
            mstore(0x20, or(shl(0x78, impl), 0x5af43d82803e903d91602b57fd5bf3))
            instance := create(0, 0x09, 0x37)
        }
        require(instance != address(0), "clone failed");
    }
}
