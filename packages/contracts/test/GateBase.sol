// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReleaseGate, ISignetDomains} from "../src/ReleaseGate.sol";
import {SignetRegistry} from "../src/SignetRegistry.sol";
import {
    IPolicyProcessor,
    ICircuitBeacon,
    ISiteRegistryWriter,
    IContainerOpener,
    ICircuitNFT
} from "../src/interfaces/ITapeOutPolicy.sol";
import {NetlistProcessor, MockBeacon, MockOpener, MockSiteRegistry} from "./mocks/Mocks.sol";

/// Shared setup: the REAL policy netlist (packages/circuit/artifacts/policy.json) on a TAP-02 evaluator,
/// a beacon pinned to the X Layer circuit implementation, SignetRegistry with a mock SiteRegistry, one gate.
abstract contract GateBase is Test {
    address constant IMPL = 0x977f217887E085D298Cb3819cDAD5A0ee35F29B2;
    address constant CONTAINER = 0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed;
    uint256 constant POLICY_ID = 6;
    uint256 constant SHARED_ID = 5;
    string constant DOMAIN = "app.example.org";

    NetlistProcessor cpu;
    MockBeacon beacon;
    MockSiteRegistry sites;
    SignetRegistry reg;
    ReleaseGate gate;

    bytes netlist;
    bytes expected; // expected[n] = packed outputs for input n
    bytes32 netlistSha;

    address A0 = makeAddr("approver0");
    address A1 = makeAddr("approver1");
    address A2 = makeAddr("approver2");
    address P = makeAddr("proposerCI");
    address R = makeAddr("recovery");
    address G = makeAddr("guardian");
    address X = makeAddr("stranger");

    bytes32 constant ALLOW = keccak256("allowlist-v1");
    bytes32 constant ORIG = keccak256("origins-v1");

    function setUp() public virtual {
        string memory json = vm.readFile("../circuit/artifacts/policy.json");
        netlist = vm.parseJsonBytes(json, ".netlist");
        expected = vm.parseJsonBytes(json, ".expected");
        netlistSha = vm.parseJsonBytes32(json, ".netlistSha256");

        cpu = new NetlistProcessor();
        cpu.set(POLICY_ID, netlist, 9, 2);
        beacon = new MockBeacon(IMPL);
        sites = new MockSiteRegistry(cpu, SHARED_ID);
        reg = new SignetRegistry(
            ISiteRegistryWriter(address(sites)),
            IContainerOpener(address(new MockOpener(CONTAINER))),
            ICircuitNFT(address(cpu)),
            SHARED_ID
        );
        cpu.setOwner(SHARED_ID, address(reg));
        gate = new ReleaseGate(config(DOMAIN));
    }

    function config(string memory domain) internal view returns (ReleaseGate.Config memory c) {
        c.approvers = [A0, A1, A2];
        c.proposer = P;
        c.recovery = R;
        c.guardian = G;
        c.policyProcessor = IPolicyProcessor(address(cpu));
        c.policyCircuitId = POLICY_ID;
        c.policyNetlistSha256 = netlistSha;
        c.beacon = ICircuitBeacon(address(beacon));
        c.expectedImplementation = IMPL;
        c.registry = ISignetDomains(address(reg));
        if (bytes(domain).length > 0) {
            c.domains = new string[](1);
            c.domains[0] = domain;
        }
    }

    // ---------------------------------------------------------------- helpers

    function approvers() internal view returns (address[3] memory) {
        return [A0, A1, A2];
    }

    function propose(bytes32 manifest, bytes32 allow, bytes32 orig, bool e) internal returns (uint64 id) {
        vm.prank(P);
        id = gate.proposeRelease(manifest, allow, orig, e);
    }

    function proposeAdmin(ReleaseGate.Action a, bytes memory args) internal returns (uint64 id) {
        vm.prank(A0);
        id = gate.proposeAdmin(a, args);
    }

    function approveMask(uint64 id, uint8 mask) internal {
        address[3] memory a = approvers();
        for (uint256 i; i < 3; i++) {
            if (mask & (1 << i) != 0) {
                vm.prank(a[i]);
                gate.approve(id);
            }
        }
    }

    /// Returns true if publish succeeded, false if the circuit denied it. Any other revert fails the test.
    function tryPublish(uint64 id) internal returns (bool) {
        try gate.publish(id) {
            return true;
        } catch (bytes memory err) {
            assertEq(bytes4(err), ReleaseGate.PolicyDenied.selector, "unexpected revert reason");
            return false;
        }
    }

    /// First release of a fresh gate: tier 10 (allowlist "changed" from nothing), via the 3-of-3 fast lane.
    function baseline(bytes32 manifest) internal returns (uint64 id) {
        id = propose(manifest, ALLOW, ORIG, true);
        approveMask(id, 7);
        gate.publish(id);
    }
}
