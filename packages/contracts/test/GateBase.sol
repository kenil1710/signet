// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReleaseGate} from "../src/ReleaseGate.sol";
import {SignetRegistry} from "../src/SignetRegistry.sol";
import {SignetFactory} from "../src/SignetFactory.sol";
import {IPolicyProcessor, ICircuitBeacon, ISiteRegistryWriter, IContainerOpener} from "../src/interfaces/ITapeOutPolicy.sol";
import {NetlistProcessor, MockBeacon, MockOpener, MockSiteRegistry} from "./mocks/Mocks.sol";

/// Shared setup: the REAL policy netlist (packages/circuit/artifacts/policy.json) on a TAP-02 evaluator, a beacon
/// pinned to the X Layer circuit implementation, SignetRegistry as operator of the shared container, a factory,
/// and one factory-made gate bound to DOMAIN in the shared container.
abstract contract GateBase is Test {
    address constant IMPL = 0x977f217887E085D298Cb3819cDAD5A0ee35F29B2;
    uint256 constant POLICY_ID = 6;
    uint256 constant SHARED_ID = 5;
    string constant DOMAIN = "app.example.org";

    NetlistProcessor cpu;
    MockBeacon beacon;
    MockOpener opener;
    MockSiteRegistry sites;
    SignetRegistry reg;
    SignetFactory factory;
    ReleaseGate gate;
    address sharedContainer;

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
    address O0 = makeAddr("ops0");
    address O1 = makeAddr("ops1");
    address O2 = makeAddr("ops2");
    address SHARED_HOLDER = makeAddr("sharedHolder"); // holds circuit #5 (the dev wallet today)

    bytes32 constant ALLOW = keccak256("allowlist-v1");
    bytes32 constant ORIG = keccak256("origins-v1");
    bytes32 constant F1 = keccak256("files-1");
    bytes32 constant F2 = keccak256("files-2");
    bytes32 constant F3 = keccak256("files-3");

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        string memory json = vm.readFile("../circuit/artifacts/policy.json");
        netlist = vm.parseJsonBytes(json, ".netlist");
        expected = vm.parseJsonBytes(json, ".expected");
        netlistSha = vm.parseJsonBytes32(json, ".netlistSha256");

        cpu = new NetlistProcessor();
        cpu.set(POLICY_ID, netlist, 9, 2);
        cpu.setOwner(SHARED_ID, SHARED_HOLDER);
        beacon = new MockBeacon(IMPL);
        opener = new MockOpener();
        sites = new MockSiteRegistry();
        sharedContainer = opener.accountOf(address(cpu), SHARED_ID);
        sites.registerContainer(sharedContainer, cpu, SHARED_ID);

        reg = new SignetRegistry(
            ISiteRegistryWriter(address(sites)), IContainerOpener(address(opener)), address(cpu), SHARED_ID, [O0, O1, O2]
        );
        factory = new SignetFactory(
            address(reg),
            IPolicyProcessor(address(cpu)),
            POLICY_ID,
            netlistSha,
            address(cpu).codehash,
            ICircuitBeacon(address(beacon)),
            IMPL
        );
        reg.initFactory(address(factory));
        vm.prank(SHARED_HOLDER);
        sites.setOperator(sharedContainer, address(reg), 30 days);

        gate = newGate(DOMAIN);
    }

    function newGate(string memory domain) internal returns (ReleaseGate) {
        return newGateWith([A0, A1, A2], P, R, G, domain, address(0), 0);
    }

    function newGateWith(
        address[3] memory a,
        address prop,
        address rec,
        address guard,
        string memory domain,
        address circuits,
        uint256 tokenId
    ) internal returns (ReleaseGate) {
        SignetFactory.DomainInit[] memory d = new SignetFactory.DomainInit[](bytes(domain).length > 0 ? 1 : 0);
        if (d.length > 0) d[0] = SignetFactory.DomainInit(domain, circuits, tokenId);
        return ReleaseGate(factory.createGate(a, prop, rec, guard, d));
    }

    // ---------------------------------------------------------------- helpers

    function approvers() internal view returns (address[3] memory) {
        return [A0, A1, A2];
    }

    function propose(bytes32 filesRoot, bytes32 allow, bytes32 orig, bool e) internal returns (uint64 id) {
        vm.prank(P);
        id = gate.proposeRelease(filesRoot, allow, orig, e);
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

    /// Returns true if publish succeeded, false if the policy denied it. Any other revert fails the test.
    function tryPublish(uint64 id) internal returns (bool) {
        try gate.publish(id) {
            return true;
        } catch (bytes memory err) {
            assertEq(bytes4(err), ReleaseGate.PolicyDenied.selector, "unexpected revert reason");
            return false;
        }
    }

    /// First release of a fresh gate: tier 10 (allowlist "changed" from nothing), via the 3-of-3 fast lane.
    function baseline(bytes32 filesRoot) internal returns (uint64 id) {
        id = propose(filesRoot, ALLOW, ORIG, true);
        approveMask(id, 7);
        gate.publish(id);
    }

    /// Run a tier-11 admin action to completion: 3 of 3, then the long timelock from the last approval.
    function admin(ReleaseGate.Action a, bytes memory args) internal {
        uint64 id = proposeAdmin(a, args);
        approveMask(id, 7);
        vm.warp(block.timestamp + gate.longDelay());
        gate.publish(id);
    }

    function mh(bytes32 filesRoot, bytes32 allow, bytes32 orig) internal pure returns (bytes32) {
        return sha256(abi.encode(filesRoot, allow, orig));
    }
}
