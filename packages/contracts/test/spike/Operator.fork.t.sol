// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";

interface ISR {
    function setOperator(address container, address op, uint256 ttl) external;
    function operatorOf(address container) external view returns (address);
    function operatorUntil(address container) external view returns (uint256);
    function canEdit(address container, address account) external view returns (bool);
    function putFile(address, string calldata, string calldata, bytes32, bytes calldata) external;
    function appendChunk(address, string calldata, uint256, bytes calldata) external;
    function removeFile(address, string calldata) external;
    function setFallback(address, string calldata) external;
    function fallbackPath(address) external view returns (string memory);
    function fileInfo(address, string calldata) external view returns (uint32, string memory, bytes32, uint40, uint256);
}

interface I721 {
    function safeTransferFrom(address, address, uint256) external;
}

contract Holder {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function call(address t, bytes calldata d) external returns (bytes memory) {
        (bool ok, bytes memory r) = t.call(d);
        if (!ok) assembly { revert(add(r, 32), mload(r)) }
        return r;
    }
}

/// How SiteRegistry operators behave (needed for SignetRegistry as operator of the shared container).
/// LOCAL fork, nothing broadcast. SKIPPED when XLAYER_RPC_URL is unset.
contract OperatorForkTest is Test {
    ISR constant S = ISR(0xd6EFb7adCc9c83dC4924Ad56f6a8E4e969b9ADB6);
    address constant CPU = 0x73153e5fd2Acac604D49d6ca9fea27b750718F22;
    address constant DEV = 0x79327d03b79c99a88A838e82bE9d17eB1A62c7BE;
    address constant C = 0x8E2E14Ac2B8EfAB942d2dAEbe232071460bA94Ed;

    function test_operatorSemantics() public {
        string memory rpc = vm.envOr("XLAYER_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc, 76_306_000); // before circuit #5 moved into the site gate (block 76,306,374)
        Holder h = new Holder();
        vm.prank(DEV);
        I721(CPU).safeTransferFrom(DEV, address(h), 5);
        address op = makeAddr("operator");
        address op2 = makeAddr("operator2");

        // too long TTL?
        (bool longOk,) = address(h).call(abi.encodeCall(Holder.call, (address(S), abi.encodeCall(ISR.setOperator, (C, op, 31 days)))));
        console2.log("setOperator ttl 31 days accepted:", longOk);
        h.call(address(S), abi.encodeCall(ISR.setOperator, (C, op, 30 days)));
        console2.log("operatorOf:", S.operatorOf(C));
        console2.log("operatorUntil - now:", S.operatorUntil(C) - block.timestamp);
        console2.log("canEdit(op):", S.canEdit(C, op));

        bytes memory d1 = new bytes(24_000);
        bytes memory d2 = bytes("tail");
        bytes32 hw = sha256(bytes.concat(d1, d2));
        vm.startPrank(op);
        S.putFile(C, "projects/x.org/big.json", "application/json", hw, d1);
        S.appendChunk(C, "projects/x.org/big.json", 1, d2);
        (uint32 size,,,, uint256 chunks) = S.fileInfo(C, "projects/x.org/big.json");
        console2.log("operator chunked write size/chunks:", size, chunks);
        S.removeFile(C, "projects/x.org/big.json");
        (,,,, chunks) = S.fileInfo(C, "projects/x.org/big.json");
        console2.log("operator removeFile -> chunks:", chunks);
        S.putFile(C, "projects/x.org/index.html", "text/html", sha256("hi"), "hi");
        S.setFallback(C, "projects/x.org/index.html");
        console2.log("operator setFallback -> container fallback:", S.fallbackPath(C));
        (bool opSetsOp,) = address(S).call(abi.encodeCall(ISR.setOperator, (C, op2, 1 days)));
        console2.log("operator can set another operator:", opSetsOp);
        vm.stopPrank();

        // a second operator replaces the first?
        h.call(address(S), abi.encodeCall(ISR.setOperator, (C, op2, 1 days)));
        console2.log("after setting op2: canEdit(op) / canEdit(op2):", S.canEdit(C, op), S.canEdit(C, op2));
        // expiry
        vm.warp(block.timestamp + 1 days + 1);
        console2.log("op2 after ttl: canEdit:", S.canEdit(C, op2));
        // re-setting same operator renews
        h.call(address(S), abi.encodeCall(ISR.setOperator, (C, op2, 30 days)));
        console2.log("op2 renewed: canEdit:", S.canEdit(C, op2));
        // NFT transfer clears the operator?
        address newHolder = address(new Holder());
        h.call(CPU, abi.encodeWithSignature("safeTransferFrom(address,address,uint256)", address(h), newHolder, 5));
        console2.log("after NFT transfer: canEdit(op2):", S.canEdit(C, op2));
    }
}
