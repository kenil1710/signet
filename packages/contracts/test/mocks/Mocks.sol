// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC721ReceiverLike {
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4);
}

/// Processor stand-in that evaluates real TAP-02 NAND netlists (no LATCH/REF): same semantics as the chain
/// (docs/tapeout-interfaces.md §2), so unit tests run the actual policy netlist bytes. Also a tiny ERC-721.
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

    function safeTransferFrom(address from, address to, uint256 id) external {
        require(ownerOf[id] == from && msg.sender == from, "not owner");
        ownerOf[id] = to;
        if (to.code.length > 0) {
            require(
                IERC721ReceiverLike(to).onERC721Received(msg.sender, from, id, "")
                    == IERC721ReceiverLike.onERC721Received.selector,
                "unsafe recipient"
            );
        }
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

/// Different code (so a different code hash) that answers like a processor: a fake "processor".
contract FakeProcessor {
    bytes internal nl;

    constructor(bytes memory n) {
        nl = n;
    }

    function circuitInfo(uint256) external view returns (uint32, uint32, uint32, uint32) {
        return (9, 2, 0, uint32(nl.length / 7));
    }

    function netlist(uint256) external view returns (bytes memory) {
        return nl;
    }

    function eval(uint256, bytes calldata) external pure returns (bytes memory) {
        return hex"03"; // always PUBLISH + UNFREEZE
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
    function accountOf(address circuits, uint256 tokenId) public pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encode("container", circuits, tokenId)))));
    }
}

/// SiteRegistry stand-in with the measured rules (docs §8): the circuit holder or the container's single
/// operator may write; setOperator is holder-only with ttl <= 30 days; chunks <= 24,000 bytes; one fallback
/// per container.
contract MockSiteRegistry {
    struct Token {
        NetlistProcessor nft;
        uint256 id;
    }

    struct File {
        bytes32 h;
        string contentType;
        bytes data;
        uint256 chunks;
    }

    mapping(address => Token) public tokenOf;
    mapping(address => address) public operatorOf;
    mapping(address => uint256) public operatorUntil;
    mapping(address => mapping(string => File)) internal files;
    mapping(address => string) public fallbackPath;

    function registerContainer(address container, NetlistProcessor nft, uint256 id) external {
        tokenOf[container] = Token(nft, id);
    }

    function _holder(address c) internal view returns (address) {
        Token storage t = tokenOf[c];
        return address(t.nft) == address(0) ? address(0) : t.nft.ownerOf(t.id);
    }

    function canEdit(address c, address who) public view returns (bool) {
        return who != address(0) && (_holder(c) == who || (operatorOf[c] == who && block.timestamp < operatorUntil[c]));
    }

    modifier editor(address c) {
        require(canEdit(c, msg.sender), "NotOwner");
        _;
    }

    function setOperator(address c, address op, uint256 ttl) external {
        require(_holder(c) == msg.sender, "NotOwner");
        require(ttl <= 30 days, "ttl");
        operatorOf[c] = op;
        operatorUntil[c] = block.timestamp + ttl;
    }

    function putFile(address c, string calldata path, string calldata contentType, bytes32 h, bytes calldata data)
        external
        editor(c)
    {
        require(data.length <= 24_000, "chunk");
        files[c][path] = File(h, contentType, data, 1);
    }

    function appendChunk(address c, string calldata path, uint256 expectIndex, bytes calldata data) external editor(c) {
        File storage f = files[c][path];
        require(f.chunks == expectIndex && data.length <= 24_000, "chunk");
        f.data = bytes.concat(f.data, data);
        f.chunks++;
    }

    function removeFile(address c, string calldata path) external editor(c) {
        delete files[c][path];
    }

    function setFallback(address c, string calldata path) external editor(c) {
        fallbackPath[c] = path;
    }

    function fileInfo(address c, string calldata path) external view returns (uint32, string memory, bytes32, uint40, uint256) {
        File storage f = files[c][path];
        return (uint32(f.data.length), f.contentType, f.h, 0, f.chunks);
    }

    function read(address c, string calldata path) external view returns (bytes memory) {
        return files[c][path].data;
    }
}
