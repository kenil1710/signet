// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Spike A interfaces. Every function here is recorded in docs/tapeout-interfaces.md with its
// source: TAP-02 §6 (processor read functions + tapeout), or a selector present in the X Layer
// bytecode and resolved via the public signature DB (marked "bytecode" there).
// Do not add functions that are not in that file.

/// Processor contract ("cpu"): ERC-721 beacon proxy created by the factory. Stores and evaluates circuits.
interface ITapeOutProcessor {
    function nextId() external view returns (uint256);
    function circuitInfo(uint256 id) external view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);
    function netlist(uint256 id) external view returns (bytes memory);
    /// One beat of a combinational circuit. Inputs/outputs packed LSB-first (TAP-02 §5).
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
    function tapeout(bytes calldata netlist, uint32 nIn, uint32 nOut) external payable returns (uint256 id);
    function TAPEOUT_FEE() external view returns (uint256);
    function transistors() external view returns (address);
    function ownerOf(uint256 id) external view returns (address);
}

/// Per-processor transistor token (ERC-1155). Token ids: NAND() and LATCH().
interface ITapeOutTransistors {
    function NAND() external view returns (uint256);
    function LATCH() external view returns (uint256);
    function mintPrice() external view returns (uint256);
    function protocolFee() external view returns (uint256);
    function supplyCap() external view returns (uint256);
    function minted() external view returns (uint256);
    /// Payment rule (msg.value) is NOT documented; measured on a fork in test/spike/SpikeA.fork.t.sol.
    function mint(uint256 id, uint256 amount) external payable;
    function balanceOf(address account, uint256 id) external view returns (uint256);
}

/// Processor factory (UUPS proxy).
interface ITapeOutFactory {
    function cpuCount() external view returns (uint256);
    function cpuAt(uint256 i) external view returns (address);
    function isCPU(address cpu) external view returns (bool);
    function isSealed() external view returns (uint256);
    function circuitBeacon() external view returns (address);
}

/// Container opener: derives each circuit's ERC-6551 container and opens it (one-time FEE()).
/// Sources: TAP-10 Appendix A (accountOf, isOpened) + X Layer bytecode (open, FEE, isDeployed).
interface ITapeOutContainerOpener {
    function accountOf(address circuits, uint256 tokenId) external view returns (address);
    function isOpened(address circuits, uint256 tokenId) external view returns (bool);
    function isDeployed(address circuits, uint256 tokenId) external view returns (bool);
    function FEE() external view returns (uint256);
    /// Payment rule and caller rule measured on a fork in test/spike/SpikeB.fork.t.sol.
    function open(address circuits, uint256 tokenId) external payable;
}

/// SiteRegistry (site store). Source: TAP-10 Appendix A (reads + writes) + X Layer bytecode.
interface ISiteRegistry {
    function fileInfo(address container, string calldata path)
        external
        view
        returns (uint32 size, string memory contentType, bytes32 sha256Hash, uint40 updatedAt, uint256 chunkCount);
    function read(address container, string calldata path) external view returns (bytes memory);
    function readRange(address container, string calldata path, uint256 offset, uint256 len)
        external
        view
        returns (bytes memory);
    function pathCount(address container) external view returns (uint256);
    function isOpenedContainer(address container) external view returns (bool);
    function canEdit(address container, address account) external view returns (bool);
    function CHUNK_MAX() external view returns (uint256);
    function CHUNKS_MAX() external view returns (uint256);
    /// Writes the first chunk (<= CHUNK_MAX bytes) and replaces an existing file.
    function putFile(address container, string calldata path, string calldata contentType, bytes32 sha256Hash, bytes calldata data)
        external;
    /// Appends a chunk when expectIndex equals the current chunk count.
    function appendChunk(address container, string calldata path, uint256 expectIndex, bytes calldata data) external;
    function removeFile(address container, string calldata path) external;
}
