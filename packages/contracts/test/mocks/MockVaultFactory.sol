// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Staging stand-ins for a Misthos-style vault factory (Signet v2 factory rule tests, packages/extension/test/staging/
/// ssr.test.ts): EIP-1167 clones deployed with CREATE2 from (caller, programId), a view that predicts the address,
/// and vaults whose owner can be transferred. Not deployed anywhere but the local staging chain.
contract MockVault {
    bytes32 public programId;
    address public owner;
    address public agent;
    address public guardian;
    bool private _init;

    event Deposited(address indexed from, uint256 amount);

    function initialize(bytes32 programId_, address owner_, address agent_, address guardian_) external {
        require(!_init, "initialized");
        _init = true;
        (programId, owner, agent, guardian) = (programId_, owner_, agent_, guardian_);
    }

    function deposit(uint256 amount) external {
        emit Deposited(msg.sender, amount);
    }

    function transferOwnership(address owner_) external {
        require(msg.sender == owner, "not owner");
        owner = owner_;
    }
}

contract MockVaultFactory {
    address public immutable implementation;

    event VaultCreated(bytes32 indexed programId, address indexed vault, address indexed owner, address agent);

    constructor() {
        implementation = address(new MockVault());
    }

    function createVault(bytes32 programId, address owner, address agent, address guardian) external returns (address vault) {
        bytes32 salt = keccak256(abi.encode(msg.sender, programId));
        address impl = implementation;
        assembly ("memory-safe") {
            mstore(0x00, or(shr(0xe8, shl(0x60, impl)), 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000))
            mstore(0x20, or(shl(0x78, impl), 0x5af43d82803e903d91602b57fd5bf3))
            vault := create2(0, 0x09, 0x37, salt)
        }
        require(vault != address(0), "clone failed");
        MockVault(vault).initialize(programId, owner, agent, guardian);
        emit VaultCreated(programId, vault, owner, agent);
    }

    function predictVaultAddress(address deployer, bytes32 programId) external view returns (address) {
        bytes32 salt = keccak256(abi.encode(deployer, programId));
        bytes memory init = abi.encodePacked(hex"3d602d80600a3d3981f3363d3d373d3d3d363d73", implementation, hex"5af43d82803e903d91602b57fd5bf3");
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(init))))));
    }
}
