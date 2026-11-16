// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReleaseGate, ISignetRegistryForGate} from "./ReleaseGate.sol";
import {IPolicyProcessor, ICircuitBeacon} from "./interfaces/ITapeOutPolicy.sol";

interface ISignetRegistryForFactory {
    function register(address gate) external;
    function claimFor(address gate, string calldata domain, address circuits, uint256 tokenId) external;
}

/// Deploys a project's ReleaseGate (a minimal EIP-1167 clone of one audited implementation), sets it up and
/// claims its domains in the SAME transaction. SignetRegistry binds domains only to gates made here, so a
/// binding always points at genuine ReleaseGate code wired to the real policy circuit.
contract SignetFactory {
    struct DomainInit {
        string domain;
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

    event GateCreated(address indexed gate, address indexed creator);

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
