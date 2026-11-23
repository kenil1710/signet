// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockVault, MockVaultFactory} from "./mocks/MockVaultFactory.sol";

/// The staging factory behaves like Misthos's: the predicted address is where createVault deploys, per caller.
contract MockVaultFactoryTest is Test {
    function test_predictMatchesCreate() public {
        MockVaultFactory f = new MockVaultFactory();
        address me = makeAddr("me");
        bytes32 id = keccak256("program");
        address predicted = f.predictVaultAddress(me, id);
        vm.prank(me);
        address v = f.createVault(id, me, makeAddr("agent"), address(0));
        assertEq(v, predicted);
        assertEq(MockVault(v).owner(), me);
        assertEq(MockVault(v).programId(), id);
        assertTrue(f.predictVaultAddress(makeAddr("other"), id) != v, "another caller gets another address");
    }
}
