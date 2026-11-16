// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Processor stand-in that evaluates real TAP-02 NAND netlists (no LATCH/REF): same semantics as the chain
/// (docs/tapeout-interfaces.md §2), so unit tests run the actual policy netlist bytes.
contract NetlistProcessor {
    struct C {
        bytes netlist;
        uint32 nIn;
        uint32 nOut;
        bool exists;
    }

    mapping(uint256 => C) internal circuits;
    mapping(uint256 => address) public ownerOf;

    function set(uint256 id, bytes calldata nl, uint32 nIn, uint32 nOut) external {
        require(nl.length % 7 == 0, "NAND only");
        circuits[id] = C(nl, nIn, nOut, true);
    }

    function setOwner(uint256 id, address o) external {
        ownerOf[id] = o;
    }

    function circuitInfo(uint256 id) external view returns (uint32, uint32, uint32, uint32) {
        C storage c = circuits[id];
        require(c.exists, "no circuit");
        return (c.nIn, c.nOut, 0, uint32(c.netlist.length / 7));
    }

    function netlist(uint256 id) external view returns (bytes memory) {
        return circuits[id].netlist;
    }

    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory out) {
        C storage c = circuits[id];
        require(c.exists, "no circuit");
        bytes memory nl = c.netlist;
        uint256 nIn = c.nIn;
        uint256 gates = nl.length / 7;
        uint256 total = 2 + nIn + gates;
        bool[] memory s = new bool[](total);
        s[1] = true;
        for (uint256 i; i < nIn; i++) {
            s[2 + i] = i / 8 < inputs.length && (uint8(inputs[i / 8]) >> (i % 8)) & 1 == 1;
        }
        for (uint256 g; g < gates; g++) {
            uint256 o = g * 7;
            require(nl[o] == 0x00, "bad opcode");
            uint256 a = (uint256(uint8(nl[o + 1])) << 16) | (uint256(uint8(nl[o + 2])) << 8) | uint8(nl[o + 3]);
            uint256 b = (uint256(uint8(nl[o + 4])) << 16) | (uint256(uint8(nl[o + 5])) << 8) | uint8(nl[o + 6]);
            require(a < 2 + nIn + g && b < 2 + nIn + g, "NAND: future signal");
            s[2 + nIn + g] = !(s[a] && s[b]);
        }
        out = new bytes((c.nOut + 7) / 8);
        for (uint256 j; j < c.nOut; j++) {
            if (s[total - c.nOut + j]) out[j / 8] = bytes1(uint8(out[j / 8]) | uint8(1 << (j % 8)));
        }
    }
}

contract MockBeacon {
    address public implementation;

    constructor(address i) {
        implementation = i;
    }

    function set(address i) external {
        implementation = i;
    }
}

contract MockOpener {
    address public immutable container;

    constructor(address c) {
        container = c;
    }

    function accountOf(address, uint256) external view returns (address) {
        return container;
    }
}

/// Records putFile calls; like the real one, only the circuit holder may write.
contract MockSiteRegistry {
    NetlistProcessor public immutable nft;
    uint256 public immutable id;

    struct File {
        bytes32 h;
        bytes data;
        address container;
        uint256 writes;
    }

    mapping(string => File) public files;

    constructor(NetlistProcessor n, uint256 i) {
        nft = n;
        id = i;
    }

    function putFile(address container, string calldata path, string calldata, bytes32 h, bytes calldata data) external {
        require(nft.ownerOf(id) == msg.sender, "NotOwner");
        File storage f = files[path];
        f.h = h;
        f.data = data;
        f.container = container;
        f.writes++;
    }

    function fileData(string calldata path) external view returns (bytes memory) {
        return files[path].data;
    }
}
