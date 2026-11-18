// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ReleaseGate} from "../src/ReleaseGate.sol";
import {SignetRegistry} from "../src/SignetRegistry.sol";
import {SignetFactory} from "../src/SignetFactory.sol";
import {IPolicyProcessor, ICircuitBeacon, ISiteRegistryWriter, IContainerOpener} from "../src/interfaces/ITapeOutPolicy.sol";

interface ISiteReadS {
    function read(address container, string calldata path) external view returns (bytes memory);
}

/// LOCAL STAGING ONLY: deploys Signet's contracts on an anvil fork of X Layer mainnet (staging/up.sh).
/// Every entry point first asks the node for `anvil_nodeInfo`, which a real X Layer node doesn't answer, so
/// this script can't run against mainnet. It uses anvil's unlocked test accounts; there are no keys here.
///
///   deploy()  registry + factory, and the commits for the two staging domains
///   gates()   (at least 2 blocks later) Signet's site gate and a demo project gate
///   smoke()   one full release on the demo gate: propose, 3 approvals, publish, write files, read back
contract Staging is Script {
    address constant CPU = 0x73153e5fd2Acac604D49d6ca9fea27b750718F22; // processor #101
    uint256 constant POLICY_CIRCUIT = 6;
    uint256 constant SHARED_CIRCUIT = 5;
    bytes32 constant CPU_CODEHASH = 0x57aa306fd0be97087da3534e03398f5ff4efd533b5be4e45a405ce86fa6717d5;
    address constant BEACON = 0xf70d1ed4f62CF3780157B0b421b7E2F45bD0991C;
    address constant IMPL = 0x977f217887E085D298Cb3819cDAD5A0ee35F29B2;
    address constant SITES = 0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6;
    address constant OPENER = 0x536adD8F30f03b69f6fbF29d425A816A0dC50106;

    string constant OUT = "deployments/local.json";
    string constant DEMO_DOMAIN = "demo.signet.test";
    string constant SITE_DOMAIN = "signet.test";

    // staging/up.sh passes anvil's accounts: 0 deployer, 1-3 approvers, 4 proposer (CI), 5 recovery,
    // 6 guardian, 7-9 spare users
    address[] acct;

    function _init() internal {
        require(block.chainid == 196, "expected an X Layer fork");
        vm.rpc("anvil_nodeInfo", "[]"); // reverts on a real node: local anvil only
        acct = vm.envAddress("STAGING_ACCOUNTS", ",");
        require(acct.length >= 8, "need 8 accounts");
    }

    function _salt(string memory domain) internal pure returns (bytes32) {
        return keccak256(bytes(string.concat("staging:", domain))); // not secret: nobody races us locally
    }

    function deploy() external {
        _init();
        string memory json = vm.readFile("../circuit/artifacts/policy.json");
        // The registry fixes the factory and Signet's site gate at deployment, as predicted addresses:
        // the factory is the deployer's next contract, the site gate the factory's first clone.
        address predictedFactory = vm.computeCreateAddress(acct[0], vm.getNonce(acct[0]) + 1);
        vm.startBroadcast(acct[0]);
        SignetRegistry reg = new SignetRegistry(
            ISiteRegistryWriter(SITES),
            IContainerOpener(OPENER),
            CPU,
            SHARED_CIRCUIT,
            predictedFactory,
            vm.computeCreateAddress(predictedFactory, 2)
        );
        SignetFactory factory = new SignetFactory(
            address(reg),
            IPolicyProcessor(CPU),
            POLICY_CIRCUIT,
            vm.parseJsonBytes32(json, ".netlistSha256"),
            CPU_CODEHASH,
            ICircuitBeacon(BEACON),
            IMPL
        );
        require(address(factory) == predictedFactory, "factory address was predicted wrong");
        factory.commit(factory.commitmentOf(SITE_DOMAIN, _salt(SITE_DOMAIN), acct[0]));
        factory.commit(factory.commitmentOf(DEMO_DOMAIN, _salt(DEMO_DOMAIN), acct[0]));
        vm.stopBroadcast();

        string memory o = "contracts";
        vm.serializeAddress(o, "registry", address(reg));
        vm.serializeAddress(o, "factory", address(factory));
        vm.writeJson(vm.serializeAddress(o, "gateImplementation", factory.implementation()), OUT, ".contracts");
        console2.log("registry:", address(reg));
        console2.log("factory:", address(factory));
    }

    function gates() external {
        _init();
        string memory cfg = vm.readFile(OUT);
        SignetRegistry reg = SignetRegistry(vm.parseJsonAddress(cfg, ".contracts.registry"));
        SignetFactory factory = SignetFactory(vm.parseJsonAddress(cfg, ".contracts.factory"));

        vm.startBroadcast(acct[0]);
        address site = _create(factory, SITE_DOMAIN); // must be the factory's FIRST gate
        address demo = _create(factory, DEMO_DOMAIN);
        vm.stopBroadcast();
        require(site == reg.signetSiteGate(), "site gate address was predicted wrong");

        vm.writeJson(_gateJson("site", site, SITE_DOMAIN, string.concat("signet/", SITE_DOMAIN, "/")), OUT, ".gates.site");
        vm.writeJson(_gateJson("demo", demo, DEMO_DOMAIN, string.concat("projects/", DEMO_DOMAIN, "/")), OUT, ".gates.demo");
        console2.log("Signet site gate:", site);
        console2.log("demo project gate:", demo);
    }

    function _create(SignetFactory factory, string memory domain) internal returns (address) {
        SignetFactory.DomainInit[] memory d = new SignetFactory.DomainInit[](1);
        d[0] = SignetFactory.DomainInit(domain, _salt(domain), address(0), 0);
        return factory.createGate([acct[1], acct[2], acct[3]], acct[4], acct[5], acct[6], d);
    }

    function _gateJson(string memory key, address gate, string memory domain, string memory prefix)
        internal
        returns (string memory)
    {
        vm.serializeAddress(key, "address", gate);
        vm.serializeString(key, "domain", domain);
        return vm.serializeString(key, "prefix", prefix);
    }

    /// For a deployment made by the MAINNET scripts (staging/rehearse-mainnet-full.sh): there the factory's first gate
    /// is already Signet's site gate, so only the demo project's gate is added, as any user would: commit, then
    /// (2 blocks later) create. Writes .gates.demo.
    function demoCommit() external {
        _init();
        SignetFactory factory = SignetFactory(vm.parseJsonAddress(vm.readFile(OUT), ".contracts.factory"));
        vm.startBroadcast(acct[0]);
        factory.commit(factory.commitmentOf(DEMO_DOMAIN, _salt(DEMO_DOMAIN), acct[0]));
        vm.stopBroadcast();
    }

    function demoGate() external {
        _init();
        SignetFactory factory = SignetFactory(vm.parseJsonAddress(vm.readFile(OUT), ".contracts.factory"));
        vm.startBroadcast(acct[0]);
        address demo = _create(factory, DEMO_DOMAIN);
        vm.stopBroadcast();
        vm.writeJson(_gateJson("demo", demo, DEMO_DOMAIN, string.concat("projects/", DEMO_DOMAIN, "/")), OUT, ".gates.demo");
        console2.log("demo project gate:", demo);
    }

    /// One release, end to end, on the demo gate. Each actor sends their own transaction.
    function smoke() external {
        _init();
        string memory cfg = vm.readFile(OUT);
        SignetRegistry reg = SignetRegistry(vm.parseJsonAddress(cfg, ".contracts.registry"));
        ReleaseGate gate = ReleaseGate(vm.parseJsonAddress(cfg, ".gates.demo.address"));

        bytes memory allowlist = bytes('{"196":{"targets":[],"spenders":[],"eip712":[]}}');
        bytes memory origins = bytes('["http://127.0.0.1:8545"]');
        bytes memory index = bytes(string.concat("<!doctype html><title>staging smoke ", vm.toString(block.number), "</title>"));
        bytes32 root = sha256(abi.encode(DEMO_DOMAIN, "index.html", "text/html", sha256(index)));
        bytes32 ha = sha256(allowlist);
        bytes32 ho = sha256(origins);

        vm.broadcast(acct[4]); // CI proposes; "e" asks for the fast lane (the allowlist changed or it is the first release)
        uint64 id = gate.proposeRelease(root, ha, ho, true);
        for (uint256 i = 1; i <= 3; i++) {
            vm.broadcast(acct[i]);
            gate.approve(id);
        }
        vm.startBroadcast(acct[7]); // anyone can publish and relay the files
        gate.publish(id);
        bytes32[] memory none;
        reg.writeFile(SignetRegistry.File(DEMO_DOMAIN, "index.html", "text/html", index, none));
        reg.writeFile(SignetRegistry.File(DEMO_DOMAIN, "signet/allowlist.json", "application/json", allowlist, none));
        reg.writeFile(SignetRegistry.File(DEMO_DOMAIN, "signet/origins.json", "application/json", origins, none));
        vm.stopBroadcast();

        (, address container, string memory prefix) = reg.bindingOf(DEMO_DOMAIN);
        require(keccak256(ISiteReadS(SITES).read(container, string.concat(prefix, "index.html"))) == keccak256(index), "read-back");
        require(gate.isValidManifest(sha256(abi.encode(root, ha, ho))), "manifest not valid");
        console2.log("smoke OK: release", id, "published and files written under", prefix);
    }
}
