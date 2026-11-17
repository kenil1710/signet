// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SignetRegistry} from "../src/SignetRegistry.sol";
import {SignetFactory} from "../src/SignetFactory.sol";
import {ReleaseGate} from "../src/ReleaseGate.sol";
import {IPolicyProcessor, ICircuitBeacon, ISiteRegistryWriter, IContainerOpener} from "../src/interfaces/ITapeOutPolicy.sol";

/// Deploys Signet on X Layer mainnet in two steps (docs/mainnet-plan.md). The sender is the dev wallet, which
/// holds circuit #5 (the shared container) and so is the only key that can make the registry its operator.
///
///   step1()  SignetRegistry, SignetFactory (which deploys the ReleaseGate implementation), the commitment for
///            Signet's own domain, and SiteRegistry.setOperator(sharedContainer, registry, 30 days)
///   step2()  at least 2 blocks later: Signet's own site gate (the factory's FIRST gate) and its domain claim
///
/// Settings come from the environment (nothing secret is printed):
///   SIGNET_SITE_DOMAIN     Signet's own domain, e.g. signet.example
///   SIGNET_SITE_SALT       32 random bytes; keep it private until step2 (it hides the domain in step1)
///   SIGNET_SITE_APPROVERS  3 addresses, comma-separated
///   SIGNET_SITE_PROPOSER   the CI key's address
///   SIGNET_SITE_RECOVERY   a key kept offline
///   SIGNET_SITE_GUARDIAN   the watchtower's freeze-only key, or 0x0000000000000000000000000000000000000000
///
/// SIMULATE (no transaction):  forge script script/MainnetDeploy.s.sol --sig "step1()" --rpc-url xlayer --sender <dev>
/// SEND (only after Kenil's explicit yes):  add --account signet-dev --broadcast --slow
contract MainnetDeploy is Script {
    address constant DEV = 0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE; // holds circuits #5 and #6
    address constant CPU = 0x73153e5fd2Acac604D49d6ca9fea27b750718F22; // processor #101
    uint256 constant POLICY_CIRCUIT = 6;
    uint256 constant SHARED_CIRCUIT = 5;
    address constant SHARED_CONTAINER = 0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed;
    bytes32 constant CPU_CODEHASH = 0x57aa306fd0be97087da3534e03398f5ff4efd533b5be4e45a405ce86fa6717d5;
    bytes32 constant POLICY_NETLIST_SHA256 = 0x1a2e19870a19f653af4bddf049e1070461b7466577640a4cb341a579838b20db;
    address constant BEACON = 0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C;
    address constant IMPL = 0x977f217887E085D298Cb3819cDAD5A0ee35F29B2;
    address constant SITES = 0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6;
    address constant OPENER = 0x536adD8F30f03b69f6fbF29d425A816A0dC50106;
    uint256 constant OPERATOR_TTL = 30 days; // SiteRegistry's maximum

    function _out() internal view returns (string memory) {
        return vm.envOr("SIGNET_DEPLOY_OUT", string("deployments/mainnet-deploy.json")); // the rehearsal writes elsewhere
    }

    function _checks() internal view {
        require(block.chainid == 196, "not X Layer");
        require(msg.sender == DEV, "the sender must be the dev wallet (it holds circuit #5)");
        (bool ok, bytes memory impl) = BEACON.staticcall(abi.encodeWithSignature("implementation()"));
        require(ok && abi.decode(impl, (address)) == IMPL, "circuit implementation changed");
        require(CPU.codehash == CPU_CODEHASH, "processor code changed");
        (bool ok2, bytes memory nl) = CPU.staticcall(abi.encodeWithSignature("netlist(uint256)", POLICY_CIRCUIT));
        require(ok2 && sha256(abi.decode(nl, (bytes))) == POLICY_NETLIST_SHA256, "policy circuit #6 is not the reviewed netlist");
        require(IContainerOpener(OPENER).accountOf(CPU, SHARED_CIRCUIT) == SHARED_CONTAINER, "shared container moved");
    }

    function _commitment(SignetFactory factory) internal view returns (bytes32) {
        return factory.commitmentOf(vm.envString("SIGNET_SITE_DOMAIN"), vm.envBytes32("SIGNET_SITE_SALT"), DEV);
    }

    function step1() external {
        _checks();
        uint256 nonce = vm.getNonce(DEV);
        address predictedFactory = vm.computeCreateAddress(DEV, nonce + 1);
        address predictedSiteGate = vm.computeCreateAddress(predictedFactory, 2); // nonce 1 = the gate implementation
        console2.log("dev nonce:", nonce);
        vm.startBroadcast();
        SignetRegistry reg = new SignetRegistry(
            ISiteRegistryWriter(SITES), IContainerOpener(OPENER), CPU, SHARED_CIRCUIT, predictedFactory, predictedSiteGate
        );
        SignetFactory factory =
            new SignetFactory(address(reg), IPolicyProcessor(CPU), POLICY_CIRCUIT, POLICY_NETLIST_SHA256, CPU_CODEHASH, ICircuitBeacon(BEACON), IMPL);
        require(address(factory) == predictedFactory, "factory address was predicted wrong: stop, nothing else is sent");
        factory.commit(_commitment(factory));
        ISiteRegistryWriter(SITES).setOperator(SHARED_CONTAINER, address(reg), OPERATOR_TTL);
        vm.stopBroadcast();

        string memory o = "deploy";
        vm.serializeAddress(o, "registry", address(reg));
        vm.serializeAddress(o, "factory", address(factory));
        vm.serializeAddress(o, "gateImplementation", factory.implementation());
        vm.serializeAddress(o, "predictedSiteGate", predictedSiteGate);
        vm.writeJson(vm.serializeUint(o, "step1Block", block.number), _out());
        console2.log("registry:", address(reg));
        console2.log("factory:", address(factory));
        console2.log("gate implementation:", factory.implementation());
        console2.log("Signet site gate will be:", predictedSiteGate);
    }

    function step2() external {
        _checks();
        string memory cfg = vm.readFile(_out());
        SignetRegistry reg = SignetRegistry(vm.parseJsonAddress(cfg, ".registry"));
        SignetFactory factory = SignetFactory(vm.parseJsonAddress(cfg, ".factory"));
        require(factory.implementation().code.length > 0, "factory not deployed");
        (uint64 commitBlock,) = factory.commits(_commitment(factory));
        require(commitBlock != 0 && block.number >= commitBlock + 2, "the commitment is missing or not 2 blocks old yet");

        address[] memory a = vm.envAddress("SIGNET_SITE_APPROVERS", ",");
        require(a.length == 3, "SIGNET_SITE_APPROVERS needs 3 addresses");
        SignetFactory.DomainInit[] memory d = new SignetFactory.DomainInit[](1);
        d[0] = SignetFactory.DomainInit(vm.envString("SIGNET_SITE_DOMAIN"), vm.envBytes32("SIGNET_SITE_SALT"), address(0), 0);
        vm.startBroadcast();
        address gate = factory.createGate(
            [a[0], a[1], a[2]], vm.envAddress("SIGNET_SITE_PROPOSER"), vm.envAddress("SIGNET_SITE_RECOVERY"), vm.envAddress("SIGNET_SITE_GUARDIAN"), d
        );
        vm.stopBroadcast();
        require(gate == reg.signetSiteGate(), "site gate address was predicted wrong");
        (address bound,, string memory prefix) = reg.bindingOf(vm.envString("SIGNET_SITE_DOMAIN"));
        require(bound == gate, "domain not bound");
        require(reg.domainCount() == 1, "unexpected domain list");
        require(!ReleaseGate(gate).enforced(), "a new gate starts in observe mode");
        vm.writeJson(vm.serializeAddress("site", "siteGate", gate), _out(), ".siteGate");
        console2.log("Signet site gate:", gate);
        console2.log("prefix:", prefix);
    }
}
